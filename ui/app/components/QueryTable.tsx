import React from "react";
import { useSegmentedDql } from "../hooks/usePortfolio";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components-preview/tables";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { QueryState } from "./QueryState";

interface QueryTableProps<T> {
  title: string;
  query: string;
  columns: DataTableColumnDef<T>[];
  emptyText?: string;
  pageSize?: number;
}

/** Runs a DQL query and renders the records in a titled DataTable card. */
export function QueryTable<T extends Record<string, unknown>>({
  title,
  query,
  columns,
  emptyText,
  pageSize = 25,
}: QueryTableProps<T>) {
  const { data, isLoading, error } = useSegmentedDql<T>(query);
  const records = data?.records ?? [];
  return (
    <Surface>
      <Flex flexDirection="column" gap={12} padding={16}>
        <Flex justifyContent="space-between" alignItems="baseline">
          <Heading level={4}>{title}</Heading>
          {!isLoading && !error && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
              {records.length.toLocaleString()}
            </Text>
          )}
        </Flex>
        <QueryState isLoading={isLoading} error={error} isEmpty={records.length === 0} emptyText={emptyText}>
          <DataTable data={records} columns={columns} sortable resizable fullWidth>
            {records.length > pageSize && <DataTable.Pagination defaultPageSize={pageSize} />}
          </DataTable>
        </QueryState>
      </Flex>
    </Surface>
  );
}
