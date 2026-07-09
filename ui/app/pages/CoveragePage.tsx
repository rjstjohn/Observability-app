import React, { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Link, Text } from "@dynatrace/strato-components/typography";
import { SearchInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components-preview/tables";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { usePortfolio, num } from "../hooks/usePortfolio";
import { QueryState } from "../components/QueryState";
import { SignalCell, MonitoringModeCell } from "../components/cells";
import { type CoverageRow } from "../queries/coverage";

const signalCol = (key: keyof CoverageRow, header: string): DataTableColumnDef<CoverageRow> => ({
  id: key,
  header,
  accessor: key,
  width: 90,
  cell: ({ value }) => <SignalCell value={value as string} />,
});

export const CoveragePage = () => {
  const { rows, isLoading, error } = usePortfolio();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tier, setTier] = useState("all");
  const [revenue, setRevenue] = useState("all");

  const tiers = useMemo(
    () => [...new Set(rows.map((r) => r.biaIndex).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "monitored" && r.Monitored !== "Yes") return false;
      if (status === "unmonitored" && r.Monitored === "Yes") return false;
      if (tier !== "all" && r.biaIndex !== tier) return false;
      if (revenue === "yes" && r.revenueGenerating !== "Yes") return false;
      if (revenue === "no" && r.revenueGenerating !== "No") return false;
      if (!q) return true;
      return [r.appID, r.appName, r.buOwnerName, r.itApplicationOwner, r.itPortfolioOwnerName, r.businessUnit, r.supportRemedyGroup]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, status, tier, revenue]);

  const columns: DataTableColumnDef<CoverageRow>[] = useMemo(
    () => [
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
      { id: "appName", header: "Application Name", accessor: "appName", width: 240 },
      { id: "biaIndex", header: "Tier", accessor: "biaIndex", width: 70 },
      {
        id: "monitoringMode",
        header: "Monitoring",
        accessor: "monitoringMode",
        width: 130,
        cell: ({ value }) => <MonitoringModeCell value={value as string} />,
      },
      signalCol("Metrics", "Metrics"),
      signalCol("Traces", "Traces"),
      signalCol("Logs", "Logs"),
      signalCol("RUM", "RUM"),
      signalCol("Synthetic", "Synthetic"),
      { id: "Hosts", header: "Hosts", accessor: (r) => num(r.Hosts), width: 80 },
      { id: "Services", header: "Services", accessor: (r) => num(r.Services), width: 90 },
      { id: "buOwnerName", header: "BU Owner", accessor: "buOwnerName", width: 160 },
      { id: "itApplicationOwner", header: "IT App Owner", accessor: "itApplicationOwner", width: 160 },
      { id: "itPortfolioOwnerName", header: "Portfolio Owner", accessor: "itPortfolioOwnerName", width: 160 },
      { id: "supportRemedyGroup", header: "Support Group", accessor: "supportRemedyGroup", width: 200 },
      { id: "revenueGenerating", header: "Revenue", accessor: "revenueGenerating", width: 90 },
      { id: "businessUnit", header: "Business Unit", accessor: "businessUnit", width: 220 },
    ],
    []
  );

  return (
    <Flex flexDirection="column" gap={16} padding={32}>
      <Flex flexDirection="column" gap={4}>
        <Heading>Coverage &amp; Health</Heading>
        <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
          Every LeanIX application with its detected observability signals. Click an App ID for detail.
        </Paragraph>
      </Flex>

      <QueryState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
        <Flex flexFlow="wrap" gap={16} alignItems="flex-end">
          <Flex flexDirection="column" gap={4} style={{ minWidth: 280 }}>
            <Text textStyle="small">Search (app, owner, BU, support group)</Text>
            <SearchInput value={search} onChange={setSearch} placeholder="e.g. MuleSoft, 19698, finance…" />
          </Flex>
          <Flex flexDirection="column" gap={4}>
            <Text textStyle="small">Status</Text>
            <ToggleButtonGroup value={status} onChange={setStatus}>
              <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="monitored">Monitored</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="unmonitored">Not monitored</ToggleButtonGroup.Item>
            </ToggleButtonGroup>
          </Flex>
          <Flex flexDirection="column" gap={4}>
            <Text textStyle="small">Tier</Text>
            <ToggleButtonGroup value={tier} onChange={setTier}>
              <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
              {tiers.map((t) => (
                <ToggleButtonGroup.Item key={t} value={t}>
                  {t}
                </ToggleButtonGroup.Item>
              ))}
            </ToggleButtonGroup>
          </Flex>
          <Flex flexDirection="column" gap={4}>
            <Text textStyle="small">Revenue Generating</Text>
            <ToggleButtonGroup value={revenue} onChange={setRevenue}>
              <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="yes">Yes</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="no">No</ToggleButtonGroup.Item>
            </ToggleButtonGroup>
          </Flex>
        </Flex>

        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} applications
        </Text>

        <DataTable data={filtered} columns={columns} sortable resizable fullWidth>
          <DataTable.Pagination defaultPageSize={50} />
        </DataTable>
      </QueryState>
    </Flex>
  );
};
