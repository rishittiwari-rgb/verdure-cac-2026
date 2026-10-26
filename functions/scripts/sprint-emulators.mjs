/** Reproducible local-only sprint services. --lan enables physical-device QA. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((a) => !["--lan", "--config-only"].includes(a))) throw new Error("Use --lan and/or --config-only");
const config = JSON.parse(readFileSync(`${root}/firebase.json`, "utf8"));
const host = args.includes("--lan") ? "0.0.0.0" : "127.0.0.1";
for (const service of ["auth", "functions", "firestore", "storage"]) config.emulators[service].host = host;
config.emulators.functions.port = 5002; // 5001 is occupied by an unrelated service on the development Mac.
const path = `${root}/.sprint-firebase.json`;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`Local sprint configuration: ${host}; Auth 9099, Functions 5002, Firestore 8899, Storage 9199`);
if (!args.includes("--config-only")) {
  const child = spawn("npx", ["firebase-tools@13", "emulators:start", "--only", "auth,functions,firestore,storage",
    "--project", "connectify-19dd8", "--config", path], { cwd: root, stdio: "inherit" });
  child.on("error", (e) => { console.error(e.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}
