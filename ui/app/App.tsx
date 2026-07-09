import { Page } from "@dynatrace/strato-components-preview/layouts";
import { SegmentSelector } from "@dynatrace/strato-components-preview/filters";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { OverviewPage } from "./pages/OverviewPage";
import { CoveragePage } from "./pages/CoveragePage";
import { AppDetailPage } from "./pages/AppDetailPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { ExplorerPage } from "./pages/ExplorerPage";

export const App = () => {
  return (
    <Page>
      <Page.Header>
        <Header />
      </Page.Header>
      <Page.Main>
        <Flex
          alignItems="center"
          gap={12}
          style={{ padding: "12px 32px", borderBottom: `1px solid ${Colors.Border.Neutral.Default}` }}
        >
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
            Segment
          </Text>
          <SegmentSelector />
        </Flex>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="/app" element={<AppDetailPage />} />
          <Route path="/app/:appID" element={<AppDetailPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
        </Routes>
      </Page.Main>
    </Page>
  );
};
