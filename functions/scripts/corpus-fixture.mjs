// Recorded-corpus fixture helpers.
//
// The sprint's rule is "recorded fixtures, not the live internet, in tests".
// record-corpus.mjs fetches the configured public feeds ONCE and writes a
// gzipped JSON snapshot of the normalized records; everything else — the
// baseline script, the write-path tests, the acceptance script — replays that
// snapshot through the real ingest code with no network. One live run per
// milestone is recorded as evidence; this module is how it is read back.
//
// No Firestore queries live here, so the index inventory does not audit it.

import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(here, "..", "test-fixtures", "corpus");

/** Newest `<areaId>-<date>.json.gz` in the corpus directory, or null. */
export function latestCorpusPath(areaId = "san-jose-ca") {
  if (!existsSync(CORPUS_DIR)) return null;
  const files = readdirSync(CORPUS_DIR).filter((f) => f.startsWith(`${areaId}-`) && f.endsWith(".json.gz")).sort();
  return files.length ? join(CORPUS_DIR, files[files.length - 1]) : null;
}

/** Serialize a recorded corpus (records keep Date instances; JSON turns them into ISO strings). */
export function saveRecordedCorpus(path, corpus) {
  mkdirSync(dirname(path), { recursive: true });
  const json = JSON.stringify(corpus);
  writeFileSync(path, gzipSync(Buffer.from(json)));
  return { bytes: json.length, sha256: createHash("sha256").update(json).digest("hex") };
}

/** Read a recorded corpus and revive the Date fields the ingest path expects. */
export function loadRecordedCorpus(path = latestCorpusPath()) {
  if (!path || !existsSync(path)) throw new Error("No recorded corpus found. Run `node scripts/record-corpus.mjs` once (network) first.");
  const json = gunzipSync(readFileSync(path)).toString("utf8");
  const corpus = JSON.parse(json);
  for (const source of Object.values(corpus.sources)) {
    for (const rec of source.records) {
      rec.start = new Date(rec.start);
      if (rec.end) rec.end = new Date(rec.end);
    }
  }
  corpus.path = path;
  corpus.sha256 = createHash("sha256").update(json).digest("hex");
  return corpus;
}

/** Records for one source id, with `at` stamped so a replay can keep "nothing changed" exact. */
export function recordsFor(corpus, sourceId) {
  return corpus.sources[sourceId]?.records ?? [];
}

/** The source ids present in a corpus, in the order the ingest schedules run them. */
export function corpusSources(corpus, order) {
  const present = Object.keys(corpus.sources).filter((s) => corpus.sources[s].records.length);
  return order ? order.filter((s) => present.includes(s)) : present;
}
