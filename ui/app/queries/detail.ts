/** Per-application drill-down queries. Each is scoped to a single appID (cheap). */
import { sanitizeAppId } from "./common";

/** Tag-adherence fieldsAdd block shared by host / service / process-group queries.
 *  Computed on the full tags array (before expand). */
const tagFlags = `
| fieldsAdd hasAppIDTag = if(contains(toString(tags), "AppID:"), "Yes", else: "No"),
            hasAppNameTag = if(contains(toString(tags), "App_Name:"), "Yes", else: "No"),
            hasBUTag = if(contains(toString(tags), "BU:"), "Yes", else: "No"),
            hasEnvTag = if(contains(toString(tags), "Environment:"), "Yes", else: "No"),
            hasLocationTag = if(contains(toString(tags), "Location:"), "Yes", else: "No")`;

/** Coarse pre-filter applied right after fetch: keeps only entities whose tag string
 *  contains the AppID (a superset — the exact `appID == id` match after expand makes it
 *  precise). This collapses the expand cardinality from "all entities" to just this app's,
 *  which keeps the process-group query (tens of thousands of PGIs) well within app limits. */
const tagPreFilter = (id: string) => `| filter contains(toString(tags), "AppID:${id}")`;

/** Full LeanIX record for one application (drives the metadata card). */
export function leanixDetailQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
load "/lookups/leanix_data"
| fieldsAdd appID = trim(appID)
| filter appID == "${id}"
| limit 1`;
}

/** Host ids directly tagged with the app, plus hosts its tagged services/PGIs run on. */
const appHostIds = (id: string) => `
fetch dt.entity.host
| filter contains(toString(tags), "AppID:${id}")
| expand tags | parse tags, """'AppID:'LD:appID""" | fieldsAdd appID = trim(appID) | filter appID == "${id}"
| fields hostId = id
| append [ fetch dt.entity.service | filter contains(toString(tags), "AppID:${id}")
          | expand tags | parse tags, """'AppID:'LD:appID""" | fieldsAdd appID = trim(appID) | filter appID == "${id}"
          | fieldsAdd h = runs_on[dt.entity.host] | expand h | fields hostId = h ]
| append [ fetch dt.entity.process_group_instance | filter contains(toString(tags), "AppID:${id}")
          | expand tags | parse tags, """'AppID:'LD:appID""" | fieldsAdd appID = trim(appID) | filter appID == "${id}"
          | fieldsAdd h = belongs_to[dt.entity.host] | fields hostId = h ]
| filter isNotNull(hostId)
| dedup hostId`;

/**
 * Hosts for the app — directly tagged OR running one of the app's tagged services/PGIs.
 * `hasAppIDTag` is app-specific, so a host that appears via a service but isn't tagged
 * with this AppID shows the gap.
 */
export function hostDetailQuery(appID: string, cutoff: number): string {
  const id = sanitizeAppId(appID);
  return `
${appHostIds(id)}
| lookup [ fetch dt.entity.host
           | filter lifetime[end] > now()-2h
           | fieldsAdd tags
           | fieldsAdd hasAppIDTag = if(contains(toString(tags), "AppID:${id}"), "Yes", else: "No"),
                       hasAppNameTag = if(contains(toString(tags), "App_Name:"), "Yes", else: "No"),
                       hasBUTag = if(contains(toString(tags), "BU:"), "Yes", else: "No"),
                       hasEnvTag = if(contains(toString(tags), "Environment:"), "Yes", else: "No"),
                       hasLocationTag = if(contains(toString(tags), "Location:"), "Yes", else: "No")
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
| fieldsAdd tags
${tagPreFilter(id)}${tagFlags}
| expand tags
| parse tags, """'AppID:'LD:appID"""
| fieldsAdd appID = trim(appID)
| filter appID == "${id}"
| fieldsAdd Upstream = arraySize(called_by[dt.entity.service]),
            Downstream = arraySize(calls[dt.entity.service]),
            hostEntityId = arrayFirst(runs_on[dt.entity.host]),
            HostCount = arraySize(runs_on[dt.entity.host])
| lookup [ fetch dt.entity.host | fields id, entity.name ],
    sourceField: hostEntityId, lookupField: id, fields: { Host = entity.name }
| fields Service = entity.name, id, HostId = hostEntityId, Host, HostCount, Upstream, Downstream,
         hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag
| dedup id
| sort Service asc
| limit 1000`;
}

/**
 * Process group instances for the app — directly tagged OR run by one of the app's tagged
 * services. `hasAppIDTag` is app-specific so untagged-but-related processes show the gap.
 */
export function processGroupInstanceDetailQuery(appID: string): string {
  const id = sanitizeAppId(appID);
  return `
fetch dt.entity.process_group_instance
| filter contains(toString(tags), "AppID:${id}")
| expand tags | parse tags, """'AppID:'LD:appID""" | fieldsAdd appID = trim(appID) | filter appID == "${id}"
| fields pgiId = id
| append [ fetch dt.entity.service | filter contains(toString(tags), "AppID:${id}")
          | expand tags | parse tags, """'AppID:'LD:appID""" | fieldsAdd appID = trim(appID) | filter appID == "${id}"
          | fieldsAdd p = runs_on[dt.entity.process_group_instance] | expand p | fields pgiId = p ]
| filter isNotNull(pgiId)
| dedup pgiId
| lookup [ fetch dt.entity.process_group_instance
           | fieldsAdd tags
           | fieldsAdd hasAppIDTag = if(contains(toString(tags), "AppID:${id}"), "Yes", else: "No"),
                       hasAppNameTag = if(contains(toString(tags), "App_Name:"), "Yes", else: "No"),
                       hasBUTag = if(contains(toString(tags), "BU:"), "Yes", else: "No"),
                       hasEnvTag = if(contains(toString(tags), "Environment:"), "Yes", else: "No"),
                       hasLocationTag = if(contains(toString(tags), "Location:"), "Yes", else: "No")
           | fieldsAdd hostEntityId = belongs_to[dt.entity.host]
           | fields id, ProcessGroupInstance = entity.name, hostEntityId,
                    hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag ],
    sourceField: pgiId, lookupField: id,
    fields: { ProcessGroupInstance, hostEntityId, hasAppIDTag, hasAppNameTag, hasBUTag, hasEnvTag, hasLocationTag }
| filter isNotNull(ProcessGroupInstance)
| lookup [ fetch dt.entity.host | fields id, entity.name ],
    sourceField: hostEntityId, lookupField: id, fields: { Host = entity.name }
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
| fieldsAdd tags
${tagPreFilter(id)}
| expand tags
| parse tags, """'AppID:'LD:appID"""
| fieldsAdd appID = trim(appID)
| filter appID == "${id}"
| fieldsAdd Namespace = namespaceName, Type = arrayFirst(cloudApplicationDeploymentTypes)
| fields Workload = entity.name, id, Namespace, Type
| dedup id
| sort Workload asc
| limit 1000`;
}
