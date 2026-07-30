/**
 * Core portfolio-coverage query, built from the environment configuration.
 *
 * Reads the configured lookup table and left-joins each observability signal aggregated
 * per application id. Returns ONE row per application (monitored or not), so a single
 * query powers the Overview, Coverage, Recommendations and Explorer tabs.
 *
 * Performance notes that must be preserved:
 *  - entity sub-queries extract the id by expanding ONLY the configured tag (appIdFromTags);
 *  - the log-presence check is NOT here — it is a separate parallel query (see below),
 *    because it is the only non-0 GB part and would otherwise block the whole portfolio;
 *  - ids are trimmed on both sides (lookup values and tag values carry stray spaces).
 */
import type { AppConfig } from "../config/types";
import { ID, appIdFromTags, dqlField, dqlStr, loadLookup, lookupProjection } from "./common";

/** RUM/synthetic id extraction, per the configured matching mode. */
function rumIdExtraction(cfg: AppConfig): string | undefined {
  if (cfg.rum.mode === "name") {
    // First token before the delimiter, trimmed. Replaces the old `LD:` (leading-digits)
    // parse, which silently failed for non-numeric application ids.
    const d = dqlStr(cfg.rum.delimiter || "-");
    return `| fieldsAdd ${ID} = if(contains(\`entity.name\`, "${d}"), trim(splitString(\`entity.name\`, "${d}")[0]))
| filter isNotNull(${ID})`;
  }
  if (cfg.rum.mode === "tag") {
    const key = dqlStr(cfg.rum.tagKey || cfg.entities.tagKey);
    return `
| fieldsAdd appIdTags = arrayRemoveNulls(iCollectArray(if(matchesValue(tags[], "${key}:*"), tags[])))
| expand appIdTags
| fieldsAdd ${ID} = trim(splitString(appIdTags, ":")[1])
| filter isNotNull(${ID})`;
  }
  return undefined;
}

/** Builds the portfolio coverage query for this environment. */
export function buildCoverageQuery(cfg: AppConfig): string {
  const hoursActive = Math.max(1, Math.floor(cfg.windows.entityActivityHours ?? 2));
  const parts: string[] = [];

  parts.push(`${loadLookup(cfg)}
| fields ${lookupProjection(cfg)}`);

  // ---- HOSTS + monitoringMode (always on: it defines monitoringMode) ----
  parts.push(`
| lookup [
    fetch dt.entity.host
    | filter lifetime[end] > now()-${hoursActive}h
    ${appIdFromTags(cfg)}
    | summarize { hasFullStack = countIf(monitoringMode == "FULL_STACK"),
                  hasInfra = countIf(monitoringMode == "INFRASTRUCTURE"),
                  Hosts = count(),
                  FootPrint = sum(arraySize(runs[dt.entity.service])) }, by: {${ID}}
  ], sourceField: ${ID}, lookupField: ${ID}, fields: {hasFullStack, hasInfra, Hosts, FootPrint}
| fieldsAdd monitoringMode = if(isNull(Hosts), "None",
                             else: if(hasFullStack > 0, "Full",
                               else: if(hasInfra > 0, "Infrastructure", else: "Other"))),
            Hosts = coalesce(Hosts, 0), FootPrint = coalesce(FootPrint, 0)
| fieldsRemove hasFullStack, hasInfra`);

  // ---- SERVICES (Traces) ----
  // Service count is also used for the Services column, so fetch it even when the Traces
  // signal is off; only the Traces flag is conditional.
  parts.push(`
| lookup [
    fetch dt.entity.service ${appIdFromTags(cfg)}
    | summarize { Services = count() }, by: {${ID}}
  ], sourceField: ${ID}, lookupField: ${ID}, fields: {Services}
| fieldsAdd Services = coalesce(Services, 0)`);
  if (cfg.signals.traces) {
    parts.push(`| fieldsAdd Traces = if(Services > 0, "Yes", else: "No")`);
  }

  // ---- METRICS (real ingestion probe: host cpu or service request datapoints) ----
  if (cfg.signals.metrics) {
    parts.push(`
| lookup [
    timeseries cpu = avg(dt.host.cpu.usage), by:{dt.entity.host}, from: now()-${hoursActive}h
    | filter isNotNull(arrayLast(arrayRemoveNulls(cpu))) | fields id = dt.entity.host
    | lookup [ fetch dt.entity.host ${appIdFromTags(cfg)} | fields id, ${ID} | dedup id ],
        sourceField: id, lookupField: id, fields: {${ID}}
    | filter isNotNull(${ID})
    | append [
        timeseries req = sum(dt.service.request.count), by:{dt.entity.service}, from: now()-${hoursActive}h
        | filter isNotNull(arrayLast(arrayRemoveNulls(req))) | fields id = dt.entity.service
        | lookup [ fetch dt.entity.service ${appIdFromTags(cfg)} | fields id, ${ID} | dedup id ],
            sourceField: id, lookupField: id, fields: {${ID}}
        | filter isNotNull(${ID}) ]
    | summarize { metricEntities = count() }, by: {${ID}}
  ], sourceField: ${ID}, lookupField: ${ID}, fields: {metricEntities}
| fieldsAdd Metrics = if(isNotNull(metricEntities) AND metricEntities > 0, "Yes", else: "No")
| fieldsRemove metricEntities`);
  }

  // ---- RUM + SYNTHETIC ----
  const rumExtract = rumIdExtraction(cfg);
  if ((cfg.signals.rum || cfg.signals.synthetic) && rumExtract) {
    const wantSynth = cfg.signals.synthetic && cfg.synthetic.mode === "viaRum";
    parts.push(`
| lookup [
    fetch dt.entity.mobile_application
    ${rumExtract}
    | fieldsAdd hasSynthetic = false
    | append [ fetch dt.entity.application
               ${rumExtract}
               | fieldsAdd hasSynthetic = (arraySize(monitored_by[dt.entity.synthetic_test]) > 0) ]
    | summarize { rumApps = count(), synthApps = countIf(hasSynthetic == true) }, by: {${ID}}
  ], sourceField: ${ID}, lookupField: ${ID}, fields: {rumApps, synthApps}`);
    if (cfg.signals.rum) {
      parts.push(`| fieldsAdd RUM = if(isNotNull(rumApps) AND rumApps > 0, "Yes", else: "No")`);
    }
    if (wantSynth) {
      parts.push(`| fieldsAdd Synthetic = if(isNotNull(synthApps) AND synthApps > 0, "Yes", else: "No")`);
    }
    parts.push(`| fieldsRemove rumApps, synthApps`);
  }

  // ---- Monitored: OR across the ENABLED signals only ----
  const monitored: string[] = [`monitoringMode != "None"`];
  if (cfg.signals.traces) monitored.push(`Traces == "Yes"`);
  if (cfg.signals.metrics) monitored.push(`Metrics == "Yes"`);
  if (cfg.signals.rum && rumExtract) monitored.push(`RUM == "Yes"`);
  if (cfg.signals.synthetic && rumExtract && cfg.synthetic.mode === "viaRum")
    monitored.push(`Synthetic == "Yes"`);
  // NB: Logs is merged client-side (parallel query), so it is deliberately not here.
  parts.push(`
| fieldsAdd Monitored = if(${monitored.join(" OR ")}, "Yes", else: "No")
| sort Hosts desc
| limit 5000`);

  return parts.join("\n");
}

/**
 * Log presence per application. Runs in PARALLEL with the coverage query and is merged in
 * usePortfolio — a full log scan is the single most expensive part of the portfolio view.
 */
export function buildLogPresenceQuery(cfg: AppConfig): string {
  const hours = Math.max(1, Math.floor(cfg.logs.lookbackHours ?? 2));
  const ratio = Math.max(1, Math.floor(cfg.logs.samplingRatio ?? 1000));
  const field = dqlField(cfg.logs.field);
  const sampling = ratio > 1 ? `, samplingRatio: ${ratio}` : "";
  return `
fetch logs${sampling}, from: now()-${hours}h
| filter isNotNull(${field})
| fieldsAdd ${ID} = trim(toString(${field}))
| summarize logs = count(), by: {${ID}}
| fields ${ID}`;
}

export type YesNo = "Yes" | "No";
export type MonitoringMode = "Full" | "Infrastructure" | "Other" | "None";

/**
 * A portfolio row: a stable core plus whatever extra lookup columns the environment
 * configured (accessed by their raw column name).
 */
export type CoverageRow = {
  /** Stable internal alias of the configured key field. */
  appID: string;
  /** Stable internal alias of the configured name field. */
  appName: string;
  Hosts: number;
  FootPrint: number;
  Services: number;
  monitoringMode: MonitoringMode;
  Metrics?: YesNo;
  Traces?: YesNo;
  /** Undefined while the parallel log query is still loading (renders as "—"). */
  Logs?: YesNo;
  RUM?: YesNo;
  Synthetic?: YesNo;
  Monitored: YesNo;
} & Record<string, unknown>;

export interface LogPresenceRow {
  appID: string;
}
