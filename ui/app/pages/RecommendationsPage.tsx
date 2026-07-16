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
import { ADHERENCE_ROLLUP_QUERY, type AdherenceRollupRow } from "../queries/recommendations";
import { type CoverageRow } from "../queries/coverage";

const rollupCols: DataTableColumnDef<AdherenceRollupRow>[] = [
  { id: "EntityType", header: "Entity Type", accessor: "EntityType", width: 160 },
  { id: "Total", header: "Total", accessor: (r) => num(r.Total), width: 100 },
  { id: "MissingAppID", header: "No AppID", accessor: (r) => num(r.MissingAppID), width: 110 },
  { id: "MissingAppName", header: "No App_Name", accessor: (r) => num(r.MissingAppName), width: 130 },
  { id: "MissingBU", header: "No BU", accessor: (r) => num(r.MissingBU), width: 100 },
  { id: "MissingEnvironment", header: "No Environment", accessor: (r) => num(r.MissingEnvironment), width: 140 },
  { id: "MissingLocation", header: "No Location", accessor: (r) => num(r.MissingLocation), width: 120 },
];

export const RecommendationsPage = () => {
  const { rows, isLoading, error } = usePortfolio();
  const rollup = useSegmentedDql<AdherenceRollupRow>(ADHERENCE_ROLLUP_QUERY);
  const rollupRecords = useMemo(() => rollup.data?.records ?? [], [rollup.data]);

  const totals = useMemo(() => {
    const sum = (k: keyof AdherenceRollupRow) => rollupRecords.reduce((a, r) => a + num(r[k]), 0);
    return {
      appId: sum("MissingAppID"),
      appName: sum("MissingAppName"),
      bu: sum("MissingBU"),
      env: sum("MissingEnvironment"),
      loc: sum("MissingLocation"),
    };
  }, [rollupRecords]);

  /** Priority apps: Tier-1 (BCC1) AND revenue-generating, with at least one missing core signal. */
  const priority = useMemo(() => {
    const core: (keyof CoverageRow)[] = ["Metrics", "Traces", "Logs"];
    return rows
      .filter((r) => r.biaIndex === "BCC1" && r.revenueGenerating === "Yes")
      .map((r) => ({ ...r, gaps: core.filter((c) => r[c] === "No").length + (r.monitoringMode === "None" ? 1 : 0) }))
      .filter((r) => r.gaps > 0)
      .sort((a, b) => b.gaps - a.gaps || a.biaIndex.localeCompare(b.biaIndex));
  }, [rows]);

  const priorityCols: DataTableColumnDef<CoverageRow>[] = [
    {
      id: "appID",
      header: "App ID",
      accessor: "appID",
      width: 90,
      cell: ({ value }) => (
        <Link as={RouterLink} to={`/app/${encodeURIComponent(String(value))}`}>
          {String(value)}
        </Link>
      ),
    },
    { id: "appName", header: "Application", accessor: "appName", width: 220 },
    { id: "biaIndex", header: "Tier", accessor: "biaIndex", width: 70 },
    { id: "revenueGenerating", header: "Revenue", accessor: "revenueGenerating", width: 90 },
    { id: "Metrics", header: "Metrics", accessor: "Metrics", width: 90, cell: ({ value }) => <SignalCell value={value as string} /> },
    { id: "Traces", header: "Traces", accessor: "Traces", width: 90, cell: ({ value }) => <SignalCell value={value as string} /> },
    { id: "Logs", header: "Logs", accessor: "Logs", width: 90, cell: ({ value }) => <SignalCell value={value as string} /> },
    { id: "buOwnerName", header: "BU Owner", accessor: "buOwnerName", width: 170 },
    { id: "supportRemedyGroup", header: "Support Group", accessor: "supportRemedyGroup", width: 220 },
  ];

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
        <QueryState isLoading={rollup.isLoading} error={rollup.error} isEmpty={rollupRecords.length === 0}>
          <Flex flexFlow="wrap" gap={16}>
            <StatCard label="Missing AppID tag" value={totals.appId.toLocaleString()} intent={totals.appId ? "critical" : "success"} />
            <StatCard label="Missing App_Name tag" value={totals.appName.toLocaleString()} intent={totals.appName ? "warning" : "success"} />
            <StatCard label="Missing BU tag" value={totals.bu.toLocaleString()} intent={totals.bu ? "warning" : "success"} />
            <StatCard label="Missing Environment tag" value={totals.env.toLocaleString()} intent={totals.env ? "warning" : "success"} />
            <StatCard label="Missing Location tag" value={totals.loc.toLocaleString()} intent={totals.loc ? "warning" : "success"} />
          </Flex>
          <Surface>
            <Flex padding={16}>
              <DataTable data={rollupRecords} columns={rollupCols} sortable fullWidth />
            </Flex>
          </Surface>
        </QueryState>

        <Heading level={4}>Priority applications (Tier-1 and revenue-generating, with signal gaps)</Heading>
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
      </QueryState>
    </Flex>
  );
};
