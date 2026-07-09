/* eslint-disable noSecrets/no-secrets -- these are static deep-link URL templates, not secrets */
/**
 * Absolute deep links to native Dynatrace apps.
 *
 * The base is `getEnvironmentUrl()` (the real tenant URL). `window.location.origin` is
 * unreliable here because the app runs sandboxed. Render these with a native
 * `<a target="_blank">` so the absolute URL opens verbatim in a new tab.
 */
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

const base = () => getEnvironmentUrl().replace(/\/$/, "");
const enc = encodeURIComponent;

/** Host detail in Infrastructure & Operations. */
export const hostLink = (id: string, name?: string) => {
  const filter = name ? `#filtering=Host+%3D+*${enc(name)}*+` : "";
  return `${base()}/ui/apps/dynatrace.infraops/explorer/Compute/Hosts?perspective=Health&sort=healthIndicators%3Adescending&fullPageId=${id}${filter}`;
};

/** Process (group instance) detail in Infrastructure & Operations. */
export const processLink = (id: string, name?: string) => {
  const filter = name ? `#filtering=Process+%3D+*${enc(name)}*+` : "";
  return `${base()}/ui/apps/dynatrace.infraops/explorer/Compute/Processes?perspective=Health&sort=healthIndicators%3Adescending&fullPageId=${id}${filter}`;
};

/** Service detail in the Services app (filtering the list by the app's AppID tag). */
export const serviceLink = (id: string, appID?: string) => {
  const filter = appID ? `#filtering=tags+%3D+%22AppID%3A${enc(appID)}%22+` : "";
  return `${base()}/ui/apps/dynatrace.services/explorer/services?fullPageId=${id}&perspective=performance&sort=entity%3Aascending&detailsId=${id}&sidebarOpen=false${filter}`;
};

/** Logs app, pre-filtered to a specific log source (and host, when known). */
export const logsLink = (source: string, host?: string) => {
  const filterFieldQuery = host
    ? `log.source = ${source} host.name = ${host} `
    : `log.source = ${source} `;
  const state = {
    version: 2,
    "dt.timeframe": { from: "now()-30m", to: "now()" },
    tableConfig: { columns: ["timestamp", "status", "Log message"] },
    analysisMode: "logs",
    showDqlEditor: false,
    filterFieldQuery,
  };
  return `${base()}/ui/apps/dynatrace.logs/#${enc(JSON.stringify(state))}`;
};

/** RUM application overview in Experience / Frontend Vitals. */
export const rumLink = (applicationId: string) =>
  `${base()}/ui/apps/dynatrace.experience.vitals/frontends/${applicationId}/overview`;

/** Synthetic monitor detail in the Synthetic app. */
export const syntheticLink = (id: string, name?: string) => {
  const filter = name ? `#filtering=Name+%3D+%22${enc(name)}%22+` : "";
  return `${base()}/ui/apps/dynatrace.synthetic/monitors?tf=now-2h%3Bnow&perspective=default&sort=healthIndicators%3Adescending&detailsId=${id}&sidebarOpen=false${filter}`;
};
