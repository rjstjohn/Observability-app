import React from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";

type Intent = "neutral" | "success" | "warning" | "critical";

const INTENT_COLOR: Record<Intent, string> = {
  neutral: Colors.Text.Primary.Default,
  success: Colors.Text.Success.Default,
  warning: Colors.Text.Warning.Default,
  critical: Colors.Text.Critical.Default,
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  intent?: Intent;
}

/** Compact KPI tile used across the Overview and detail headers. */
export const StatCard = ({ label, value, hint, intent = "neutral" }: StatCardProps) => (
  <Surface>
    <Flex flexDirection="column" gap={4} padding={16} style={{ minWidth: 150 }}>
      <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
        {label}
      </Text>
      <Heading level={2} style={{ color: INTENT_COLOR[intent] }}>
        {value}
      </Heading>
      {hint && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          {hint}
        </Text>
      )}
    </Flex>
  </Surface>
);
