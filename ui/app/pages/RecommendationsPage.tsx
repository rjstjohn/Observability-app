import React, { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text, Link } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components-preview/tables";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { usePortfolio, useSegmentedDql, num } from "../hooks/usePortfolio";
import { QueryState } from "../components/QueryState";
import { StatCard } from "../components/StatCard";
import { SignalCell } from "../components/cells";
import { buildAdherenceRollupQuery, type AdherenceRollupRow } from "../queries/recommendations";
import { type CoverageRow } from "../queries/coverage";
import { useConfig } from "../config/ConfigProvider";
import { enabledSignals, fieldsFor, str } from "../config/types";

export const RecommendationsPage = () => {
  const { config } = useConfig();
  const { rows, isLoading, error } = usePortfolio();
  const rollupQuery = useMemo(() => buildAdherenceRollupQuery(config), [config]);
  const rollup = useSegmentedDql<AdherenceRollupRow>(rollupQuery);
  const rollupRecords = useMemo(() => rollup.data?.records ?? [], [rollup.data]);

  const tags = config.entities.adherenceTags;
  const signals = enabledSignals(config);
  const priorityConds = useMemo(() => config.priority.conditions ?? [], [config.priority.conditions]);

  /** Totals per tag: the app-id tag plus each configured adherence tag. */
  const totals = useMemo(() => {
    const sum = (k: string) => rollupRecords.reduce((a, r) => a + num(r[k]), 0);
    return {
      appId: sum("MissingAppID"),
      byTag: tags.map((t, i) => ({ label: t.label, count: sum(`Missing${i}`) })),
    };
  }, [rollupRecords, tags]);

  const rollupCols: DataTableColumnDef<AdherenceRollupRow>[] = useMemo(
    () => [
      { id: "EntityType", header: "Entity Type", accessor: "EntityType", width: 160 },
      { id: "Total", header: "Total", accessor: (r) => num(r.Total), width: 100 },
      {
        id: "MissingAppID",
        header: `No ${config.entities.tagKey}`,
        accessor: (r) => num(r.MissingAppID),
        width: 120,
      },
      ...tags.map<DataTableColumnDef<AdherenceRollupRow>>((t, i) => ({
        id: `Missing${i}`,
        header: `No ${t.label}`,
        accessor: (r) => num(r[`Missing${i}`]),
        width: 130,
      })),
    ],
    [tags, config.entities.tagKey]
  );

  /** Priority applications: match every configured condition AND have a signal gap. */
  const priority = useMemo(() => {
    if (!priorityConds.length) return [];
    const core = signals.filter((s) => s === "Metrics" || s === "Traces" || s === "Logs");
    return rows
      .filter((r) => priorityConds.every((c) => c.values.includes(str(r[c.field]))))
      .map((r) => ({
        ...r,
        gaps: core.filter((c) => r[c] === "No").length + (r.monitoringMode === "None" ? 1 : 0),
      }))
      .filter((r) => r.gaps > 0)
      .sort((a, b) => b.gaps - a.gaps);
  }, [rows, priorityConds, signals]);

  const priorityCols: DataTableColumnDef<CoverageRow>[] = useMemo(
    () => [
      {
        id: "appID",
        header: "App ID",
        accessor: "appID",
        width: 100,
        cell: ({ value }) => (
          <Link as={RouterLink} to={`/app/${encodeURIComponent(String(value))}`}>
            {String(value)}
          </Link>
        ),
      },
      { id: "appName", header: "Application", accessor: "appName", width: 220 },
      ...priorityConds.map<DataTableColumnDef<CoverageRow>>((c, i) => ({
        // Key by index so two conditions on the same column can't produce a duplicate id.
        id: `cond_${i}`,
        header: config.fields.find((f) => f.key === c.field)?.label ?? c.field,
        accessor: (r) => str(r[c.field]),
        width: 120,
      })),
      ...signals
        .filter((s) => s === "Metrics" || s === "Traces" || s === "Logs")
        .map<DataTableColumnDef<CoverageRow>>((s) => ({
          id: s,
          header: s,
          accessor: s,
          width: 90,
          cell: ({ value }) => <SignalCell value={value as string} />,
        })),
      ...fieldsFor(config, "table")
        .filter((f) => !priorityConds.some((c) => c.field === f.key))
        .slice(0, 2)
        .map<DataTableColumnDef<CoverageRow>>((f) => ({
          id: `cf_${f.key}`,
          header: f.label || f.key,
          accessor: (r) => str(r[f.key]),
          width: 180,
        })),
    ],
    [priorityConds, signals, config]
  );

  const priorityLabel = priorityConds
    .map((c) => `${config.fields.find((f) => f.key === c.field)?.label ?? c.field} = ${c.values.join("/")}`)
    .join(" and ");

  return (
    <Flex flexDirection="column" gap={24} padding={32}>
      <Flex flexDirection="column" gap={4}>
        <Heading>Recommendations</Heading>
        <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
          Portfolio-wide metadata gaps and the highest-priority applications to improve.
        </Paragraph>
      </Flex>

      <QueryState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
        <Heading level={4}>Metadata tag gaps (all monitored entities)</Heading>
        <QueryState
          isLoading={rollup.isLoading}
          error={rollup.error}
          isEmpty={rollupRecords.length === 0}
        >
          <Flex flexFlow="wrap" gap={16}>
            <StatCard
              label={`Missing ${config.entities.tagKey} tag`}
              value={totals.appId.toLocaleString()}
              intent={totals.appId ? "critical" : "success"}
            />
            {totals.byTag.map((t) => (
              <StatCard
                key={t.label}
                label={`Missing ${t.label} tag`}
                value={t.count.toLocaleString()}
                intent={t.count ? "warning" : "success"}
              />
            ))}
          </Flex>
          <Surface>
            <Flex padding={16}>
              <DataTable data={rollupRecords} columns={rollupCols} sortable fullWidth />
            </Flex>
          </Surface>
        </QueryState>

        {priorityConds.length > 0 ? (
          <>
            <Heading level={4}>Priority applications ({priorityLabel}, with signal gaps)</Heading>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
              {priority.length.toLocaleString()} applications need attention
            </Text>
            <Surface>
              <Flex padding={16}>
                <DataTable data={priority} columns={priorityCols} sortable resizable fullWidth>
                  {priority.length > 25 && <DataTable.Pagination defaultPageSize={25} />}
                </DataTable>
              </Flex>
            </Surface>
          </>
        ) : (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            No priority rule configured — set one on the Configuration tab to highlight the
            applications that matter most.
          </Text>
        )}
      </QueryState>
    </Flex>
  );
};
