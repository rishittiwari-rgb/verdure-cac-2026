// This runner cannot write to a configured production project.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) throw new Error("A loopback Firestore emulator is required");
process.env.GCLOUD_PROJECT = "connectify-19dd8";
process.env.FUNCTIONS_EMULATOR = "true";
const { runPlaceIngest } = await import("../lib/parks/store.js");
const path = process.argv[2];
let request;
if (path && path !== "--live") {
  const capture = JSON.parse(gunzipSync(readFileSync(path), { maxOutputLength: 160 * 1024 * 1024 }).toString("utf8"));
  if (capture.version !== 1 || !capture.responses) throw new Error("Invalid public source capture");
  request = async (url) => { const response = capture.responses[url]; if (!response) throw new Error(`Capture is missing source response: ${url}`); return response; };
} else if (path !== "--live") throw new Error("Pass --live or a permission-checked capture.json.gz path");
const result = await runPlaceIngest({ request });
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length ? 1 : 0);
