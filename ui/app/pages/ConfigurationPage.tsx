import React, { useMemo, useRef, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { Flex, Surface, Divider } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text, Strong } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Menu } from "@dynatrace/strato-components/navigation";
import { TextInput, Switch, Select, SelectOption, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { CheckmarkIcon, CriticalIcon, WarningIcon, DotMenuIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useConfig } from "../config/ConfigProvider";
import {
  type AppConfig,
  type FieldMapping,
  EMPTY_CONFIG,
  SIGNAL_KEYS,
  SIGNAL_FLAG,
  normalizeConfig,
  validateConfig,
  str,
} from "../config/types";
import { lookupSampleQuery, lookupValuesQuery, tagKeySampleQuery } from "../queries/common";

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <Surface>
    <Flex flexDirection="column" gap={12} padding={20}>
      <Flex flexDirection="column" gap={2}>
        <Heading level={4}>{title}</Heading>
        {hint && (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            {hint}
          </Text>
        )}
      </Flex>
      {children}
    </Flex>
  </Surface>
);

const Labeled = ({ label, children, width = 260 }: { label: string; children: React.ReactNode; width?: number }) => (
  <Flex flexDirection="column" gap={4} style={{ minWidth: width }}>
    <Text textStyle="small">{label}</Text>
    {children}
  </Flex>
);

const Status = ({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) => (
  <Flex alignItems="center" gap={8}>
    <span style={{ display: "inline-flex", color: ok ? Colors.Text.Success.Default : warn ? Colors.Text.Warning.Default : Colors.Text.Critical.Default }}>
      {ok ? <CheckmarkIcon /> : warn ? <WarningIcon /> : <CriticalIcon />}
    </span>
    <Text>{children}</Text>
  </Flex>
);

/**
 * A multi-select of a lookup column's actual values (used by the priority rule so users pick
 * real values like "Tier1" rather than guessing). Falls back to comma-separated free text until
 * the values are discovered, and always keeps whatever is already selected visible.
 */
const ValueField = ({
  values,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) => {
  if (!options.length) {
    return (
      <TextInput
        value={values.join(", ")}
        onChange={(v) => onChange(v.split(",").map((s) => s.trim()).filter(Boolean))}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  }
  const opts = [...new Set([...values, ...options])];
  return (
    <Select multiple value={values} onChange={(v) => onChange(v ?? [])} disabled={disabled} clearable>
      <Select.Trigger width="full" />
      <Select.Content>
        <Select.Filter />
        {opts.map((o) => (
          <SelectOption key={o} value={o}>
            {o}
          </SelectOption>
        ))}
      </Select.Content>
    </Select>
  );
};

/**
 * A picker for a lookup column. When the lookup's columns have been discovered it renders a
 * filterable dropdown of them; until then (or when discovery failed) it falls back to a plain
 * text field so the user can always type a column name. The current value is always shown,
 * even if it isn't in the discovered set (e.g. a column that no longer exists).
 */
const ColumnField = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) => {
  if (!options.length) {
    return <TextInput value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} />;
  }
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select value={value || null} onChange={(v) => onChange(v == null ? "" : String(v))} disabled={disabled}>
      {/* width="full" makes the trigger fill its container (like the text inputs) instead of
          auto-sizing to the selected value. The trigger width is read from this slot's prop. */}
      <Select.Trigger width="full" />
      <Select.Content>
        <Select.Filter />
        {opts.map((o) => (
          <SelectOption key={o} value={o}>
            {o}
          </SelectOption>
        ))}
      </Select.Content>
    </Select>
  );
};

export const ConfigurationPage = () => {
  const { config, save, canEdit, isLoading, reload } = useConfig();
  const [draft, setDraft] = useState<AppConfig>(config);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string>();
  const [saveErr, setSaveErr] = useState<string>();
  const [testing, setTesting] = useState(false);
  // Visibility of the optional Tier & priority section. Decoupled from the data so a user can
  // configure a tier with no priority conditions (or vice versa) and keep the section open.
  const [showPriority, setShowPriority] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Adopt the loaded config once it arrives (until the user starts editing).
  React.useEffect(() => {
    if (!dirty) {
      setDraft(config);
      setShowPriority(!!config.tier?.field || (config.priority.conditions?.length ?? 0) > 0);
    }
  }, [config, dirty]);

  const set = (patch: Partial<AppConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setSaveMsg(undefined);
    // Any change invalidates a prior "tested" pass, so Export re-gates until re-tested.
    setTesting(false);
  };

  const errors = useMemo(() => validateConfig(draft), [draft]);

  /* ---------------- field discovery ---------------- */
  // Debounce the path so column discovery fires once the user pauses typing, not per keystroke.
  const [discoPath, setDiscoPath] = useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDiscoPath(draft.lookup.path.trim()), 400);
    return () => clearTimeout(t);
  }, [draft.lookup.path]);

  // Columns are discovered automatically whenever the path resolves — the pickers below turn
  // into filterable dropdowns as soon as this returns.
  const sampleQuery = discoPath ? lookupSampleQuery(discoPath) : "";
  const sample = useDql<Record<string, unknown>>(sampleQuery, {
    runInBackground: true,
    enabled: !!sampleQuery,
  });
  const discoveredFields = useMemo(() => {
    const rec = sample.data?.records?.[0];
    return rec ? Object.keys(rec).sort() : [];
  }, [sample.data]);

  // Tag keys are discovered automatically so the tag pickers are dropdowns of what's actually
  // in use on this tenant's entities.
  const tagKeys = useDql<{ tagKey: string; entities: number }>(tagKeySampleQuery(), {
    runInBackground: true,
    enabled: true,
  });
  const discoveredTagKeys = useMemo(
    () => (tagKeys.data?.records ?? []).map((r) => String(r.tagKey)).filter(Boolean),
    [tagKeys.data]
  );

  // Distinct values for the columns used by priority conditions, so those become value pickers.
  const valueColumns = useMemo(
    () => [...new Set((draft.priority.conditions ?? []).map((c) => c.field).filter(Boolean))],
    [draft.priority.conditions]
  );
  const valuesQuery = useMemo(
    () => (discoPath ? lookupValuesQuery(discoPath, valueColumns) : ""),
    [discoPath, valueColumns]
  );
  const valuesSample = useDql<Record<string, unknown>>(valuesQuery, {
    runInBackground: true,
    enabled: !!valuesQuery,
  });
  const valuesByColumn = useMemo(() => {
    const recs = valuesSample.data?.records ?? [];
    const out: Record<string, string[]> = {};
    for (const col of valueColumns) {
      out[col] = [...new Set(recs.map((r) => str(r[col])).filter(Boolean))].sort();
    }
    return out;
  }, [valuesSample.data, valueColumns]);

  /* ---------------- actions ---------------- */
  const onSave = async () => {
    setSaving(true);
    setSaveErr(undefined);
    setSaveMsg(undefined);
    try {
      await save(draft);
      setDirty(false);
      setSaveMsg("Configuration saved.");
    } catch (e) {
      setSaveErr((e as Error).message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "observability-coverage-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import from a chosen .json file (parsed, normalised, staged into the draft for review + Save).
  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        set(normalizeConfig(JSON.parse(text)));
        setSaveErr(undefined);
        setSaveMsg(`Imported ${file.name} — review below, then Save.`);
      } catch {
        setSaveErr(`${file.name} isn't a valid configuration file.`);
      }
    };
    reader.onerror = () => setSaveErr(`Couldn't read ${file.name}.`);
    reader.readAsText(file);
  };

  /** Export is enabled only once the config has been tested (Test configuration ran and the
   *  lookup resolved). Any edit resets this, so an exported file is always a tested one. */
  const configTested = testing && !!discoPath && !sample.isLoading && !sample.error && discoveredFields.length > 0;

  /* ---------------- field list editing ---------------- */
  const updateField = (i: number, patch: Partial<FieldMapping>) => {
    const fields = [...draft.fields];
    fields[i] = { ...fields[i], ...patch };
    set({ fields });
  };
  /** Pick a column for a field and autofill the label from it, unless the label was customised. */
  const setFieldColumn = (i: number, key: string) => {
    const prev = draft.fields[i];
    const autofill = !prev.label || prev.label === prev.key;
    updateField(i, { key, label: autofill ? key : prev.label });
  };
  const addField = () =>
    set({
      fields: [
        ...draft.fields,
        { key: "", label: "", inTable: true, inDetail: true, searchable: false, order: draft.fields.length },
      ],
    });
  const removeField = (i: number) => set({ fields: draft.fields.filter((_, x) => x !== i) });

  const addTag = () =>
    set({ entities: { ...draft.entities, adherenceTags: [...draft.entities.adherenceTags, { key: "", label: "" }] } });
  const updateTag = (i: number, patch: Partial<{ key: string; label: string }>) => {
    const adherenceTags = [...draft.entities.adherenceTags];
    adherenceTags[i] = { ...adherenceTags[i], ...patch };
    set({ entities: { ...draft.entities, adherenceTags } });
  };
  const removeTag = (i: number) =>
    set({ entities: { ...draft.entities, adherenceTags: draft.entities.adherenceTags.filter((_, x) => x !== i) } });
  /** Pick a tag key and autofill its label, unless the label was customised. */
  const setTagKey = (i: number, key: string) => {
    const prev = draft.entities.adherenceTags[i];
    const autofill = !prev.label || prev.label === prev.key;
    updateTag(i, { key, label: autofill ? key : prev.label });
  };

  // Adherence checking is "on" when at least one tag is configured; the toggle just
  // reveals/clears the list (no separate persisted flag needed).
  const adherenceOn = draft.entities.adherenceTags.length > 0;

  if (isLoading) {
    return (
      <Flex alignItems="center" justifyContent="center" gap={8} padding={32}>
        <ProgressCircle />
        <Text>Loading configuration…</Text>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" gap={20} padding={32}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={16}>
        <Flex flexDirection="column" gap={4}>
          <Heading>Configuration</Heading>
          <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
            Tell the app where your application portfolio lives and how your Dynatrace entities are
            tagged. Settings are shared by everyone using this app in this environment.
          </Paragraph>
          {!canEdit && (
            <Status warn>
              You have read-only access. Ask someone with settings write permission to make changes.
            </Status>
          )}
        </Flex>
        <Menu>
          <Menu.Trigger>
            <Button aria-label="Import or export configuration">
              <DotMenuIcon />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            {canEdit && (
              <Menu.Item onSelect={() => fileInputRef.current?.click()}>Import configuration…</Menu.Item>
            )}
            <Menu.Item
              onSelect={(e: React.SyntheticEvent) => {
                if (configTested) onExport();
                else e.preventDefault();
              }}
              style={configTested ? undefined : { opacity: 0.5 }}
            >
              Export configuration
              {!configTested && <Menu.ItemTooltip>Test configuration before exporting.</Menu.ItemTooltip>}
            </Menu.Item>
          </Menu.Content>
        </Menu>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = "";
          }}
        />
      </Flex>

      <Section
        title="Portfolio lookup table"
        hint="The Grail lookup table listing your applications, and which columns identify them."
      >
        <Flex flexFlow="wrap" gap={16}>
          <Labeled label="Lookup path" width={320}>
            <TextInput
              value={draft.lookup.path}
              onChange={(v) => set({ lookup: { ...draft.lookup, path: v } })}
              placeholder="/lookups/my_applications"
              disabled={!canEdit}
            />
          </Labeled>
          <Labeled label="Application ID column">
            <ColumnField
              value={draft.lookup.keyField}
              onChange={(v) => set({ lookup: { ...draft.lookup, keyField: v } })}
              options={discoveredFields}
              placeholder="appID"
              disabled={!canEdit}
            />
          </Labeled>
        </Flex>
        {/* Live validation of the path — the column pickers fill in automatically once it resolves. */}
        {discoPath && (
          <>
            {sample.isLoading ? (
              <Flex alignItems="center" gap={8}>
                <ProgressCircle size="small" />
                <Text textStyle="small">Checking lookup table…</Text>
              </Flex>
            ) : sample.error ? (
              <Status>Lookup table not found or unreadable at {discoPath}.</Status>
            ) : discoveredFields.length ? (
              <Status ok>
                Lookup table found — {discoveredFields.length} columns available in the pickers below.
              </Status>
            ) : (
              <Status warn>No rows returned from {discoPath} — check the path.</Status>
            )}
          </>
        )}
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          The application ID column holds the identifier the app joins on — it must match the value
          carried in your entity tag (configured under Entity tagging below). If your table has a
          separate display-name column, add it under <Strong>Portfolio fields</Strong>; otherwise the
          ID is used as the name.
        </Text>
      </Section>

      <Section
        title="Portfolio fields"
        hint="Optional. Surface extra columns from your lookup table — owner, business unit, criticality, and so on — so they show up alongside each application's coverage. Add as many or as few as you like."
      >
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          For each column, choose where it appears. <Strong>Coverage table</Strong> adds it as a
          column on the Coverage &amp; Health grid (and the Explorer / Recommendations tables) —
          keep this list short so the grid stays readable. <Strong>App detail</Strong> shows it on
          an individual application&apos;s page, where there is room for everything.{" "}
          <Strong>Searchable</Strong> includes it in the Coverage search box.
        </Text>
        <Flex flexDirection="column" gap={12}>
          {draft.fields.map((f, i) => (
            <Flex key={i} flexFlow="wrap" gap={12} alignItems="flex-end">
              <Labeled label="Column" width={220}>
                <ColumnField
                  value={f.key}
                  onChange={(v) => setFieldColumn(i, v)}
                  options={discoveredFields}
                  placeholder="businessUnit"
                  disabled={!canEdit}
                />
              </Labeled>
              <Labeled label="Label" width={220}>
                <TextInput value={f.label} onChange={(v) => updateField(i, { label: v })} placeholder="Business Unit" disabled={!canEdit} />
              </Labeled>
              <Labeled label="Coverage table" width={120}>
                <Switch value={f.inTable} onChange={(v) => updateField(i, { inTable: v })} disabled={!canEdit} />
              </Labeled>
              <Labeled label="App detail" width={100}>
                <Switch value={f.inDetail} onChange={(v) => updateField(i, { inDetail: v })} disabled={!canEdit} />
              </Labeled>
              <Labeled label="Searchable" width={100}>
                <Switch value={!!f.searchable} onChange={(v) => updateField(i, { searchable: v })} disabled={!canEdit} />
              </Labeled>
              {canEdit && (
                <Button variant="default" onClick={() => removeField(i)}>
                  Remove
                </Button>
              )}
            </Flex>
          ))}
          {canEdit && (
            <Flex>
              <Button variant="emphasized" onClick={addField}>
                Add field
              </Button>
            </Flex>
          )}
        </Flex>
      </Section>

      <Section title="Entity tagging" hint="How Dynatrace entities are linked to an application.">
        <Flex flexFlow="wrap" gap={16}>
          <Labeled label="Application tag key">
            <ColumnField
              value={draft.entities.tagKey}
              onChange={(v) => set({ entities: { ...draft.entities, tagKey: v } })}
              options={discoveredTagKeys}
              placeholder="AppID"
              disabled={!canEdit}
            />
          </Labeled>
        </Flex>
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          Dynatrace entities (hosts, services, process groups…) are linked to an application by a
          tag of the form <Strong>{draft.entities.tagKey || "<key>"}:&lt;id&gt;</Strong>. The app
          matches that tag&apos;s value against the <Strong>Application ID column</Strong> of your
          lookup table — so an entity tagged{" "}
          <Strong>{draft.entities.tagKey || "AppID"}:19698</Strong> is attributed to the application
          whose ID is <Strong>19698</Strong>.
        </Text>
        <Divider />
        <Labeled label="Check that required tags are present on entities" width={360}>
          <Switch
            value={adherenceOn}
            onChange={(v) => {
              if (v) {
                if (!adherenceOn) addTag();
              } else {
                set({ entities: { ...draft.entities, adherenceTags: [] } });
              }
            }}
            disabled={!canEdit}
          />
        </Labeled>
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          When on, the app reports which monitored entities are missing each tag below — on the
          Recommendations tab and each application&apos;s detail page.
        </Text>
        {adherenceOn && (
          <Flex flexDirection="column" gap={12}>
            {draft.entities.adherenceTags.map((t, i) => (
              <Flex key={i} flexFlow="wrap" gap={12} alignItems="flex-end">
                <Labeled label="Tag key" width={220}>
                  <ColumnField
                    value={t.key}
                    onChange={(v) => setTagKey(i, v)}
                    options={discoveredTagKeys}
                    placeholder="App_Name"
                    disabled={!canEdit}
                  />
                </Labeled>
                <Labeled label="Label" width={220}>
                  <TextInput value={t.label} onChange={(v) => updateTag(i, { label: v })} placeholder="App Name" disabled={!canEdit} />
                </Labeled>
                {canEdit && (
                  <Button variant="default" onClick={() => removeTag(i)}>
                    Remove
                  </Button>
                )}
              </Flex>
            ))}
            {canEdit && (
              <Flex>
                <Button variant="emphasized" onClick={addTag}>
                  Add tag
                </Button>
              </Flex>
            )}
          </Flex>
        )}
      </Section>

      <Section title="Signals" hint="Turn off anything this environment doesn't use — it disappears from the UI and from the Monitored roll-up.">
        <Flex flexFlow="wrap" gap={20}>
          {SIGNAL_KEYS.map((s) => (
            <Labeled key={s} label={s} width={110}>
              <Switch
                value={draft.signals[SIGNAL_FLAG[s]]}
                onChange={(v) => set({ signals: { ...draft.signals, [SIGNAL_FLAG[s]]: v } })}
                disabled={!canEdit}
              />
            </Labeled>
          ))}
        </Flex>
      </Section>

      <Section title="RUM &amp; Synthetic matching" hint="How web/mobile applications map to a portfolio application.">
        <Flex flexFlow="wrap" gap={16} alignItems="flex-end">
          <Labeled label="RUM matching">
            <ToggleButtonGroup value={draft.rum.mode} onChange={(v) => set({ rum: { ...draft.rum, mode: v as AppConfig["rum"]["mode"] } })}>
              <ToggleButtonGroup.Item value="name">By name</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="tag">By tag</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="off">Off</ToggleButtonGroup.Item>
            </ToggleButtonGroup>
          </Labeled>
          {draft.rum.mode === "name" && (
            <Labeled label="Name delimiter" width={160}>
              <TextInput value={draft.rum.delimiter ?? "-"} onChange={(v) => set({ rum: { ...draft.rum, delimiter: v } })} placeholder="-" disabled={!canEdit} />
            </Labeled>
          )}
          {draft.rum.mode === "tag" && (
            <Labeled label="RUM tag key" width={200}>
              <TextInput value={draft.rum.tagKey ?? ""} onChange={(v) => set({ rum: { ...draft.rum, tagKey: v } })} placeholder="AppID" disabled={!canEdit} />
            </Labeled>
          )}
          <Labeled label="Synthetic matching">
            <ToggleButtonGroup value={draft.synthetic.mode} onChange={(v) => set({ synthetic: { ...draft.synthetic, mode: v as AppConfig["synthetic"]["mode"] } })}>
              <ToggleButtonGroup.Item value="viaRum">Via RUM app</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="tag">By tag</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="off">Off</ToggleButtonGroup.Item>
            </ToggleButtonGroup>
          </Labeled>
          {draft.synthetic.mode === "tag" && (
            <Labeled label="Synthetic tag key" width={200}>
              <TextInput value={draft.synthetic.tagKey ?? ""} onChange={(v) => set({ synthetic: { ...draft.synthetic, tagKey: v } })} placeholder="AppID" disabled={!canEdit} />
            </Labeled>
          )}
        </Flex>
        {draft.rum.mode === "name" && (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            The application id is the text before the first <Strong>{draft.rum.delimiter || "-"}</Strong> in the
            entity name (e.g. <Strong>19698{draft.rum.delimiter || "-"}My App</Strong> → <Strong>19698</Strong>).
          </Text>
        )}
      </Section>

      <Section title="Logs" hint="Which log attribute carries the application id.">
        <Flex flexFlow="wrap" gap={16}>
          <Labeled label="Log field">
            <TextInput value={draft.logs.field} onChange={(v) => set({ logs: { ...draft.logs, field: v } })} placeholder="AppID" disabled={!canEdit} />
          </Labeled>
          <Labeled label="Sampling ratio (1 = none)" width={200}>
            <TextInput
              value={String(draft.logs.samplingRatio)}
              onChange={(v) => set({ logs: { ...draft.logs, samplingRatio: Number(v) || 1 } })}
              disabled={!canEdit}
            />
          </Labeled>
          <Labeled label="Look-back (hours)" width={160}>
            <TextInput
              value={String(draft.logs.lookbackHours)}
              onChange={(v) => set({ logs: { ...draft.logs, lookbackHours: Number(v) || 2 } })}
              disabled={!canEdit}
            />
          </Labeled>
        </Flex>
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          A full log scan is expensive. Sampling keeps the portfolio view fast; per-application
          detail links through to the Logs app for exact numbers.
        </Text>
      </Section>

      <Section title="Tier &amp; priority" hint="Optional. Flag your most important applications so the app can highlight the coverage gaps that matter most.">
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          A <Strong>tier</Strong> column (e.g. criticality) drives the tier filter on Coverage, a
          headline KPI card and the Overview distribution. A <Strong>priority rule</Strong> marks an
          application as priority when it matches every condition you add — those apps get their own
          KPI and a dedicated &quot;Priority applications with gaps&quot; table on the
          Recommendations tab.
        </Text>
        <Labeled label="Identify priority / critical applications" width={340}>
          <Switch
            value={showPriority}
            onChange={(v) => {
              setShowPriority(v);
              if (!v) set({ tier: undefined, priority: { conditions: [] } });
            }}
            disabled={!canEdit}
          />
        </Labeled>
        {showPriority && (
        <>
        <Flex flexFlow="wrap" gap={16}>
          <Labeled label="Tier / criticality column">
            <ColumnField
              value={draft.tier?.field ?? ""}
              onChange={(v) => set({ tier: v ? { field: v, label: draft.tier?.label || "Tier" } : undefined })}
              options={discoveredFields}
              placeholder="(none)"
              disabled={!canEdit}
            />
          </Labeled>
          <Labeled label="Tier label">
            <TextInput
              value={draft.tier?.label ?? ""}
              onChange={(v) => set({ tier: draft.tier?.field ? { field: draft.tier.field, label: v } : undefined })}
              placeholder="Tier"
              disabled={!canEdit || !draft.tier?.field}
            />
          </Labeled>
        </Flex>
        <Divider />
        <Text textStyle="small">
          Priority rule — an application is &quot;priority&quot; when it matches all of these conditions.
          Pick the actual column value(s) to match (e.g. Tier1); several values in one condition match
          any of them.
        </Text>
        <Flex flexDirection="column" gap={12}>
          {(draft.priority.conditions ?? []).map((c, i) => (
            <Flex key={i} flexFlow="wrap" gap={12} alignItems="flex-end">
              <Labeled label="Column" width={220}>
                <ColumnField
                  value={c.field}
                  onChange={(v) => {
                    const conditions = [...draft.priority.conditions];
                    conditions[i] = { ...conditions[i], field: v };
                    set({ priority: { conditions } });
                  }}
                  options={discoveredFields}
                  placeholder="criticality"
                  disabled={!canEdit}
                />
              </Labeled>
              <Labeled label="Matches value(s)" width={220}>
                <ValueField
                  values={c.values}
                  onChange={(vals) => {
                    const conditions = [...draft.priority.conditions];
                    conditions[i] = { ...conditions[i], values: vals };
                    set({ priority: { conditions } });
                  }}
                  options={valuesByColumn[c.field] ?? []}
                  placeholder="Tier1"
                  disabled={!canEdit}
                />
              </Labeled>
              {canEdit && (
                <Button variant="default" onClick={() => set({ priority: { conditions: draft.priority.conditions.filter((_, x) => x !== i) } })}>
                  Remove
                </Button>
              )}
            </Flex>
          ))}
          {canEdit && (
            <Flex>
              <Button variant="emphasized" onClick={() => set({ priority: { conditions: [...(draft.priority.conditions ?? []), { field: "", values: [] }] } })}>
                Add condition
              </Button>
            </Flex>
          )}
        </Flex>
        </>
        )}
      </Section>

      <Section title="Advanced" hint="Sensible defaults; change only if your environment needs it.">
        <Flex flexFlow="wrap" gap={16}>
          <Labeled label="OneAgent outdated after (releases behind)" width={260}>
            <TextInput
              value={String(draft.agent.outdatedReleasesBehind)}
              onChange={(v) => set({ agent: { outdatedReleasesBehind: Number(v) || 5 } })}
              disabled={!canEdit}
            />
          </Labeled>
          <Labeled label="Entity active within (hours)" width={220}>
            <TextInput
              value={String(draft.windows.entityActivityHours)}
              onChange={(v) => set({ windows: { ...draft.windows, entityActivityHours: Number(v) || 2 } })}
              disabled={!canEdit}
            />
          </Labeled>
          <Labeled label="Trend look-back (days)" width={200}>
            <TextInput
              value={String(draft.windows.fullstackDays)}
              onChange={(v) => set({ windows: { ...draft.windows, fullstackDays: Number(v) || 60 } })}
              disabled={!canEdit}
            />
          </Labeled>
        </Flex>
      </Section>

      <Section title="Test configuration" hint="Reads your environment and checks the settings above actually resolve.">
        <Flex gap={12} alignItems="center">
          <Button variant="emphasized" onClick={() => setTesting(true)}>
            Test configuration
          </Button>
          {(sample.isLoading || tagKeys.isLoading) && <ProgressCircle />}
        </Flex>
        {testing && (
          <Flex flexDirection="column" gap={8}>
            {sample.error ? (
              <Status>Lookup table unreadable: {sample.error.message}</Status>
            ) : discoveredFields.length ? (
              <>
                <Status ok>Lookup table found — {discoveredFields.length} columns detected.</Status>
                <Status ok={discoveredFields.includes(draft.lookup.keyField)}>
                  ID column <Strong>{draft.lookup.keyField || "(unset)"}</Strong>{" "}
                  {discoveredFields.includes(draft.lookup.keyField) ? "exists" : "was not found in the table"}
                </Status>
                <Status ok={discoveredFields.includes(draft.lookup.nameField)}>
                  Name column <Strong>{draft.lookup.nameField || "(unset)"}</Strong>{" "}
                  {discoveredFields.includes(draft.lookup.nameField) ? "exists" : "was not found in the table"}
                </Status>
                {draft.fields.filter((f) => f.key && !discoveredFields.includes(f.key)).map((f) => (
                  <Status key={f.key} warn>
                    Field <Strong>{f.key}</Strong> is configured but not present in the lookup table.
                  </Status>
                ))}
              </>
            ) : (
              <Status warn>No rows returned from the lookup table — is the path correct?</Status>
            )}
            <Status ok={discoveredTagKeys.includes(draft.entities.tagKey)} warn={!discoveredTagKeys.includes(draft.entities.tagKey)}>
              Tag key <Strong>{draft.entities.tagKey || "(unset)"}</Strong>{" "}
              {discoveredTagKeys.includes(draft.entities.tagKey)
                ? "is in use on your entities"
                : "was not seen on sampled hosts — check the spelling"}
            </Status>
            {discoveredFields.length > 0 && (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
                Available columns: {discoveredFields.join(", ")}
              </Text>
            )}
          </Flex>
        )}
      </Section>

      {/* Save bar */}
      <Surface>
        <Flex flexDirection="column" gap={12} padding={20}>
          {errors.length > 0 && (
            <Flex flexDirection="column" gap={6}>
              {errors.map((e) => (
                <Status key={e}>{e}</Status>
              ))}
            </Flex>
          )}
          {saveErr && <Status>{saveErr}</Status>}
          {saveMsg && <Status ok>{saveMsg}</Status>}
          <Flex gap={12} alignItems="center">
            {canEdit && (
              <Button variant="accent" onClick={() => { void onSave(); }} disabled={saving || errors.length > 0 || !dirty}>
                {saving ? "Saving…" : "Save configuration"}
              </Button>
            )}
            <Button
              variant="default"
              onClick={() => {
                setDirty(false);
                setSaveErr(undefined);
                setSaveMsg(undefined);
                void reload();
              }}
            >
              Discard changes
            </Button>
            {canEdit && (
              <Button variant="default" onClick={() => set(EMPTY_CONFIG)}>
                Reset to blank
              </Button>
            )}
          </Flex>
        </Flex>
      </Surface>
    </Flex>
  );
};
