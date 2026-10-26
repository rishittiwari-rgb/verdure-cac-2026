/**
 * iCalendar (.ics) parser — the one piece of code that turns every public
 * library, city, parks and community-centre calendar into Verdure events.
 *
 * Scope: RFC 5545 VEVENTs as published by Springshare LibCal, Google Calendar,
 * Outlook and most municipal CMSs — line unfolding, property parameters
 * (TZID, VALUE=DATE), text unescaping, GEO, CATEGORIES, and a bounded RRULE
 * expansion (DAILY/WEEKLY with INTERVAL/BYDAY/COUNT/UNTIL, plus EXDATE), which
 * covers the recurring "Storytime every Tuesday" pattern civic feeds use.
 * Anything more exotic is skipped rather than guessed — a wrong date is worse
 * than a missing event.
 *
 * Dependency-free on purpose: one less package to audit for a function that
 * runs on a schedule with a vendor key next to it.
 */

import { zonedToUtc } from "./normalize.js";

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url?: string;
  categories: string[];
  start: Date;
  end?: Date;
  allDay: boolean;
  geo?: { lat: number; lng: number };
  organizer?: string;
  /** RFC 5545 STATUS: CONFIRMED | TENTATIVE | CANCELLED. */
  status?: string;
  /** For expanded recurrences: the occurrence start as ISO, appended to the uid. */
  recurrenceId?: string;
}

interface Prop { name: string; params: Record<string, string>; value: string; }

/** RFC 5545 §3.1: a line starting with a space or tab continues the previous one. */
export function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else if (line.length) {
      out.push(line);
    }
  }
  return out;
}

function parseProp(line: string): Prop | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

/** The first ':' outside a double-quoted parameter value. */
function findValueColon(line: string): number {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\"") inQuote = !inQuote;
    else if (c === ":" && !inQuote) return i;
  }
  return -1;
}

/** RFC 5545 §3.3.11 TEXT unescaping. */
export function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

interface ParsedDate { date: Date; allDay: boolean; }

/**
 * DATE (20260906), DATE-TIME local (20260906T100000, with TZID or the calendar's
 * default zone), or UTC (20260906T100000Z).
 */
export function parseIcsDate(value: string, params: Record<string, string>, defaultTz: string): ParsedDate | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || params.VALUE === "DATE") {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const tz = params.TZID || defaultTz;
    // Midnight local on that day — the day is what matters for an all-day event.
    return { date: zonedToUtc({ y: +m[1], m: +m[2], d: +m[3], hh: 0, mm: 0, ss: 0 }, tz), allDay: true };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!dt) return null;
  const parts = { y: +dt[1], m: +dt[2], d: +dt[3], hh: +dt[4], mm: +dt[5], ss: +(dt[6] ?? 0) };
  if (dt[7] === "Z") {
    return { date: new Date(Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss)), allDay: false };
  }
  return { date: zonedToUtc(parts, params.TZID || defaultTz), allDay: false };
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Expand an RRULE into occurrence starts, bounded by `horizonEnd` and a hard cap.
 * Supports FREQ=DAILY|WEEKLY, INTERVAL, COUNT, UNTIL, BYDAY (weekly). Other
 * frequencies return just the first occurrence — never a guess.
 */
export function expandRRule(rrule: string, start: Date, horizonEnd: Date, cap = 60): Date[] {
  const rule: Record<string, string> = {};
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  let until: Date | null = null;
  if (rule.UNTIL) {
    const u = parseIcsDate(rule.UNTIL, {}, "UTC");
    until = u ? u.date : null;
  }
  const limit = (d: Date) => d.getTime() <= horizonEnd.getTime() && (!until || d.getTime() <= until.getTime());

  const out: Date[] = [];
  if (freq !== "DAILY" && freq !== "WEEKLY") return [start];

  if (freq === "DAILY") {
    for (let i = 0; out.length < Math.min(cap, count); i++) {
      const d = new Date(start.getTime() + i * interval * 86_400_000);
      if (!limit(d)) break;
      out.push(d);
    }
    return out;
  }

  // WEEKLY
  const byDay = rule.BYDAY ? rule.BYDAY.split(",").map((s) => WEEKDAYS[s.replace(/^[+-]?\d+/, "")]).filter((n) => n !== undefined) : [start.getUTCDay()];
  // Walk week by week from the start's week; emit matching weekdays.
  const startDay = start.getUTCDay();
  const weekStart = new Date(start.getTime() - startDay * 86_400_000);
  for (let w = 0; out.length < Math.min(cap, count) && w < 520; w += interval) {
    for (const day of [...byDay].sort()) {
      const d = new Date(weekStart.getTime() + (w * 7 + day) * 86_400_000);
      if (d.getTime() < start.getTime()) continue;
      if (!limit(d)) { if (d.getTime() > horizonEnd.getTime()) return out; continue; }
      if (out.length >= Math.min(cap, count)) break;
      out.push(d);
    }
  }
  return out;
}

export interface ParseOptions {
  /** Zone for DATE-TIME values without TZID (X-WR-TIMEZONE is used when present). */
  defaultTimeZone: string;
  /** Occurrences are expanded up to this instant. */
  horizonEnd: Date;
  /** Drop events that ended before this instant. */
  notBefore?: Date;
}

/** Parse a whole .ics document into flat, single-occurrence events. */
export function parseIcs(text: string, opts: ParseOptions): IcsEvent[] {
  const lines = unfold(text);
  let defaultTz = opts.defaultTimeZone;
  const calTz = lines.find((l) => l.startsWith("X-WR-TIMEZONE:"));
  if (calTz) defaultTz = calTz.slice("X-WR-TIMEZONE:".length).trim() || defaultTz;

  const events: IcsEvent[] = [];
  let current: Prop[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = []; continue; }
    if (line === "END:VEVENT") {
      if (current) events.push(...buildEvents(current, defaultTz, opts));
      current = null;
      continue;
    }
    if (current) {
      const p = parseProp(line);
      if (p) current.push(p);
    }
  }
  return events;
}

function buildEvents(props: Prop[], defaultTz: string, opts: ParseOptions): IcsEvent[] {
  const get = (name: string) => props.find((p) => p.name === name);
  const dtstart = get("DTSTART");
  if (!dtstart) return [];
  const start = parseIcsDate(dtstart.value, dtstart.params, defaultTz);
  if (!start) return [];
  const dtend = get("DTEND");
  const end = dtend ? parseIcsDate(dtend.value, dtend.params, defaultTz) : null;
  const summary = unescapeText(get("SUMMARY")?.value ?? "");
  if (!summary.trim()) return [];

  const geoRaw = get("GEO")?.value;
  let geo: { lat: number; lng: number } | undefined;
  if (geoRaw) {
    const [la, ln] = geoRaw.split(";").map(Number);
    if (Number.isFinite(la) && Number.isFinite(ln) && la !== 0 && ln !== 0) geo = { lat: la, lng: ln };
  }
  const organizerProp = get("ORGANIZER");
  const organizer = organizerProp?.params.CN || undefined;

  const base: Omit<IcsEvent, "start" | "end" | "recurrenceId"> = {
    uid: get("UID")?.value?.trim() || `${summary}-${start.date.toISOString()}`,
    summary,
    description: unescapeText(get("DESCRIPTION")?.value ?? ""),
    location: unescapeText(get("LOCATION")?.value ?? ""),
    url: get("URL")?.value?.trim() || undefined,
    categories: (get("CATEGORIES")?.value ?? "").split(",").map((c) => unescapeText(c).trim()).filter(Boolean),
    allDay: start.allDay,
    geo,
    organizer,
    status: get("STATUS")?.value?.trim().toUpperCase() || undefined,
  };

  const durationMs = end ? Math.max(0, end.date.getTime() - start.date.getTime()) : 0;
  const rrule = get("RRULE")?.value;
  const exdates = new Set(
    props.filter((p) => p.name === "EXDATE")
      .flatMap((p) => p.value.split(",").map((v) => parseIcsDate(v, p.params, defaultTz)?.date.getTime()))
      .filter((t): t is number => typeof t === "number"),
  );

  const starts = rrule ? expandRRule(rrule, start.date, opts.horizonEnd) : [start.date];
  const notBefore = opts.notBefore?.getTime() ?? -Infinity;
  const out: IcsEvent[] = [];
  for (const s of starts) {
    if (exdates.has(s.getTime())) continue;
    const e = durationMs ? new Date(s.getTime() + durationMs) : undefined;
    const endsAt = e ?? new Date(s.getTime() + (start.allDay ? 86_400_000 : 0));
    if (endsAt.getTime() < notBefore) continue;
    out.push({
      ...base,
      start: s,
      end: e,
      recurrenceId: rrule ? s.toISOString() : undefined,
    });
  }
  return out;
}
