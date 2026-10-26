// Fresh, isolated broad gates. Leaves the working sprint emulator untouched.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
const root = fileURLToPath(new URL("../../", import.meta.url));
const build = spawnSync("npm", ["--prefix", "functions", "run", "test:units"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const config = JSON.parse(readFileSync(`${root}/firebase.json`, "utf8"));
for (const [service, port] of Object.entries({ auth: 9109, functions: 5012, firestore: 8909, storage: 9209 })) {
  config.emulators[service] = { ...config.emulators[service], host: "127.0.0.1", port };
}
config.emulators.firestore.websocketPort = 9151;
config.emulators.hub = { host: "127.0.0.1", port: 4402 };
config.emulators.logging = { host: "127.0.0.1", port: 4502 };
const path = `${root}/.sprint-regression-firebase.json`;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
const child = spawn("npx", ["firebase-tools@13", "emulators:exec", "--project", "connectify-19dd8", "--config", path,
  "--only", "auth,functions,firestore,storage",
  "FUNCTIONS_EMULATOR_PORT=5012 node functions/scripts/e2e-backend.mjs && FUNCTIONS_EMULATOR_PORT=5012 node functions/scripts/redteam.mjs"],
  { cwd: root, stdio: "inherit" });
child.on("error", (e) => { console.error(e.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
