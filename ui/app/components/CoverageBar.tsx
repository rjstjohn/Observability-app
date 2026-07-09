import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";

export interface CoverageBarProps {
  label: string;
  covered: number;
  total: number;
}

/** A labelled horizontal coverage bar (covered / total) with a percentage. */
export const CoverageBar = ({ label, covered, total }: CoverageBarProps) => {
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const color =
    pct >= 75 ? Colors.Text.Success.Default : pct >= 40 ? Colors.Text.Warning.Default : Colors.Text.Critical.Default;
  return (
    <Flex flexDirection="column" gap={4} style={{ width: "100%" }}>
      <Flex justifyContent="space-between" alignItems="baseline">
        <Text>{label}</Text>
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          {covered.toLocaleString()} / {total.toLocaleString()} ({pct}%)
        </Text>
      </Flex>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: Colors.Background.Container.Neutral.Default,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </Flex>
  );
};
