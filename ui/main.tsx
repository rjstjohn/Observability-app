import React from "react";
import ReactDOM from "react-dom/client";
import { AppRoot } from "@dynatrace/strato-components/core";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { ConfigProvider } from "./app/config/ConfigProvider";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <AppRoot>
    <ConfigProvider>
      <BrowserRouter basename="ui">
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </AppRoot>
);
