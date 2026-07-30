import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Link } from "@dynatrace/strato-components/typography";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useConfig } from "../config/ConfigProvider";

/**
 * Wraps a page so it only renders once the environment has been configured. Without this,
 * an unconfigured install would fire queries against an empty lookup path and surface raw
 * DQL errors instead of telling the user what to do.
 */
export const RequiresConfig = ({ children }: { children: React.ReactNode }) => {
  const { isLoading, error, configured } = useConfig();

  if (isLoading) {
    return (
      <Flex alignItems="center" justifyContent="center" gap={8} padding={32}>
        <ProgressCircle />
        <Paragraph>Loading configuration…</Paragraph>
      </Flex>
    );
  }

  if (error) {
    return (
      <Surface>
        <Flex flexDirection="column" gap={8} padding={24}>
          <Heading level={4}>Couldn&apos;t load the configuration</Heading>
          <Paragraph style={{ color: Colors.Text.Neutral.Default }}>{error.message}</Paragraph>
          <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
            This usually means the app is missing the <strong>app-settings:objects:read</strong> scope,
            or your user hasn&apos;t granted it yet.
          </Paragraph>
        </Flex>
      </Surface>
    );
  }

  if (!configured) {
    return (
      <Surface>
        <Flex flexDirection="column" gap={12} padding={32} style={{ maxWidth: 640 }}>
          <Heading level={3}>Configure this app</Heading>
          <Paragraph style={{ color: Colors.Text.Neutral.Default }}>
            This app maps your application portfolio to what Dynatrace is monitoring. Before it can
            show anything, it needs to know where your portfolio lives and how your entities are
            tagged — the lookup table, its application-id column, and the tag key that links
            entities to an application.
          </Paragraph>
          <Link as={RouterLink} to="/configuration">
            Open Configuration →
          </Link>
        </Flex>
      </Surface>
    );
  }

  return <>{children}</>;
};
