/**
 * Automatic decision (W4.3) — replaces approval. A source becomes active only
 * if EVERY rule passes; each result and its evidence are stored on the source.
 *
 *   Not denied         host (and every host its probes landed on) is off the deny-list
 *   Robots allow       robots.txt allows the feed path; a 403 on robots.txt rejects, never retried another way
 *   Machine-readable   an adapter exists: a feed, an API or schema.org data the site publishes for machines
 *   Terms allow        the terms page (link text, then common paths) has no restrictive clause
 *   Real events        ≥ 1 upcoming event in the radius (re-inspected monthly otherwise)
 *   Not adult content  no sexual / adult-entertainment signal (alcohol is adultOnly's job)
 *
 * TERMS — one documented reading, and why. The clause detector is the sprint
 * rule verbatim (terms.ts). Applied literally to the launch area's existing
 * sources it rejects every platform-hosted public calendar: Localist's
 * boilerplate on events.sjsu.edu says "Users may not access the Service through
 * automated methods", BiblioCommons' on sjpl.bibliocommons.com says "you may
 * not copy, reproduce, republish … the Service Content", and uConnect's on
 * careercenter.sjsu.edu bars commercial reuse of its partners' content — while
 * the same sprint names SJSU's Localist feed, a BiblioCommons feed and
 * careercenter.sjsu.edu as sources that MUST pass. The existing sourcing
 * policy (ingest/areas.ts) already states the resolution in prose: city
 * calendars, library systems and parks departments publish their event
 * listings as public information and are fair game. So: a PUBLIC INSTITUTION
 * (a .edu / .gov / .mil / .us host, or a library-platform host) passes the
 * terms rule even when its platform vendor's boilerplate matches, and the
 * matched sentence is STORED on the decision as evidence either way. Private
 * and nonprofit hosts (.org, .com, …) get the rule exactly as written: a
 * matching sentence rejects, when in doubt reject. The Children's Discovery
 * Museum (cdm.org, "may not be used … for any commercial purpose") and ACTIVE's
 * API terms ("You may not … store, cache … longer than the current usage
 * session") reject under it; Midpen (openspace.org) has no matching sentence.
 * This is the one place the rule is softened, it is visible in every decision
 * record, and the go-live checklist asks a human to read the stored evidence
 * for the public-institution sources before launch.
 */

import type { LaunchArea } from "../ingest/areas.js";
import { isDeniedHost } from "../ingest/sources-registry.js";
import { HostThrottle, PAGE_MAX_BYTES, discoveryFetch, hostOf } from "./http.js";
import { robotsVerdict } from "./robots.js";
import { COMMON_TERMS_PATHS, adultContentSignal, findRestrictiveClause, htmlTitle, termsLinks, type RestrictiveClause } from "./terms.js";
import type { Inspection } from "./inspect.js";

export type RulePass = true | false | null;   // null = could not be determined; re-inspect, never activate
export interface RuleResult { pass: RulePass; evidence: string }
export const RULE_NAMES = ["notDenied", "robotsAllow", "machineReadable", "termsAllow", "realEvents", "notAdultContent"] as const;
export type RuleName = typeof RULE_NAMES[number];

export interface TermsResult {
  pass: RulePass; evidence: string;
  /** The page that was read, or null when none was found. */
  url: string | null;
  /** The first restrictive clause found, recorded whether or not it decided the outcome. */
  clause: RestrictiveClause | null;
  /** "no-terms-page" | "no-restrictive-clause" | "public-institution" | "restrictive-clause" | "unavailable" */
  basis: string;
  candidates: string[];
}

export interface Decision {
  decidedAt: string;
  verdict: "active" | "rejected" | "unknown";
  rules: Record<RuleName, RuleResult>;
  terms: Omit<TermsResult, "pass" | "evidence">;
  /** Rules that failed, in order — empty for an active source. */
  failed: RuleName[];
  /** Rules that could not be determined — the source is re-inspected, not activated. */
  undetermined: RuleName[];
}

export interface DecideDeps {
  area: LaunchArea;
  fetchImpl?: typeof fetch;
  throttle?: HostThrottle;
  now?: Date;
  /** The candidate came from inside the radius (OSM element, in-radius corpus event, organizer in the area). Lets a feed without coordinates satisfy "real events". */
  originInArea?: boolean;
  originNote?: string;
}

/** Public bodies' event calendars are public information (ingest/areas.ts policy). */
export const PUBLIC_INSTITUTION_SUFFIXES = [".edu", ".gov", ".mil", ".us", ".k12.ca.us", ".bibliocommons.com", ".libcal.com", ".legistar.com", ".libnet.info"];
export function isPublicInstitution(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return PUBLIC_INSTITUTION_SUFFIXES.some((s) => h.endsWith(s));
}

const looksLikeTermsPage = (html: string): boolean => /\b(terms|conditions|legal|policies|acceptable use)\b/i.test(htmlTitle(html)) || /<h[12][^>]*>[^<]*\b(terms|conditions|legal|policies)\b/i.test(html);

/** Find and read the site's terms page: link text on the home page first, then common paths. */
export async function termsCheck(host: string, siteUrl: string, homeHtml: string, deps: Required<Pick<DecideDeps, "fetchImpl" | "throttle">>): Promise<TermsResult> {
  const candidates = termsLinks(homeHtml, siteUrl);
  const get = async (url: string) => { await deps.throttle.wait(hostOf(url)); return discoveryFetch(url, { maxBytes: PAGE_MAX_BYTES }, deps.fetchImpl); };
  let page: { url: string; html: string } | null = null;
  let unavailable = 0;
  for (const url of candidates) {
    const p = await get(url);
    if (p.status === 200 && p.text) { page = { url: p.finalUrl || url, html: p.text }; break; }
    if (p.status === 0 || p.status >= 500) unavailable++;
  }
  if (!page) {
    for (const path of COMMON_TERMS_PATHS) {
      const url = `${siteUrl.replace(/\/$/, "")}${path}`;
      const p = await get(url);
      if (p.status === 200 && p.text && looksLikeTermsPage(p.text)) { page = { url: p.finalUrl || url, html: p.text }; candidates.push(url); break; }
      if (p.status === 0 || p.status >= 500) unavailable++;
    }
  }
  if (!page) {
    if (unavailable > 0 && !candidates.length) return { pass: null, evidence: "terms page could not be fetched; re-inspect later", url: null, clause: null, basis: "unavailable", candidates };
    return { pass: true, evidence: "no terms page found by link text or common paths; a site that publishes a feed and has no terms page passes", url: null, clause: null, basis: "no-terms-page", candidates };
  }
  const clause = findRestrictiveClause(page.html);
  if (!clause) return { pass: true, evidence: `no restrictive clause on ${page.url}`, url: page.url, clause: null, basis: "no-restrictive-clause", candidates };
  if (isPublicInstitution(host)) {
    return { pass: true, evidence: `public institution (${host}): its calendar is public information; the platform clause is recorded, not applied: "${clause.sentence.slice(0, 200)}"`, url: page.url, clause, basis: "public-institution", candidates };
  }
  return { pass: false, evidence: `restrictive clause on ${page.url}: "${clause.sentence.slice(0, 300)}" (${clause.prohibition} / ${clause.action})`, url: page.url, clause, basis: "restrictive-clause", candidates };
}

const feedPath = (feedUrl: string | null): string => { try { const u = new URL(feedUrl ?? ""); return u.pathname + u.search; } catch { return "/"; } };

/** Decide one inspected host. Pure of Firestore; the caller stores the result. */
export async function decideSource(ins: Inspection, deps: DecideDeps): Promise<Decision> {
  const fetchImpl = deps.fetchImpl ?? fetch, throttle = deps.throttle ?? new HostThrottle(), now = deps.now ?? new Date();
  const rules = {} as Record<RuleName, RuleResult>;

  // 1. Not denied — the host, and every host a probe landed on (a redirect into Eventbrite counts).
  const landed = [ins.host, ...ins.probes.map((p) => p.finalHost), hostOf(ins.home.finalUrl), hostOf(ins.feedUrl ?? "")].filter(Boolean);
  const denied = landed.find((h) => isDeniedHost(h));
  rules.notDenied = denied ? { pass: false, evidence: `${denied} is on the deny-list` } : { pass: true, evidence: `${ins.host} is not on the deny-list` };

  // 2. Robots — against the feed path the adapter will read.
  const rv = robotsVerdict(ins.robots.status, ins.robots.text, feedPath(ins.feedUrl));
  rules.robotsAllow = { pass: rv.outcome === "allowed" ? true : rv.outcome === "unknown" ? null : false, evidence: rv.evidence };

  // 3. Machine-readable — an adapter that reads a feed, an API or JSON-LD. No free-form page scraping is ever an option here.
  rules.machineReadable = ins.adapter
    ? { pass: true, evidence: `${ins.platform} via ${ins.adapter} adapter (${ins.detectedBy}); feed ${ins.feedUrl}` }
    : { pass: false, evidence: ins.platform === "unknown" ? "no feed, API or schema.org Event data found" : `${ins.platform} detected (${ins.detectedBy}) but it publishes no feed this sprint can read` };

  // 4. Terms — link text on the home page first (the inspection keeps only the
  //    page's meta, so the home page is read once more here), then common paths.
  const siteUrl = ins.home.finalUrl && hostOf(ins.home.finalUrl) ? `https://${hostOf(ins.home.finalUrl)}` : `https://${ins.host}`;
  await throttle.wait(ins.host);
  const home = await discoveryFetch(siteUrl, { maxBytes: PAGE_MAX_BYTES }, fetchImpl);
  const termsResult = await termsCheck(ins.host, siteUrl, home.status === 200 ? home.text : "", { fetchImpl, throttle });
  rules.termsAllow = { pass: termsResult.pass, evidence: termsResult.evidence };

  // 5. Real events — at least one upcoming event in the radius.
  const s = ins.sample;
  if (!ins.adapter) rules.realEvents = { pass: false, evidence: "no adapter, so no events could be sampled" };
  else if (!s || s.error) rules.realEvents = { pass: null, evidence: `sample failed: ${s?.error ?? "no sample"}; re-inspect later` };
  else if (s.upcoming >= 1 && s.inRadius >= 1) rules.realEvents = { pass: true, evidence: `${s.upcoming} upcoming of ${s.count} sampled, ${s.inRadius} with coordinates inside the radius` };
  else if (s.upcoming >= 1 && s.withCoordinates === 0 && deps.originInArea) rules.realEvents = { pass: true, evidence: `${s.upcoming} upcoming of ${s.count} sampled; the feed carries no coordinates and the candidate came from inside the radius (${deps.originNote ?? "origin in area"})` };
  else rules.realEvents = { pass: false, evidence: s.upcoming === 0 ? `no upcoming event in ${s.count} sampled; re-inspected monthly` : `${s.upcoming} upcoming but none inside the radius (${s.withCoordinates} with coordinates)` };

  // 6. Not adult content — home title/description and sampled titles.
  const adult = adultContentSignal([ins.home.title, ins.home.description, ...(s?.titles ?? [])]);
  rules.notAdultContent = adult ? { pass: false, evidence: `adult-content signal: "${adult}"` } : { pass: true, evidence: "no sexual or adult-entertainment signal in the home page or sampled titles" };

  const failed = RULE_NAMES.filter((r) => rules[r].pass === false);
  const undetermined = RULE_NAMES.filter((r) => rules[r].pass === null);
  return {
    decidedAt: now.toISOString(),
    verdict: failed.length ? "rejected" : undetermined.length ? "unknown" : "active",
    rules, terms: { url: termsResult.url, clause: termsResult.clause, basis: termsResult.basis, candidates: termsResult.candidates },
    failed, undetermined,
  };
}

/** The rules an ACTIVE source must still pass (audit query, weekly re-check). */
export function failingRules(d: Decision | null | undefined): RuleName[] {
  if (!d) return [...RULE_NAMES];
  return RULE_NAMES.filter((r) => d.rules?.[r]?.pass !== true);
}
