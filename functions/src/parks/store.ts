import { randomUUID, createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../common.js";
import { fetchSource, SOURCE_SPECS } from "./sources.js";
import { joinParkGeometry, normalizeFeature } from "./normalize.js";
import type { RequestJSON } from "./sources.js";
import type { PlaceFeature, SourceId } from "./types.js";
import { buildParkIndex, type ParkSummary } from "./guides.js";

export type SourceRun = { source: SourceId; fetched: number; normalized: number; skippedNullGeometry: number; normalizedGeometryFeatures: number;
  errors: string[]; durationMs: number };
export async function recordPlaceSourceHealth(result: SourceRun, runAt: Timestamp) {
  const ref = db.doc(`placeSourceHealth/${result.source}`);
  await db.runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data() ?? {}, newer = runAt.toMillis() >= (old.lastRunAt?.toMillis?.() ?? 0), good = result.errors.length === 0;
    tx.set(ref, { source: result.source,
      ...(newer ? { lastRunAt: runAt, lastOutcome: good ? "success" : "failed", lastRunFeatures: result.fetched,
        normalized: result.normalized, skippedNullGeometry: result.skippedNullGeometry, normalizedGeometryFeatures: result.normalizedGeometryFeatures,
        currentErrors: result.errors, durationMs: result.durationMs } : {}),
      ...(good && runAt.toMillis() >= (old.lastSuccessfulRunAt?.toMillis?.() ?? 0)
        ? { lastSuccessfulRunAt: runAt, lastSuccessfulFeatures: result.fetched } : {}),
      ...(!good && runAt.toMillis() >= (old.lastErrorAt?.toMillis?.() ?? 0)
        ? { lastErrorAt: runAt, lastError: result.errors.join("; ").slice(0, 1000) } : {}),
    }, { merge: true });
  });
}
export async function loadPlaceSourceHealth() {
  const rows = await db.getAll(...SOURCE_SPECS.map((s) => db.doc(`placeSourceHealth/${s.id}`)));
  return rows.map((row, i) => {
    const s = SOURCE_SPECS[i], h = row.data() ?? {};
    return { source: s.id, name: s.name, lastRunAtMs: h.lastRunAt?.toMillis?.() ?? null,
      lastSuccessfulRunAtMs: h.lastSuccessfulRunAt?.toMillis?.() ?? null, lastSuccessfulFeatures: h.lastSuccessfulFeatures ?? null,
      lastRunFeatures: h.lastRunFeatures ?? null, normalized: h.normalized ?? null, skippedNullGeometry: h.skippedNullGeometry ?? 0,
      normalizedGeometryFeatures: h.normalizedGeometryFeatures ?? 0,
      lastOutcome: h.lastOutcome ?? "never-run", currentErrors: h.currentErrors ?? [], lastError: h.lastError ?? null,
      lastErrorAtMs: h.lastErrorAt?.toMillis?.() ?? null, datasetURL: s.credit.datasetURL };
  });
}
export async function placeCatalogState() {
  const data = (await db.doc("parkCatalog/current").get()).data() ?? {};
  return { generation: data.generation ?? null, publishedAtMs: data.publishedAt?.toMillis?.() ?? null,
    count: data.count ?? 0, counts: data.counts ?? {}, latestRunAtMs: data.latestRunAt?.toMillis?.() ?? null,
    latestOutcome: data.latestOutcome ?? "never-run", latestError: data.latestError ?? null };
}
const CHUNK_CHARACTERS = 180_000;
/** GeoJSON nested arrays are not legal Firestore fields. Store bounded gzip
 * chunks with a checksum, preserving ALL vertices rather than truncating them. */
export function encodeGeometry(g: PlaceFeature["geometry"]) {
  const json = JSON.stringify(g), bytes = Buffer.from(json), compressed = gzipSync(bytes).toString("base64"), chunks: string[] = [];
  if (bytes.length > 24 * 1024 * 1024) throw new Error("Geometry exceeds storage bound");
  for (let i = 0; i < compressed.length; i += CHUNK_CHARACTERS) chunks.push(compressed.slice(i, i + CHUNK_CHARACTERS));
  return { chunks, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}
export function decodeGeometry(chunks: string[], sha256: string) {
  const bytes = gunzipSync(Buffer.from(chunks.join(""), "base64"), { maxOutputLength: 24 * 1024 * 1024 });
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Stored geometry checksum mismatch");
  return JSON.parse(bytes.toString("utf8")) as PlaceFeature["geometry"];
}
async function writeGeneration(id: string, features: PlaceFeature[], runAt: Timestamp) {
  const root = db.doc(`parkGenerations/${id}`);
  await root.create({ status: "building", createdAt: Timestamp.now(), runAt });
  let batch = db.batch(), writes = 0;
  async function flush() { if (writes) { await batch.commit(); batch = db.batch(); writes = 0; } }
  for (const f of features) {
    const { geometry, ...detail } = f, encoded = encodeGeometry(geometry);
    const ref = db.doc(`parkGenerations/${id}/features/${f.id}`);
    // Keep each batch far below Firestore's request-byte limit even when source
    // boundaries are very large. Metadata has only flat arrays / scalar fields.
    batch.create(ref, { ...detail, geometryParts: encoded.chunks.length, geometrySHA256: encoded.sha256, geometryBytes: encoded.bytes }); writes++;
    for (let i = 0; i < encoded.chunks.length; i++) {
      batch.create(ref.collection("geometry").doc(String(i)), { data: encoded.chunks[i] }); writes++;
      if (writes >= 20) await flush();
    }
    if (writes >= 20) await flush();
  }
  await flush();
  const indexJSON = Buffer.from(JSON.stringify(buildParkIndex(features)));
  const encodedIndex = gzipSync(indexJSON).toString("base64");
  const indexParts = Math.ceil(encodedIndex.length / CHUNK_CHARACTERS);
  for (let i = 0; i < indexParts; i++) await root.collection("index").doc(String(i)).create({ data: encodedIndex.slice(i * CHUNK_CHARACTERS, (i + 1) * CHUNK_CHARACTERS) });
  await root.update({ status: "ready", count: features.length, indexParts,
    indexSHA256: createHash("sha256").update(indexJSON).digest("hex") });
}
export async function loadParkIndex(generation: string): Promise<ParkSummary[]> {
  const root = db.doc(`parkGenerations/${generation}`), meta = (await root.get()).data();
  if (meta?.status !== "ready" || !Number.isSafeInteger(meta.indexParts) || meta.indexParts < 1 || meta.indexParts > 256) throw new Error("Park index is unavailable; complete a fresh place-data update.");
  const parts = await db.getAll(...Array.from({ length: meta.indexParts }, (_, i) => root.collection("index").doc(String(i))));
  const bytes = gunzipSync(Buffer.from(parts.map((p) => { const value = p.data()?.data; if (typeof value !== "string") throw new Error("Missing park index chunk"); return value; }).join(""), "base64"), { maxOutputLength: 24 * 1024 * 1024 });
  if (createHash("sha256").update(bytes).digest("hex") !== meta.indexSHA256) throw new Error("Park index checksum mismatch");
  return JSON.parse(bytes.toString("utf8"));
}
export async function readPlaceFeatures(generation: string, ids: string[]): Promise<PlaceFeature[]> {
  const result: PlaceFeature[] = [];
  for (let offset = 0; offset < ids.length; offset += 20) {
    const docs = await db.getAll(...ids.slice(offset, offset + 20).map((id) => db.doc(`parkGenerations/${generation}/features/${id}`)));
    const page = await Promise.all(docs.map(async (d) => {
      const data = d.data(); if (!data) throw new Error("Park feature no longer available; refresh the guide.");
      const count = data.geometryParts;
      if (!Number.isSafeInteger(count) || count < 1 || count > 256) throw new Error("Invalid stored geometry parts");
      const chunks = await db.getAll(...Array.from({ length: count }, (_, i) => d.ref.collection("geometry").doc(String(i))));
      const geometry = decodeGeometry(chunks.map((c) => { const v = c.data()?.data; if (typeof v !== "string") throw new Error("Missing stored geometry chunk"); return v; }), data.geometrySHA256);
      const { geometryParts, geometrySHA256, geometryBytes, ...detail } = data;
      return { ...detail, geometry } as PlaceFeature;
    }));
    result.push(...page);
  }
  return result;
}
export async function loadCatalogFeatures(generation?: string): Promise<PlaceFeature[]> {
  const id = generation ?? (await placeCatalogState()).generation;
  if (!id) return [];
  const docs = await db.collection(`parkGenerations/${id}/features`).get();
  const result: PlaceFeature[] = [];
  // Bounded parallel reads; no unbounded Promise.all over thousands of features.
  for (let offset = 0; offset < docs.size; offset += 20) {
    const page = await Promise.all(docs.docs.slice(offset, offset + 20).map(async (d) => {
      const data = d.data(), parts = data.geometryParts;
      if (!Number.isSafeInteger(parts) || parts < 1 || parts > 256) throw new Error("Invalid stored geometry parts");
      const chunks = await db.getAll(...Array.from({ length: parts }, (_, i) => d.ref.collection("geometry").doc(String(i))));
      const geometry = decodeGeometry(chunks.map((c) => { const t = c.data()?.data; if (typeof t !== "string") throw new Error("Missing stored geometry chunk"); return t; }), data.geometrySHA256);
      const { geometryParts, geometrySHA256, geometryBytes, ...detail } = data;
      return { ...detail, geometry } as PlaceFeature;
    }));
    result.push(...page);
  }
  return result;
}
/** Every source failure is persisted; a half-download NEVER replaces the live
 * catalog. Keep the preceding complete generation during an outage. */
export async function runPlaceIngest(options: { request?: RequestJSON; now?: number } = {}) {
  const started = options.now ?? Date.now(), runAt = Timestamp.fromMillis(started), runId = randomUUID();
  const runs: SourceRun[] = [], features: PlaceFeature[] = [];
  await Promise.all(SOURCE_SPECS.map(async (s) => {
    const start = Date.now(), run: SourceRun = { source: s.id, fetched: 0, normalized: 0, skippedNullGeometry: 0, normalizedGeometryFeatures: 0, errors: [], durationMs: 0 };
    try {
      const response = await fetchSource(s.id, options.request, started); run.fetched = response.features.length;
      for (const f of response.features) { const normalized = normalizeFeature(s.id, f); if (normalized) { features.push(normalized); run.normalized++;
        if (normalized.geometryNotes?.length) run.normalizedGeometryFeatures++; } else run.skippedNullGeometry++; }
      if (run.normalized === 0) throw new Error("Source has no usable geometries");
    } catch (error) { run.errors.push((error instanceof Error ? error.message : "Park source failed").slice(0, 1000)); }
    run.durationMs = Date.now() - start; runs.push(run);
    await recordPlaceSourceHealth(run, runAt);
  }));
  runs.sort((a, b) => a.source.localeCompare(b.source));
  const errors = runs.flatMap((r) => r.errors.map((e) => `${r.source}: ${e}`));
  let published = false;
  try {
    if (!errors.length) {
      joinParkGeometry(features);
      await writeGeneration(runId, features, runAt);
      published = await db.runTransaction(async (tx) => {
        const ref = db.doc("parkCatalog/current"), current = (await tx.get(ref)).data() ?? {};
        if ((current.latestRunAt?.toMillis?.() ?? 0) > started) return false;
        const counts = Object.fromEntries(runs.map((r) => [r.source, r.normalized]));
        tx.set(ref, { generation: runId, publishedAt: Timestamp.now(), count: features.length, counts, latestRunAt: runAt,
          latestOutcome: "success", latestError: null }, { merge: true }); return true;
      });
    }
  } catch (error) { errors.push(`Catalog publication: ${error instanceof Error ? error.message.slice(0, 1000) : "failed"}`); }
  if (errors.length) await db.runTransaction(async (tx) => {
    const ref = db.doc("parkCatalog/current"), current = (await tx.get(ref)).data() ?? {};
    if ((current.latestRunAt?.toMillis?.() ?? 0) <= started) tx.set(ref, { latestRunAt: runAt, latestOutcome: "failed", latestError: errors.join("; ").slice(0, 4000) }, { merge: true });
  });
  const result = { runId, startedAtMs: started, durationMs: Date.now() - started, published, count: published ? features.length : 0, runs, errors };
  await db.doc(`placeIngestRuns/${runId}`).create({ ...result, runAt });
  return result;
}

/** Retain two weeks of complete/abandoned generations for ongoing reads. A
 * failed partial write has a root record too, so it cannot leak storage forever. */
export async function prunePlaceGenerations(now = Date.now()) {
  const current = await placeCatalogState();
  const old = await db.collection("parkGenerations").where("createdAt", "<", Timestamp.fromMillis(now - 14 * 86_400_000)).get();
  for (const doc of old.docs) if (doc.id !== current.generation) await db.recursiveDelete(doc.ref);
}
