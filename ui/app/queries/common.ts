/** Shared query builders and DQL helpers. Everything customer-specific comes from AppConfig. */
import type { AppConfig } from "../config/types";

/* ------------------------------------------------------------------ *
 * DQL escaping
 * ------------------------------------------------------------------ */

/**
 * Escape a value for use inside a DQL double-quoted string literal.
 *
 * This replaces the old `sanitizeAppId`, which *stripped* anything outside
 * [A-Za-z0-9 ._-]. That silently mangled application IDs containing "/" or ":"
 * (they'd match nothing, with no error). Escaping preserves the value instead.
 */
export function dqlStr(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/** Render a field name for DQL, back-ticking it when it isn't a plain identifier. */
export function dqlField(name: string): string {
  const n = String(name ?? "").trim();
  if (!n) return n;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : "`" + n.replace(/`/g, "") + "`";
}

/** Application id as a DQL string literal body (already escaped, no surrounding quotes). */
export function appIdLiteral(id: string): string {
  return dqlStr(String(id ?? "").trim());
}

/* ------------------------------------------------------------------ *
 * Stable internal field names
 * ------------------------------------------------------------------ *
 * The customer's key/name columns are aliased to these so the rest of the
 * pipeline — and the TypeScript row types — stay constant regardless of what
 * the columns are actually called in their lookup table. */
export const ID = "appID";
export const NAME = "appName";

/** `appID`/`appName` aliases plus the configured extra columns, de-duplicated. */
export function lookupProjection(cfg: AppConfig): string {
  const extra = cfg.fields
    .map((f) => f.key)
    .filter((k) => k && k !== cfg.lookup.keyField && k !== cfg.lookup.nameField)
    .filter((k, i, a) => a.indexOf(k) === i)
    .map(dqlField);
  return [ID, NAME, ...extra].join(", ");
}

/** `load "<path>"` + alias the key/name columns to the stable internal names.
 *  The name column is optional — when unset, the id doubles as the display name. */
export function loadLookup(cfg: AppConfig): string {
  const idExpr = `trim(toString(${dqlField(cfg.lookup.keyField)}))`;
  const nameExpr = cfg.lookup.nameField ? dqlField(cfg.lookup.nameField) : idExpr;
  return `load "${dqlStr(cfg.lookup.path)}"
| fieldsAdd ${ID} = ${idExpr}, ${NAME} = ${nameExpr}`;
}

/* ------------------------------------------------------------------ *
 * Entity tag helpers
 * ------------------------------------------------------------------ */

/**
 * Indexed, exact tag match for ONE application: `| filter in("<tagKey>:<id>", tags)`.
 * This is the pattern that keeps entity queries fast (a `contains()`+`expand` scan of
 * the process-group table is ~50x slower) — never replace it with expand/parse.
 */
export function taggedFilter(cfg: AppConfig, appId: string): string {
  return `| filter in("${dqlStr(cfg.entities.tagKey)}:${appIdLiteral(appId)}", tags)`;
}

/**
 * Extract the application id from the configured tag across MANY entities by expanding
 * only the matching tag (not every tag on every entity). Requires a `tags` field.
 */
export function appIdFromTags(cfg: AppConfig): string {
  const key = dqlStr(cfg.entities.tagKey);
  return `
| fieldsAdd appIdTags = arrayRemoveNulls(iCollectArray(if(matchesValue(tags[], "${key}:*"), tags[])))
| expand appIdTags
| fieldsAdd ${ID} = trim(splitString(appIdTags, ":")[1])
| filter isNotNull(${ID})`;
}

/** Per-entity tag-adherence flags. Field names are `has_<index>` to stay safe for any tag key. */
export function adherenceFlagField(index: number): string {
  return `hasTag${index}`;
}

/**
 * Adherence flags for the configured tag list. `hasAppIDTag` is app-specific (does the
 * entity carry THIS application's tag) so entities pulled in via a service relationship
 * surface the gap; the rest are presence checks.
 */
export function adherenceFlags(cfg: AppConfig, appId: string): string {
  const own = `| fieldsAdd hasAppIDTag = if(in("${dqlStr(cfg.entities.tagKey)}:${appIdLiteral(
    appId
  )}", tags), "Yes", else: "No")`;
  const rest = cfg.entities.adherenceTags.map(
    (t, i) =>
      `, ${adherenceFlagField(i)} = if(contains(tagStr, "${dqlStr(t.key)}:"), "Yes", else: "No")`
  );
  if (!rest.length) return `| fieldsAdd tagStr = toString(tags)\n${own}`;
  return `| fieldsAdd tagStr = toString(tags)\n${own}${rest.join("")}`;
}

/** The adherence flag field names, in configured order (for `| fields` projections). */
export function adherenceFieldList(cfg: AppConfig): string[] {
  return ["hasAppIDTag", ...cfg.entities.adherenceTags.map((_, i) => adherenceFlagField(i))];
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

/**
 * OneAgent "outdated" cutoff: the Nth-highest distinct minor release, where N is
 * `agent.outdatedReleasesBehind`. A host below the cutoff is more than N releases behind.
 */
export function versionCutoffQuery(cfg: AppConfig): string {
  const n = Math.max(1, Math.floor(cfg.agent.outdatedReleasesBehind ?? 5));
  return `
fetch dt.entity.host
| filter isNotNull(installerVersion)
| fieldsAdd minor = toLong(splitString(installerVersion, ".")[1])
| filter isNotNull(minor)
| summarize minors = arrayDistinct(collectArray(minor))
| fieldsAdd minors = arraySort(minors, direction: "descending")
| fieldsAdd cutoff = coalesce(minors[${n}], arrayLast(minors)),
            latest = arrayFirst(minors)
| fields cutoff, latest`;
}

export interface VersionCutoff {
  cutoff: number;
  latest: number;
}

/**
 * Distinct applications with Full-Stack monitoring over time. Only ids present in the
 * configured lookup are counted, so it lines up with the portfolio "Full" count.
 * Resolves host -> id with a lookup join (per-event entityAttr() is far slower).
 */
export function fullstackOverTimeQuery(cfg: AppConfig): string {
  const days = Math.max(1, Math.floor(cfg.windows.fullstackDays ?? 60));
  return `
fetch dt.system.events, from: now() - ${days}d
| filter event.type == "Full-Stack Monitoring"
| fields timestamp, dt.entity.host
| lookup [ fetch dt.entity.host${appIdFromTags(cfg)}
           | fields id, ${ID} | dedup id ],
    sourceField: dt.entity.host, lookupField: id, fields: {${ID}}
| filter isNotNull(${ID})
| lookup [ ${loadLookup(cfg)} | fields ${ID}, ${NAME} ],
    sourceField: ${ID}, lookupField: ${ID}, fields: {${NAME}}
| filter isNotNull(${NAME})
| makeTimeseries Full_Stack = countDistinct(${ID}), time: timestamp, interval: 7d`;
}

/** Distinct column names available in the configured lookup (drives config field pickers). */
export function lookupSampleQuery(path: string): string {
  return `load "${dqlStr(path)}" | limit 1`;
}

/** Distinct value combinations for the given lookup columns (drives the priority value pickers). */
export function lookupValuesQuery(path: string, columns: string[]): string {
  const cols = [...new Set(columns.filter(Boolean))].map(dqlField);
  if (!cols.length) return "";
  const list = cols.join(", ");
  return `load "${dqlStr(path)}"
| summarize count(), by: {${list}}
| fields ${list}
| limit 2000`;
}

/** Most common entity tag keys, to populate the tag-key picker on the Configuration page. */
export function tagKeySampleQuery(): string {
  return `
fetch dt.entity.host
| fieldsAdd tags
| expand tags
| parse tags, """LD:tagKey, ':'"""
| fieldsAdd tagKey = trim(tagKey)
| filter isNotNull(tagKey)
| summarize entities = count(), by: {tagKey}
| sort entities desc
| limit 50`;
}
