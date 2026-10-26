/**
 * rank-judge-mock.mjs — a tiny local OpenAI-compatible judge for tests.
 *
 * Serves POST /v1/chat/completions on 127.0.0.1 and answers the rank-eval
 * relevance prompt with strict JSON, deterministically. It is NOT a model: it
 * exists so rank-eval-unit.mjs can exercise blinding, pooling, caching,
 * retries and the decision rule without a network or an LLM. The mock sees
 * exactly what a real judge would see (profile text + listing text) and
 * nothing else, so a mode that must "make v1 win" has to work from titles.
 *
 * Usage: node scripts/rank-judge-mock.mjs [--port 0] [--mode keyword|all|none|titles]
 *          [--titles <file.json>] [--log <requests.jsonl>] [--fail-first N] [--batch]
 *
 * Modes
 *   keyword  (default) relevant when the listing mentions a keyword of one of the
 *            person's interests; a person with no interests finds Free listings relevant.
 *   all      every listing relevant.
 *   none     no listing relevant.
 *   titles   relevant iff the listing title is in --titles (a JSON array of strings).
 *
 * --fail-first N answers the first N requests with HTTP 500 (retry test).
 * --log appends every request body as one JSON line (blinding test).
 * Prints "listening http://127.0.0.1:<port>" once bound.
 */
import { createServer } from "node:http";
import { readFileSync, appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = (name) => args.includes(name);
const port = Number(opt("--port", "0"));
const mode = opt("--mode", "keyword");
const logPath = opt("--log", null);
let failFirst = Number(opt("--fail-first", "0"));
const titles = new Set(mode === "titles" ? JSON.parse(readFileSync(opt("--titles"), "utf8")).map((t) => String(t).toLowerCase()) : []);

/** Interest vocabulary mirrors the app's interests; keywords are deliberately crude. */
export const MOCK_KEYWORDS = {
  outdoors: ["hike", "trail", "park", "nature", "preserve", "garden", "outdoor", "walk"],
  volunteering: ["volunteer", "cleanup", "clean-up", "restoration", "serve"],
  fitness: ["yoga", "run", "fitness", "workout", "zumba", "climbing", "sports"],
  arts: ["art", "gallery", "exhibit", "craft", "paint", "theater", "theatre", "film", "movie", "dance"],
  music: ["music", "concert", "band", "jazz", "choir", "orchestra", "sing"],
  food: ["food", "cooking", "tasting", "market", "cook", "recipe"],
  tech: ["tech", "coding", "robot", "computer", "hackathon", "ai", "programming", "3d"],
  learning: ["class", "lecture", "workshop", "learn", "lesson", "seminar", "talk", "tutoring", "library"],
  community: ["community", "meetup", "social", "neighbor", "civic", "council", "mixer"],
  family: ["family", "kids", "children", "storytime", "story time", "toddler", "baby", "all ages", "teen"],
};

const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?![\\p{L}\\p{N}_])`, "iu");

export function judgeListing(personText, listingText) {
  const listing = String(listingText);
  if (mode === "all") return true;
  if (mode === "none") return false;
  if (mode === "titles") {
    const m = /^Title:\s*(.*)$/mi.exec(listing);
    return !!m && titles.has(m[1].trim().toLowerCase());
  }
  const im = /^Interests:\s*(.*)$/mi.exec(String(personText));
  const interests = im ? im[1].split(",").map((s) => s.trim().toLowerCase()).filter((s) => s && s !== "none" && s !== "none stated") : [];
  if (!interests.length) return /^Price:\s*Free/mi.test(listing);
  return interests.some((i) => (MOCK_KEYWORDS[i] ?? [i]).some((w) => wordRe(w).test(listing)));
}

/** The prompt format rank-eval.mjs sends: "PERSON:\n...\n\nLISTING:\n..." or numbered "LISTING 1:" blocks. */
function answer(body) {
  const user = (body.messages ?? []).filter((m) => m.role === "user").map((m) => String(m.content)).join("\n");
  const person = (/PERSON:\n([\s\S]*?)\n\nLISTING/i.exec(user) ?? [, ""])[1];
  const blocks = [...user.matchAll(/LISTING(?: (\d+))?:\n([\s\S]*?)(?=\n\nLISTING(?: \d+)?:\n|\n\nAnswer|$)/gi)];
  if (blocks.length === 1 && blocks[0][1] === undefined) return JSON.stringify({ relevant: judgeListing(person, blocks[0][2]) });
  return JSON.stringify({ verdicts: blocks.map((b) => ({ index: Number(b[1]), relevant: judgeListing(person, b[2]) })) });
}

let served = 0;
const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) { res.writeHead(404); return res.end(); }
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    if (logPath) appendFileSync(logPath, raw.replace(/\r?\n/g, " ") + "\n");
    if (failFirst > 0) { failFirst--; res.writeHead(500, { "content-type": "application/json" }); return res.end('{"error":"injected failure"}'); }
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); return res.end('{"error":"bad json"}'); }
    served++;
    const content = answer(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `mock-${served}`, object: "chat.completion", model: body.model ?? "mock-judge",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
  });
});
server.listen(port, "127.0.0.1", () => {
  console.log(`listening http://127.0.0.1:${server.address().port}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
