// Read-only public GIS capture. Permission is validated BEFORE feature requests.
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fetchSource, requestJSON, SOURCE_SPECS } from "../lib/parks/sources.js";
const output = process.argv[2];
if (!output?.startsWith("/")) throw new Error("Usage: node scripts/parks-capture.mjs /absolute/path/capture.json.gz");
const responses = {}, counts = {}, started = Date.now();
async function capture(url) { const data = await requestJSON(url); responses[url] = data; return data; }
function save(complete) {
  const bytes = Buffer.from(JSON.stringify({ version: 1, complete, capturedAtMs: started, counts, responses }));
  writeFileSync(output, gzipSync(bytes), { mode: 0o600 });
  return bytes;
}
for (const source of SOURCE_SPECS) {
  try {
    const result = await fetchSource(source.id, capture, started);
    counts[source.id] = result.features.length;
    console.log(`${source.id}: ${result.features.length} complete, permission-checked public features`);
  } finally { save(false); }
}
const bytes = save(true);
console.log(JSON.stringify({ output, capturedAtMs: started, counts, uncompressedBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex") }));
