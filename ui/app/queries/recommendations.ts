/** Cross-application queries for the Recommendations and Explorer tabs. */
import type { AppConfig } from "../config/types";
import { ID, appIdFromTags, dqlStr, loadLookup } from "./common";

/** Entity tables included in the portfolio-wide tag audit. */
const ENTITY_TABLES: Array<{ table: string; label: string }> = [
  { table: "dt.entity.host", label: "Host" },
  { table: "dt.entity.service", label: "Service" },
  // process_group (~60k) rather than process_group_instance (~155k): same coverage, half the scan.
  { table: "dt.entity.process_group", label: "Process Group" },
];

/**
 * Per-tag missing counts across hosts, services and process groups.
 *
 * Scan-bound by design (it must read every entity to count), so keep the per-record work
 * minimal: no tag expansion, and toString(tags) computed once rather than per tag check.
 */
export function buildAdherenceRollupQuery(cfg: AppConfig): string {
  const tags = cfg.entities.adherenceTags;
  const missingExprs = tags
    .map((t, i) => `                missing${i} = if(contains(tagStr, "${dqlStr(t.key)}:"), 0, else: 1)`)
    .join(",\n");
  const missingAggs = tags.map((_, i) => `                  Missing${i} = sum(missing${i})`).join(",\n");

  const block = (table: string, label: string) => `
    fetch ${table}
    | fieldsAdd EntityType = "${dqlStr(label)}", tagStr = toString(tags)
    | fieldsAdd noAppID = if(contains(tagStr, "${dqlStr(cfg.entities.tagKey)}:"), 0, else: 1)${
      missingExprs ? ",\n" + missingExprs : ""
    }
    | summarize { Total = count(),
                  MissingAppID = sum(noAppID)${missingAggs ? ",\n" + missingAggs : ""} }, by: {EntityType}`;

  const [first, ...rest] = ENTITY_TABLES;
  return [
    block(first.table, first.label),
    ...rest.map((e) => `| append [${block(e.table, e.label)}]`),
  ].join("\n");
}

/** One row of the tag-gap rollup: a stable core plus one Missing<i> per configured tag. */
export type AdherenceRollupRow = {
  EntityType: string;
  Total: number;
  MissingAppID: number;
} & Record<string, unknown>;

/**
 * Applications tagged on entities that are NOT present in the configured lookup —
 * typos, retired apps, or apps not yet onboarded to the portfolio table.
 */
export function buildOrphanTagsQuery(cfg: AppConfig): string {
  const block = (table: string, label: string) => `
    fetch ${table}${appIdFromTags(cfg)}
    | fieldsAdd EntityType = "${dqlStr(label)}"
    | summarize { entities = count() }, by: {${ID}, EntityType}`;

  const [first, ...rest] = ENTITY_TABLES;
  const branches = [
    block(first.table, first.label),
    ...rest.map((e) => `| append [${block(e.table, e.label)}]`),
  ].join("\n");

  return `${branches}
| summarize { entities = sum(entities), entityTypes = arrayDistinct(collectArray(EntityType)) }, by: {${ID}}
| lookup [ ${loadLookup(cfg)} | fields ${ID}, appName ],
    sourceField: ${ID}, lookupField: ${ID}, fields: {appName}
| filter isNull(appName)
| fields ${ID}, entities, entityTypes
| sort entities desc
| limit 1000`;
}

export interface OrphanTagRow {
  appID: string;
  entities: number;
  entityTypes: string[];
}
