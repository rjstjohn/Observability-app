import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { CheckmarkIcon, CriticalIcon, MinusIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";

/** Renders a Yes / No / (none) observability signal as a coloured icon. */
export const SignalCell = ({ value }: { value?: string }) => {
  if (value === "Yes") {
    return (
      <span title="Detected" style={{ color: Colors.Text.Success.Default, display: "inline-flex" }}>
        <CheckmarkIcon />
      </span>
    );
  }
  if (value === "No") {
    return (
      <span title="Not detected" style={{ color: Colors.Text.Critical.Default, display: "inline-flex" }}>
        <CriticalIcon />
      </span>
    );
  }
  return (
    <span title="N/A" style={{ color: Colors.Text.Neutral.Default, display: "inline-flex" }}>
      <MinusIcon />
    </span>
  );
};

const MODE_COLORS: Record<string, string> = {
  Full: Colors.Text.Success.Default,
  Infrastructure: Colors.Text.Warning.Default,
  Other: Colors.Text.Neutral.Default,
  None: Colors.Text.Critical.Default,
};

/** Renders the host monitoring mode with an intent colour. */
export const MonitoringModeCell = ({ value }: { value?: string }) => (
  <Text style={{ color: MODE_COLORS[value ?? "None"] ?? Colors.Text.Neutral.Default }}>
    {value === "None" ? "Not monitored" : value === "Full" ? "Full-Stack" : value}
  </Text>
);

/** Renders a tag-adherence flag (Yes = present / No = missing). */
export const AdherenceCell = ({ value }: { value?: string }) => (
  <Flex alignItems="center" gap={4}>
    {value === "Yes" ? (
      <span style={{ color: Colors.Text.Success.Default, display: "inline-flex" }}>
        <CheckmarkIcon />
      </span>
    ) : (
      <span style={{ color: Colors.Text.Critical.Default, display: "inline-flex" }}>
        <CriticalIcon />
      </span>
    )}
  </Flex>
);
