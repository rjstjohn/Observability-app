import { APPID_FROM_TAGS } from "./common";

/**
 * Core portfolio-coverage query.
 *
 * Reads the LeanIX application portfolio (`/lookups/leanix_data`) and left-joins each
 * observability signal aggregated per appID. Returns ONE row per LeanIX application
 * (monitored or not) so a single query powers the Overview, Coverage, Recommendations
 * and Explorer tabs (filtered client-side).
 *
 * Optimizations vs. the source dashboards:
 *  - entity sub-queries scan once (0 GB) and aggregate per appID;
 *  - logs use `samplingRatio: 1000` presence instead of a 67 GB full scan;
 *  - "Metrics" is a real ingestion probe (timeseries), not a "service exists" proxy;
 *  - appIDs are trimmed on both sides (LeanIX/entity names contain stray spaces);
 *  - appID is extracted by expanding ONLY the AppID tag (APPID_FROM_TAGS) rather than
 *    every tag on every entity — ~10x fewer intermediate rows across the four branches.
 *
 * Validated live: full portfolio scans ~0.09 GB.
 */
export const COVERAGE_QUERY = `
load "/lookups/leanix_data"
| fieldsAdd appID = trim(appID)
| fields appID, appName, biaIndex, buOwnerName, itApplicationOwner, itPortfolioOwnerName,
         supportRemedyGroup, revenueGenerating, businessUnit, hostingEnvironment, applicationType
// HOSTS + monitoringMode
| lookup [
    fetch dt.entity.host
    | filter lifetime[end] > now()-2h
    ${APPID_FROM_TAGS}
    | summarize { hasFullStack = countIf(monitoringMode == "FULL_STACK"),
                  hasInfra = countIf(monitoringMode == "INFRASTRUCTURE"),
                  Hosts = count(),
                  FootPrint = sum(arraySize(runs[dt.entity.service])) }, by: {appID}
  ], sourceField: appID, lookupField: appID, fields: {hasFullStack, hasInfra, Hosts, FootPrint}
| fieldsAdd monitoringMode = if(isNull(Hosts), "None",
                             else: if(hasFullStack > 0, "Full",
                               else: if(hasInfra > 0, "Infrastructure", else: "Other"))),
            Hosts = coalesce(Hosts, 0), FootPrint = coalesce(FootPrint, 0)
| fieldsRemove hasFullStack, hasInfra
// SERVICES (Traces)
| lookup [
    fetch dt.entity.service ${APPID_FROM_TAGS}
    | summarize { Services = count() }, by: {appID}
  ], sourceField: appID, lookupField: appID, fields: {Services}
| fieldsAdd Services = coalesce(Services, 0), Traces = if(Services > 0, "Yes", else: "No")
// METRICS (real ingestion: host cpu or service request reporting datapoints)
| lookup [
    timeseries cpu = avg(dt.host.cpu.usage), by:{dt.entity.host}, from: now()-2h
    | filter isNotNull(arrayLast(arrayRemoveNulls(cpu))) | fields id = dt.entity.host
    | lookup [ fetch dt.entity.host ${APPID_FROM_TAGS} | fields id, appID | dedup id ], sourceField: id, lookupField: id, fields: {appID}
    | filter isNotNull(appID)
    | append [
        timeseries req = sum(dt.service.request.count), by:{dt.entity.service}, from: now()-2h
        | filter isNotNull(arrayLast(arrayRemoveNulls(req))) | fields id = dt.entity.service
        | lookup [ fetch dt.entity.service ${APPID_FROM_TAGS} | fields id, appID | dedup id ], sourceField: id, lookupField: id, fields: {appID}
        | filter isNotNull(appID) ]
    | fieldsAdd appID = trim(appID)
    | summarize { metricEntities = count() }, by: {appID}
  ], sourceField: appID, lookupField: appID, fields: {metricEntities}
| fieldsAdd Metrics = if(isNotNull(metricEntities) AND metricEntities > 0, "Yes", else: "No")
| fieldsRemove metricEntities
// NB: the Logs signal is intentionally NOT computed here. Log presence requires a ~0.27 GB
// sampled scan (there is no index on the AppID log field). Running it inline made the whole
// portfolio query wait on it. It is now a separate query (LOG_PRESENCE_QUERY) that runs in
// PARALLEL and is merged in usePortfolio, so the coverage query returns as soon as the
// (0 GB) entity work is done.
// RUM + SYNTHETIC (entity-name "<appID> - ..." convention)
| lookup [
    fetch dt.entity.mobile_application | parse \`entity.name\`, """LD:appID, "-""""
    | filter isNotNull(appID) | fieldsAdd hasSynthetic = false
    | append [ fetch dt.entity.application | parse \`entity.name\`, """LD:appID, "-""""
               | filter isNotNull(appID)
               | fieldsAdd hasSynthetic = (arraySize(monitored_by[dt.entity.synthetic_test]) > 0) ]
    | fieldsAdd appID = trim(appID)
    | summarize { rumApps = count(), synthApps = countIf(hasSynthetic == true) }, by: {appID}
  ], sourceField: appID, lookupField: appID, fields: {rumApps, synthApps}
| fieldsAdd RUM = if(isNotNull(rumApps) AND rumApps > 0, "Yes", else: "No"),
            Synthetic = if(isNotNull(synthApps) AND synthApps > 0, "Yes", else: "No")
| fieldsRemove rumApps, synthApps
// Monitored here excludes Logs (merged in client-side once LOG_PRESENCE_QUERY resolves).
| fieldsAdd Monitored = if(monitoringMode != "None" OR Traces == "Yes"
                          OR RUM == "Yes" OR Synthetic == "Yes" OR Metrics == "Yes", "Yes", else: "No")
| sort Hosts desc
| limit 5000
`;

/**
 * Log presence per application (sampled 1:1000). Run in parallel with COVERAGE_QUERY and
 * merged in usePortfolio; see the note in COVERAGE_QUERY for why it is separate.
 */
export const LOG_PRESENCE_QUERY = `
fetch logs, samplingRatio: 1000, from: now()-2h
| filter isNotNull(AppID)
| fieldsAdd appID = trim(toString(AppID))
| summarize logs = count(), by: {appID}
| fields appID
`;

export interface LogPresenceRow {
  appID: string;
}

export type YesNo = "Yes" | "No";
export type MonitoringMode = "Full" | "Infrastructure" | "Other" | "None";

export interface CoverageRow {
  appID: string;
  appName: string;
  biaIndex: string;
  buOwnerName: string;
  itApplicationOwner: string;
  itPortfolioOwnerName: string;
  supportRemedyGroup: string;
  revenueGenerating: string;
  businessUnit: string;
  hostingEnvironment: string;
  applicationType: string;
  Hosts: number;
  FootPrint: number;
  Services: number;
  monitoringMode: MonitoringMode;
  Metrics: YesNo;
  Traces: YesNo;
  /** Undefined while the parallel log-presence query is still loading (renders as "—"). */
  Logs?: YesNo;
  RUM: YesNo;
  Synthetic: YesNo;
  Monitored: YesNo;
}

/** The five observability signals tracked per application. */
export const SIGNALS = ["Metrics", "Traces", "Logs", "RUM", "Synthetic"] as const;
export type Signal = (typeof SIGNALS)[number];
