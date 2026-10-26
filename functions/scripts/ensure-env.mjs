// `functions/.env` is ignored (CAC 2026, 1.5) because the handoff wants no config file in
// the tree that could ever hold a key. But firebase-functions `defineString()` params prompt
// on stdin when no value exists, which made `npm run e2e` hang forever under emulators:exec.
// So every build first copies the tracked, non-secret `.env.example` to `.env` when it is
// missing. An existing `.env` is never touched (a developer may have set APPLE_APP_APPLE_ID).
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = join(dir, ".env"), example = join(dir, ".env.example");
if (!existsSync(env)) {
  if (!existsSync(example)) throw new Error("functions/.env.example is missing");
  copyFileSync(example, env);
  console.log("functions/.env created from .env.example (non-secret defaults; the file is gitignored)");
}
