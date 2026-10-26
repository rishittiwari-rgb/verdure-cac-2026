// W4.1 — seed /sources from today's configuration (functions/src/ingest/sources-config.ts).
//   npm run build && node scripts/migrate-sources.mjs            # emulator (FIRESTORE_EMULATOR_HOST set)
//   npm run build && node scripts/migrate-sources.mjs --live     # the configured project (never run in this sprint)
// Idempotent: existing documents keep their status and decision; only missing ones are created.
// The deny-list is absolute: a seed on it is reported and never written.
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!emulator && !process.argv.includes("--live")) throw new Error("Refusing a non-emulator run without --live.");
if (!getApps().length) initializeApp(emulator
  ? { projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" }
  : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const { seedSourcesFromConfig, loadActiveSources } = await import("../lib/ingest/sources-registry.js");
const { SOURCE_SEEDS } = await import("../lib/ingest/sources-config.js");
const { LAUNCH_AREAS } = await import("../lib/ingest/areas.js");
const result = await seedSourcesFromConfig(SOURCE_SEEDS);
const active = {};
for (const area of LAUNCH_AREAS) active[area.id] = (await loadActiveSources(area.id)).map((s) => `${s.type}:${s.id}`);
console.log(JSON.stringify({ emulator, seeds: SOURCE_SEEDS.length, ...result, active }, null, 2));
if (result.denied.length) { console.error("Denied seeds were not written:", result.denied.join(", ")); }
