/** Per-application drill-down queries, built from the environment configuration. */
import type { AppConfig } from "../config/types";
import {
  ID,
  adherenceFieldList,
  adherenceFlags,
  appIdLiteral,
  dqlField,
  dqlStr,
  loadLookup,
  taggedFilter,
} from "./common";

/** Resolve a host entity id -> host name. The host table is small, so this join is cheap
 *  (per-row entityName() blows the query budget at a few hundred rows). */
const hostNameLookup = `
| lookup [ fetch dt.entity.host | fields id, entity.name ],
    sourceField: hostEntityId, lookupField: id, fields: { Host = entity.name }`;

/** Matches RUM/synthetic entities for one application, per the configured mode. */
function rumFilter(cfg: AppConfig, appId: string): string | undefined {
  if (cfg.rum.mode === "name") {
    const d = dqlStr(cfg.rum.delimiter || "-");
    return `| fieldsAdd rumId = if(contains(\`entity.name\`, "${d}"), trim(splitString(\`entity.name\`, "${d}")[0]))
| filter rumId == "${appIdLiteral(appId)}"`;
  }
  if (cfg.rum.mode === "tag") {
    const key = cfg.rum.tagKey || cfg.entities.tagKey;
    return `| filter in("${dqlStr(key)}:${appIdLiteral(appId)}", tags)`;
  }
  return undefined;
}

/** The full lookup row for one application (drives the metadata card).
 *  Deliberately unprojected so every configured field is available without a query change. */
export function lookupDetailQuery(cfg: AppConfig, appId: string): string {
  return `
${loadLookup(cfg)}
| filter ${ID} == "${appIdLiteral(appId)}"
| limit 1`;
}

/** Host ids tagged with the app, plus hosts its tagged services/processes run on. */
function appHostIds(cfg: AppConfig, appId: string): string {
  const t = taggedFilter(cfg, appId);
  return `
fetch dt.entity.host
${t}
| fields hostId = id
| append [ fetch dt.entity.service ${t}
          | fieldsAdd h = runs_on[dt.entity.host] | expand h | fields hostId = h ]
| append [ fetch dt.entity.process_group_instance ${t}
          | fieldsAdd h = belongs_to[dt.entity.host] | fields hostId = h ]
| filter isNotNull(hostId)
| dedup hostId`;
}

/**
 * Hosts for the app — directly tagged OR running one of its tagged services/processes.
 * `hasAppIDTag` is app-specific, so a host that appears only via a service but isn't
 * tagged shows the gap rather than being hidden.
 */
export function hostDetailQuery(cfg: AppConfig, appId: string, cutoff: number): string {
  const hours = Math.max(1, Math.floor(cfg.windows.entityActivityHours ?? 2));
  const flags = adherenceFieldList(cfg).join(", ");
  return `
${appHostIds(cfg, appId)}
| lookup [ fetch dt.entity.host
           | filter lifetime[end] > now()-${hours}h
           | fieldsAdd tags
           ${adherenceFlags(cfg, appId)}
           | fieldsAdd minor = toLong(splitString(installerVersion, ".")[1])
           | fieldsAdd outdatedAgent = if(isNotNull(minor) AND minor < ${cutoff}, "Yes", else: "No")
           | fields id, Host = entity.name, osType, monitoringMode, hostGroup = hostGroupName,
                    installerVersion, outdatedAgent, ${flags} ],
    sourceField: hostId, lookupField: id,
    fields: { Host, osType, monitoringMode, hostGroup, installerVersion, outdatedAgent, ${flags} }
| filter isNotNull(Host)
| fields id = hostId, Host, osType, monitoringMode, hostGroup, installerVersion, outdatedAgent, ${flags}
| sort Host asc
| limit 1000`;
}

/** Services for the app with tag adherence, host attribution and connectivity. */
export function serviceDetailQuery(cfg: AppConfig, appId: string): string {
  const flags = adherenceFieldList(cfg).join(", ");
  return `
fetch dt.entity.service
${taggedFilter(cfg, appId)}
| fieldsAdd tags
${adherenceFlags(cfg, appId)}
| fieldsAdd Upstream = arraySize(called_by[dt.entity.service]),
            Downstream = arraySize(calls[dt.entity.service]),
            hostEntityId = arrayFirst(runs_on[dt.entity.host]),
            HostCount = arraySize(runs_on[dt.entity.host])
${hostNameLookup}
| fields Service = entity.name, id, HostId = hostEntityId, Host, HostCount, Upstream, Downstream, ${flags}
| dedup id
| sort Service asc
| limit 1000`;
}

/**
 * Process instances tagged with the app — the FAST path (indexed tag match).
 * Covers every properly tagged application; falls back below when it returns nothing.
 */
export function processGroupInstanceDetailQuery(cfg: AppConfig, appId: string): string {
  const flags = adherenceFieldList(cfg).join(", ");
  return `
fetch dt.entity.process_group_instance
${taggedFilter(cfg, appId)}
| fieldsAdd tags
${adherenceFlags(cfg, appId)}
| fieldsAdd hostEntityId = belongs_to[dt.entity.host]
${hostNameLookup}
| fields id, ProcessGroupInstance = entity.name, HostId = hostEntityId, Host, ${flags}
| dedup id
| sort ProcessGroupInstance asc
| limit 2000`;
}

/**
 * FALLBACK for applications with no tagged process groups (e.g. a tagged service whose
 * processes were never tagged). Only run when the fast query returns zero rows: resolving
 * details for untagged process instances requires a full scan of that table.
 */
export function processGroupInstanceViaServiceQuery(cfg: AppConfig, appId: string): string {
  const flags = adherenceFieldList(cfg).join(", ");
  return `
fetch dt.entity.service
${taggedFilter(cfg, appId)}
| fieldsAdd p = runs_on[dt.entity.process_group_instance]
| expand p
| filter isNotNull(p)
| fields pgiId = p
| dedup pgiId
| lookup [ fetch dt.entity.process_group_instance
           | fieldsAdd tags
           ${adherenceFlags(cfg, appId)}
           | fieldsAdd hostEntityId = belongs_to[dt.entity.host]
           | fields id, ProcessGroupInstance = entity.name, hostEntityId, ${flags} ],
    sourceField: pgiId, lookupField: id,
    fields: { ProcessGroupInstance, hostEntityId, ${flags} }
| filter isNotNull(ProcessGroupInstance)
${hostNameLookup}
| fields id = pgiId, ProcessGroupInstance, HostId = hostEntityId, Host, ${flags}
| sort ProcessGroupInstance asc
| limit 2000`;
}

/** Log volume by source + host. Sampled per config — a full scan of one app's logs is
 *  very expensive; each row deep-links to the Logs app for exact data. */
export function logSourcesQuery(cfg: AppConfig, appId: string): string {
  const hours = Math.max(1, Math.floor(cfg.logs.lookbackHours ?? 2));
  const ratio = Math.max(1, Math.floor(cfg.logs.samplingRatio ?? 1000));
  const sampling = ratio > 1 ? `, samplingRatio: ${ratio}` : "";
  const field = dqlField(cfg.logs.field);
  return `
fetch logs${sampling}, from: now()-${hours}h
| filter trim(toString(${field})) == "${appIdLiteral(appId)}"
| summarize { Count = count(),
              Errors = countIf(loglevel == "ERROR" or status == "ERROR"),
              Warnings = countIf(loglevel == "WARN" or status == "WARN") },
            by: { Source = log.source, Host = host.name }
| sort Count desc
| limit 500`;
}

/** RUM (web + mobile) applications for this app. */
export function rumDetailQuery(cfg: AppConfig, appId: string): string {
  const f = rumFilter(cfg, appId);
  if (!f) return "";
  return `
fetch dt.entity.mobile_application
${f}
| fieldsAdd Type = "Mobile", lifetime
| append [
    fetch dt.entity.application
    ${f}
    | fieldsAdd Type = "Web", lifetime,
                Synthetics = arraySize(monitored_by[dt.entity.synthetic_test]) ]
| fieldsAdd Active = if(lifetime[end] > now()-7d, "Yes", else: "No"),
            Synthetics = coalesce(Synthetics, 0)
| fields Application = entity.name, id, Type, Active, Synthetics, LastSeen = lifetime[end]
| sort Application asc
| limit 500`;
}

/** Synthetic monitors: either via the RUM app relationship, or by their own tag. */
export function syntheticDetailQuery(cfg: AppConfig, appId: string): string {
  if (cfg.synthetic.mode === "tag") {
    const key = cfg.synthetic.tagKey || cfg.entities.tagKey;
    return `
fetch dt.entity.synthetic_test
| filter in("${dqlStr(key)}:${appIdLiteral(appId)}", tags)
| fields TestName = entity.name, id
| dedup id
| sort TestName asc
| limit 500`;
  }
  const f = rumFilter(cfg, appId);
  if (cfg.synthetic.mode !== "viaRum" || !f) return "";
  return `
fetch dt.entity.application
${f}
| fieldsAdd dt.entity.synthetic_test = monitored_by[dt.entity.synthetic_test]
| expand dt.entity.synthetic_test
| filter isNotNull(dt.entity.synthetic_test)
| fieldsAdd TestName = entityName(dt.entity.synthetic_test)
| dedup dt.entity.synthetic_test
| fields TestName, id = dt.entity.synthetic_test
| sort TestName asc
| limit 500`;
}

/** Kubernetes workloads tagged to the app. */
export function k8sWorkloadsQuery(cfg: AppConfig, appId: string): string {
  return `
fetch dt.entity.cloud_application
${taggedFilter(cfg, appId)}
| fieldsAdd Namespace = namespaceName, Type = arrayFirst(cloudApplicationDeploymentTypes)
| fields Workload = entity.name, id, Namespace, Type
| dedup id
| sort Workload asc
| limit 1000`;
}
