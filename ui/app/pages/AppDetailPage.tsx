import React, { useMemo, useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import { Flex, Grid, Surface, Divider } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text, Link, Strong } from "@dynatrace/strato-components/typography";
import { SearchInput } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components-preview/tables";
import { CheckmarkIcon, CriticalIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { usePortfolio, useVersionCutoff, useSegmentedDql, num } from "../hooks/usePortfolio";
import { QueryState } from "../components/QueryState";
import { QueryTable } from "../components/QueryTable";
import { StatCard } from "../components/StatCard";
import { SignalCell, MonitoringModeCell, AdherenceCell } from "../components/cells";
import { SIGNALS, type CoverageRow } from "../queries/coverage";
import {
  leanixDetailQuery,
  hostDetailQuery,
  serviceDetailQuery,
  processGroupInstanceDetailQuery,
  logSourcesQuery,
  rumDetailQuery,
  syntheticDetailQuery,
  k8sWorkloadsQuery,
} from "../queries/detail";
import { hostLink, serviceLink, processLink, logsLink, rumLink, syntheticLink } from "../lib/links";

/** Tag-adherence columns explainer shown under each entity section. */
const ADHERENCE_NOTE =
  "AppID, App_Name, BU, Environment and Location indicate whether each of those tags exists on the entity.";

/** Renders an entity name as a link to its native Dynatrace page (opens in a new tab).
 *  Uses a native anchor so the absolute cross-app URL is opened verbatim (the Strato Link
 *  rewrites cross-app hrefs under the current app's path). */
const linkCell = (hrefFor: (row: Record<string, unknown>) => string) => {
  const Cell = ({ value, rowData }: { value: unknown; rowData: Record<string, unknown> }) => (
    <a
      href={hrefFor(rowData)}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: Colors.Text.Primary.Default, textDecoration: "underline" }}
    >
      {String(value)}
    </a>
  );
  Cell.displayName = "LinkCell";
  return Cell;
};

const ADHERENCE_COLS: DataTableColumnDef<Record<string, unknown>>[] = [
  { id: "hasAppIDTag", header: "AppID", accessor: "hasAppIDTag", width: 80, cell: ({ value }) => <AdherenceCell value={value as string} /> },
  { id: "hasAppNameTag", header: "App_Name", accessor: "hasAppNameTag", width: 95, cell: ({ value }) => <AdherenceCell value={value as string} /> },
  { id: "hasBUTag", header: "BU", accessor: "hasBUTag", width: 70, cell: ({ value }) => <AdherenceCell value={value as string} /> },
  { id: "hasEnvTag", header: "Environment", accessor: "hasEnvTag", width: 110, cell: ({ value }) => <AdherenceCell value={value as string} /> },
  { id: "hasLocationTag", header: "Location", accessor: "hasLocationTag", width: 90, cell: ({ value }) => <AdherenceCell value={value as string} /> },
];

const Field = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <Flex flexDirection="column" gap={2} style={{ minWidth: 180 }}>
    <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
      {label}
    </Text>
    <Text>{value === undefined || value === null || value === "" ? "—" : value}</Text>
  </Flex>
);

/** Selector shown when no app is chosen, or to switch apps. */
const AppPicker = ({ rows }: { rows: CoverageRow[] }) => {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return rows
      .filter((r) => `${r.appID} ${r.appName}`.toLowerCase().includes(s))
      .slice(0, 8);
  }, [q, rows]);
  return (
    <Flex flexDirection="column" gap={8} style={{ maxWidth: 480 }}>
      <SearchInput value={q} onChange={setQ} placeholder="Search application by ID or name…" />
      {matches.map((m) => (
        <Link key={m.appID} as={RouterLink} to={`/app/${encodeURIComponent(m.appID)}`}>
          {m.appID} — {m.appName}
        </Link>
      ))}
    </Flex>
  );
};

const RecRow = ({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) => (
  <Flex alignItems="center" gap={8}>
    <span
      style={{
        display: "inline-flex",
        color: ok ? Colors.Text.Success.Default : warn ? Colors.Text.Warning.Default : Colors.Text.Critical.Default,
      }}
    >
      {ok ? <CheckmarkIcon /> : warn ? <WarningIcon /> : <CriticalIcon />}
    </span>
    <Text>{children}</Text>
  </Flex>
);

const AppDetail = ({ appID, row }: { appID: string; row?: CoverageRow }) => {
  const { cutoff } = useVersionCutoff();
  const leanix = useSegmentedDql<Record<string, string>>(leanixDetailQuery(appID));
  const meta = leanix.data?.records?.[0];

  const hosts = useSegmentedDql<Record<string, unknown>>(hostDetailQuery(appID, cutoff ?? 0));
  const services = useSegmentedDql<Record<string, unknown>>(serviceDetailQuery(appID));
  const pgs = useSegmentedDql<Record<string, unknown>>(processGroupInstanceDetailQuery(appID));

  const hostRecords = hosts.data?.records ?? [];
  const serviceRecords = services.data?.records ?? [];
  const pgRecords = pgs.data?.records ?? [];
  const entityRecords = [...hostRecords, ...serviceRecords, ...pgRecords];

  const missing = (flag: string) => entityRecords.filter((e) => e[flag] === "No").length;
  const outdated = hostRecords.filter((h) => h.outdatedAgent === "Yes").length;

  const hostCols: DataTableColumnDef<Record<string, unknown>>[] = [
    { id: "Host", header: "Host", accessor: "Host", width: 260, cell: linkCell((r) => hostLink(String(r.id), String(r.Host))) },
    { id: "monitoringMode", header: "Mode", accessor: "monitoringMode", width: 130 },
    { id: "osType", header: "OS", accessor: "osType", width: 90 },
    { id: "hostGroup", header: "Host Group", accessor: "hostGroup", width: 140 },
    { id: "installerVersion", header: "Agent", accessor: "installerVersion", width: 160 },
    { id: "outdatedAgent", header: "Recent Version", accessor: "outdatedAgent", width: 120, cell: ({ value }) => <AdherenceCell value={value === "Yes" ? "No" : "Yes"} /> },
    ...ADHERENCE_COLS,
  ];
  const serviceCols: DataTableColumnDef<Record<string, unknown>>[] = [
    { id: "Service", header: "Service", accessor: "Service", width: 260, cell: linkCell((r) => serviceLink(String(r.id), appID)) },
    {
      id: "Host",
      header: "Host",
      accessor: "Host",
      width: 220,
      cell: ({ value, rowData }) =>
        value ? (
          <a href={hostLink(String(rowData.HostId), String(value))} target="_blank" rel="noopener noreferrer" style={{ color: Colors.Text.Primary.Default, textDecoration: "underline" }}>
            {String(value)}
            {num(rowData.HostCount) > 1 ? ` (+${num(rowData.HostCount) - 1})` : ""}
          </a>
        ) : (
          <>—</>
        ),
    },
    { id: "Upstream", header: "Upstream", accessor: (r) => num(r.Upstream), width: 100 },
    { id: "Downstream", header: "Downstream", accessor: (r) => num(r.Downstream), width: 110 },
    ...ADHERENCE_COLS,
  ];
  const pgiCols: DataTableColumnDef<Record<string, unknown>>[] = [
    { id: "ProcessGroupInstance", header: "Process Group Instance", accessor: "ProcessGroupInstance", width: 300, cell: linkCell((r) => processLink(String(r.id), String(r.ProcessGroupInstance))) },
    {
      id: "Host",
      header: "Host",
      accessor: "Host",
      width: 240,
      cell: ({ value, rowData }) =>
        value ? (
          <a href={hostLink(String(rowData.HostId), String(value))} target="_blank" rel="noopener noreferrer" style={{ color: Colors.Text.Primary.Default, textDecoration: "underline" }}>
            {String(value)}
          </a>
        ) : (
          <>—</>
        ),
    },
    ...ADHERENCE_COLS,
  ];

  return (
    <Flex flexDirection="column" gap={24}>
      {/* Metadata card */}
      <Surface>
        <Flex flexDirection="column" gap={12} padding={16}>
          <Heading level={3}>
            {appID} — {meta?.appName ?? row?.appName ?? "Unknown application"}
          </Heading>
          <QueryState isLoading={leanix.isLoading} error={leanix.error} isEmpty={!meta} emptyText="No LeanIX record for this App ID.">
            <Flex flexFlow="wrap" gap={24}>
              <Field label="Tier (biaIndex)" value={meta?.biaIndex} />
              <Field label="Status" value={meta?.appStatus} />
              <Field label="Business Unit" value={meta?.businessUnit} />
              <Field label="BU Owner" value={meta?.buOwnerName} />
              <Field label="IT App Owner" value={meta?.itApplicationOwner} />
              <Field label="Portfolio Owner" value={meta?.itPortfolioOwnerName} />
              <Field label="Support Group" value={meta?.supportRemedyGroup} />
              <Field label="Revenue Generating" value={meta?.revenueGenerating} />
              <Field label="Hosting" value={meta?.hostingEnvironment} />
              <Field label="Type" value={meta?.applicationType} />
              <Field label="Security" value={meta?.securityClassification} />
              <Field label="Critical Process" value={meta?.criticalBusinessProcess} />
              <Field label="Facing" value={meta?.internalExternalFacing} />
              <Field label="DR Plan" value={meta?.drPlan} />
            </Flex>
          </QueryState>
        </Flex>
      </Surface>

      {/* Signal summary */}
      <Flex flexFlow="wrap" gap={16}>
        <StatCard label="Monitoring Mode" value={<MonitoringModeCell value={row?.monitoringMode} />} />
        {SIGNALS.map((s) => (
          <StatCard key={s} label={s} value={<SignalCell value={row?.[s] as string} />} />
        ))}
        <StatCard label="Hosts" value={num(row?.Hosts)} />
        <StatCard label="Services" value={num(row?.Services)} />
      </Flex>

      {/* Recommendations */}
      <Surface>
        <Flex flexDirection="column" gap={8} padding={16}>
          <Heading level={4}>Recommendations to improve monitoring</Heading>
          {row?.monitoringMode === "None" && row?.Traces === "No" && (
            <RecRow>No OneAgent / services detected. Onboard this application to Dynatrace.</RecRow>
          )}
          {row?.Metrics === "No" && <RecRow>No metric ingestion detected — verify OneAgent / metric sources.</RecRow>}
          {row?.Logs === "No" && <RecRow>No logs detected — configure log ingestion for this app's hosts/processes.</RecRow>}
          {row?.Traces === "No" && <RecRow>No traced services — enable deep monitoring / instrumentation.</RecRow>}
          {row?.RUM === "No" && <RecRow warn>No RUM application — consider web/mobile RUM if user-facing.</RecRow>}
          {row?.Synthetic === "No" && <RecRow warn>No synthetic monitors — add availability checks for key journeys.</RecRow>}
          <Divider />
          <RecRow ok={missing("hasAppIDTag") === 0} warn={missing("hasAppIDTag") > 0}>
            {missing("hasAppIDTag")} entities missing the <Strong>AppID</Strong> tag
          </RecRow>
          <RecRow ok={missing("hasAppNameTag") === 0} warn={missing("hasAppNameTag") > 0}>
            {missing("hasAppNameTag")} entities missing the <Strong>App_Name</Strong> tag
          </RecRow>
          <RecRow ok={missing("hasBUTag") === 0} warn={missing("hasBUTag") > 0}>
            {missing("hasBUTag")} entities missing the <Strong>BU</Strong> tag
          </RecRow>
          <RecRow ok={missing("hasEnvTag") === 0} warn={missing("hasEnvTag") > 0}>
            {missing("hasEnvTag")} entities missing the <Strong>Environment</Strong> tag
          </RecRow>
          <RecRow ok={missing("hasLocationTag") === 0} warn={missing("hasLocationTag") > 0}>
            {missing("hasLocationTag")} entities missing the <Strong>Location</Strong> tag
          </RecRow>
          <RecRow ok={outdated === 0} warn={outdated > 0}>
            {outdated} hosts running an outdated OneAgent (more than 5 releases behind latest)
          </RecRow>
        </Flex>
      </Surface>

      {/* Drill-down tables */}
      <Surface>
        <Flex flexDirection="column" gap={12} padding={16}>
          <Heading level={4}>Hosts &amp; metadata adherence</Heading>
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            Includes hosts tagged with this AppID and hosts running this app&apos;s tagged services/processes. {ADHERENCE_NOTE} A host appearing here with AppID = ✗ is untagged for this app. Recent Version shows whether the OneAgent is within 5 releases of the latest.
          </Text>
          <QueryState isLoading={hosts.isLoading} error={hosts.error} isEmpty={hostRecords.length === 0} emptyText="No hosts found for this App ID.">
            <DataTable data={hostRecords} columns={hostCols} sortable resizable fullWidth>
              {hostRecords.length > 25 && <DataTable.Pagination defaultPageSize={25} />}
            </DataTable>
          </QueryState>
        </Flex>
      </Surface>

      <Surface>
        <Flex flexDirection="column" gap={12} padding={16}>
          <Heading level={4}>Process group instances &amp; tag adherence</Heading>
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            Includes processes tagged with this AppID and processes run by this app&apos;s tagged services. {ADHERENCE_NOTE} Host shows which host each process runs on; AppID = ✗ means the process is untagged for this app.
          </Text>
          <QueryState isLoading={pgs.isLoading} error={pgs.error} isEmpty={pgRecords.length === 0} emptyText="No process group instances found for this App ID.">
            <DataTable data={pgRecords} columns={pgiCols} sortable resizable fullWidth>
              {pgRecords.length > 25 && <DataTable.Pagination defaultPageSize={25} />}
            </DataTable>
          </QueryState>
        </Flex>
      </Surface>

      <Surface>
        <Flex flexDirection="column" gap={12} padding={16}>
          <Heading level={4}>Services &amp; metadata adherence</Heading>
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            {ADHERENCE_NOTE} Host shows the host the service runs on (+N if it spans more).
          </Text>
          <QueryState isLoading={services.isLoading} error={services.error} isEmpty={serviceRecords.length === 0} emptyText="No services tagged to this App ID.">
            <DataTable data={serviceRecords} columns={serviceCols} sortable resizable fullWidth>
              {serviceRecords.length > 25 && <DataTable.Pagination defaultPageSize={25} />}
            </DataTable>
          </QueryState>
        </Flex>
      </Surface>

      <QueryTable
        title="Log volume by source & host (sampled 1:1000 — click a source for exact logs)"
        query={logSourcesQuery(appID)}
        emptyText="No logs detected for this App ID in the last 2h."
        columns={[
          { id: "Source", header: "Source", accessor: "Source", width: 320, cell: linkCell((r) => logsLink(String(r.Source), String(r.Host))) },
          { id: "Host", header: "Host", accessor: "Host", width: 240 },
          { id: "Count", header: "Count (≈)", accessor: (r) => num(r.Count), width: 110 },
          { id: "Errors", header: "Errors (≈)", accessor: (r) => num(r.Errors), width: 110 },
          { id: "Warnings", header: "Warnings (≈)", accessor: (r) => num(r.Warnings), width: 120 },
        ]}
      />

      <Grid gridTemplateColumns="1fr 1fr" gap={16}>
        <QueryTable
          title="RUM applications"
          query={rumDetailQuery(appID)}
          emptyText="No RUM applications matched by name."
          columns={[
            { id: "Application", header: "Application", accessor: "Application", width: 220, cell: linkCell((r) => rumLink(String(r.id))) },
            { id: "Type", header: "Type", accessor: "Type", width: 90 },
            { id: "Active", header: "Active", accessor: "Active", width: 90 },
            { id: "Synthetics", header: "Synthetics", accessor: (r) => num(r.Synthetics), width: 100 },
          ]}
        />
        <QueryTable
          title="Synthetic monitors"
          query={syntheticDetailQuery(appID)}
          emptyText="No synthetic monitors found."
          columns={[{ id: "TestName", header: "Test", accessor: "TestName", width: 320, cell: linkCell((r) => syntheticLink(String(r.id), String(r.TestName))) }]}
        />
      </Grid>

      <QueryTable
        title="Kubernetes workloads"
        query={k8sWorkloadsQuery(appID)}
        emptyText="No Kubernetes workloads tagged to this App ID."
        columns={[
          { id: "Workload", header: "Workload", accessor: "Workload", width: 280 },
          { id: "Namespace", header: "Namespace", accessor: "Namespace", width: 220 },
          { id: "Type", header: "Type", accessor: "Type", width: 200 },
        ]}
      />
    </Flex>
  );
};

export const AppDetailPage = () => {
  const { appID } = useParams();
  const { rows, isLoading, error } = usePortfolio();
  const row = useMemo(() => rows.find((r) => r.appID === appID), [rows, appID]);

  return (
    <Flex flexDirection="column" gap={24} padding={32}>
      <Flex flexDirection="column" gap={4}>
        <Heading>Application Detail</Heading>
        <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
          Deep-dive into one application's telemetry, metadata adherence and improvement actions.
        </Paragraph>
      </Flex>

      <QueryState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
        <AppPicker rows={rows} />
        {appID ? (
          <AppDetail key={appID} appID={appID} row={row} />
        ) : (
          <Text style={{ color: Colors.Text.Neutral.Default }}>
            Search and select an application above, or click an App ID from the Coverage tab.
          </Text>
        )}
      </QueryState>
    </Flex>
  );
};
