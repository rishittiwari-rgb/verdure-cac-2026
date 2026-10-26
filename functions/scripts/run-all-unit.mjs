// run-all.command preconditions that only show up on a Mac (CAC 2026, Mac pass 2026-10-25):
//  1. Every tracked *.command / *.sh that is run directly (has a #! line; java21.sh is only
//     sourced) is committed executable. A commit made on Windows stored
//     run-all.command and partner-detail-native.sh as 100644, so the double-click and
//     PartnerSurfaceTests' helper both died with "permission denied" (exit 126).
//  2. java21_bin (scripts/java21.sh) never picks a JVM that is not 21. `java_home -v 21` exits 0
//     with the default Java 8 when only Homebrew's keg-only openjdk@21 is installed, and the old
//     branch put that Java 8 first on PATH.
//  3. The data reload loads what the reports measured: the discovery step replays the recorded
//     cycle (activate-discovered-local.mjs; it only ran migrate-sources.mjs, so a fresh stack had
//     14 active sources instead of 19), and the inline counts module runs from functions/, where
//     firebase-admin resolves (from the repo root it failed, silenced by `2>/dev/null || true`).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
let passed = 0; function check(label, fn) { fn(); passed++; console.log(`PASS ${label}`); }

const staged = execFileSync("git", ["ls-files", "-s", "--", "*.command", "*.sh"], { cwd: repo, encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((line) => { const [mode, , , path] = line.split(/\s+/); return { mode, path }; })
  .filter(({ path }) => readFileSync(join(repo, path), "utf8").startsWith("#!"));
check("run-all.command and partner-detail-native.sh are tracked as run-directly scripts", () => {
  const paths = staged.map((s) => s.path);
  assert.ok(paths.includes("run-all.command"));
  assert.ok(paths.includes("functions/scripts/partner-detail-native.sh"));
});
for (const { mode, path } of staged) check(`${path} is committed executable (100755)`, () => assert.equal(mode, "100755", `${path} is ${mode}`));

const runAll = readFileSync(join(repo, "run-all.command"), "utf8");
check("the discovery step replays the recorded cycle after seeding the config sources", () => {
  const seed = runAll.indexOf("node functions/scripts/migrate-sources.mjs"), replay = runAll.indexOf("node functions/scripts/activate-discovered-local.mjs");
  assert.ok(seed > 0 && replay > seed, "activate-discovered-local.mjs must run after migrate-sources.mjs");
  assert.ok(replay < runAll.indexOf("foryou-interests-e2e.mjs --keep"), "sources load before the For You accounts are checked");
});
check("every inline node module runs from functions/ and its failure is not silenced", () => {
  const inline = [...runAll.matchAll(/^(.*)node --input-type=module/gm)];
  assert.ok(inline.length > 0);
  for (const m of inline) assert.match(m[1], /cd functions && $/, `inline module outside functions/: ${m[0].trim()}`);
  assert.doesNotMatch(runAll, /2>\/dev\/null \|\| true/);
});

check("the simulator's GPS is set to the seeded launch area before the app launches", () => {
  const set = runAll.indexOf('simctl location "$SIMULATOR" set 37.3352,-121.8811');
  assert.ok(set > 0, "run-all.command must set the simulated location (a UI test may have left Minneapolis)");
  assert.ok(set < runAll.indexOf('simctl launch "$SIMULATOR"'), "the location is set before the launch");
});

const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
if (bash.status !== 0) {
  console.log("SKIP java21_bin checks: no bash on PATH (run from Git Bash on Windows)");
} else {
  const root = mkdtempSync(join(tmpdir(), "java21-unit-"));
  const fakeJava = (name, banner, executable = true) => {
    const dir = join(root, name, "bin"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "java"), `#!/bin/sh\necho '${banner}' >&2\necho 'Java(TM) SE Runtime Environment' >&2\n`);
    chmodSync(join(dir, "java"), executable ? 0o755 : 0o644);
    return dir;
  };
  const java8 = fakeJava("java8", 'java version "1.8.0_451"');
  const java17 = fakeJava("java17", 'openjdk version "17.0.12" 2024-07-16');
  const brew21 = fakeJava("brew21", 'openjdk version "21.0.11" 2025-04-15');
  const other21 = fakeJava("other21", 'openjdk version "21.0.2" 2024-01-16');
  const notExecutable21 = fakeJava("noexec21", 'openjdk version "21.0.11" 2025-04-15', false);
  const missing = join(root, "missing", "bin");
  // Same shell options as run-all.command, so a pipefail/errexit trap in the helper shows here.
  const pick = (...dirs) => spawnSync("bash", ["-c", 'set -euo pipefail; . "$0"; java21_bin "$@"', join(here, "java21.sh"), ...dirs], { encoding: "utf8" });
  try {
    check("java_home's Java 8 answer is skipped for the Homebrew 21 after it", () => {
      const r = pick(missing, java8, brew21); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), brew21);
    });
    check("only Java 8 and 17 available: no candidate, exit 1, nothing printed", () => {
      const r = pick(java8, java17, missing); assert.equal(r.status, 1); assert.equal(r.stdout, "");
    });
    check("the first Java 21 wins (tools/bin before Homebrew)", () => {
      const r = pick(other21, brew21); assert.equal(r.status, 0); assert.equal(r.stdout.trim(), other21);
    });
    check("a non-executable java is not a candidate", () => {
      const r = pick(notExecutable21, java8); assert.equal(r.status, 1); assert.equal(r.stdout, "");
    });
    check("an empty java_home answer ('/bin') is not a candidate", () => {
      const r = pick("/bin", brew21); assert.equal(r.status, 0); assert.equal(r.stdout.trim(), brew21);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
console.log(`${passed} run-all unit checks passed`);
