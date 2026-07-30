import { Page } from "@dynatrace/strato-components-preview/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { RequiresConfig } from "./components/NotConfigured";
import { OverviewPage } from "./pages/OverviewPage";
import { CoveragePage } from "./pages/CoveragePage";
import { AppDetailPage } from "./pages/AppDetailPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { ExplorerPage } from "./pages/ExplorerPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";

export const App = () => {
  return (
    <Page>
      <Page.Header>
        <Header />
      </Page.Header>
      <Page.Main>
        <Routes>
          <Route path="/" element={<RequiresConfig><OverviewPage /></RequiresConfig>} />
          <Route path="/coverage" element={<RequiresConfig><CoveragePage /></RequiresConfig>} />
          <Route path="/app" element={<RequiresConfig><AppDetailPage /></RequiresConfig>} />
          <Route path="/app/:appID" element={<RequiresConfig><AppDetailPage /></RequiresConfig>} />
          <Route path="/recommendations" element={<RequiresConfig><RecommendationsPage /></RequiresConfig>} />
          <Route path="/explorer" element={<RequiresConfig><ExplorerPage /></RequiresConfig>} />
          {/* Configuration is deliberately NOT wrapped — it must be reachable when unconfigured. */}
          <Route path="/configuration" element={<ConfigurationPage />} />
        </Routes>
      </Page.Main>
    </Page>
  );
};
