/** Per-application drill-down queries. Each is scoped to a single appID. */
import { sanitizeAppId } from "./common";

/**
 * PERFORMANCE: `in("AppID:<id>", tags)` is an indexed, exact array-element match.
 * It replaces the old `contains(toString(tags), ...)` + `expand tags` + `parse` pattern,
 * which forced a full entity scan (154k+ process-group instances). Measured on this
 * tenant: ~3k scanned records vs ~155k — and it is exact, so no `AppID:139410`-style
 * substring false positives. Never reintroduce expand/parse for single-app filtering.
 */
const tagged = (id: string) => `| filter in("AppID:${id}", tags)`;

/** Tag-adherence flags. `hasAppIDTag` is app-specific (does it carry THIS app's tag);
 *  the rest are presence checks. All computed on the tags array — no expand. */
const tagFlags = (id: string) => `
| fieldsAdd hasAppIDTag = if(in("AppID:${id}", tags), "Yes", else: "No"),
            hasAppNameTag = if(contains(toString(tags), "App_Name:"), "Yes", else: "No"),
            hasBUTag = if(contains(toString(tags), "BU:"), "Yes", else: "No"),
            hasEnvTag = if(contains(toString(tags), "Environment:"), "Yes", else: "No"),
            hasLocationTag = if(contains(toString(tags), "Location:"), "Yes", else: "No")`;

/** Resolve a host entity id -> host name (host table is small, so this join is cheap). */
const hostNameLookup = `
| lookup [ fetch dt.entity.host | fields id, entity.name ],
    sourceField: hostEntityId, lookupField: id, fields: { Host = entity.name }`;

/** Full LeanIX record for one application (drives the metadata card). */
export function leanixDetailQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
load "/lookups/leanix_data"
| fieldsAdd appID = trim(appID)
| filter appID == "${id}"
| limit 1`;
}

/**
 * Hosts for the app — directly tagged OR running one of the app's tagged services/PGIs.
 * All three branches use the indexed tag match; the final lookup resolves details from the
 * (small) host table, so the whole thing stays cheap.
 */
export function hostDetailQuery(appID: string, cutoff: number): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.host
${tagged(id)}
| fields hostId = id
| append [ fetch dt.entity.service ${tagged(id)}
          | fieldsAdd h = runs_on[dt.entity.host] | expand h | fields hostId = h ]
| append [ fetch dt.entity.process_group_instance ${tagged(id)}
          | fieldsAdd h = belongs_to[dt.entity.host] | fields hostId = h ]
| filter isNotNull(hostId)
| dedup hostId
| lookup [ fetch dt.entity.host
           | filter lifetime[end] > now()-2h
           | fieldsAdd tags${tagFlags(id)}
           | fieldsAdd minor = toLong(splitString(installerVersion, ".")[1])
           | fieldsAdd outdatedAgent = if(isNotNull(minor) AND minor < ${cutoff}, "Yes", else: "No")
           | fields id, Host = entity.name, osType, monitoringMode, hostGroup = hostGroupName,
                    installerVersion, outdatedAgent,
                    hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag ],
    sourceField: hostId, lookupField: id,
    fields: { Host, osType, monitoringMode, hostGroup, installerVersion, outdatedAgent,
              hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag }
| filter isNotNull(Host)
| fields id = hostId, Host, osType, monitoringMode, hostGroup, installerVersion, outdatedAgent,
         hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag
| sort Host asc
| limit 1000`;
}

/** Services for the app with tag adherence, host attribution and connectivity. */
export function serviceDetailQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.service
${tagged(id)}
| fieldsAdd tags${tagFlags(id)}
| fieldsAdd Upstream = arraySize(called_by[dt.entity.service]),
            Downstream = arraySize(calls[dt.entity.service]),
            hostEntityId = arrayFirst(runs_on[dt.entity.host]),
            HostCount = arraySize(runs_on[dt.entity.host])
${hostNameLookup}
| fields Service = entity.name, id, HostId = hostEntityId, Host, HostCount, Upstream, Downstream,
         hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag
| dedup id
| sort Service asc
| limit 1000`;
}

/**
 * Process group instances tagged with this app — the FAST path (indexed).
 * Covers every properly-tagged application. If it returns nothing, the app falls back to
 * the service-derived query below.
 */
export function processGroupInstanceDetailQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.process_group_instance
${tagged(id)}
| fieldsAdd tags${tagFlags(id)}
| fieldsAdd hostEntityId = belongs_to[dt.entity.host]
${hostNameLookup}
| fields id, ProcessGroupInstance = entity.name, HostId = hostEntityId, Host,
         hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag
| dedup id
| sort ProcessGroupInstance asc
| limit 2000`;
}

/**
 * FALLBACK for applications with no tagged process groups (e.g. a tagged service whose
 * hosts/processes were never tagged). Finds the processes the app's tagged services run on.
 *
 * This is deliberately only used when the fast query returns zero rows: resolving details
 * for untagged PGIs requires a full scan of the process-group table (~155k records on this
 * tenant), which is far too slow to run on every application.
 */
export function processGroupInstanceViaServiceQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.service
${tagged(id)}
| fieldsAdd p = runs_on[dt.entity.process_group_instance]
| expand p
| filter isNotNull(p)
| fields pgiId = p
| dedup pgiId
| lookup [ fetch dt.entity.process_group_instance
           | fieldsAdd tags${tagFlags(id)}
           | fieldsAdd hostEntityId = belongs_to[dt.entity.host]
           | fields id, ProcessGroupInstance = entity.name, hostEntityId,
                    hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag ],
    sourceField: pgiId, lookupField: id,
    fields: { ProcessGroupInstance, hostEntityId, hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag }
| filter isNotNull(ProcessGroupInstance)
${hostNameLookup}
| fields id = pgiId, ProcessGroupInstance, HostId = hostEntityId, Host,
         hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag
| sort ProcessGroupInstance asc
| limit 2000`;
}

/** Log volume by source + host for the app.
 *  A full scan of this app's logs is very expensive (tens of GB), so this is SAMPLED
 *  (1:1000) — counts are approximate; use the Logs-app link on each row for exact data. */
export function logSourcesQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch logs, samplingRatio: 1000, from: now()-2h
| filter trim(toString(AppID)) == "${id}"
| summarize { Count = count(),
              Errors = countIf(loglevel == "ERROR" or status == "ERROR"),
              Warnings = countIf(loglevel == "WARN" or status == "WARN") },
            by: { Source = log.source, Host = host.name }
| sort Count desc
| limit 500`;
}

/** RUM (web + mobile) applications mapped to the app via the "<appID> - ..." name. */
export function rumDetailQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.mobile_application
| parse \`entity.name\`, """LD:appID, "-""""
| fieldsAdd appID = trim(appID), Type = "Mobile", lifetime
| filter appID == "${id}"
| append [
    fetch dt.entity.application
    | parse \`entity.name\`, """LD:appID, "-""""
    | fieldsAdd appID = trim(appID), Type = "Web", lifetime,
                Synthetics = arraySize(monitored_by[dt.entity.synthetic_test])
    | filter appID == "${id}" ]
| fieldsAdd Active = if(lifetime[end] > now()-7d, "Yes", else: "No"),
            Synthetics = coalesce(Synthetics, 0)
| fields Application = entity.name, id, Type, Active, Synthetics, LastSeen = lifetime[end]
| sort Application asc
| limit 500`;
}

/** Synthetic monitors (browser + http) mapped to the app's web applications. */
export function syntheticDetailQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.application
| parse \`entity.name\`, """LD:appID, "-""""
| fieldsAdd appID = trim(appID)
| filter appID == "${id}"
| fieldsAdd dt.entity.synthetic_test = monitored_by[dt.entity.synthetic_test]
| expand dt.entity.synthetic_test
| filter isNotNull(dt.entity.synthetic_test)
| fieldsAdd TestName = entityName(dt.entity.synthetic_test)
| dedup dt.entity.synthetic_test
| fields TestName, id = dt.entity.synthetic_test
| sort TestName asc
| limit 500`;
}

/** Kubernetes workloads (cloud applications) tagged to the app. */
export function k8sWorkloadsQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.cloud_application
${tagged(id)}
| fieldsAdd Namespace = namespaceName, Type = arrayFirst(cloudApplicationDeploymentTypes)
| fields Workload = entity.name, id, Namespace, Type
| dedup id
| sort Workload asc
| limit 1000`;
}
