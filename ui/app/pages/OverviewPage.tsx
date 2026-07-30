import React, { useMemo, useState } from "react";
import { Flex, Grid, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { TimeseriesChart, convertToTimeseries } from "@dynatrace/strato-components-preview/charts";
import type { ResultRecord } from "@dynatrace-sdk/client-query";
import { usePortfolio, useSegmentedDql } from "../hooks/usePortfolio";
import { QueryState } from "../components/QueryState";
import { StatCard } from "../components/StatCard";
import { CoverageBar } from "../components/CoverageBar";
import { type CoverageRow } from "../queries/coverage";
import { fullstackOverTimeQuery } from "../queries/common";
import { useConfig } from "../config/ConfigProvider";
import { enabledSignals, fieldsFor, str } from "../config/types";
import Colors from "@dynatrace/strato-design-tokens/colors";

function countBy(rows: CoverageRow[], key: (r: CoverageRow) => string) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || "(unknown)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const Distribution = ({ title, data }: { title: string; data: [string, number][] }) => {
  const max = Math.max(1, ...data.map(([, v]) => v));
  return (
    <Surface>
      <Flex flexDirection="column" gap={12} padding={16}>
        <Heading level={4}>{title}</Heading>
        {data.map(([label, value]) => (
          <Flex key={label} flexDirection="column" gap={2}>
            <Flex justifyContent="space-between">
              <Text>{label}</Text>
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
                {value.toLocaleString()}
              </Text>
            </Flex>
            <div style={{ height: 6, borderRadius: 3, background: Colors.Background.Container.Neutral.Default }}>
              <div
                style={{
                  width: `${(value / max) * 100}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: Colors.Background.Container.Primary.Accent,
                }}
              />
            </div>
          </Flex>
        ))}
      </Flex>
    </Surface>
  );
};

export const OverviewPage = () => {
  const { config } = useConfig();
  const { rows, isLoading, error, logsPending } = usePortfolio();
  const fullStackQuery = useMemo(() => fullstackOverTimeQuery(config), [config]);
  const fullStack = useSegmentedDql<ResultRecord>(fullStackQuery);

  const signals = enabledSignals(config);
  const tierField = config.tier?.field;
  const priorityConds = useMemo(() => config.priority.conditions ?? [], [config.priority.conditions]);

  /**
   * Filters for the Signal-coverage tile only (deliberately do not affect the KPI cards,
   * the trend chart or the distributions). Derived from the tier field plus any fields used
   * by the priority rule, so they reflect whatever this environment actually configured.
   */
  const filterFields = useMemo(() => {
    const keys = [tierField, ...priorityConds.map((c) => c.field)].filter(Boolean) as string[];
    return [...new Set(keys)];
  }, [tierField, priorityConds]);

  const [filters, setFilters] = useState<Record<string, string>>({});

  /** Distinct values per filter field, taken from the data so buckets are exhaustive. */
  const valuesByField = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of filterFields) {
      out[f] = [...new Set(rows.map((r) => str(r[f])).filter(Boolean))].sort();
    }
    return out;
  }, [rows, filterFields]);

  const labelFor = (field: string) =>
    field === tierField
      ? config.tier?.label || "Tier"
      : config.fields.find((f) => f.key === field)?.label || field;

  const signalRows = useMemo(
    () =>
      rows.filter((r) =>
        filterFields.every((f) => {
          const sel = filters[f];
          return !sel || sel === "all" || str(r[f]) === sel;
        })
      ),
    [rows, filters, filterFields]
  );

  const total = rows.length;
  const monitored = rows.filter((r) => r.Monitored === "Yes");
  const notMonitored = total - monitored.length;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  /** Top tier value = first sorted distinct value of the tier field (e.g. Tier1, Tier 1). */
  const topTier = tierField ? (valuesByField[tierField]?.[0] ?? "") : "";
  const tierRows = tierField && topTier ? rows.filter((r) => str(r[tierField]) === topTier) : [];
  const tierMonitored = tierRows.filter((r) => r.Monitored === "Yes").length;

  const priorityRows = useMemo(
    () =>
      priorityConds.length
        ? rows.filter((r) => priorityConds.every((c) => c.values.includes(str(r[c.field]))))
        : [],
    [rows, priorityConds]
  );
  const priorityMonitored = priorityRows.filter((r) => r.Monitored === "Yes").length;

  /** Third distribution: the first configured table field that isn't the tier field. */
  const thirdField = fieldsFor(config, "table").find((f) => f.key !== tierField);

  return (
    <Flex flexDirection="column" gap={24} padding={32}>
      <Flex flexDirection="column" gap={4}>
        <Heading>Observability Coverage — Overview</Heading>
        <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
          Portfolio-wide view of which applications Dynatrace is monitoring.
        </Paragraph>
      </Flex>

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={total === 0}
        emptyText="No applications found in the configured lookup table."
      >
        <Flex flexFlow="wrap" gap={16}>
          <StatCard label="Total applications" value={total.toLocaleString()} />
          <StatCard
            label="Monitored"
            value={monitored.length.toLocaleString()}
            hint={`${pct(monitored.length, total)}% of portfolio`}
            intent="success"
          />
          <StatCard
            label="Not monitored"
            value={notMonitored.toLocaleString()}
            hint={`${pct(notMonitored, total)}% of portfolio`}
            intent={notMonitored > 0 ? "critical" : "success"}
          />
          {tierField && topTier && (
            <StatCard
              label={`${labelFor(tierField)} ${topTier} monitored`}
              value={`${tierMonitored} / ${tierRows.length}`}
              hint={`${pct(tierMonitored, tierRows.length)}% covered`}
              intent={pct(tierMonitored, tierRows.length) >= 90 ? "success" : "warning"}
            />
          )}
          {priorityConds.length > 0 && (
            <StatCard
              label="Priority monitored"
              value={`${priorityMonitored} / ${priorityRows.length}`}
              hint={`${pct(priorityMonitored, priorityRows.length)}% covered`}
              intent={pct(priorityMonitored, priorityRows.length) >= 90 ? "success" : "warning"}
            />
          )}
        </Flex>

        <Surface>
          <Flex flexDirection="column" gap={16} padding={16}>
            <Flex justifyContent="space-between" alignItems="flex-end" flexFlow="wrap" gap={16}>
              <Heading level={4}>Signal coverage across the portfolio</Heading>
              <Flex flexFlow="wrap" gap={16} alignItems="flex-end">
                {filterFields.map((f) =>
                  (valuesByField[f] ?? []).length ? (
                    <Flex key={f} flexDirection="column" gap={4}>
                      <Text textStyle="small">{labelFor(f)}</Text>
                      <ToggleButtonGroup
                        value={filters[f] ?? "all"}
                        onChange={(v) => setFilters((prev) => ({ ...prev, [f]: v }))}
                      >
                        <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
                        {valuesByField[f].map((v) => (
                          <ToggleButtonGroup.Item key={v} value={v}>
                            {v}
                          </ToggleButtonGroup.Item>
                        ))}
                      </ToggleButtonGroup>
                    </Flex>
                  ) : null
                )}
              </Flex>
            </Flex>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
              {signalRows.length.toLocaleString()} of {total.toLocaleString()} applications
            </Text>
            {signals.map((sig) => (
              <CoverageBar
                key={sig}
                label={sig === "Logs" && logsPending ? "Logs (loading…)" : sig}
                covered={signalRows.filter((r) => r[sig] === "Yes").length}
                total={signalRows.length}
              />
            ))}
          </Flex>
        </Surface>

        <Surface>
          <Flex flexDirection="column" gap={12} padding={16}>
            <Heading level={4}>Applications with Full-Stack monitoring over time</Heading>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
              Distinct applications reporting at least one Full-Stack host, weekly over the last{" "}
              {config.windows.fullstackDays} days.
            </Text>
            <QueryState
              isLoading={fullStack.isLoading}
              error={fullStack.error}
              isEmpty={!fullStack.data?.records?.length}
              emptyText="No Full-Stack monitoring events in this period."
            >
              <div style={{ height: 280 }}>
                {fullStack.data && (
                  <TimeseriesChart
                    data={convertToTimeseries(fullStack.data.records, fullStack.data.types)}
                    variant="line"
                  />
                )}
              </div>
            </QueryState>
          </Flex>
        </Surface>

        <Grid gridTemplateColumns="1fr 1fr 1fr" gap={16}>
          {tierField && (
            <Distribution
              title={`By ${labelFor(tierField).toLowerCase()}`}
              data={countBy(rows, (r) => str(r[tierField]))}
            />
          )}
          <Distribution title="By monitoring mode" data={countBy(rows, (r) => r.monitoringMode)} />
          {thirdField && (
            <Distribution
              title={`By ${thirdField.label.toLowerCase()}`}
              data={countBy(rows, (r) => str(r[thirdField.key])).slice(0, 8)}
            />
          )}
        </Grid>
      </QueryState>
    </Flex>
  );
};
