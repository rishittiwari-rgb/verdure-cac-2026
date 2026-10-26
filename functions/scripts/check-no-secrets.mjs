#!/usr/bin/env node
// CAC 2026 (1.5) — no key may be committed, ever.
//
//   node functions/scripts/check-no-secrets.mjs            # scans every TRACKED file (what a push would send)
//   node functions/scripts/check-no-secrets.mjs --history  # also scans every commit on every branch (slow)
//
// Shape-based, so this file itself holds no key material: an NPS key is a 32-40
// character token assigned to an NPS variable, a Recreation.gov key is a UUID
// assigned to its variable, Firebase browser keys start with "AIza", Anthropic
// keys with "sk-ant-", private keys with a PEM header, and the two secret
// files must not be tracked at all. Exit code 1 on any hit. Part of
// `npm run test:units` (check:secrets) so a key in a tracked file fails the build.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });

/** [name, regex]. Placeholders in the templates ("YOUR_KEY", "<key>", "…") never match: real values are long and keyed. */
export const PATTERNS = [
  ["NPS API key assigned", /\b(?:NPS_API_KEY|NpsApiKey|npsApiKey)\b\s*[:=]\s*["']?[A-Za-z0-9]{32,40}\b/],
  ["Recreation.gov key assigned", /\b(?:RECREATION_GOV_KEY|RecreationGovKey|recreationGovKey)\b\s*[:=]\s*["']?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["Firebase/Google browser key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["SerpApi/Ticketmaster-style key assigned", /\b(?:SERPAPI_KEY|TICKETMASTER_KEY|TREMENDOUS_API_KEY)\b\s*[:=]\s*["']?[A-Za-z0-9]{24,}\b/],
  ["PEM private key", /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
  ["Google service-account JSON", /"private_key_id"\s*:\s*"[0-9a-f]{20,}"/],
];
/** Paths that must never be tracked (the ignore rules in .gitignore cover them). */
export const FORBIDDEN_TRACKED = [/^Verdure\/Secrets\.xcconfig$/, /GoogleService-Info\.plist$/, /^functions\/\.secret\.local$/, /^functions\/\.env$/, /^functions\/\.env\.local$/, /\.p8$/];
/** Binary or generated paths the text scan skips. */
const SKIP = /\.(png|jpg|jpeg|gif|webp|ttf|otf|gz|zip|pbf|storekit|xcassets)$|^functions\/lib\//;

export function scanText(path, text) {
  const hits = [];
  for (const [name, rx] of PATTERNS) if (rx.test(text)) hits.push(`${path}: ${name}`);
  return hits;
}

const history = process.argv.includes("--history");
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const problems = [];
for (const path of tracked) {
  if (FORBIDDEN_TRACKED.some((rx) => rx.test(path))) problems.push(`${path}: a secret file is TRACKED — git rm --cached it; .gitignore must cover it`);
  if (SKIP.test(path)) continue;
  let text; try { text = readFileSync(join(root, path), "utf8"); } catch { continue; }
  problems.push(...scanText(path, text));
}
if (history) {
  // Every blob on every branch: a key that was ever committed is burned even if the tip is clean.
  const patch = git("log", "--all", "-p", "--no-color", "--", ".", ":!functions/lib");
  const hits = new Set();
  for (const line of patch.split("\n")) if (/^\+/.test(line) && !/^\+\+\+/.test(line)) for (const [name, rx] of PATTERNS) if (rx.test(line)) hits.add(name);
  for (const h of hits) problems.push(`HISTORY: ${h} appears in a past commit (purge before pushing to a new remote)`);
}
if (problems.length) { console.error("Secret scan FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`Secret scan passed: ${tracked.length} tracked files${history ? " and every commit on every branch" : ""}, no key material, no secret file tracked.`);
