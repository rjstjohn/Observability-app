import React from "react";
import ReactDOM from "react-dom/client";
import { AppRoot } from "@dynatrace/strato-components/core";
import { SegmentsProvider } from "@dynatrace/strato-components-preview/filters";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <AppRoot>
    <SegmentsProvider>
      <BrowserRouter basename="ui">
        <App />
      </BrowserRouter>
    </SegmentsProvider>
  </AppRoot>
);
