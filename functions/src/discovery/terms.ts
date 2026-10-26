/**
 * Terms of use (W4.3 "Terms allow") and adult-content signals ("Not adult content").
 *
 * The rule, verbatim from the sprint spec: a restrictive clause is a sentence
 * containing a prohibition ("may not", "must not", "shall not", "prohibited",
 * "not permitted", "without our prior written consent", "personal use only",
 * "non-commercial use only") together with an action ("scrape", "crawl",
 * "spider", "robot", "automated", "data mining", "commercial", "reproduce",
 * "redistribute", "store", "cache"). Requiring both stops pages that merely
 * mention "robots.txt" from being rejected. When in doubt, reject. The matched
 * sentence is stored as evidence.
 *
 * One documented narrowing: a sentence whose subject is what VISITORS post
 * ("you may not post commercial messages", "comments must not …") governs user
 * submissions, not access to the site's published data, and is not counted.
 * Such a sentence must name posting/submitting/uploading/commenting and no
 * access verb (scrape/crawl/spider/robot/automated/data mining/cache).
 */

/**
 * The sprint's lists, verbatim and whole-word. They are deliberately NOT
 * extended: "stored" (a security notice on openspace.org), "retained" (a
 * privacy sentence about a vendor) and "solely for" each turned a page the
 * rule is meant to pass into a rejection when they were tried.
 */
export const PROHIBITIONS = [
  "may not", "must not", "shall not", "prohibited", "not permitted", "without our prior written consent",
  "personal use only", "non-commercial use only",
];
export const ACTIONS = [
  "scrape", "crawl", "spider", "robot", "automated", "data mining", "commercial", "reproduce", "redistribute", "store", "cache",
];
const ACCESS_ACTIONS = /\b(scrap(?:e|ing)|crawl(?:er|ing)?|spider|robots?|bots?|automated|automatic|data[\s-]?mining|harvest(?:ing)?|cach(?:e|ing))\b/i;
const USER_CONTENT = /\b(post(?:ing|ed)?|submit(?:ting|ted)?|upload(?:ing|ed)?|comment(?:s|ing)?|user[\s-]generated|your content|content you)\b/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PROHIBITION_RE = new RegExp(`\\b(?:${PROHIBITIONS.map(esc).join("|")})\\b`, "i");
const ACTION_RE = new RegExp(`\\b(?:${ACTIONS.map(esc).join("|")})\\b`, "i");

/** The <title> of an HTML page, whitespace-collapsed. */
export function htmlTitle(html: string): string {
  return (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Plain text from an HTML page: scripts, styles, nav chrome and tags removed; entities decoded. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;|&rsquo;|&#8217;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Sentences: split on terminal punctuation, semicolons and line breaks; keep list items whole. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 12);
}

export interface RestrictiveClause { sentence: string; prohibition: string; action: string }

/** The first restrictive clause in the page, or null. */
export function findRestrictiveClause(html: string): RestrictiveClause | null {
  for (const s of sentences(pageText(html))) {
    const p = PROHIBITION_RE.exec(s), a = ACTION_RE.exec(s);
    if (!p || !a) continue;
    if (USER_CONTENT.test(s) && !ACCESS_ACTIONS.test(s)) continue;   // governs what visitors post, not access
    return { sentence: s.slice(0, 400), prohibition: p[0], action: a[0] };
  }
  return null;
}

/** Candidate terms-page links on a home page (by link text), absolute, same site, at most `limit`. */
export function termsLinks(html: string, baseUrl: string, limit = 3): string[] {
  const out: string[] = [];
  const base = new URL(baseUrl);
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const href = m[1];
    if (!/\b(terms|conditions of use|terms of use|terms of service|legal|acceptable use|website use|site policies|disclaimer)\b/i.test(text) && !/\/(terms|legal|tos|conditions)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      if (!out.includes(u.href)) out.push(u.href);
      if (out.length >= limit) break;
    } catch { /* skip bad hrefs */ }
  }
  return out;
}

export const COMMON_TERMS_PATHS = ["/terms", "/terms-of-use", "/terms-of-service", "/terms-and-conditions", "/legal", "/legal/terms", "/policies/terms", "/terms-use-privacy", "/tos", "/site-policies", "/about/terms"];

// ── Adult content ────────────────────────────────────────────────────────────

/** Sexual / adult-entertainment signals (alcohol is adultOnly's job, not this rule's). */
export const ADULT_CONTENT_PATTERN = /\b(porn(?:ography)?|xxx|sex(?:ual)?\s+(?:services?|content|club|party|parties)|strip\s*club|strippers?|gentlemen'?s\s+club|adult\s+(?:entertainment|film|video|toys?|store|club|only\s+content)|escorts?|swingers?|fetish|bdsm|nude|nudity|erotic|lap\s*dance|peep\s*show|cam\s*girls?|onlyfans|hookup|18\+\s*(?:only\s+)?(?:content|site|material))\b/i;

export function adultContentSignal(texts: string[]): string | null {
  for (const t of texts) {
    const m = ADULT_CONTENT_PATTERN.exec(t);
    if (m) {
      const i = Math.max(0, m.index - 60);
      return t.slice(i, m.index + m[0].length + 60).replace(/\s+/g, " ").trim();
    }
  }
  return null;
}
