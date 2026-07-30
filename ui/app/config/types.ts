/**
 * Environment configuration for the Observability Coverage app.
 *
 * Everything that used to be a hardcoded customer convention (lookup path, key field,
 * field names, entity tag keys, RUM naming, log field) lives here. The whole object is
 * stored as one JSON blob in an App Settings v2 object (schemaId `coverage-config`), so
 * the shape can evolve without re-authoring a settings schema.
 */

/** A lookup-table column surfaced in the UI. The list is variable length. */
export interface FieldMapping {
  /** Column name in the customer's lookup table, e.g. "buOwnerName". */
  key: string;
  /** Display label, e.g. "BU Owner". */
  label: string;
  /** Show as a column in the Coverage & Health table. */
  inTable: boolean;
  /** Show on the Application Detail metadata card. */
  inDetail: boolean;
  /** Include in the Coverage free-text search. */
  searchable?: boolean;
  /** Sort order within each surface (ascending). */
  order: number;
}

/** A tag key the app checks for on entities, for metadata-adherence reporting. */
export interface AdherenceTag {
  /** Tag key without the colon, e.g. "App_Name". */
  key: string;
  /** Column header / label, e.g. "App Name". */
  label: string;
}

/** One condition of the "priority applications" rule. Conditions are ANDed. */
export interface PriorityCondition {
  /** Lookup field, e.g. "criticality". */
  field: string;
  /** Values that satisfy the condition, e.g. ["Tier1"]. */
  values: string[];
}

export type RumMode = "name" | "tag" | "off";
export type SyntheticMode = "viaRum" | "tag" | "off";

export interface AppConfig {
  /** Schema version of this object, for future migrations. */
  version: 1;

  lookup: {
    /** Grail lookup path, e.g. "/lookups/applications". */
    path: string;
    /** Column holding the application id (join key + tag value), e.g. "appID". */
    keyField: string;
    /** Column holding the human-readable application name, e.g. "appName". */
    nameField: string;
  };

  /** Variable-length list of extra columns to surface. */
  fields: FieldMapping[];

  /** Optional criticality/tier column; drives the tier filter, KPI and distribution. */
  tier?: { field: string; label: string };

  /** "Priority applications" rule on the Recommendations tab. Empty = section hidden. */
  priority: { conditions: PriorityCondition[] };

  entities: {
    /** Tag key linking entities to an application, e.g. "AppID" (matched as `AppID:<value>`). */
    tagKey: string;
    /** Tag keys checked for metadata adherence. Variable length. */
    adherenceTags: AdherenceTag[];
  };

  rum: {
    mode: RumMode;
    /** For mode "name": the id is the first token before this delimiter, e.g. "-". */
    delimiter?: string;
    /** For mode "tag": the tag key to match on RUM entities. */
    tagKey?: string;
  };

  synthetic: {
    /** "viaRum" = discovered through the RUM app's monitored_by relationship. */
    mode: SyntheticMode;
    tagKey?: string;
  };

  logs: {
    enabled: boolean;
    /** Log attribute holding the application id, e.g. "AppID". */
    field: string;
    /** Sampling ratio for the portfolio-wide presence check (1 = no sampling). */
    samplingRatio: number;
    lookbackHours: number;
  };

  /** Which signals participate in the UI and in the "Monitored" roll-up. */
  signals: {
    metrics: boolean;
    traces: boolean;
    logs: boolean;
    rum: boolean;
    synthetic: boolean;
  };

  agent: {
    /** A host is "outdated" when its OneAgent is more than N releases behind the newest. */
    outdatedReleasesBehind: number;
  };

  /** Advanced query windows; sensible defaults applied when omitted. */
  windows: {
    /** Entity considered active if seen within this many hours. */
    entityActivityHours: number;
    /** Look-back for the Full-Stack-over-time chart. */
    fullstackDays: number;
  };
}

/** Signal identifiers, in display order. */
export const SIGNAL_KEYS = ["Metrics", "Traces", "Logs", "RUM", "Synthetic"] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

/** Maps a signal to the config flag that enables it. */
export const SIGNAL_FLAG: Record<SignalKey, keyof AppConfig["signals"]> = {
  Metrics: "metrics",
  Traces: "traces",
  Logs: "logs",
  RUM: "rum",
  Synthetic: "synthetic",
};

/**
 * Blank starting point. `lookup.path` is empty, which is what the app treats as
 * "not configured yet" — every page shows the setup prompt instead of running queries.
 */
export const EMPTY_CONFIG: AppConfig = {
  version: 1,
  lookup: { path: "", keyField: "", nameField: "" },
  fields: [],
  priority: { conditions: [] },
  entities: { tagKey: "", adherenceTags: [] },
  rum: { mode: "off", delimiter: "-" },
  synthetic: { mode: "off" },
  logs: { enabled: false, field: "", samplingRatio: 1000, lookbackHours: 2 },
  signals: { metrics: true, traces: true, logs: false, rum: false, synthetic: false },
  agent: { outdatedReleasesBehind: 5 },
  windows: { entityActivityHours: 2, fullstackDays: 60 },
};

/** True when there is enough configuration to run the portfolio queries. */
export function isConfigured(c: AppConfig | undefined): c is AppConfig {
  return !!c && !!c.lookup?.path && !!c.lookup?.keyField && !!c.entities?.tagKey;
}

/**
 * Fields to show in a given surface, in configured order. Blank/whitespace-only keys and
 * duplicate keys are dropped here (the single choke point) so no consumer can ever build a
 * DataTable column with an empty or duplicate id — which crashes TanStack's getAllColumns.
 */
export function fieldsFor(c: AppConfig, surface: "table" | "detail"): FieldMapping[] {
  const flag = surface === "table" ? "inTable" : "inDetail";
  const out: FieldMapping[] = [];
  const seen = new Set<string>();
  for (const f of c.fields ?? []) {
    if (!f[flag]) continue;
    const k = (f.key ?? "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out.sort((a, b) => a.order - b.order);
}

/**
 * Row-field names the coverage query already produces. A configured lookup column that
 * collides with one of these would clash both in the DQL row and in the table columns, so
 * validateConfig rejects it.
 */
export const RESERVED_FIELD_KEYS = [
  "appID",
  "appName",
  "Hosts",
  "Services",
  "FootPrint",
  "monitoringMode",
  "Metrics",
  "Traces",
  "Logs",
  "RUM",
  "Synthetic",
  "Monitored",
] as const;

/**
 * Safely stringify a dynamically-keyed row value. Configured fields are typed `unknown`
 * (the column set isn't known at compile time), so `String(x)` would risk "[object Object]".
 */
export function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return "";
}

/** Signals enabled in this environment, in display order. */
export function enabledSignals(c: AppConfig): SignalKey[] {
  return SIGNAL_KEYS.filter((s) => c.signals?.[SIGNAL_FLAG[s]]);
}

/**
 * Merge a parsed/imported object onto EMPTY_CONFIG so missing keys never crash the UI
 * (older saved configs, hand-edited JSON, partial imports).
 */
export function normalizeConfig(raw: unknown): AppConfig {
  const r = (raw ?? {}) as Partial<AppConfig>;
  return {
    ...EMPTY_CONFIG,
    ...r,
    version: 1,
    lookup: { ...EMPTY_CONFIG.lookup, ...(r.lookup ?? {}) },
    fields: Array.isArray(r.fields) ? r.fields : [],
    tier: r.tier?.field ? r.tier : undefined,
    priority: { conditions: r.priority?.conditions ?? [] },
    entities: {
      ...EMPTY_CONFIG.entities,
      ...(r.entities ?? {}),
      adherenceTags: r.entities?.adherenceTags ?? [],
    },
    rum: { ...EMPTY_CONFIG.rum, ...(r.rum ?? {}) },
    synthetic: { ...EMPTY_CONFIG.synthetic, ...(r.synthetic ?? {}) },
    logs: { ...EMPTY_CONFIG.logs, ...(r.logs ?? {}) },
    signals: { ...EMPTY_CONFIG.signals, ...(r.signals ?? {}) },
    agent: { ...EMPTY_CONFIG.agent, ...(r.agent ?? {}) },
    windows: { ...EMPTY_CONFIG.windows, ...(r.windows ?? {}) },
  };
}

/** Human-readable problems that would make the config not work. */
export function validateConfig(c: AppConfig): string[] {
  const errs: string[] = [];
  if (!c.lookup.path) errs.push("Lookup table path is required.");
  else if (!c.lookup.path.startsWith("/")) errs.push('Lookup path must start with "/", e.g. /lookups/my_apps.');
  if (!c.lookup.keyField) errs.push("Application ID field is required.");
  if (!c.entities.tagKey) errs.push("Entity tag key is required (how entities link to an application).");
  if (c.rum.mode === "name" && !c.rum.delimiter) errs.push("RUM name matching needs a delimiter.");
  if (c.rum.mode === "tag" && !c.rum.tagKey) errs.push("RUM tag matching needs a tag key.");
  if (c.synthetic.mode === "tag" && !c.synthetic.tagKey) errs.push("Synthetic tag matching needs a tag key.");
  if (c.signals.logs && !c.logs.field) errs.push("The Logs signal is enabled but no log field is set.");
  if (c.signals.rum && c.rum.mode === "off") errs.push("The RUM signal is enabled but RUM matching is off.");
  if (c.signals.synthetic && c.synthetic.mode === "off")
    errs.push("The Synthetic signal is enabled but synthetic matching is off.");
  // Portfolio fields: every surfaced field needs a non-blank, non-reserved, unique key —
  // otherwise the table column it produces has an empty/duplicate id and the page crashes.
  c.fields.forEach((f, i) => {
    const k = (f.key ?? "").trim();
    if (!k) errs.push(`Portfolio field #${i + 1} is missing its lookup column.`);
    else if ((RESERVED_FIELD_KEYS as readonly string[]).includes(k))
      errs.push(`Portfolio field column "${k}" is a reserved name the app already uses — pick a different column.`);
  });
  const dupes = c.fields.map((f) => (f.key ?? "").trim()).filter((k, i, a) => k && a.indexOf(k) !== i);
  if (dupes.length) errs.push(`Duplicate portfolio field column(s): ${[...new Set(dupes)].join(", ")}.`);

  // Adherence tags and priority conditions must be complete if present.
  (c.entities.adherenceTags ?? []).forEach((t, i) => {
    if (!(t.key ?? "").trim()) errs.push(`Adherence tag #${i + 1} is missing its tag key.`);
  });
  (c.priority.conditions ?? []).forEach((cond, i) => {
    if (!(cond.field ?? "").trim()) errs.push(`Priority condition #${i + 1} is missing its column.`);
    else if (!cond.values || cond.values.length === 0)
      errs.push(`Priority condition #${i + 1} ("${cond.field}") has no values.`);
  });
  return errs;
}
