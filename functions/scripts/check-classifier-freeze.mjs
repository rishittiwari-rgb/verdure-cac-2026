// D1 is an input freeze for the concurrent ranking evaluation, not a convention.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("docs/audits/classifier-freeze-2026-10-03.json", root)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [path, expected] of Object.entries(manifest.files)) {
  if (hash(readFileSync(new URL(path, root))) !== expected) throw new Error(`D1 classifier freeze changed: ${path}`);
  const committed = execFileSync("git", ["show", `${manifest.commit}:${path}`], { cwd: fileURLToPath(root) });
  if (hash(committed) !== expected) throw new Error(`Freeze hash does not match D1 commit: ${path}`);
}
console.log(`Classifier freeze verified: ${manifest.commit} (${Object.keys(manifest.files).length} files).`);
