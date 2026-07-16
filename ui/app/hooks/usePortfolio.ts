import { useDql } from "@dynatrace-sdk/react-hooks";
import { useSegments } from "@dynatrace/strato-components-preview/filters";
import { COVERAGE_QUERY, type CoverageRow } from "../queries/coverage";
import { VERSION_CUTOFF_QUERY, type VersionCutoff } from "../queries/common";

/**
 * `runInBackground: true` is important: by default useDql CANCELS an in-flight query when
 * focus changes, so scrolling away from a slow tile returned no results. With it set, the
 * query completes regardless of where the user is looking.
 */
const BACKGROUND = { runInBackground: true } as const;

/**
 * Runs a DQL query with the globally-selected Dynatrace Segments applied
 * (`filterSegments`). Use this for any query whose entity/log fetches should
 * honour the segment selected in the app header.
 */
export function useSegmentedDql<T = Record<string, unknown>>(
  query: string,
  params?: { maxResultRecords?: number },
  options?: { enabled?: boolean }
) {
  const { segments } = useSegments();
  return useDql<T>({ query, filterSegments: segments, ...params }, { ...BACKGROUND, ...options });
}

/**
 * Runs the portfolio-coverage query once (segment-aware). The query + segment
 * selection form the cache key, so every tab that calls this shares the result.
 */
export function usePortfolio() {
  const { segments } = useSegments();
  // The portfolio is ~1,850 apps; raise maxResultRecords above the Grail default of 1000.
  const { data, isLoading, error, refetch } = useDql<CoverageRow>(
    { query: COVERAGE_QUERY, maxResultRecords: 10000, filterSegments: segments },
    BACKGROUND
  );
  return { rows: data?.records ?? [], isLoading, error, refetch };
}

/** OneAgent outdated-version cutoff (6th-highest distinct minor release; segment-independent). */
export function useVersionCutoff() {
  const { data, isLoading, error } = useDql<VersionCutoff>(VERSION_CUTOFF_QUERY, BACKGROUND);
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
