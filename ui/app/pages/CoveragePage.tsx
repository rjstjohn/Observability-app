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
import { useConfig } from "../config/ConfigProvider";
import { enabledSignals, fieldsFor, str } from "../config/types";

export const CoveragePage = () => {
  const { config } = useConfig();
  const { rows, isLoading, error } = usePortfolio();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tier, setTier] = useState("all");
  const [priority, setPriority] = useState("all");

  const signals = enabledSignals(config);
  const tableFields = useMemo(() => fieldsFor(config, "table"), [config]);
  const searchFields = useMemo(
    () => config.fields.filter((f) => f.searchable).map((f) => f.key),
    [config]
  );
  const tierField = config.tier?.field;

  /** Tier chips are derived from the data so they match whatever values exist. */
  const tiers = useMemo(() => {
    if (!tierField) return [];
    return [...new Set(rows.map((r) => str(r[tierField])).filter(Boolean))].sort();
  }, [rows, tierField]);

  /** Does a row satisfy every configured priority condition? */
  const matchesPriority = useMemo(() => {
    const conds = config.priority.conditions ?? [];
    return (r: CoverageRow) =>
      conds.length > 0 && conds.every((c) => c.values.includes(str(r[c.field])));
  }, [config.priority.conditions]);

  const hasPriorityRule = (config.priority.conditions ?? []).length > 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "monitored" && r.Monitored !== "Yes") return false;
      if (status === "unmonitored" && r.Monitored === "Yes") return false;
      if (tierField && tier !== "all" && str(r[tierField]) !== tier) return false;
      if (priority === "yes" && !matchesPriority(r)) return false;
      if (!q) return true;
      return [r.appID, r.appName, ...searchFields.map((k) => r[k])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, status, tier, priority, tierField, searchFields, matchesPriority]);

  const columns: DataTableColumnDef<CoverageRow>[] = useMemo(() => {
    const cols: DataTableColumnDef<CoverageRow>[] = [
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
      { id: "appName", header: "Application Name", accessor: "appName", width: 240 },
      {
        id: "monitoringMode",
        header: "Monitoring",
        accessor: "monitoringMode",
        width: 130,
        cell: ({ value }) => <MonitoringModeCell value={value as string} />,
      },
      ...signals.map<DataTableColumnDef<CoverageRow>>((s) => ({
        id: s,
        header: s,
        accessor: s,
        width: 90,
        cell: ({ value }) => <SignalCell value={value as string} />,
      })),
      { id: "Hosts", header: "Hosts", accessor: (r) => num(r.Hosts), width: 80 },
      { id: "Services", header: "Services", accessor: (r) => num(r.Services), width: 90 },
      // Configured lookup columns, in configured order.
      ...tableFields.map<DataTableColumnDef<CoverageRow>>((f) => ({
        // Namespace the id so a lookup column can never collide with a core/signal column id.
        id: `cf_${f.key}`,
        header: f.label || f.key,
        accessor: (r) => str(r[f.key]),
        width: 170,
      })),
    ];
    return cols;
  }, [signals, tableFields]);

  return (
    <Flex flexDirection="column" gap={16} padding={32}>
      <Flex flexDirection="column" gap={4}>
        <Heading>Coverage &amp; Health</Heading>
        <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
          Every application in your portfolio with its detected observability signals. Click an App
          ID for detail.
        </Paragraph>
      </Flex>

      <QueryState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
        <Flex flexFlow="wrap" gap={16} alignItems="flex-end">
          <Flex flexDirection="column" gap={4} style={{ minWidth: 280 }}>
            <Text textStyle="small">Search</Text>
            <SearchInput value={search} onChange={setSearch} placeholder="Application, ID or owner…" />
          </Flex>
          <Flex flexDirection="column" gap={4}>
            <Text textStyle="small">Status</Text>
            <ToggleButtonGroup value={status} onChange={setStatus}>
              <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="monitored">Monitored</ToggleButtonGroup.Item>
              <ToggleButtonGroup.Item value="unmonitored">Not monitored</ToggleButtonGroup.Item>
            </ToggleButtonGroup>
          </Flex>
          {/* Tier filter only exists when a tier field is configured. */}
          {tierField && tiers.length > 0 && (
            <Flex flexDirection="column" gap={4}>
              <Text textStyle="small">{config.tier?.label || "Tier"}</Text>
              <ToggleButtonGroup value={tier} onChange={setTier}>
                <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
                {tiers.map((t) => (
                  <ToggleButtonGroup.Item key={t} value={t}>
                    {t}
                  </ToggleButtonGroup.Item>
                ))}
              </ToggleButtonGroup>
            </Flex>
          )}
          {hasPriorityRule && (
            <Flex flexDirection="column" gap={4}>
              <Text textStyle="small">Priority</Text>
              <ToggleButtonGroup value={priority} onChange={setPriority}>
                <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
                <ToggleButtonGroup.Item value="yes">Priority only</ToggleButtonGroup.Item>
              </ToggleButtonGroup>
            </Flex>
          )}
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
