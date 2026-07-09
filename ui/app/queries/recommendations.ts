/** Cross-app queries for the Recommendations and Explorer tabs. */

/** Per-tag missing-count rollup across hosts, services and process groups.
 *  Tag presence is checked without expanding (cheap — no per-tag fan-out). */
const adherenceBlock = (entity: string, label: string) => `
    fetch ${entity}
    | fieldsAdd EntityType = "${label}"
    | fieldsAdd noAppID = if(contains(toString(tags), "AppID:"), 0, else: 1),
                noAppName = if(contains(toString(tags), "App_Name:"), 0, else: 1),
                noBU = if(contains(toString(tags), "BU:"), 0, else: 1),
                noEnv = if(contains(toString(tags), "Environment:"), 0, else: 1),
                noLocation = if(contains(toString(tags), "Location:"), 0, else: 1)
    | summarize { Total = count(),
                  MissingAppID = sum(noAppID),
                  MissingAppName = sum(noAppName),
                  MissingBU = sum(noBU),
                  MissingEnvironment = sum(noEnv),
                  MissingLocation = sum(noLocation) }, by: {EntityType}`;

export const ADHERENCE_ROLLUP_QUERY = `
${adherenceBlock("dt.entity.host", "Host")}
| append [${adherenceBlock("dt.entity.service", "Service")}]
| append [${adherenceBlock("dt.entity.process_group", "Process Group")}]`;

export interface AdherenceRollupRow {
  EntityType: string;
  Total: number;
  MissingAppID: number;
  MissingAppName: number;
  MissingBU: number;
  MissingEnvironment: number;
  MissingLocation: number;
}

/** Orphan AppID tags: entities tagged with an AppID that is NOT in the LeanIX portfolio. */
const orphanBlock = (entity: string, label: string) => `
    fetch ${entity}
    | fieldsAdd tags
    | expand tags
    | parse tags, """'AppID:'LD:appID"""
    | filter isNotNull(appID)
    | fieldsAdd appID = trim(appID), EntityType = "${label}"
    | summarize { entities = count() }, by: {appID, EntityType}`;

export const ORPHAN_TAGS_QUERY = `
${orphanBlock("dt.entity.host", "Host")}
| append [${orphanBlock("dt.entity.service", "Service")}]
| append [${orphanBlock("dt.entity.process_group", "Process Group")}]
| summarize { entities = sum(entities), entityTypes = arrayDistinct(collectArray(EntityType)) }, by: {appID}
| lookup [ load "/lookups/leanix_data" | fieldsAdd appID = trim(appID) | fields appID, appName ],
    sourceField: appID, lookupField: appID, fields: {appName}
| filter isNull(appName)
| fields appID, entities, entityTypes
| sort entities desc
| limit 1000`;

export interface OrphanTagRow {
  appID: string;
  entities: number;
  entityTypes: string[];
}
