import { useMemo } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { buildCoverageQuery, buildLogPresenceQuery, type CoverageRow, type LogPresenceRow } from "../queries/coverage";
import { versionCutoffQuery, type VersionCutoff } from "../queries/common";
import { useConfig } from "../config/ConfigProvider";

/**
 * `runInBackground: true` matters: by default useDql CANCELS an in-flight query when focus
 * changes, so scrolling away from a slow tile returned no results.
 */
const BACKGROUND = { runInBackground: true } as const;

/**
 * Runs a DQL query gated on the environment being configured (an empty query string would
 * otherwise error on load). (Named for the removed Segment filter; kept as the shared runner.)
 */
export function useSegmentedDql<T = Record<string, unknown>>(
  query: string,
  params?: { maxResultRecords?: number },
  options?: { enabled?: boolean }
) {
  const { configured } = useConfig();
  const enabled = (options?.enabled ?? true) && configured && !!query;
  return useDql<T>({ query, ...params }, { ...BACKGROUND, enabled });
}

/**
 * Portfolio coverage. The coverage query and the log-presence query run in PARALLEL —
 * the log scan is the only expensive part, so the page renders as soon as the (0 GB)
 * entity work finishes and the Logs column fills in a moment later.
 */
export function usePortfolio() {
  const { config, configured, isLoading: configLoading } = useConfig();

  const coverageQuery = useMemo(() => (configured ? buildCoverageQuery(config) : ""), [config, configured]);
  const logQuery = useMemo(
    () => (configured && config.signals.logs && config.logs.field ? buildLogPresenceQuery(config) : ""),
    [config, configured]
  );

  const cov = useDql<CoverageRow>(
    { query: coverageQuery, maxResultRecords: 10000 },
    { ...BACKGROUND, enabled: !!coverageQuery }
  );
  const logs = useDql<LogPresenceRow>(
    { query: logQuery, maxResultRecords: 10000 },
    { ...BACKGROUND, enabled: !!logQuery }
  );

  // Settle once the log query finishes (success or error) so the UI never hangs on
  // "loading…"; when logs are disabled there is nothing to wait for.
  const logsReady = !logQuery || !logs.isLoading;

  const rows = useMemo(() => {
    const covRows = cov.data?.records ?? [];
    const logSet = new Set((logs.data?.records ?? []).map((r) => String(r.appID).trim()));
    return covRows.map((r) => {
      if (!logQuery) return r;
      const hasLogs = logsReady && logSet.has(String(r.appID));
      const Logs: CoverageRow["Logs"] = logsReady ? (hasLogs ? "Yes" : "No") : undefined;
      const Monitored: CoverageRow["Monitored"] = r.Monitored === "Yes" || hasLogs ? "Yes" : "No";
      return { ...r, Logs, Monitored };
    });
  }, [cov.data, logs.data, logsReady, logQuery]);

  return {
    rows,
    // Render as soon as the coverage query is done — never block on the log scan.
    isLoading: configLoading || cov.isLoading,
    error: cov.error,
    refetch: cov.refetch,
    logsPending: !!logQuery && !logsReady,
  };
}

/** OneAgent outdated-version cutoff, per the configured "releases behind" threshold. */
export function useVersionCutoff() {
  const { config, configured } = useConfig();
  const query = useMemo(() => (configured ? versionCutoffQuery(config) : ""), [config, configured]);
  const { data, isLoading, error } = useDql<VersionCutoff>(query, {
    ...BACKGROUND,
    enabled: !!query,
  });
  const record = data?.records?.[0];
  return {
    cutoff: record ? Number(record.cutoff) : undefined,
    latest: record ? Number(record.latest) : undefined,
    isLoading,
    error,
  };
}

/** DQL counts come back as strings/bigints depending on type; coerce defensively. */
export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
