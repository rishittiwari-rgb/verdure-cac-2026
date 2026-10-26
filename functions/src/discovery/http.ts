/**
 * Discovery HTTP (W4.2–W4.4): one bounded, honest, replayable way to touch the web.
 *
 *   • the fingerprinter's user agent, 12-second timeout, response-size cap
 *   • one request per host per 10 seconds (in-process throttle)
 *   • conditional requests (If-None-Match / If-Modified-Since); a 304 is a
 *     successful, free run
 *   • record / replay: every response can be written to a fixture directory
 *     during the ONE live run per milestone, and tests replay those fixtures.
 *     A replay miss throws — a test must never reach the live internet by
 *     accident.
 *
 * Nothing here parses events; the adapters do that through `fetchImpl`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export const DISCOVERY_USER_AGENT = "Verdure-source-survey/1.0 (+https://verdure-app.com)";
export const DEFAULT_TIMEOUT_MS = 12_000;
/** Pages: platform identification and terms text need only the beginning. */
export const PAGE_MAX_BYTES = 300_000;
/** Feeds: one sample page of a feed. */
export const FEED_MAX_BYTES = 1_500_000;
export const HOST_MIN_INTERVAL_MS = 10_000;

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;            // 0 when the request itself failed
  headers: Record<string, string>;
  text: string;
  truncated: boolean;
  error?: string;
  fetchedAt: string;
}

export interface DiscoveryFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  etag?: string | null;
  lastModified?: string | null;
  method?: "GET" | "HEAD";
}

const KEPT_HEADERS = ["content-type", "etag", "last-modified", "content-length", "location", "x-robots-tag", "cache-control"];

/** Per-host spacing. One instance per job; tests pass `0`. */
export class HostThrottle {
  private readonly last = new Map<string, number>();
  constructor(private readonly minIntervalMs = HOST_MIN_INTERVAL_MS, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}
  async wait(host: string): Promise<void> {
    const now = Date.now();
    const due = (this.last.get(host) ?? 0) + this.minIntervalMs;
    if (due > now) await this.sleep(due - now);
    this.last.set(host, Math.max(now, due));
  }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
}

/**
 * A stable file-safe key for a URL (sha1) — fixture file names and cache ids.
 * Calendar dates inside a URL (start_date=2026-10-19, 20261019T000000Z, a
 * `days=` horizon) are normalised so a fixture recorded on one day replays on
 * another: the adapters embed "today" in their feed requests.
 */
export const urlKey = (url: string): string => createHash("sha1").update(normalizeForKey(url)).digest("hex");
export const normalizeForKey = (url: string): string => url
  .replace(/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g, "<date>")
  .replace(/\d{8}T\d{6}Z?/g, "<date>")
  .replace(/datetime'[^']*'/g, "datetime'<date>'");

/**
 * Fetch one URL within the limits. Never throws: failures come back with
 * status 0 and an `error`, because a failed probe is a finding, not a crash.
 */
export async function discoveryFetch(url: string, opts: DiscoveryFetchOptions = {}, fetchImpl: typeof fetch = fetch): Promise<FetchedPage> {
  const maxBytes = opts.maxBytes ?? PAGE_MAX_BYTES;
  const fetchedAt = new Date().toISOString();
  const headers: Record<string, string> = { "user-agent": DISCOVERY_USER_AGENT, accept: opts.accept ?? "text/html,application/xhtml+xml,application/json,text/calendar,application/rss+xml,application/xml;q=0.9,*/*;q=0.5" };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;
  try {
    const res = await fetchImpl(url, { method: opts.method ?? "GET", headers, redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    const kept: Record<string, string> = {};
    for (const h of KEPT_HEADERS) { const v = res.headers.get(h); if (v) kept[h] = v; }
    let text = "";
    let truncated = false;
    if (res.status !== 304 && opts.method !== "HEAD" && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (bytes >= maxBytes) { truncated = true; await reader.cancel().catch(() => {}); break; }
      }
    }
    return { url, finalUrl: res.url || url, status: res.status, headers: kept, text, truncated, fetchedAt };
  } catch (e) {
    return { url, finalUrl: url, status: 0, headers: {}, text: "", truncated: false, error: e instanceof Error ? e.message : String(e), fetchedAt };
  }
}

// ── Record / replay ─────────────────────────────────────────────────────────

interface RecordedResponse {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  recordedAt: string;
  method: string;
}

const responseFrom = (r: RecordedResponse): Response => {
  const nullBody = r.status === 204 || r.status === 304 || r.status < 200;
  const res = new Response(nullBody ? null : r.body, { status: r.status, headers: r.headers });
  Object.defineProperty(res, "url", { value: r.finalUrl });
  return res;
};

const requestUrl = (input: RequestInfo | URL): string => typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/**
 * Wrap a real fetch so every response is written to `dir` (gzipped JSON, one
 * file per URL+method). Bodies are capped so fixtures stay small; the cap is
 * recorded, and the replay reports the same truncation.
 */
export function recordingFetch(dir: string, inner: typeof fetch = fetch, bodyCap = FEED_MAX_BYTES): typeof fetch {
  mkdirSync(dir, { recursive: true });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const res = await inner(input, init);
    const body = res.status === 204 || res.status === 304 ? "" : await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { if (KEPT_HEADERS.includes(k.toLowerCase())) headers[k.toLowerCase()] = v; });
    const rec: RecordedResponse = { url, finalUrl: res.url || url, status: res.status, headers, body: body.slice(0, bodyCap), truncated: body.length > bodyCap, recordedAt: new Date().toISOString(), method };
    writeFileSync(join(dir, `${urlKey(`${method} ${url}`)}.json.gz`), gzipSync(JSON.stringify(rec)));
    return responseFrom(rec);
  }) as typeof fetch;
}

/** Serve recorded responses; a miss throws so a test can never go live by accident. */
export function replayFetch(dir: string, onMiss?: (url: string) => Response | undefined): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const file = join(dir, `${urlKey(`${method} ${url}`)}.json.gz`);
    if (!existsSync(file)) {
      const fallback = onMiss?.(url);
      if (fallback) return fallback;
      throw new Error(`replayFetch: no recorded response for ${method} ${url} (fixture dir ${dir})`);
    }
    const rec = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as RecordedResponse;
    // Honour conditional requests the way a server would: same validator → 304.
    const etag = rec.headers.etag, lastMod = rec.headers["last-modified"];
    const h = new Headers(init?.headers ?? {});
    if ((etag && h.get("if-none-match") === etag) || (lastMod && h.get("if-modified-since") === lastMod)) {
      return responseFrom({ ...rec, status: 304, body: "" });
    }
    return responseFrom(rec);
  }) as typeof fetch;
}

/** List the URLs a fixture directory holds (for evidence tables). */
export function recordedUrls(dir: string): Array<{ method: string; url: string; status: number; finalUrl: string; bytes: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json.gz")).map((f) => {
    const rec = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8")) as RecordedResponse;
    return { method: rec.method, url: rec.url, status: rec.status, finalUrl: rec.finalUrl, bytes: rec.body.length };
  });
}
