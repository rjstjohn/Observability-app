import React from "react";
import { Flex, Grid, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { TimeseriesChart, convertToTimeseries } from "@dynatrace/strato-components-preview/charts";
import type { ResultRecord } from "@dynatrace-sdk/client-query";
import { usePortfolio, useSegmentedDql } from "../hooks/usePortfolio";
import { QueryState } from "../components/QueryState";
import { StatCard } from "../components/StatCard";
import { CoverageBar } from "../components/CoverageBar";
import { SIGNALS, type CoverageRow } from "../queries/coverage";
import { FULLSTACK_OVER_TIME_QUERY } from "../queries/common";
import Colors from "@dynatrace/strato-design-tokens/colors";

function countBy(rows: CoverageRow[], key: (r: CoverageRow) => string) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || "(unknown)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Simple labelled distribution bars (used for tier / mode / hosting breakdowns). */
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
  const { rows, isLoading, error } = usePortfolio();
  const fullStack = useSegmentedDql<ResultRecord>(FULLSTACK_OVER_TIME_QUERY);

  const total = rows.length;
  const monitored = rows.filter((r) => r.Monitored === "Yes");
  const notMonitored = total - monitored.length;

  const bcc1 = rows.filter((r) => r.biaIndex === "BCC1");
  const bcc1Monitored = bcc1.filter((r) => r.Monitored === "Yes").length;
  const revenue = rows.filter((r) => r.revenueGenerating === "Yes");
  const revenueMonitored = revenue.filter((r) => r.Monitored === "Yes").length;

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  return (
    <Flex flexDirection="column" gap={24} padding={32}>
      <Flex flexDirection="column" gap={4}>
        <Heading>Observability Coverage — Overview</Heading>
        <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
          Portfolio-wide view of which applications Dynatrace is monitoring.
        </Paragraph>
      </Flex>

      <QueryState isLoading={isLoading} error={error} isEmpty={total === 0} emptyText="No applications found in leanix_data.">
        <Flex flexFlow="wrap" gap={16}>
          <StatCard label="Total applications" value={total.toLocaleString()} />
          <StatCard
            label="Monitored"
            value={`${monitored.length.toLocaleString()}`}
            hint={`${pct(monitored.length, total)}% of portfolio`}
            intent="success"
          />
          <StatCard
            label="Not monitored"
            value={notMonitored.toLocaleString()}
            hint={`${pct(notMonitored, total)}% of portfolio`}
            intent={notMonitored > 0 ? "critical" : "success"}
          />
          <StatCard
            label="Tier-1 (BCC1) monitored"
            value={`${bcc1Monitored} / ${bcc1.length}`}
            hint={`${pct(bcc1Monitored, bcc1.length)}% covered`}
            intent={pct(bcc1Monitored, bcc1.length) >= 90 ? "success" : "warning"}
          />
          <StatCard
            label="Revenue-generating monitored"
            value={`${revenueMonitored} / ${revenue.length}`}
            hint={`${pct(revenueMonitored, revenue.length)}% covered`}
            intent={pct(revenueMonitored, revenue.length) >= 90 ? "success" : "warning"}
          />
        </Flex>

        <Surface>
          <Flex flexDirection="column" gap={16} padding={16}>
            <Heading level={4}>Signal coverage across the portfolio</Heading>
            {SIGNALS.map((sig) => (
              <CoverageBar
                key={sig}
                label={sig}
                covered={rows.filter((r) => r[sig] === "Yes").length}
                total={total}
              />
            ))}
          </Flex>
        </Surface>

        <Surface>
          <Flex flexDirection="column" gap={12} padding={16}>
            <Heading level={4}>Applications with Full-Stack monitoring over time</Heading>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
              Distinct applications reporting at least one Full-Stack host, weekly over the last 60 days.
            </Text>
            <QueryState
              isLoading={fullStack.isLoading}
              error={fullStack.error}
              isEmpty={!fullStack.data?.records?.length}
              emptyText="No Full-Stack monitoring events in the last 60 days."
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
          <Distribution title="By tier (biaIndex)" data={countBy(rows, (r) => r.biaIndex)} />
          <Distribution title="By monitoring mode" data={countBy(rows, (r) => r.monitoringMode)} />
          <Distribution
            title="By hosting environment"
            data={countBy(rows, (r) => r.hostingEnvironment).slice(0, 8)}
          />
        </Grid>
      </QueryState>
    </Flex>
  );
};
