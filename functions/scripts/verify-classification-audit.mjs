import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";

const root = new URL("../../docs/audits/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root)));
const rows = (name) => JSON.parse(gunzipSync(readFileSync(new URL(name, root))));
const before = read("classification-before-2026-10-03.json");
const after = read("classification-after-2026-10-03.json");
const a = rows("classification-before-2026-10-03-records.json.gz");
const b = rows("classification-after-2026-10-03-records.json.gz");
const ids = (rs) => rs.map((r) => `${r.event.source}:${r.event.sourceEventId}`).sort();
assert.equal(before.sourceSnapshotSHA256, after.sourceSnapshotSHA256);
assert.equal(before.capturedAt, after.capturedAt);
assert.deepEqual(ids(a), ids(b), "before and after must classify the same records");
assert.equal(new Set(ids(a)).size, a.length, "source identities must be unique");
for (const [report, rs] of [[before, a], [after, b]]) {
  assert.equal(report.overall.total, rs.length);
  assert.equal(report.overall.low, rs.filter((r) => r.prediction.classificationConfidence < 0.65).length);
  assert.equal(Object.values(report.bySource).reduce((n, s) => n + s.total, 0), rs.length);
  assert.equal(Object.values(report.byFeed).reduce((n, s) => n + s.total, 0), rs.length);
}
assert.ok(after.overall.low < before.overall.low);
console.log(JSON.stringify({ fixedInputs: a.length, sourceSnapshotSHA256: after.sourceSnapshotSHA256,
  before: before.overall.low, after: after.overall.low,
  bySource: Object.fromEntries(Object.entries(before.bySource).map(([key, value]) =>
    [key, { total: value.total, before: value.low, after: after.bySource[key].low }])) }, null, 2));
