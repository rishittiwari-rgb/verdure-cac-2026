/**
 * robots.txt (W4.3 "Robots allow"). RFC 9309 semantics: groups by user-agent,
 * the most specific group wins (our token, then "*"), and within a group the
 * longest matching rule wins; Allow beats Disallow on equal length. `*` and
 * `$` are supported in paths. Anything we cannot parse is treated as not
 * allowed — when in doubt, reject.
 *
 * A 403 on robots.txt itself is a rejection. A 404 (no robots file) allows.
 * Network failures and 5xx leave the answer "unknown" so the candidate is
 * re-inspected later instead of being activated.
 */

export const ROBOTS_TOKENS = ["verdure-source-survey", "verdure"];

export interface RobotsRule { allow: boolean; path: string }
export interface RobotsGroup { agents: string[]; rules: RobotsRule[] }

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      if (field === "disallow" && value === "") continue;   // "Disallow:" (empty) allows everything
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

function pathMatches(rulePath: string, path: string): boolean {
  // Translate `*` → `.*`, trailing `$` → end anchor; everything else literal.
  let re = "^";
  for (let i = 0; i < rulePath.length; i++) {
    const c = rulePath[i];
    if (c === "*") re += ".*";
    else if (c === "$" && i === rulePath.length - 1) re += "$";
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  try { return new RegExp(re).test(path); } catch { return false; }
}

/** Pick the group for our user agent: a named token wins over "*". */
export function groupFor(groups: RobotsGroup[], tokens: string[] = ROBOTS_TOKENS): RobotsGroup | null {
  for (const t of tokens) {
    const g = groups.find((x) => x.agents.some((a) => a === t || t.startsWith(a) && a.length >= 7));
    if (g) return g;
  }
  return groups.find((x) => x.agents.includes("*")) ?? null;
}

/** True when `path` (with query) may be fetched under this robots.txt text. */
export function robotsAllows(robotsText: string, path: string, tokens: string[] = ROBOTS_TOKENS): boolean {
  const group = groupFor(parseRobots(robotsText), tokens);
  if (!group) return true;
  let best: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (!pathMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow && !best.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export type RobotsVerdict = { outcome: "allowed" | "disallowed" | "forbidden" | "unknown"; evidence: string };

/** Decide from the robots.txt HTTP status and body for one feed path. */
export function robotsVerdict(status: number, body: string, path: string): RobotsVerdict {
  if (status === 403 || status === 401) return { outcome: "forbidden", evidence: `robots.txt returned ${status}; a 403 is not a licence to try harder` };
  if (status === 404 || status === 410) return { outcome: "allowed", evidence: `no robots.txt (${status})` };
  if (status === 0 || status >= 500) return { outcome: "unknown", evidence: `robots.txt unavailable (${status || "network error"})` };
  if (status >= 200 && status < 300) {
    if (!/user-agent\s*:/i.test(body)) return { outcome: "allowed", evidence: "robots.txt has no user-agent groups" };
    const ok = robotsAllows(body, path);
    const group = groupFor(parseRobots(body));
    const rule = group?.rules.filter((r) => pathMatches(r.path, path)).sort((a, b) => b.path.length - a.path.length)[0];
    return { outcome: ok ? "allowed" : "disallowed", evidence: rule ? `${rule.allow ? "Allow" : "Disallow"}: ${rule.path} (group: ${group?.agents.join(", ")})` : "no matching rule" };
  }
  return { outcome: "unknown", evidence: `robots.txt returned ${status}` };
}
