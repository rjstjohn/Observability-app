# Observability Coverage

A Dynatrace App (AppEngine) that gives a **portfolio-wide view of which applications
Dynatrace is monitoring** — and where the gaps are. It joins an application portfolio
lookup table to live telemetry (hosts, services, process groups, logs, metrics, RUM,
synthetic) and reports, per application: monitoring mode, which signals are flowing, and
metadata/tagging adherence, with per-app drill-down and prioritized recommendations.

Built with the [Dynatrace App Toolkit](https://developer.dynatrace.com/) (React +
TypeScript + Strato components). All data is fetched with DQL via `useDql`; the app runs
with the **signed-in user's** Grail permissions.

---

## Tabs

| Tab | What it shows |
|---|---|
| **Overview** | KPIs (total apps, % monitored, Tier‑1 / revenue‑gen coverage), signal‑coverage bars, Full‑Stack‑over‑time chart, distributions by tier / mode / hosting. |
| **Coverage & Health** | Filterable master table: one row per application with monitoring mode + Metrics / Traces / Logs / RUM / Synthetic, owners, support group, host/service counts. Row → detail. |
| **Application Detail** | Per‑app metadata card, signal summary, recommendations, and drill‑down tables (Hosts → Processes → Services → Logs, then RUM, Synthetic, K8s) with tag‑adherence flags and deep links to the native apps. |
| **Recommendations** | Portfolio‑wide metadata‑tag gaps and the highest‑priority apps (Tier‑1 / revenue‑generating) with signal gaps. |
| **Explorer** | Applications with no detected telemetry, and orphan `AppID` tags (tagged entities not in the portfolio lookup). |

A global **Segment** selector (native Dynatrace Segments) at the top filters every tab.

---

## Prerequisites

- **Node.js ≥ 18** and npm.
- A **Dynatrace SaaS** environment (Grail / AppEngine).
- A **platform token** (or OAuth client) for deployment, with the scopes listed under
  [Deploying](#deploying).
- The environment must satisfy the [data conventions](#required-environment-conventions)
  below (or you adapt the queries — see [Customization](#customization)).

---

## Required environment conventions

This app is **convention-driven**. Out of the box it expects the following. If your
environment differs, see [Customization](#customization) for exactly where to change each
one.

1. **Portfolio lookup table** at **`/lookups/leanix_data`** (a Grail lookup / tabular
   file), keyed by **`appID`**, with at least these fields:
   `appID, appName, biaIndex, buOwnerName, itApplicationOwner, itPortfolioOwnerName,
   supportRemedyGroup, revenueGenerating, businessUnit, hostingEnvironment,
   applicationType`. The detail card also reads `fullName, appStatus,
   securityClassification, criticalBusinessProcess, internalExternalFacing, drPlan`.
   - `biaIndex` is treated as the **application tier** (e.g. `BCC1`, `BCC2`).
2. **Entity tagging** — hosts, services and process‑group instances carry a
   **`AppID:<appID>`** tag linking them to a portfolio application. Metadata‑adherence
   checks also look for **`App_Name:`**, **`BU:`**, **`Environment:`**, **`Location:`**
   tags.
3. **RUM / Synthetic naming** — web/mobile application entities are named
   **`<appID> - <name>`** (the app parses the `appID` prefix). Synthetic monitors are
   discovered via each web application's `monitored_by[dt.entity.synthetic_test]`.
4. **Logs** carry an **`AppID`** field (bizevent/log attribute) used for log presence and
   the per‑source log breakdown.

> An application is considered "monitored" if it has any of: a full/infra host, a tagged
> service (traces), metric ingestion, logs, a RUM app, or a synthetic monitor. Hosts and
> processes in the detail view are the union of **directly `AppID`‑tagged** entities **and**
> the hosts/processes the app's tagged **services** run on — so untagged-but-related
> entities are surfaced with `AppID = ✗`.

---

## Setup

```bash
git clone https://github.com/rjstjohn/Observability-app.git
cd Observability-app
npm install
```

### Configure the target environment (required)

The tenant URL is **not** hard-coded. `app.config.json` ships with a placeholder:

```json
"environmentUrl": "https://YOUR_TENANT.apps.dynatrace.com/"
```

Set it to your environment in **one** of these ways:

- Edit `environmentUrl` in `app.config.json`, **or**
- Pass `--environment-url https://<your-tenant>.apps.dynatrace.com` to `dt-app dev` /
  `dt-app deploy` (overrides the config).

### App identity (optional)

`app.config.json` → `app.id` is `my.observability.coverage` and `app.name` is
`Observability Coverage`. **Change `app.id`** to your own reverse-domain id (e.g.
`my.acme.obs.coverage`) for your org — the id is the app's permanent identifier in the
environment. (Changing the id deploys a *new* app rather than updating an existing one.)

### Scopes

The app requests these Grail read scopes (`app.config.json` → `app.scopes`); the signed-in
user must also hold them via IAM policy:

`storage:logs:read`, `storage:metrics:read`, `storage:entities:read`,
`storage:events:read`, `storage:buckets:read`, `storage:files:read` (the `/lookups/`
table), `storage:system:read` (`dt.system.events`), `storage:filter-segments:read`
(the Segment selector).

---

## Local development

```bash
npm run start          # = dt-app dev ; opens a browser, prompts SSO login
# or target an env explicitly:
npx dt-app dev --environment-url https://<your-tenant>.apps.dynatrace.com
```

The dev server proxies DQL to your environment using your interactive login, so you see
real data. On first run you'll be asked to consent to the app's scopes.

`npm run build` type-checks and bundles; `npm run lint` runs ESLint.

---

## Deploying

Deployment needs a token with **app-install** scopes **in addition to** the read scopes
above:

- `app-engine:apps:install`, `app-engine:apps:run`
- `app-settings:objects:read` / `:write` (only if you add app settings later)
- plus all `storage:*` scopes the app declares.

Deploy non-interactively with a **platform token** via the `DT_PLATFORM_TOKEN` env var:

```bash
# bash
export DT_PLATFORM_TOKEN="dt0s16.XXXX.XXXXXXXX"
npx dt-app deploy --non-interactive --environment-url https://<your-tenant>.apps.dynatrace.com
```

```powershell
# PowerShell
$env:DT_PLATFORM_TOKEN = "dt0s16.XXXX.XXXXXXXX"
npx dt-app deploy --non-interactive --environment-url https://<your-tenant>.apps.dynatrace.com
```

- **Bump `app.version`** in `app.config.json` before each deploy — the platform rejects a
  re-deploy of the same version with different content.
- Never commit the token. `.dt-app/.tokens.json` (interactive-login cache) is
  git-ignored; keep it that way.
- After deploy the app is at
  `https://<your-tenant>.apps.dynatrace.com/ui/apps/<app.id>`. Each user grants the app's
  scopes on first open.

`npm run uninstall` removes it from the target environment.

---

## Customization

Adapting to a different portfolio model or org — the tenant-specific bits and where they
live:

| Change | Where |
|---|---|
| Lookup path / field names (`/lookups/leanix_data`, `appID`, owners, tier…) | `ui/app/queries/coverage.ts`, `ui/app/queries/detail.ts`, `ui/app/queries/common.ts` |
| Tag keys (`AppID`, `App_Name`, `BU`, `Environment`, `Location`) | `ui/app/queries/detail.ts`, `ui/app/queries/recommendations.ts`, `ui/app/queries/common.ts` (`ADHERENCE_TAGS`) |
| RUM / synthetic entity naming convention (`<appID> - …`) | `ui/app/queries/coverage.ts`, `ui/app/queries/detail.ts` |
| Tier field / values (`biaIndex`, `BCC1`…) | `ui/app/queries/coverage.ts`, page filters |
| "Outdated OneAgent" rule (default: >5 releases behind latest) | `ui/app/queries/common.ts` (`VERSION_CUTOFF_QUERY`) |
| Deep-link URL formats to native apps | `ui/app/lib/links.ts` |
| Deep-link **target apps** (must be installed): `dynatrace.infraops`, `dynatrace.services`, `dynatrace.logs`, `dynatrace.experience.vitals`, `dynatrace.synthetic` | `ui/app/lib/links.ts` |

---

## Performance & cost notes

- Entity queries (hosts/services/PGIs) scan large record counts but consume **~0 GB**
  (Grail entity model). The metric-ingestion probe is `timeseries`-based and effectively
  free.
- The portfolio-coverage query samples logs (`samplingRatio: 1000`) → the whole portfolio
  view costs **~0.1 GB**.
- The per-app **log-source** tile is **sampled 1:1000** (counts marked `≈`) because a full
  scan of one app's logs can be tens of GB. Each row deep-links to the Logs app for exact
  data.
- Host/process names in the detail tables are resolved with a batched `lookup` join (not
  per-row `entityName()`), which matters at scale (hundreds/thousands of entities).

---

## Project structure

```
app.config.json          app id/name, environmentUrl (placeholder), scopes
ui/
  main.tsx               AppRoot + SegmentsProvider + router
  app/
    App.tsx              Page shell, nav, global Segment selector, routes
    components/          cells, StatCard, CoverageBar, QueryState, QueryTable, Header
    hooks/usePortfolio   segment-aware DQL hooks (portfolio, version cutoff)
    lib/links.ts         deep links to native Dynatrace apps
    pages/               Overview, Coverage, AppDetail, Recommendations, Explorer
    queries/             coverage.ts, detail.ts, recommendations.ts, common.ts
```

---

## Available scripts

`npm run start` (dev) · `npm run build` · `npm run deploy` · `npm run uninstall` ·
`npm run lint` · `npm run info`
