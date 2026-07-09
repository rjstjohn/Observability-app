import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Paragraph } from "@dynatrace/strato-components/typography";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { CriticalIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";

interface QueryStateProps {
  isLoading: boolean;
  error?: { message?: string } | null;
  isEmpty?: boolean;
  emptyText?: string;
  children: React.ReactNode;
}

/** Standard loading / error / empty handling around a query-backed view. */
export const QueryState = ({ isLoading, error, isEmpty, emptyText, children }: QueryStateProps) => {
  if (isLoading) {
    return (
      <Flex alignItems="center" justifyContent="center" gap={8} padding={32}>
        <ProgressCircle />
        <Text>Querying Grail…</Text>
      </Flex>
    );
  }
  if (error) {
    return (
      <Flex alignItems="center" gap={8} padding={16} style={{ color: Colors.Text.Critical.Default }}>
        <CriticalIcon />
        <Paragraph>{error.message ?? "Query failed."}</Paragraph>
      </Flex>
    );
  }
  if (isEmpty) {
    return (
      <Flex padding={32} justifyContent="center">
        <Text style={{ color: Colors.Text.Neutral.Default }}>{emptyText ?? "No data."}</Text>
      </Flex>
    );
  }
  return <>{children}</>;
};
