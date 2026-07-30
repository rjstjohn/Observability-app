# Observability Coverage

A Dynatrace App (AppEngine) that gives a **portfolio-wide view of which applications
Dynatrace is monitoring** — and where the gaps are. It joins your application-portfolio
lookup table to live telemetry (hosts, services, process groups, logs, metrics, RUM,
synthetic) and reports, per application: monitoring mode, which signals are flowing, and
metadata/tagging adherence, with per-app drill-down and prioritized recommendations.

**It adapts to your environment's conventions — no code changes.** Everything that used to
be hard-coded (the lookup path, key/name columns, which fields to surface, the entity tag
that links entities to applications, RUM/log naming, tier and priority rules) is set from
an in-app **Configuration** page and stored per-environment. Move a verified setup between
tenants with JSON import/export.

Built with the [Dynatrace App Toolkit](https://developer.dynatrace.com/) (React +
TypeScript + Strato components). All data is fetched with DQL via `useDql`; the app runs
with the **signed-in user's** Grail permissions.

---

## Tabs

| Tab | What it shows |
|---|---|
| **Overview** | KPIs (total apps, % monitored, tier and priority coverage), signal-coverage bars filterable by tier/priority, Full-Stack-over-time chart, and distributions by tier / monitoring mode / a chosen field. |
| **Coverage & Health** | Filterable master table: one row per application with monitoring mode + Metrics / Traces / Logs / RUM / Synthetic, host/service counts, and whichever lookup fields you surface. Row → detail. |
| **Application Detail** | Per-app metadata card, signal summary, recommendations, and drill-down tables (Hosts, Process Groups, Services, Log sources, RUM, Synthetic, K8s) with tag-adherence flags and deep links to the native apps. |
| **Recommendations** | Portfolio-wide metadata-tag gaps by entity type, and the highest-priority applications (per your priority rule) that still have monitoring gaps. |
| **Explorer** | Applications with no detected telemetry, and orphan tags (tagged entities that don't map to any application in the lookup). |

---

## Prerequisites

- **Node.js ≥ 18** and npm.
- A **Dynatrace SaaS** environment (Grail / AppEngine).
- A **platform token** (or OAuth client) for deployment, with the scopes under
  [Deploying](#deploying).
- Two things in the environment (mapped from the Configuration page, below):
  1. A **portfolio lookup table** — a Grail lookup / tabular file at `/lookups/<name>`
     listing your applications, with a column that holds the application id and (optionally)
     a display-name column and any metadata columns you want to surface.
  2. An **entity tag** whose value is that application id (e.g. `AppID:<id>`) on the hosts,
     services and process groups you want attributed to each application.

Everything else (RUM/log naming, tier, priority, adherence tags) is optional and configured
in-app.

---

## Configuration (in-app)

On first open the app is **unconfigured** and every tab shows a "Configure this app" prompt
that links to the **Configuration** tab. Configuration is stored as a single
environment-scoped [App Settings](https://developer.dynatrace.com/) object shared by all
users of the app; editing it requires the `app-settings:objects:write` permission (the page
is read-only otherwise).

The Configuration page walks you through:

- **Portfolio lookup table** — the lookup path and the **Application ID column**. Enter a
  path and the app validates it live and turns the column inputs into filterable pickers of
  the table's actual columns.
- **Portfolio fields** — optional extra columns to surface; per field choose **Coverage
  table** (a column on the main grid), **App detail** (a row on the per-app page), and
  **Searchable**.
- **Entity tagging** — the tag key that links entities to an application (its value is
  matched against the Application ID column), and an optional list of tag keys to check for
  metadata adherence.
- **Signals** — turn Metrics / Traces / Logs / RUM / Synthetic on or off; disabled signals
  vanish from the UI and the "Monitored" roll-up.
- **RUM & Synthetic matching** — by entity-name pattern (id before a delimiter) or by tag.
- **Logs** — the log attribute carrying the application id, plus sampling / look-back.
- **Tier & priority** — an optional tier/criticality column and a priority rule (match one
  or more columns against chosen values) that drives KPI cards and the Recommendations
  "priority applications" table.
- **Test configuration** — reads the environment and confirms the lookup resolves and the
  tag key is in use.
- **Import / Export** — the ⋯ menu by the page title exports the current config as JSON or
  imports one from a file; Export is enabled once the config has been tested.

> An application is "monitored" if it has any enabled signal: a full/infra host, a tagged
> service (traces), metric ingestion, logs, a RUM app, or a synthetic monitor. Hosts and
> processes in the detail view are the union of **directly tagged** entities **and** the
> hosts/processes the app's tagged **services** run on — so untagged-but-related entities
> are surfaced as an adherence gap.

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

Set it in **one** of these ways:

- Edit `environmentUrl` in `app.config.json`, **or**
- Pass `--environment-url https://<your-tenant>.apps.dynatrace.com` to `dt-app dev` /
  `dt-app deploy` (overrides the config).

### App identity (optional)

`app.config.json` → `app.id` is `my.observability.coverage`, `app.name` is
`Observability Coverage`. Change `app.id` to your own reverse-domain id for your org — the
id is the app's permanent identifier in the environment. (Changing the id deploys a *new*
app rather than updating an existing one.)

### Scopes

The app requests these scopes (`app.config.json` → `app.scopes`); the signed-in user must
also hold them via IAM policy:

`storage:logs:read`, `storage:metrics:read`, `storage:entities:read`,
`storage:events:read`, `storage:buckets:read`, `storage:files:read` (the `/lookups/`
table), `storage:system:read` (`dt.system.events`), and
`app-settings:objects:read` / `app-settings:objects:write` (read/edit the configuration).

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

Deployment needs a token with **app-install** scopes **in addition to** the scopes above:

- `app-engine:apps:install`, `app-engine:apps:run`
- plus all `storage:*` and `app-settings:objects:*` scopes the app declares.

Deploy non-interactively with a **platform token** via `DT_PLATFORM_TOKEN`:

```bash
export DT_PLATFORM_TOKEN="dt0s16.XXXX.XXXXXXXX"
npx dt-app deploy --non-interactive --environment-url https://<your-tenant>.apps.dynatrace.com
```

```powershell
$env:DT_PLATFORM_TOKEN = "dt0s16.XXXX.XXXXXXXX"
npx dt-app deploy --non-interactive --environment-url https://<your-tenant>.apps.dynatrace.com
```

- **Bump `app.version`** in `app.config.json` before each deploy — the platform rejects a
  re-deploy of the same version with different content.
- The **settings schema** (`settings/schemas/coverage-config.schema.json`) deploys with the
  app; if you edit its constraints, bump the schema's own `version` too (settings schemas are
  immutable per version).
- Never commit the token. `.dt-app/.tokens.json` (interactive-login cache) is git-ignored.
- After deploy the app is at
  `https://<your-tenant>.apps.dynatrace.com/ui/apps/<app.id>`; each user grants the app's
  scopes on first open, then an admin configures it once from the Configuration tab.

`npm run uninstall` removes it from the target environment.

### Deep-link target apps

The detail tables deep-link to native Dynatrace apps, which must be installed in the
environment: `dynatrace.infraops`, `dynatrace.services`, `dynatrace.logs`,
`dynatrace.experience.vitals`, `dynatrace.synthetic`. Link formats live in
`ui/app/lib/links.ts`.

---

## Performance & cost notes

- Entity queries (hosts/services/PGIs) scan large record counts but consume **~0 GB** (Grail
  entity model). The metric-ingestion probe is `timeseries`-based and effectively free.
- Entity → application matching uses an **indexed, exact tag match** (`in("<key>:<id>",
  tags)`), not a `contains()` + `expand` scan — ~50× fewer records processed at scale.
- The portfolio log-presence check runs as a **separate parallel query** and samples logs
  (`samplingRatio`, configurable) so the portfolio view renders immediately and the Logs
  column fills in a moment later.
- The per-app **log-source** tile is sampled (counts marked `≈`) because a full scan of one
  app's logs can be tens of GB; each row deep-links to the Logs app for exact data.
- Host/process names in the detail tables are resolved with a batched `lookup` join (not
  per-row `entityName()`), which matters at scale.

---

## Project structure

```
app.config.json                 app id/name, environmentUrl (placeholder), scopes
settings/schemas/               App Settings v2 schema for the stored configuration
ui/
  main.tsx                      AppRoot + ConfigProvider + router
  app/
    App.tsx                     Page shell, nav, routes
    config/                     AppConfig model, App Settings store, ConfigProvider
    components/                 cells, StatCard, CoverageBar, QueryState, NotConfigured, Header
    hooks/usePortfolio.ts       config-gated DQL hooks (portfolio, version cutoff)
    lib/links.ts                deep links to native Dynatrace apps
    pages/                      Overview, Coverage, AppDetail, Recommendations, Explorer, Configuration
    queries/                    coverage.ts, detail.ts, recommendations.ts, common.ts (all config-driven builders)
```

---

## Available scripts

`npm run start` (dev) · `npm run build` · `npm run deploy` · `npm run uninstall` ·
`npm run lint` · `npm run info`
