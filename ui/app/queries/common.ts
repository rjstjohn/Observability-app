/** Shared query helpers and constants. */

/** OneAgent "outdated" cutoff: the 6th-highest distinct minor release in the fleet.
 *  A host is outdated when its minor release is more than 5 releases behind the latest. */
export const VERSION_CUTOFF_QUERY = `
fetch dt.entity.host
| filter isNotNull(installerVersion)
| fieldsAdd minor = toLong(splitString(installerVersion, ".")[1])
| filter isNotNull(minor)
| summarize minors = arrayDistinct(collectArray(minor))
| fieldsAdd minors = arraySort(minors, direction: "descending")
| fieldsAdd cutoff = coalesce(minors[5], minors[arraySize(minors) - 1]),
            latest = minors[0]
| fields cutoff, latest
`;

export interface VersionCutoff {
  cutoff: number;
  latest: number;
}

/**
 * appIDs come from our own LeanIX data / parsed tags, but they are interpolated into
 * query strings, so strip anything that is not a safe identifier character.
 */
export function sanitizeAppId(appID: string): string {
  return (appID ?? "").trim().replace(/[^A-Za-z0-9 ._-]/g, "");
}

/**
 * PERFORMANCE: extracts the appID from the `AppID:<id>` tag by expanding ONLY the matching
 * tags, instead of `expand tags | parse ...` which expands every tag on every entity
 * (~10x the rows). Handles entities carrying more than one AppID tag correctly.
 * Requires a `tags` field on the record.
 */
export const APPID_FROM_TAGS = `
| fieldsAdd appIdTags = arrayRemoveNulls(iCollectArray(if(matchesValue(tags[], "AppID:*"), tags[])))
| expand appIdTags
| fieldsAdd appID = trim(splitString(appIdTags, ":")[1])
| filter isNotNull(appID)`;

/** Distinct LeanIX applications with Full-Stack monitoring over time (weekly, last 60 days).
 *  Only AppID tags that exist in leanix_data are counted, so this aligns with the
 *  portfolio "By monitoring mode: Full" count (orphan tags are surfaced in Explorer).
 *
 *  PERFORMANCE: resolves host -> appID with a single lookup join. The previous version
 *  called entityAttr() per event, which forces per-record entity resolution. */
export const FULLSTACK_OVER_TIME_QUERY = `
fetch dt.system.events, from: now() - 60d
| filter event.type == "Full-Stack Monitoring"
| fields timestamp, dt.entity.host
| lookup [ fetch dt.entity.host${APPID_FROM_TAGS}
           | fields id, appID | dedup id ],
    sourceField: dt.entity.host, lookupField: id, fields: {appID}
| filter isNotNull(appID)
| lookup [ load "/lookups/leanix_data" | fieldsAdd appID = trim(appID) | fields appID, appName ],
    sourceField: appID, lookupField: appID, fields: {appName}
| filter isNotNull(appName)
| makeTimeseries Full_Stack = countDistinct(appID), time: timestamp, interval: 7d
`;

/** Tag keys we expect every monitored entity to carry, used for metadata-adherence checks. */
export const ADHERENCE_TAGS = [
  { key: "AppID", label: "AppID" },
  { key: "App_Name", label: "App Name" },
  { key: "BU", label: "BU" },
  { key: "Environment", label: "Environment" },
  { key: "Location", label: "Location" },
] as const;
