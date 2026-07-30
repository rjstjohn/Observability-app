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
import { type CoverageRow } from "../queries/coverage";
import { adherenceFieldList } from "../queries/common";
import {
  lookupDetailQuery,
  hostDetailQuery,
  serviceDetailQuery,
  processGroupInstanceDetailQuery,
  processGroupInstanceViaServiceQuery,
  logSourcesQuery,
  rumDetailQuery,
  syntheticDetailQuery,
  k8sWorkloadsQuery,
} from "../queries/detail";
import { hostLink, serviceLink, processLink, logsLink, rumLink, syntheticLink } from "../lib/links";
import { useConfig } from "../config/ConfigProvider";
import { enabledSignals, fieldsFor, type AppConfig } from "../config/types";

type Row = Record<string, unknown>;

/** Entity name as a link to its native Dynatrace page. Uses a native anchor so the absolute
 *  cross-app URL opens verbatim (the Strato Link rewrites cross-app hrefs). */
const linkCell = (hrefFor: (row: Row) => string) => {
  const Cell = ({ value, rowData }: { value: unknown; rowData: Row }) => (
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

/** Adherence columns: the app-id tag plus each configured tag, in configured order. */
function adherenceCols(cfg: AppConfig): DataTableColumnDef<Row>[] {
  const fields = adherenceFieldList(cfg);
  const labels = [cfg.entities.tagKey, ...cfg.entities.adherenceTags.map((t) => t.label)];
  return fields.map((f, i) => ({
    id: f,
    header: labels[i],
    accessor: f,
    width: Math.max(80, Math.min(140, labels[i].length * 9 + 40)),
    cell: ({ value }) => <AdherenceCell value={value as string} />,
  }));
}

const Field = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <Flex flexDirection="column" gap={2} style={{ minWidth: 180 }}>
    <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
      {label}
    </Text>
    <Text>{value === undefined || value === null || value === "" ? "—" : value}</Text>
  </Flex>
);

const AppPicker = ({ rows }: { rows: CoverageRow[] }) => {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return rows.filter((r) => `${r.appID} ${r.appName}`.toLowerCase().includes(s)).slice(0, 8);
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
  const { config } = useConfig();
  const { cutoff } = useVersionCutoff();
  const signals = enabledSignals(config);
  const detailFields = useMemo(() => fieldsFor(config, "detail"), [config]);
  const adhCols = useMemo(() => adherenceCols(config), [config]);
  const adhFields = useMemo(() => adherenceFieldList(config), [config]);

  const meta = useSegmentedDql<Record<string, string>>(lookupDetailQuery(config, appID));
  const metaRow = meta.data?.records?.[0];

  const hosts = useSegmentedDql<Row>(hostDetailQuery(config, appID, cutoff ?? 0), undefined, {
    enabled: cutoff !== undefined,
  });
  const services = useSegmentedDql<Row>(serviceDetailQuery(config, appID));

  const pgsTagged = useSegmentedDql<Row>(processGroupInstanceDetailQuery(config, appID));
  const taggedPgis = pgsTagged.data?.records ?? [];
  // Only apps with NO tagged processes fall back to the service-derived query, which must
  // scan the whole process-group table and is far too slow to run for every application.
  const needsFallback = !pgsTagged.isLoading && !pgsTagged.error && taggedPgis.length === 0;
  const pgsFallback = useSegmentedDql<Row>(processGroupInstanceViaServiceQuery(config, appID), undefined, {
    enabled: needsFallback,
  });

  const hostRecords = hosts.data?.records ?? [];
  const serviceRecords = services.data?.records ?? [];
  const pgRecords = needsFallback ? (pgsFallback.data?.records ?? []) : taggedPgis;
  const pgsLoading = pgsTagged.isLoading || (needsFallback && pgsFallback.isLoading);
  const pgsError = pgsTagged.error ?? (needsFallback ? pgsFallback.error : undefined);

  const entityRecords = [...hostRecords, ...serviceRecords, ...pgRecords];
  const missing = (flag: string) => entityRecords.filter((e) => e[flag] === "No").length;
  const outdated = hostRecords.filter((h) => h.outdatedAgent === "Yes").length;

  const adherenceNote = `${[config.entities.tagKey, ...config.entities.adherenceTags.map((t) => t.label)].join(
    ", "
  )} indicate whether each of those tags exists on the entity.`;

  const hostCols: DataTableColumnDef<Row>[] = [
    { id: "Host", header: "Host", accessor: "Host", width: 260, cell: linkCell((r) => hostLink(String(r.id), String(r.Host))) },
    { id: "monitoringMode", header: "Mode", accessor: "monitoringMode", width: 130 },
    { id: "osType", header: "OS", accessor: "osType", width: 90 },
    { id: "hostGroup", header: "Host Group", accessor: "hostGroup", width: 140 },
    { id: "installerVersion", header: "Agent", accessor: "installerVersion", width: 160 },
    {
      id: "outdatedAgent",
      header: "Recent Version",
      accessor: "outdatedAgent",
      width: 120,
      cell: ({ value }) => <AdherenceCell value={value === "Yes" ? "No" : "Yes"} />,
    },
    ...adhCols,
  ];
  const hostLinkCell = (r: Row) => hostLink(String(r.HostId), String(r.Host));
  const serviceCols: DataTableColumnDef<Row>[] = [
    { id: "Service", header: "Service", accessor: "Service", width: 260, cell: linkCell((r) => serviceLink(String(r.id), appID, config.entities.tagKey)) },
    {
      id: "Host",
      header: "Host",
      accessor: "Host",
      width: 220,
      cell: ({ value, rowData }) =>
        value ? (
          <a href={hostLinkCell(rowData)} target="_blank" rel="noopener noreferrer" style={{ color: Colors.Text.Primary.Default, textDecoration: "underline" }}>
            {String(value)}
            {num(rowData.HostCount) > 1 ? ` (+${num(rowData.HostCount) - 1})` : ""}
          </a>
        ) : (
          <>—</>
        ),
    },
    { id: "Upstream", header: "Upstream", accessor: (r) => num(r.Upstream), width: 100 },
    { id: "Downstream", header: "Downstream", accessor: (r) => num(r.Downstream), width: 110 },
    ...adhCols,
  ];
  const pgiCols: DataTableColumnDef<Row>[] = [
    { id: "ProcessGroupInstance", header: "Process Group Instance", accessor: "ProcessGroupInstance", width: 300, cell: linkCell((r) => processLink(String(r.id), String(r.ProcessGroupInstance))) },
    {
      id: "Host",
      header: "Host",
      accessor: "Host",
      width: 240,
      cell: ({ value, rowData }) =>
        value ? (
          <a href={hostLinkCell(rowData)} target="_blank" rel="noopener noreferrer" style={{ color: Colors.Text.Primary.Default, textDecoration: "underline" }}>
            {String(value)}
          </a>
        ) : (
          <>—</>
        ),
    },
    ...adhCols,
  ];

  const rumQuery = rumDetailQuery(config, appID);
  const synthQuery = syntheticDetailQuery(config, appID);

  return (
    <Flex flexDirection="column" gap={24}>
      <Surface>
        <Flex flexDirection="column" gap={12} padding={16}>
          <Heading level={3}>
            {appID} — {metaRow?.[config.lookup.nameField] ?? row?.appName ?? "Unknown application"}
          </Heading>
          <QueryState
            isLoading={meta.isLoading}
            error={meta.error}
            isEmpty={!metaRow}
            emptyText="No portfolio record for this application id."
          >
            <Flex flexFlow="wrap" gap={24}>
              {detailFields.map((f) => (
                <Field key={f.key} label={f.label} value={metaRow?.[f.key]} />
              ))}
            </Flex>
          </QueryState>
        </Flex>
      </Surface>

      <Flex flexFlow="wrap" gap={16}>
        <StatCard label="Monitoring Mode" value={<MonitoringModeCell value={row?.monitoringMode} />} />
        {signals.map((s) => (
          <StatCard key={s} label={s} value={<SignalCell value={row?.[s] as string} />} />
        ))}
        <StatCard label="Hosts" value={num(row?.Hosts)} />
        <StatCard label="Services" value={num(row?.Services)} />
      </Flex>

      <Surface>
        <Flex flexDirection="column" gap={8} padding={16}>
          <Heading level={4}>Recommendations to improve monitoring</Heading>
          {row?.monitoringMode === "None" && row?.Traces === "No" && (
            <RecRow>No agent or services detected. Onboard this application to Dynatrace.</RecRow>
          )}
          {signals.map((s) =>
            row?.[s] === "No" ? (
              <RecRow key={s} warn={s === "RUM" || s === "Synthetic"}>
                No {s.toLowerCase()} detected for this application.
              </RecRow>
            ) : null
          )}
          <Divider />
          <RecRow ok={missing("hasAppIDTag") === 0} warn={missing("hasAppIDTag") > 0}>
            {missing("hasAppIDTag")} entities missing the <Strong>{config.entities.tagKey}</Strong> tag
          </RecRow>
          {config.entities.adherenceTags.map((t, i) => {
            const n = missing(adhFields[i + 1]);
            return (
              <RecRow key={t.key} ok={n === 0} warn={n > 0}>
                {n} entities missing the <Strong>{t.label}</Strong> tag
              </RecRow>
            );
          })}
          <RecRow ok={outdated === 0} warn={outdated > 0}>
            {outdated} hosts running an outdated OneAgent (more than{" "}
            {config.agent.outdatedReleasesBehind} releases behind latest)
          </RecRow>
        </Flex>
      </Surface>

      <Surface>
        <Flex flexDirection="column" gap={12} padding={16}>
          <Heading level={4}>Hosts &amp; metadata adherence</Heading>
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            Includes hosts tagged with this application and hosts running its tagged
            services/processes. {adherenceNote} Recent Version shows whether the OneAgent is within{" "}
            {config.agent.outdatedReleasesBehind} releases of the latest.
          </Text>
          <QueryState isLoading={hosts.isLoading} error={hosts.error} isEmpty={hostRecords.length === 0} emptyText="No hosts found for this application.">
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
            Includes processes tagged with this application and processes run by its tagged
            services. {adherenceNote}
          </Text>
          <QueryState isLoading={pgsLoading} error={pgsError} isEmpty={pgRecords.length === 0} emptyText="No process group instances found for this application.">
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
            {adherenceNote} Host shows the host the service runs on (+N if it spans more).
          </Text>
          <QueryState isLoading={services.isLoading} error={services.error} isEmpty={serviceRecords.length === 0} emptyText="No services found for this application.">
            <DataTable data={serviceRecords} columns={serviceCols} sortable resizable fullWidth>
              {serviceRecords.length > 25 && <DataTable.Pagination defaultPageSize={25} />}
            </DataTable>
          </QueryState>
        </Flex>
      </Surface>

      {config.signals.logs && config.logs.field && (
        <QueryTable
          title={`Log volume by source & host${config.logs.samplingRatio > 1 ? ` (sampled 1:${config.logs.samplingRatio})` : ""}`}
          query={logSourcesQuery(config, appID)}
          emptyText="No logs detected for this application."
          columns={[
            { id: "Source", header: "Source", accessor: "Source", width: 320, cell: linkCell((r) => logsLink(String(r.Source), String(r.Host))) },
            { id: "Host", header: "Host", accessor: "Host", width: 240 },
            { id: "Count", header: "Count", accessor: (r) => num(r.Count), width: 110 },
            { id: "Errors", header: "Errors", accessor: (r) => num(r.Errors), width: 100 },
            { id: "Warnings", header: "Warnings", accessor: (r) => num(r.Warnings), width: 110 },
          ]}
        />
      )}

      <Grid gridTemplateColumns="1fr 1fr" gap={16}>
        {config.signals.rum && rumQuery && (
          <QueryTable
            title="RUM applications"
            query={rumQuery}
            emptyText="No RUM applications matched."
            columns={[
              { id: "Application", header: "Application", accessor: "Application", width: 220, cell: linkCell((r) => rumLink(String(r.id))) },
              { id: "Type", header: "Type", accessor: "Type", width: 90 },
              { id: "Active", header: "Active", accessor: "Active", width: 90 },
              { id: "Synthetics", header: "Synthetics", accessor: (r) => num(r.Synthetics), width: 100 },
            ]}
          />
        )}
        {config.signals.synthetic && synthQuery && (
          <QueryTable
            title="Synthetic monitors"
            query={synthQuery}
            emptyText="No synthetic monitors found."
            columns={[
              { id: "TestName", header: "Test", accessor: "TestName", width: 320, cell: linkCell((r) => syntheticLink(String(r.id), String(r.TestName))) },
            ]}
          />
        )}
      </Grid>

      <QueryTable
        title="Kubernetes workloads"
        query={k8sWorkloadsQuery(config, appID)}
        emptyText="No Kubernetes workloads tagged to this application."
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
          Deep-dive into one application&apos;s telemetry, metadata adherence and improvement actions.
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
