import React, { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text, Link } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components-preview/tables";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { usePortfolio, useSegmentedDql, num } from "../hooks/usePortfolio";
import { QueryState } from "../components/QueryState";
import { StatCard } from "../components/StatCard";
import { ORPHAN_TAGS_QUERY, type OrphanTagRow } from "../queries/recommendations";
import { type CoverageRow } from "../queries/coverage";

export const ExplorerPage = () => {
  const { rows, isLoading, error } = usePortfolio();
  const orphans = useSegmentedDql<OrphanTagRow>(ORPHAN_TAGS_QUERY);
  const orphanRecords = orphans.data?.records ?? [];

  const notMonitored = useMemo(() => rows.filter((r) => r.Monitored === "No"), [rows]);

  const unmonCols: DataTableColumnDef<CoverageRow>[] = [
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
    { id: "appName", header: "Application", accessor: "appName", width: 240 },
    { id: "biaIndex", header: "Tier", accessor: "biaIndex", width: 70 },
    { id: "revenueGenerating", header: "Revenue", accessor: "revenueGenerating", width: 90 },
    { id: "businessUnit", header: "Business Unit", accessor: "businessUnit", width: 240 },
    { id: "buOwnerName", header: "BU Owner", accessor: "buOwnerName", width: 170 },
    { id: "hostingEnvironment", header: "Hosting", accessor: "hostingEnvironment", width: 140 },
  ];

  const orphanCols: DataTableColumnDef<OrphanTagRow>[] = [
    { id: "appID", header: "Tagged App ID", accessor: "appID", width: 140 },
    { id: "entities", header: "Entities", accessor: (r) => num(r.entities), width: 110 },
    {
      id: "entityTypes",
      header: "Entity Types",
      accessor: (r) => (Array.isArray(r.entityTypes) ? r.entityTypes.join(", ") : String(r.entityTypes ?? "")),
      width: 260,
    },
  ];

  return (
    <Flex flexDirection="column" gap={24} padding={32}>
      <Flex flexDirection="column" gap={4}>
        <Heading>Explorer — Gaps &amp; Orphans</Heading>
        <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
          Applications with no detected telemetry, and AppID-tagged entities that don't match any LeanIX application.
        </Paragraph>
      </Flex>

      <QueryState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
        <Flex flexFlow="wrap" gap={16}>
          <StatCard
            label="Applications not monitored"
            value={notMonitored.length.toLocaleString()}
            hint={`of ${rows.length.toLocaleString()} in portfolio`}
            intent={notMonitored.length ? "critical" : "success"}
          />
          <StatCard
            label="Orphan AppID tags"
            value={orphans.isLoading ? "…" : orphanRecords.length.toLocaleString()}
            hint="tagged but not in LeanIX"
            intent={orphanRecords.length ? "warning" : "success"}
          />
        </Flex>

        <Heading level={4}>Not monitored — no metrics, traces, logs, RUM or synthetic detected</Heading>
        <Surface>
          <Flex padding={16}>
            <DataTable data={notMonitored} columns={unmonCols} sortable resizable fullWidth>
              {notMonitored.length > 50 && <DataTable.Pagination defaultPageSize={50} />}
            </DataTable>
          </Flex>
        </Surface>

        <Heading level={4}>Orphan AppID tags — data-quality follow-up</Heading>
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          These AppID values are tagged on entities but missing from leanix_data (typos, retired apps, or new apps not yet onboarded).
        </Text>
        <Surface>
          <Flex padding={16}>
            <QueryState isLoading={orphans.isLoading} error={orphans.error} isEmpty={orphanRecords.length === 0} emptyText="No orphan AppID tags — every tagged entity maps to a known application.">
              <DataTable data={orphanRecords} columns={orphanCols} sortable resizable fullWidth>
                {orphanRecords.length > 50 && <DataTable.Pagination defaultPageSize={50} />}
              </DataTable>
            </QueryState>
          </Flex>
        </Surface>
      </QueryState>
    </Flex>
  );
};
