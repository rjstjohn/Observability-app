/* Emits the DQL the app would run for a given config JSON, for offline parity checks.
   Customer-agnostic: pass any exported AppConfig JSON.
     esbuild scripts/emit-queries.ts --bundle --platform=node --format=cjs --outfile=emit.cjs
     node emit.cjs <config.json> <coverage|logs|fullstack|rollup|orphans>
*/
import { readFileSync } from "node:fs";
import { buildCoverageQuery, buildLogPresenceQuery } from "../ui/app/queries/coverage";
import { fullstackOverTimeQuery } from "../ui/app/queries/common";
import { buildAdherenceRollupQuery, buildOrphanTagsQuery } from "../ui/app/queries/recommendations";
import { normalizeConfig } from "../ui/app/config/types";

const configPath = process.argv[2];
if (!configPath) {
  process.stderr.write("usage: node emit.cjs <config.json> [coverage|logs|fullstack|rollup|orphans]\n");
  process.exit(1);
}
const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
const cfg = normalizeConfig(raw);

const which = process.argv[3] || "coverage";
const out: Record<string, string> = {
  coverage: buildCoverageQuery(cfg),
  logs: buildLogPresenceQuery(cfg),
  fullstack: fullstackOverTimeQuery(cfg),
  rollup: buildAdherenceRollupQuery(cfg),
  orphans: buildOrphanTagsQuery(cfg),
};
process.stdout.write(out[which] ?? `unknown query "${which}"`);
