/**
 * inspectSource(host) — W4.2. Port of functions/scripts/fingerprint.mjs into
 * the server, extended with the feeds this sprint can ingest.
 *
 * Detects: LiveWhale, Localist, BiblioCommons, LibCal, Legistar, CivicPlus,
 * Trumba, plain iCal, RSS, WordPress "The Events Calendar" and schema.org
 * Event JSON-LD. For a platform with an adapter it then parses up to 25
 * events THROUGH THE REAL ADAPTER (the adapter's own fetch is wrapped so only
 * one bounded page is requested) and records the count, the date range, the
 * share with coordinates and the share inside the radius.
 *
 * Read-only. Every request goes through discoveryFetch: honest user agent,
 * 12-second timeout, size cap, one request per host per 10 seconds.
 */

import type { LaunchArea } from "../ingest/areas.js";
import { isInsideArea } from "../ingest/areas.js";
import type { NormalizedEvent, SourceId } from "../ingest/types.js";
import { fetchLocalist } from "../ingest/sources/localist.js";
import { fetchLiveWhale } from "../ingest/sources/livewhale.js";
import { fetchBiblioCommons } from "../ingest/sources/bibliocommons.js";
import { fetchLibCal } from "../ingest/sources/libcal.js";
import { fetchLegistar } from "../ingest/sources/legistar.js";
import { fetchIcsFeed } from "../ingest/sources/icsfeed.js";
import { fetchWordPressTec } from "../ingest/sources/wordpress-tec.js";
import { fetchJsonLd, extractEvents, sitemapLocs } from "../ingest/sources/jsonld.js";
import { fetchRssIcs, parseRssItems, icsUrlForPage, type RssItem } from "../ingest/sources/rss-ics.js";
import { DISCOVERY_USER_AGENT, FEED_MAX_BYTES, HostThrottle, PAGE_MAX_BYTES, discoveryFetch, hostOf, type FetchedPage } from "./http.js";

export type Platform = "livewhale" | "localist" | "bibliocommons" | "libcal" | "legistar" | "civicplus" | "trumba" | "ical" | "rss" | "wordpress-tec" | "jsonld" | "unknown";

export interface Probe { name: string; url: string; status: number; contentType: string; finalHost: string; bytes: number; hit: boolean }
export interface InspectionSample {
  count: number; upcoming: number; withCoordinates: number; inRadius: number;
  firstStart: string | null; lastStart: string | null; titles: string[]; error: string | null;
}
export interface Inspection {
  host: string; inspectedAt: string;
  platform: Platform; detectedBy: string;
  /** The adapter that can ingest it, or null (RSS/CivicPlus/Trumba-without-ical/unknown). */
  adapter: SourceId | null;
  /** The feed the adapter reads (also the path robots.txt is checked against). */
  feedUrl: string | null;
  params: Record<string, unknown> | null;
  home: { status: number; finalUrl: string; generator: string; title: string; description: string; hasEventJsonLd: boolean };
  robots: { status: number; text: string };
  probes: Probe[];
  sample: InspectionSample | null;
  requests: number;
}

export interface InspectDeps {
  area: LaunchArea;
  fetchImpl?: typeof fetch;
  throttle?: HostThrottle;
  now?: Date;
  maxSample?: number;
}

export const validHost = (host: string): boolean =>
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) && host.includes(".") && !host.includes("..") && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/i.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host);

const STANDARD_PROBES: Array<[string, string]> = [
  ["LiveWhale JSON v2", "/live/json/v2/events/max/1/hide_repeats/true"],
  ["Localist API", "/api/2/events?days=1&pp=1"],
  ["WordPress TEC REST", "/wp-json/tribe/events/v1/events?per_page=1"],
  ["iCal /events.ics", "/events.ics"],
  ["iCal /calendar.ics", "/calendar.ics"],
  ["iCal ?ical=1", "/events/?ical=1"],
  ["iCal /?ical=1", "/?ical=1"],
  ["RSS /feed", "/feed"],
  ["RSS /events/feed", "/events/feed"],
  ["CivicPlus RSS index", "/rss.aspx"],
  ["Sitemap", "/sitemap.xml"],
];

export function htmlMeta(html: string): { generator: string; title: string; description: string } {
  const generator = /<meta\b[^>]*name=["']generator["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] ?? /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']generator["']/i.exec(html)?.[1] ?? "";
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const description = /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)/i.exec(html)?.[1] ?? "";
  return { generator, title: title.slice(0, 200), description: description.slice(0, 300) };
}

const isJson = (p: FetchedPage) => p.status === 200 && /^\s*[[{]/.test(p.text);
const isIcal = (p: FetchedPage) => p.status === 200 && p.text.includes("BEGIN:VCALENDAR");
const isRss = (p: FetchedPage) => p.status === 200 && /<(rss|feed)\b/i.test(p.text.slice(0, 2000)) && /<(item|entry)\b/i.test(p.text);
const probe = (name: string, p: FetchedPage, hit: boolean): Probe => ({ name, url: p.url, status: p.status, contentType: p.headers["content-type"] ?? "", finalHost: hostOf(p.finalUrl), bytes: p.text.length, hit });

/**
 * Wrap the adapter's fetch so one inspection costs one bounded page: page sizes
 * are rewritten to the sample size and the first page's pagination is patched
 * to "one page", so the adapter stops on its own. Everything else is the
 * adapter's real code path.
 */
export function samplingFetch(adapter: SourceId, inner: typeof fetch, throttle: HostThrottle, sample: number, budget: { requests: number; max: number }): typeof fetch {
  let patchedFirst = false;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (++budget.requests > budget.max) throw new Error(`inspection request budget (${budget.max}) exceeded`);
    url = url.replace(/([?&]pp=)\d+/, `$1${sample}`).replace(/([?&]per_page=)\d+/, `$1${sample}`).replace(/([?&]limit=)\d+/, `$1${sample}`).replace(/\/paginate\/\d+\//, `/paginate/${sample}/`).replace(/\/max\/\d+\//, `/max/${sample}/`);
    await throttle.wait(hostOf(url));
    const headers = new Headers(init?.headers ?? {});
    headers.set("user-agent", DISCOVERY_USER_AGENT);
    const res = await inner(url, { ...init, headers, signal: AbortSignal.timeout(12_000) });
    if (patchedFirst || !res.ok || !/json/i.test(res.headers.get("content-type") ?? "") && !["localist", "livewhale", "bibliocommons", "wordpress-tec"].includes(adapter)) return res;
    patchedFirst = true;
    let body: unknown;
    const text = (await res.text()).slice(0, FEED_MAX_BYTES);
    try { body = JSON.parse(text); } catch { return new Response(text, { status: res.status, headers: res.headers }); }
    const o = body as Record<string, any>;
    if (adapter === "bibliocommons" && o.events?.pagination) o.events.pagination.pages = 1;
    if (adapter === "localist" && o.page) o.page.total = Array.isArray(o.events) ? o.events.length : 0;
    if (adapter === "livewhale" && o.meta) { o.meta.total_pages = 1; o.meta.total_results = Array.isArray(o.data) ? o.data.length : 0; }
    if (adapter === "wordpress-tec" && "total_pages" in o) o.total_pages = 1;
    const out = new Response(JSON.stringify(o), { status: res.status, headers: res.headers });
    Object.defineProperty(out, "url", { value: res.url });
    return out;
  }) as typeof fetch;
}

/** Run the real adapter for a bounded sample. */
export async function sampleThroughAdapter(adapter: SourceId, params: Record<string, unknown>, deps: Required<Pick<InspectDeps, "area" | "fetchImpl" | "throttle" | "now" | "maxSample">>, budget: { requests: number; max: number }): Promise<NormalizedEvent[]> {
  const f = samplingFetch(adapter, deps.fetchImpl, deps.throttle, deps.maxSample, budget);
  const { area, now } = deps;
  const p = params as any;
  switch (adapter) {
    case "localist": return fetchLocalist(area, String(p.host), String(p.name), f);
    case "livewhale": return fetchLiveWhale(area, String(p.host), String(p.name), f, now);
    // The adapter accepts page sizes of 50–150 only; samplingFetch rewrites the URL's limit= to the sample size.
    case "bibliocommons": return fetchBiblioCommons(area, { name: String(p.name), library: String(p.library), host: p.host, pageSize: Math.min(150, Math.max(50, deps.maxSample)) }, f);
    case "libcal": return fetchLibCal(area, { name: String(p.name), calendarId: String(p.calendarId), rssUrl: String(p.rssUrl) }, f);
    case "legistar": return fetchLegistar(area, String(p.client), String(p.name), f);
    case "ics": return fetchIcsFeed(area, { name: String(p.name), url: String(p.url) }, "ics", f);
    case "wordpress-tec": return fetchWordPressTec(area, { name: String(p.name), siteUrl: String(p.siteUrl) }, f, now);
    case "jsonld": return fetchJsonLd(area, { name: String(p.name), siteUrl: String(p.siteUrl), sitemapUrl: p.sitemapUrl, maxPages: 3 }, f, now);
    case "rss-ics": return fetchRssIcs(area, { name: String(p.name), feedUrl: String(p.feedUrl), maxPages: 1 }, f, now);
    default: return [];
  }
}

export function summarizeSample(records: NormalizedEvent[], area: LaunchArea, now: Date, cap: number): InspectionSample {
  const rows = records.slice(0, cap);
  const starts = rows.map((r) => r.start.getTime()).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const withCoordinates = rows.filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number").length;
  const inRadius = rows.filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number" && isInsideArea(area, r.latitude, r.longitude, 0)).length;
  return {
    count: rows.length, upcoming: rows.filter((r) => (r.end ?? r.start).getTime() >= now.getTime()).length, withCoordinates, inRadius,
    firstStart: starts.length ? new Date(starts[0]).toISOString() : null, lastStart: starts.length ? new Date(starts[starts.length - 1]).toISOString() : null,
    titles: rows.slice(0, 8).map((r) => r.title), error: null,
  };
}

/** The site's name from its title: the part before a spaced separator (" | ", " – ", " - "); an in-word hyphen ("Tri-C") is kept. */
const displayName = (host: string, title: string) => (title.split(/\s+[|–—-]\s+|\s*[|–—]\s*/)[0].trim() || host).slice(0, 80);

/** Inspect one host. Never throws for network reasons: a failed probe is a finding. */
export async function inspectSource(host: string, deps: InspectDeps): Promise<Inspection> {
  const fetchImpl = deps.fetchImpl ?? fetch, throttle = deps.throttle ?? new HostThrottle(), now = deps.now ?? new Date(), maxSample = deps.maxSample ?? 25;
  host = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const inspectedAt = now.toISOString();
  const empty: Inspection = { host, inspectedAt, platform: "unknown", detectedBy: "", adapter: null, feedUrl: null, params: null, home: { status: 0, finalUrl: "", generator: "", title: "", description: "", hasEventJsonLd: false }, robots: { status: 0, text: "" }, probes: [], sample: null, requests: 0 };
  if (!validHost(host)) return { ...empty, detectedBy: "invalid hostname" };
  const budget = { requests: 0, max: 40 };
  const get = async (url: string, maxBytes = PAGE_MAX_BYTES) => { budget.requests++; await throttle.wait(hostOf(url)); return discoveryFetch(url, { maxBytes }, fetchImpl); };
  const base = `https://${host}`;
  let home = await get(base);
  // A host whose home page redirects elsewhere (www., a new domain) is inspected where it lands.
  const sameDomain = (h: string) => !!h && h !== host && h.endsWith(host.split(".").slice(-2).join("."));
  const landed = hostOf(home.finalUrl);
  let site = sameDomain(landed) ? `https://${landed}` : base;
  let robots = await get(`${site}/robots.txt`, 60_000);
  // A host that refuses its apex but serves www. (cdm.org answered 403 to every apex page while
  // its robots.txt redirected to www.cdm.org) is inspected where robots.txt lands, so its terms
  // page and feed are read rather than 20 identical 403s.
  if ((home.status === 0 || home.status >= 400) && site === base && sameDomain(hostOf(robots.finalUrl))) {
    site = `https://${hostOf(robots.finalUrl)}`;
    home = await get(site);
    robots = await get(`${site}/robots.txt`, 60_000);
  }
  const meta = htmlMeta(home.text);
  const hasEventJsonLd = extractEvents(home.text).length > 0;
  const probes: Probe[] = [];
  const results: Record<string, FetchedPage> = {};
  const list: Array<[string, string]> = [...STANDARD_PROBES];
  if (host.endsWith(".libcal.com")) {
    const cal = await get(`${site}/calendar`);
    const cid = /<option\s+value="(\d+)"\s+data-cal_id="\1"/i.exec(cal.text)?.[1] ?? /[?&]cid=(\d+)/.exec(cal.text)?.[1];
    if (cid) list.push(["LibCal RSS", `/rss.php?m=month&cid=${cid}`]);
  }
  if (host.endsWith(".legistar.com") && host !== "webapi.legistar.com") list.push(["Legistar Events API", `https://webapi.legistar.com/v1/${host.split(".")[0]}/events?$top=1`]);
  if (host.endsWith(".bibliocommons.com")) list.push(["BiblioCommons gateway", `https://gateway.bibliocommons.com/v2/libraries/${host.split(".")[0]}/events?limit=1`]);
  for (const [name, path] of list) {
    const url = path.startsWith("https://") ? path : `${site}${path}`;
    const p = await get(url, name === "Sitemap" ? PAGE_MAX_BYTES : 120_000);
    results[name] = p;
    const hit = name.startsWith("iCal") ? isIcal(p) : name.startsWith("RSS") ? isRss(p)
      : name === "CivicPlus RSS index" ? p.status === 200 && /RSSFeed\.aspx|ModID=/i.test(p.text)
      : name === "Sitemap" ? p.status === 200 && /<(urlset|sitemapindex)\b/i.test(p.text)
      : name === "LiveWhale JSON v2" ? isJson(p) && /"meta"\s*:\s*\{|"data"\s*:\s*\[/.test(p.text)
      : name === "Localist API" ? isJson(p) && /"events"\s*:\s*\[/.test(p.text)
      : name === "WordPress TEC REST" ? isJson(p) && /"events"\s*:\s*\[/.test(p.text) && /"total_pages"|"rest_url"/.test(p.text)
      : name === "LibCal RSS" ? p.status === 200 && /<rss\b/i.test(p.text)
      : name === "Legistar Events API" ? isJson(p) && /^\s*\[/.test(p.text)
      : name === "BiblioCommons gateway" ? isJson(p) && /"events"\s*:/.test(p.text)
      : p.status === 200;
    probes.push(probe(name, p, hit));
  }
  const hit = (name: string) => probes.find((x) => x.name === name)?.hit === true;
  const name = displayName(host, meta.title);
  let platform: Platform = "unknown", detectedBy = "no positive platform signal", adapter: SourceId | null = null, feedUrl: string | null = null, params: Record<string, unknown> | null = null;
  const siteHost = hostOf(site) || host;
  if (host.endsWith(".bibliocommons.com") && hit("BiblioCommons gateway")) {
    platform = "bibliocommons"; detectedBy = "host + gateway API"; adapter = "bibliocommons"; const library = host.split(".")[0];
    feedUrl = `https://gateway.bibliocommons.com/v2/libraries/${library}/events`; params = { name, library, host, tags: ["library"] };
  } else if (host.endsWith(".libcal.com") && hit("LibCal RSS")) {
    platform = "libcal"; detectedBy = "calendar host + RSS"; adapter = "libcal"; const cid = /cid=(\d+)/.exec(results["LibCal RSS"].url)?.[1] ?? "";
    feedUrl = results["LibCal RSS"].url; params = { name, calendarId: cid, rssUrl: feedUrl, tags: ["library"] };
  } else if (hit("Legistar Events API")) {
    platform = "legistar"; detectedBy = "public Web API"; adapter = "legistar"; const client = host.split(".")[0];
    feedUrl = `https://webapi.legistar.com/v1/${client}/events`; params = { client, name };
  } else if (/livewhale/i.test(meta.generator) && hit("LiveWhale JSON v2") || hit("LiveWhale JSON v2")) {
    platform = "livewhale"; detectedBy = /livewhale/i.test(meta.generator) ? "meta generator + JSON v2" : "JSON v2 feed"; adapter = "livewhale";
    feedUrl = `${site}/live/json/v2/events`; params = { host: siteHost, name };
  } else if (hit("Localist API")) {
    platform = "localist"; detectedBy = /localist/i.test(meta.generator) ? "meta generator + API" : "API response"; adapter = "localist";
    feedUrl = `${site}/api/2/events`; params = { host: siteHost, name };
  } else if (hit("WordPress TEC REST")) {
    platform = "wordpress-tec"; detectedBy = "tribe/events REST route"; adapter = "wordpress-tec"; feedUrl = results["WordPress TEC REST"].url.replace(/\?.*$/, ""); params = { name, siteUrl: site };
  } else if (hit("RSS /events/feed") && await (async () => {
    // W4.5 rss-ics: an RSS feed of event pages whose first item has a per-event iCalendar export.
    let items: RssItem[] = [];
    try { items = parseRssItems(results["RSS /events/feed"].text); } catch { return false; }
    const link = items.find((i) => /^https?:\/\//.test(i.link))?.link;
    if (!link || hostOf(link) !== siteHost && !hostOf(link).endsWith(host)) return false;
    const ics = await get(icsUrlForPage(link), 120_000);
    probes.push(probe("Per-event iCal export", ics, ics.status === 200 && ics.text.includes("BEGIN:VCALENDAR")));
    return probes[probes.length - 1].hit;
  })()) {
    platform = "rss"; detectedBy = "RSS /events/feed + per-event iCal export"; adapter = "rss-ics";
    feedUrl = results["RSS /events/feed"].url; params = { name, feedUrl };
  } else if (/trumba\.com/i.test(home.text) || /\/month\/categories\//i.test(home.text)) {
    platform = "trumba"; detectedBy = "Trumba embed";
    const webName = /webName\s*:\s*["']([^"']+)["']/i.exec(home.text)?.[1];
    if (webName) { adapter = "ics"; feedUrl = `https://www.trumba.com/calendars/${webName}.ics`; params = { name, url: feedUrl }; detectedBy += " (iCal export)"; }
  } else if (["iCal /events.ics", "iCal /calendar.ics", "iCal ?ical=1", "iCal /?ical=1"].some(hit)) {
    const which = ["iCal /events.ics", "iCal /calendar.ics", "iCal ?ical=1", "iCal /?ical=1"].find(hit)!;
    platform = "ical"; detectedBy = which; adapter = "ics"; feedUrl = results[which].url; params = { name, url: feedUrl };
  } else if (hasEventJsonLd) {
    platform = "jsonld"; detectedBy = "schema.org Event on the home page"; adapter = "jsonld"; feedUrl = hit("Sitemap") ? results["Sitemap"].url : `${site}/sitemap.xml`; params = { name, siteUrl: site, sitemapUrl: feedUrl };
  } else if (hit("Sitemap")) {
    // One event page from the sitemap decides whether the site publishes Event JSON-LD.
    const { urls, sitemaps } = sitemapLocs(results["Sitemap"].text);
    let candidates = urls.filter((u) => /\/(events?|calendar|whats-on|happenings|shows?|performances?|exhibitions?)\/[^/?#]+/i.test(u));
    if (!candidates.length) for (const sm of sitemaps.filter((u) => /event|calendar|show/i.test(u)).slice(0, 2)) { const p = await get(sm); candidates = candidates.concat(sitemapLocs(p.text).urls.filter((u) => /\/(events?|calendar|whats-on|happenings|shows?|performances?|exhibitions?)\/[^/?#]+/i.test(u))); }
    if (candidates.length) {
      const page = await get(candidates[0]);
      probes.push(probe("Event page JSON-LD", page, extractEvents(page.text).length > 0));
      if (probes[probes.length - 1].hit) { platform = "jsonld"; detectedBy = "schema.org Event on a sitemap-listed event page"; adapter = "jsonld"; feedUrl = results["Sitemap"].url; params = { name, siteUrl: site, sitemapUrl: feedUrl }; }
    }
  }
  if (platform === "unknown") {
    if (hit("CivicPlus RSS index") || /civicplus/i.test(meta.generator)) { platform = "civicplus"; detectedBy = hit("CivicPlus RSS index") ? "RSS index" : "meta generator"; }
    else if (["RSS /feed", "RSS /events/feed"].some(hit)) { platform = "rss"; detectedBy = ["RSS /feed", "RSS /events/feed"].find(hit)!; }
  }
  let sample: InspectionSample | null = null;
  if (adapter && params) {
    try {
      const records = await sampleThroughAdapter(adapter, params, { area: deps.area, fetchImpl, throttle, now, maxSample }, budget);
      sample = summarizeSample(records, deps.area, now, maxSample);
    } catch (e) {
      sample = { count: 0, upcoming: 0, withCoordinates: 0, inRadius: 0, firstStart: null, lastStart: null, titles: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
  }
  return {
    host, inspectedAt, platform, detectedBy, adapter, feedUrl, params,
    home: { status: home.status, finalUrl: home.finalUrl, generator: meta.generator, title: meta.title, description: meta.description, hasEventJsonLd },
    robots: { status: robots.status, text: robots.text.slice(0, 20_000) },
    probes, sample, requests: budget.requests,
  };
}
