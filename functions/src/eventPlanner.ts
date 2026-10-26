/** Event planner: a model sequences verified event IDs from Verdure's own
 * ranker. Every model ID is checked against candidate documents before return.
 * Refinements stay in Firestore and do not spend another model call. */
import { modelKey } from "./model-key.js";
import { randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db, requireUid, enforceRateLimit, safeText, plusActiveFrom } from "./common.js";
import { haversineMiles } from "./ranking.js";
import { recommendEligibleFor as recommendFor } from "./program-feed.js";
import { FREE_PLANS_PER_MONTH, PLAN_VENDOR_COST_CENTS, monthKey, nextMonthISO } from "./adventure.js";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ADVENTURE_MODEL = defineString("ADVENTURE_MODEL", { default: "claude-sonnet-5" });

export interface EventPlanCandidate {
  id: string; title: string; category: string; organizer: string;
  startMs: number; locationName: string; isFree: boolean; priceMin?: number;
  latitude?: number; longitude?: number; ageSuitability?: string;
  social: number; description?: string;
  /** Runs the whole local day (BiblioCommons: midnight start, 23:59:59 end, "12:00 AM"). */
  allDay?: boolean;
}

/** A day-long listing: labelled "All day", or a local-midnight start that ends 20+ hours later. */
export function isAllDayListing(startMs: number, endMs: number | undefined, time: string | undefined): boolean {
  if ((time ?? "").trim().toLowerCase() === "all day") return true;
  const hm = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(startMs);
  return hm === "00:00" && endMs !== undefined && endMs - startMs >= 20 * 3_600_000;
}

export interface EventPlanRequest {
  when: string; who: string; distance: string; budget: string; note: string;
  targetDate?: string; lat?: number; lng?: number; nowMs: number;
}

function datePart(ms: number, kind: "day" | "weekday"): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles",
    ...(kind === "day" ? { year: "numeric", month: "2-digit", day: "2-digit" } : { weekday: "short" }) }).format(ms);
}

function localISODate(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function thisWeekendDates(nowMs: number): { saturday: string; monday: string } {
  const weekday = datePart(nowMs, "weekday");
  const daysToSaturday: Record<string, number> = {
    Sun: -1, Mon: 5, Tue: 4, Wed: 3, Thu: 2, Fri: 1, Sat: 0,
  };
  const localDay = localISODate(nowMs);
  // Calendar arithmetic on ISO dates avoids crossing a DST change by adding
  // a fixed number of milliseconds to an actual Los Angeles timestamp.
  const dateAtUTCNoon = Date.parse(`${localDay}T12:00:00Z`);
  const saturday = new Date(dateAtUTCNoon + daysToSaturday[weekday] * 86_400_000);
  const monday = new Date(saturday.getTime() + 2 * 86_400_000);
  return { saturday: saturday.toISOString().slice(0, 10), monday: monday.toISOString().slice(0, 10) };
}

/** Pure eligibility and ordering. A sparse result is honest and prompts widening. */
export function selectPlanCandidates(rows: EventPlanCandidate[], req: EventPlanRequest): EventPlanCandidate[] {
  const nowDay = localISODate(req.nowMs);
  const tomorrowDay = new Date(Date.parse(`${nowDay}T12:00:00Z`) + 86_400_000)
    .toISOString().slice(0, 10);
  const weekend = thisWeekendDates(req.nowMs);
  const note = req.note.toLowerCase();
  return rows.filter((e) => {
    if (e.startMs < req.nowMs) return false;
    const eventDay = localISODate(e.startMs);
    if (req.when === "Tonight" && eventDay !== nowDay) return false;
    if (req.when === "Tomorrow" && eventDay !== tomorrowDay) return false;
    if (req.when === "Pick a date" && eventDay !== req.targetDate) return false;
    if (req.when === "This weekend") {
      if (eventDay < weekend.saturday || eventDay >= weekend.monday) return false;
    }
    if (req.who === "With kids" && !["children", "all"].includes(e.ageSuitability ?? "")) return false;
    if (req.budget === "Free" && !e.isFree) return false;
    if (req.budget === "Under $20" && !e.isFree && (e.priceMin === undefined || e.priceMin > 20)) return false;
    if (note && !`${e.title} ${e.description ?? ""} ${e.category} ${e.locationName}`.toLowerCase().includes(note)) return false;
    if (req.distance !== "Anywhere nearby") {
      if (req.lat === undefined || req.lng === undefined || e.latitude === undefined || e.longitude === undefined) return false;
      const miles = haversineMiles(req.lat, req.lng, e.latitude, e.longitude);
      if (req.distance === "Walking" && miles > 1.5) return false;
      if (req.distance === "Short drive" && miles > 12) return false;
    }
    return true;
  }).slice(0, 25);
}

/** Prefer events not used in recent sessions, but never fabricate supply when
 * an area has only a few real events. */
export function avoidRecentPlanEvents(rows: EventPlanCandidate[], recent: string[]): EventPlanCandidate[] {
  const fresh = rows.filter((e) => !recent.includes(e.id));
  return fresh.length >= 2 ? fresh : rows;
}

/** A tool result can reorder or explain, but it cannot create a stop. */
export function validateModelStops(input: unknown, candidates: EventPlanCandidate[]): Array<{ eventId: string; why: string }> {
  const allowed = new Set(candidates.map((c) => c.id));
  const seen = new Set<string>();
  const list = Array.isArray(input) ? input : [];
  return list.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const id = safeText(value.eventId, 180);
    if (!allowed.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ eventId: id, why: safeText(value.why, 220) || "A real event that fits your choices." }];
  }).slice(0, 3);
}

/** Deterministic, model-free refinement over the same verified candidates. */
export function refineSelection(selected: string[], candidates: EventPlanCandidate[], action: string,
  targetId: string, lat?: number, lng?: number): string[] {
  const next = [...selected];
  if (action === "shorter") {
    if (next.length < 2) throw new HttpsError("failed-precondition", "The plan is already short.");
    next.pop(); return next;
  }
  if (action === "remove") {
    if (!next.includes(targetId)) throw new HttpsError("invalid-argument", "Choose a stop to remove.");
    return next.filter((id) => id !== targetId);
  }
  const available = candidates.filter((e) => !next.includes(e.id));
  if (action === "longer") {
    if (next.length >= 4 || !available.length) throw new HttpsError("failed-precondition", "No more matching events.");
    next.push(available[0].id); return next;
  }
  const index = next.indexOf(targetId);
  const target = candidates.find((e) => e.id === targetId);
  if (index < 0 || !target) throw new HttpsError("invalid-argument", "Choose a stop to change.");
  const distance = (e: EventPlanCandidate) => lat !== undefined && lng !== undefined &&
    e.latitude !== undefined && e.longitude !== undefined
    ? haversineMiles(lat, lng, e.latitude, e.longitude) : Infinity;
  const cost = (e: EventPlanCandidate) => e.isFree ? 0 : e.priceMin ?? Infinity;
  const choices = available.filter((e) => {
    if (action === "earlier") return e.startMs < target.startMs;
    if (action === "later") return e.startMs > target.startMs;
    if (action === "cheaper") return cost(e) < cost(target);
    if (action === "closer") return distance(e) < distance(target);
    if (action === "more") return e.category === target.category;
    if (action === "different") return e.category !== target.category;
    return true;
  });
  if (!choices.length) throw new HttpsError("failed-precondition", "No better matching event. Try wider choices.");
  next[index] = choices[0].id;
  return next;
}

async function sequenceWithModel(candidates: EventPlanCandidate[], key: string): Promise<{
  title: string; intro: string; stops: Array<{ eventId: string; why: string }>;
}> {
  const tool = { name: "event_plan", description: "Sequence real event IDs into a short plan.",
    input_schema: { type: "object", properties: {
      title: { type: "string" }, intro: { type: "string" },
      stops: { type: "array", items: { type: "object", properties: {
        eventId: { type: "string" }, why: { type: "string" },
      }, required: ["eventId", "why"] } },
    }, required: ["title", "intro", "stops"] } };
  const lines = candidates.slice(0, 15).map((e) =>
    `${e.id} | ${e.title} | ${new Date(e.startMs).toISOString()} | ${e.locationName} | ${e.category} | ${e.isFree ? "free" : "paid"} | friend signal ${e.social > 0 ? "yes" : "no"}`).join("\n");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(25_000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ADVENTURE_MODEL.value(), max_tokens: 700,
      tools: [tool], tool_choice: { type: "tool", name: "event_plan" },
      messages: [{ role: "user", content: `Choose 2 or 3 distinct real event IDs from this list. Sequence them by start time; never invent an event or fact. Explain each stop briefly.\n${lines}` }] }),
  });
  if (!response.ok) throw new Error(`Planner vendor status ${response.status}`);
  const body = await response.json() as { content?: Array<{ type: string; name?: string; input?: unknown }> };
  const raw = body.content?.find((c) => c.type === "tool_use" && c.name === "event_plan")?.input as Record<string, unknown> | undefined;
  if (!raw) throw new Error("Planner returned no tool result.");
  const stops = validateModelStops(raw.stops, candidates);
  if (stops.length < 2) throw new Error("Planner selected too few real events.");
  stops.sort((a, b) => (candidates.find((c) => c.id === a.eventId)?.startMs ?? 0) -
    (candidates.find((c) => c.id === b.eventId)?.startMs ?? 0));
  return { title: safeText(raw.title, 80) || "Your plan", intro: safeText(raw.intro, 300), stops };
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Event length when the listing gives none: long enough to attend, short enough to chain. */
export const ASSUMED_EVENT_MINUTES = 90;

function clockLA(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })
    .format(ms).replace(" AM", " am").replace(" PM", " pm");
}

function legMinutes(a: EventPlanCandidate, b: EventPlanCandidate): { minutes: number; text: string } | null {
  if (a.latitude === undefined || a.longitude === undefined || b.latitude === undefined || b.longitude === undefined) return null;
  const km = haversineMiles(a.latitude, a.longitude, b.latitude, b.longitude) * 1.609344;
  if (km < 0.05) return { minutes: 0, text: "same venue" };
  if (km < 1.2) { const m = Math.max(1, Math.round((km * 1.3) / 5 * 60)); return { minutes: m, text: `${m}-min walk` }; }
  const m = Math.round((km * 1.3) / 35 * 60) + 2;
  return { minutes: m, text: `${m}-min drive` };
}

/**
 * The plan without a model: Verdure's own ranking picks the first event, then later
 * events on the same day that can actually be reached after it (assumed length plus
 * travel), up to three, in time order. Every phrase comes from a listing field.
 */
export function sequenceEventsFallback(rows: EventPlanCandidate[]): {
  title: string; intro: string; stops: Array<{ eventId: string; why: string }>;
} {
  if (!rows.length) return { title: "A plan nearby", intro: "", stops: [] };
  const first = rows[0];
  const day = localISODate(first.startMs);
  const sameDay = rows.filter((e) => localISODate(e.startMs) === day);
  // Day-long listings have no real start time: at most one, as "any time that day".
  const flexible = sameDay.find((e) => e.allDay);
  const chain: EventPlanCandidate[] = [];
  for (const e of sameDay.filter((x) => !x.allDay)) {
    if (chain.length + (flexible ? 1 : 0) >= 3) break;
    const timeline = [...chain, e].sort((a, b) => a.startMs - b.startMs);
    const fits = timeline.every((x, i) => {
      if (i === 0) return true;
      const prev = timeline[i - 1];
      const leg = legMinutes(prev, x);
      return x.startMs >= prev.startMs + (ASSUMED_EVENT_MINUTES + (leg?.minutes ?? 20)) * 60_000;
    });
    if (fits && !chain.some((c) => c.title === e.title) && e.title !== flexible?.title) chain.push(e);
  }
  chain.sort((a, b) => a.startMs - b.startMs);
  // Too little on the anchor's day (one event per day is common two weeks out): continue with the next
  // best-ranked events on later days, no two within two hours, so the plan still has 2–3 real stops.
  let spansDays = false;
  if (chain.length + (flexible ? 1 : 0) < 2) {
    for (const e of rows) {
      if (chain.length >= 3) break;
      if (e.allDay || chain.includes(e)) continue;
      if (chain.some((c) => Math.abs(c.startMs - e.startMs) < 120 * 60_000)) continue;
      chain.push(e); spansDays = true;
    }
    chain.sort((a, b) => a.startMs - b.startMs);
  }
  // Still one stop (everything else that fits clashes with it in time): offer the next-ranked
  // same-time events as alternatives rather than a one-card plan. They are labelled as such.
  const alternatives: EventPlanCandidate[] = [];
  if (chain.length + (flexible ? 1 : 0) < 2) {
    for (const e of rows) {
      if (alternatives.length + chain.length >= 3) break;
      if (e.allDay || chain.includes(e) || alternatives.includes(e)) continue;
      alternatives.push(e);
    }
  }
  const chosen = flexible && (first.allDay || chain.length < 3) ? [...chain, flexible, ...alternatives] : [...chain, ...alternatives];
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long" }).format(first.startMs);
  // The plan card already shows each event's time, venue and price; the why adds what it can't.
  const stops = chosen.map((e, i) => {
    const parts: string[] = [];
    if (e === first) parts.push("Your best-ranked match for these choices");
    if (alternatives.includes(e)) {
      parts.push(`At the same time as ${first.title} — an alternative if that one falls through`);
    } else if (e.allDay) {
      parts.push(e === first ? "runs all day, so fit it in when it suits" : "Runs all day, so fit it in when it suits");
    } else if (i > 0 && !chosen[i - 1].allDay) {
      const prev = chosen[i - 1];
      const leg = legMinutes(prev, e);
      const gap = Math.round((e.startMs - prev.startMs) / 60_000);
      const gapText = gap >= 60 ? `${Math.floor(gap / 60)} h${gap % 60 ? ` ${gap % 60} min` : ""}` : `${gap} min`;
      if (spansDays && localISODate(e.startMs) !== localISODate(prev.startMs)) {
        parts.push(`${new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long" }).format(e.startMs)} at ${clockLA(e.startMs)}`);
      } else {
        parts.push(leg ? (leg.minutes === 0 ? `Same venue as ${prev.title}` : `${capitalize(leg.text)} from ${prev.title}`)
          : `After ${prev.title}`);
        parts.push(`starts ${gapText} after it`);
      }
    } else if (e !== first) {
      parts.push("The first timed event of the day");
    }
    if (e === first && e.organizer) parts.push(`hosted by ${e.organizer}`);
    if (e.social >= 0.69) parts.push("a friend is going");
    return { eventId: e.id, why: `${parts.join(" · ")}.` };
  });
  const timed = chosen.filter((e) => !e.allDay && !alternatives.includes(e));
  const free = chosen.every((e) => e.isFree);
  const title = spansDays && timed.length >= 2 ? `Next up: ${chosen.length} events over ${new Set(timed.map((e) => localISODate(e.startMs))).size} days`
    : timed.length >= 2 ? `${weekday}: ${chosen.length} events from ${clockLA(timed[0].startMs)}`
    : `${weekday}: ${first.title}`.slice(0, 80);
  const timedText = spansDays && timed.length >= 2
    ? `${timed.length} events in date order, starting ${weekday} at ${clockLA(timed[0].startMs)}; nothing else matched on that day, so the rest fall on later days.`
    : timed.length >= 2
    ? `${timed.length} timed events in order, ${clockLA(timed[0].startMs)} to about ${clockLA(timed[timed.length - 1].startMs + ASSUMED_EVENT_MINUTES * 60_000)}, each reachable after the one before.`
    : timed.length === 1 ? `${timed[0].title} starts at ${clockLA(timed[0].startMs)}.` : "";
  const flexibleText = flexible && chosen.includes(flexible) ? `${flexible.title} runs all day, so fit it in when it suits.` : "";
  const altText = alternatives.length ? `${alternatives.length === 1 ? "One alternative" : `${alternatives.length} alternatives`} at the same time, in case the first falls through.` : "";
  const intro = [timedText, altText, flexibleText, free ? "All free." : ""].filter(Boolean).join(" ")
    || `Only one matching event fits that day.`;
  return { title, intro, stops };
}

const fallbackPlan = (rows: EventPlanCandidate[]) => sequenceEventsFallback(rows);

export const planEvents = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "planEvents");
  const lat = Number(req.data?.lat), lng = Number(req.data?.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const input: EventPlanRequest = {
    when: safeText(req.data?.when, 20), who: safeText(req.data?.who, 20),
    distance: safeText(req.data?.distance, 20), budget: safeText(req.data?.budget, 20),
    note: safeText(req.data?.note, 120), targetDate: safeText(req.data?.targetDate, 10),
    lat: hasLoc ? lat : undefined, lng: hasLoc ? lng : undefined,
    nowMs: Date.now(),
  };
  if (input.when === "Pick a date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate ?? "") ||
       Number.isNaN(Date.parse(`${input.targetDate}T12:00:00Z`)))) {
    throw new HttpsError("invalid-argument", "Choose a valid date.");
  }
  const areaId = safeText(req.data?.areaId, 60) || "san-jose-ca";
  if (areaId.includes("/")) throw new HttpsError("invalid-argument", "Invalid area.");
  const ranked = await recommendFor(uid, areaId, input.lat, input.lng, 60, input.nowMs);
  const [docs, viewer] = await Promise.all([
    Promise.all(ranked.slice(0, 50).map((r) => db.collection("events").doc(r.id).get())),
    db.collection("users").doc(uid).get(),
  ]);
  const viewerIsAdult = viewer.data()?.ageBand === "adult";
  const rows: EventPlanCandidate[] = docs.flatMap((doc, i) => {
    const x = doc.data();
    if (!x || x.hidden === true || x.active !== true || x.broadcast !== true || x.category === "Program" || x.opportunitySubtype === "program") return [];
    if (x.adultOnly === true && !viewerIsAdult) return [];   // minor protection (W2)
    return [{ id: doc.id, title: safeText(x.title, 120), category: safeText(x.category, 50),
      organizer: safeText(x.organizer, 100), startMs: x.date instanceof Timestamp ? x.date.toMillis() : 0,
      locationName: safeText(x.locationName, 200), isFree: x.isFree === true,
      priceMin: typeof x.priceMin === "number" ? x.priceMin : undefined,
      latitude: typeof x.latitude === "number" ? x.latitude : undefined,
      longitude: typeof x.longitude === "number" ? x.longitude : undefined,
      ageSuitability: safeText(x.ageSuitability, 20), social: ranked[i]?.parts.social ?? 0,
      description: safeText(x.description, 300),
      allDay: isAllDayListing(x.date instanceof Timestamp ? x.date.toMillis() : 0,
        x.endDate instanceof Timestamp ? x.endDate.toMillis() : undefined, typeof x.time === "string" ? x.time : undefined) }];
  });
  const userSnapshot = await db.collection("users").doc(uid).get();
  const recent = Array.isArray(userSnapshot.data()?.recentPlanEventIDs)
    ? userSnapshot.data()?.recentPlanEventIDs as string[] : [];
  const candidates = avoidRecentPlanEvents(selectPlanCandidates(rows, input), recent);
  if (candidates.length < 2) throw new HttpsError("not-found", "Not enough real events fit yet. Widen your dates, distance or budget.");
  const ref = db.collection("eventPlanSessions").doc(randomBytes(12).toString("base64url"));
  const month = monthKey();
  await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(uid);
    const snap = await tx.get(userRef);
    const used = Number(snap.data()?.plannerUsage?.[month]) || 0;
    if (!plusActiveFrom(snap.data()) && used >= FREE_PLANS_PER_MONTH) {
      throw new HttpsError("permission-denied", "Monthly free plans used.",
        { reason: "planner_quota_exhausted", used, limit: FREE_PLANS_PER_MONTH, resetsOn: nextMonthISO() });
    }
    tx.set(userRef, { plannerUsage: { [month]: used + 1 } }, { merge: true });
    tx.create(ref, { uid, candidateIDs: candidates.map((c) => c.id), candidates,
      selectedIDs: [], lat: input.lat ?? null, lng: input.lng ?? null,
      modelCalls: 0, refinements: 0, createdAt: FieldValue.serverTimestamp(), month });
  });
  let plan = fallbackPlan(candidates);
  let modelUsed = false;
  const key = modelKey();
  if (key && candidates.length >= 2) {
    try { plan = await sequenceWithModel(candidates, key); modelUsed = true; }
    catch (error) { console.warn("[planEvents] deterministic fallback:", error); }
  }
  const selectedIDs = plan.stops.map((s) => s.eventId);
  await Promise.all([
    ref.set({ selectedIDs, modelCalls: modelUsed ? 1 : 0 }, { merge: true }),
    db.collection("users").doc(uid).set({ recentPlanEventIDs: Array.from(new Set([...selectedIDs, ...recent])).slice(0, 50) }, { merge: true }),
  ]);
  if (modelUsed) await db.collection("treasury").doc(month).set({
    plannerCostCents: FieldValue.increment(PLAN_VENDOR_COST_CENTS),
    eventPlannerSessions: FieldValue.increment(1),
  }, { merge: true });
  return { sessionId: ref.id, ...plan, candidateCount: candidates.length, modelUsed };
});

export const refineEventPlan = onCall(async (req) => {
  const uid = requireUid(req.auth);
  await enforceRateLimit(uid, "refineEventPlan");
  const sessionId = safeText(req.data?.sessionId, 64);
  const action = safeText(req.data?.action, 20);
  const targetId = safeText(req.data?.targetId, 180);
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) ||
      !["swap", "earlier", "later", "cheaper", "closer", "more", "remove", "shorter", "longer", "different"].includes(action)) {
    throw new HttpsError("invalid-argument", "Invalid refinement.");
  }
  const ref = db.collection("eventPlanSessions").doc(sessionId);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const session = current.data();
    if (session?.uid !== uid) throw new HttpsError("not-found", "Plan not found.");
    if (Number(session.refinements ?? 0) >= 50 || Number(session.modelCalls ?? 0) > 10) {
      throw new HttpsError("resource-exhausted", "Start a new plan.");
    }
    const candidates = Array.isArray(session.candidates) ? session.candidates as EventPlanCandidate[] : [];
    const selected = Array.isArray(session.selectedIDs) ? session.selectedIDs as string[] : [];
    const lat = typeof session.lat === "number" ? session.lat : undefined;
    const lng = typeof session.lng === "number" ? session.lng : undefined;
    const selectedIDs = refineSelection(selected, candidates, action, targetId, lat, lng);
    tx.set(ref, { selectedIDs, refinements: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { sessionId, selectedIDs, modelCalls: Number(session.modelCalls ?? 0) };
  });
});
