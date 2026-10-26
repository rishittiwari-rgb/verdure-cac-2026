// Start only the local website/Firebase/Supabase combination. Credentials are
// passed to the child environment, never printed, saved in source or browser.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(root, "node_modules/.bin/supabase");
const status = JSON.parse(execFileSync(cli, ["status", "-o", "json"], { cwd: root, encoding: "utf8", env: process.env }));
const url = status.API_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname) || !status.SERVICE_ROLE_KEY || !status.ANON_KEY) {
  throw new Error("Start the local Supabase stack first.");
}
const port = process.env.VERDURE_STAFF_TEST_PORT || "3104";
if (!/^\d{4,5}$/.test(port)) throw new Error("Choose a valid local website port.");
const env = { ...process.env, VERDURE_STAFF_EMULATOR: "1", VERDURE_SUBMISSIONS_LOCAL: "1", VERDURE_SUBMISSIONS_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}` };
const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", port],
  { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
