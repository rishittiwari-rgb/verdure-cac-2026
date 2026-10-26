/**
 * Adventure Planner — an itinerary built from REAL nearby places.
 *
 * CAC 2026 (1.2): there is no Anthropic key and none is being bought. The plan
 * is built by the deterministic engine in adventure-engine.ts — the same
 * allowlist, open hours, weather, sunset and the user's picks, applied as
 * rules. The model path below stays intact and runs ONLY when a key is
 * configured; if the model call fails, the engine answers instead. Either way
 * every stop is matched back to a supplied candidate before it leaves.
 *
 * THE DESIGN CONSTRAINT THAT SHAPES EVERYTHING HERE.
 * This repo spent a whole release removing fabricated data — invented ratings,
 * hash-scattered coordinates, fake attendee counts. A planner that lets a
 * language model name places from memory walks all of that straight back in,
 * and worse: it sends someone to a trailhead that doesn't exist. So the model
 * is never asked WHICH places exist. It is handed a candidate list the app
 * already fetched from NPS / Recreation.gov / OSM and told to choose from it.
 *
 * Enforcement is mechanical, not polite: every stop the model returns is
 * matched back to a candidate id, and anything unrecognised is DROPPED before
 * the response leaves this function. A prompt instruction alone would be a
 * request; this is a guarantee.
 *
 * Weather comes from Open-Meteo — free, no API key, no account. One less
 * credential to leak, and the planner degrades to "weather unknown" rather
 * than failing if it's unreachable.
 *
 * SETUP:
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { plusActiveFrom } from "./common.js";
import { buildPlan, type EngineWeather } from "./adventure-engine.js";
import { modelKey } from "./model-key.js";

const db = () => getFirestore();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ADVENTURE_MODEL = defineString("ADVENTURE_MODEL", { default: "claude-sonnet-5" });

/** Planning costs a vendor call per request, so it's bounded per user. */
const PLAN_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };

/// Free-tier monthly quota. The hourly rate limit above is an abuse brake, not
/// an economic one: at 30/hour a single free account could bill 720 Anthropic
/// calls a day, forever. This is the actual cost ceiling, and it is the thing
/// Verdure+ sells (see PaywallView.features, first row).
export const FREE_PLANS_PER_MONTH = 5;

/// What one MODEL plan costs us in vendor spend, in cents. One Claude call plus
/// the Open-Meteo lookup (free). Rounded up deliberately — an under-estimate
/// here silently understates the treasury burn that decides whether this
/// feature can stay free at all. A rules-engine plan costs 0 and is booked as 0.
export const PLAN_VENDOR_COST_CENTS = 2;

/// Calendar month in UTC. Quota keys and treasury buckets must agree on this,
/// so both call the same function.
export function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/// When a quota-exhausted free user gets their plans back. Sent to the client
/// so the paywall can say a date instead of "later".
export function nextMonthISO(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

interface Candidate {
  id: string;
  name: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  hours?: string;
}

interface Stop {
  placeId: string;
  name: string;
  order: number;
  minutes: number;
  why: string;
}

/** Current conditions plus today's sunrise and sunset, or null when the service is unreachable. Exported for the planner review script. */
export async function fetchWeather(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<EngineWeather | null> {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,precipitation,weather_code",
    daily: "sunrise,sunset",
    forecast_days: "1",
    timeformat: "unixtime",
    timezone: "auto",
    temperature_unit: "fahrenheit",
  });
  try {
    const res = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = await res.json() as {
      current?: { temperature_2m?: number; precipitation?: number; weather_code?: number };
      daily?: { sunrise?: number[]; sunset?: number[] };
    };
    const c = body.current;
    if (!c) return null;
    const code = Number(c.weather_code ?? 0);
    const sunrise = Number(body.daily?.sunrise?.[0]), sunset = Number(body.daily?.sunset?.[0]);
    return {
      temperatureF: Number(c.temperature_2m ?? 0),
      precipitation: Number(c.precipitation ?? 0),
      code,
      summary: describeWeather(code),
      sunriseMs: Number.isFinite(sunrise) && sunrise > 0 ? sunrise * 1000 : undefined,
      sunsetMs: Number.isFinite(sunset) && sunset > 0 ? sunset * 1000 : undefined,
    };
  } catch {
    return null;
  }
}

/** WMO weather codes → plain English, so the prompt reads like a forecast. */
export function describeWeather(code: number): string {
  if (code === 0) return "clear";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzling";
  if (code <= 67) return "rainy";
  if (code <= 77) return "snowy";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorms";
}

function buildPrompt(args: {
  interests: string[];
  timeOfDay: string;
  durationMinutes: number;
  weather: Awaited<ReturnType<typeof fetchWeather>>;
  candidates: Candidate[];
}): string {
  const weatherLine = args.weather
    ? `${Math.round(args.weather.temperatureF)}°F and ${args.weather.summary}` +
      (args.weather.precipitation > 0 ? ` (${args.weather.precipitation} mm precipitation)` : "")
    : "unknown — plan something that works rain or shine";

  const list = args.candidates.map((c) =>
    `- id=${c.id} | ${c.name}${c.category ? ` | ${c.category}` : ""}${c.hours ? ` | hours: ${c.hours}` : ""}`
  ).join("\n");

  return `You are planning a short outdoor outing for a Verdure member.

Conditions right now: ${weatherLine}
Time of day: ${args.timeOfDay}
Time available: ${args.durationMinutes} minutes
Their interests: ${args.interests.length ? args.interests.join(", ") : "no strong preference"}

Choose from ONLY these real nearby places. Do not invent a place, and do not
use a name that is not on this list — anything not matching an id below will be
discarded automatically:

${list}

Build an itinerary of 2 to 4 stops that genuinely fits ${args.durationMinutes} minutes
including travel between them. Let the weather shape it: shelter and shorter
hops when it's wet or cold, longer outdoor time when it's pleasant.

For each stop give a one-sentence reason that references something concrete —
the conditions, the time of day, or their interests. No filler, no superlatives,
no invented facts about the place (you only know its name and category).

Also write a two-sentence intro that sets up the outing.`;
}

const ITINERARY_TOOL = {
  name: "itinerary",
  description: "Return the planned outing.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Short title, 2-5 words" },
      intro: { type: "string", description: "Two sentences setting up the outing" },
      stops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            placeId: { type: "string", description: "The id= value from the candidate list" },
            name: { type: "string" },
            order: { type: "number" },
            minutes: { type: "number" },
            why: { type: "string" },
          },
          required: ["placeId", "name", "order", "minutes", "why"],
        },
      },
    },
    required: ["title", "intro", "stops"],
  },
};

async function callClaude(prompt: string, apiKey: string, model: string): Promise<{
  title: string; intro: string; stops: Stop[];
}> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      // Forcing the tool call is what makes the output parseable every time —
      // free-text JSON from a model is a parsing bug waiting for a bad day.
      tools: [ITINERARY_TOOL],
      tool_choice: { type: "tool", name: "itinerary" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new HttpsError("unavailable", `Planner upstream error ${res.status}: ${text}`);
  }

  const body = await res.json() as {
    content?: Array<{ type: string; name?: string; input?: unknown }>;
  };
  const toolUse = body.content?.find((c) => c.type === "tool_use" && c.name === "itinerary");
  if (!toolUse?.input) throw new HttpsError("internal", "Planner returned no itinerary.");

  const input = toolUse.input as { title?: string; intro?: string; stops?: unknown[] };
  return {
    title: String(input.title ?? "Your outing"),
    intro: String(input.intro ?? ""),
    stops: Array.isArray(input.stops) ? input.stops as Stop[] : [],
  };
}

export const planAdventure = onCall(
  { secrets: [ANTHROPIC_API_KEY] },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to plan an adventure.");

    // Rate limit AND monthly quota, both in ONE transaction.
    //
    // They are deliberately not two transactions. Checking the quota, then
    // separately incrementing it, lets N concurrent calls all read 4 and all
    // write 5 — the exact race that makes a "5 a month" limit mean "5 a month
    // unless you tap fast", and the planner is billed per call.
    const ref = db().collection("rateLimits").doc(`${uid}_planAdventure`);
    const userRef = db().collection("users").doc(uid);
    const mk = monthKey();
    let isPlus = false;
    let usedAfter = 0;

    await db().runTransaction(async (tx) => {
      // Both reads must happen before any write in a Firestore transaction.
      const [snap, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
      const d = snap.data();
      const now = Date.now();

      // --- hourly abuse brake -------------------------------------------
      const startedAt = typeof d?.windowStart?.toMillis === "function" ? d.windowStart.toMillis() : 0;
      const expired = now - startedAt >= PLAN_LIMIT.windowMs;
      const count = expired ? 0 : (Number(d?.count) || 0);
      if (count >= PLAN_LIMIT.max) {
        throw new HttpsError("resource-exhausted", "Too many plans this hour. Try again shortly.");
      }

      // --- monthly economic quota ---------------------------------------
      // Entitlement is read from the same snapshot inside the transaction, so
      // a subscription that lapses mid-call can't be used to skip the count.
      isPlus = plusActiveFrom(userSnap.data(), now);
      const used = Number(userSnap.data()?.plannerUsage?.[mk]) || 0;

      if (!isPlus && used >= FREE_PLANS_PER_MONTH) {
        // DISTINCT from the hourly "resource-exhausted" above: this one is a
        // sales moment, not an error, and the client routes it to the paywall.
        // The details payload is the contract — AdventurePlannerService keys
        // off `reason`, never off the message text.
        throw new HttpsError(
          "permission-denied",
          `You've used all ${FREE_PLANS_PER_MONTH} plans this month. Verdure+ members plan without limits.`,
          { reason: "planner_quota_exhausted", used, limit: FREE_PLANS_PER_MONTH, resetsOn: nextMonthISO() },
        );
      }

      tx.set(ref, {
        uid, action: "planAdventure", count: count + 1,
        windowStart: expired ? new Date(now) : (d?.windowStart ?? new Date(now)),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Members are counted too. The quota doesn't apply to them, but the
      // number is what tells us what unlimited actually costs before we price
      // it — and it's what the treasury report reconciles against.
      usedAfter = used + 1;
      tx.set(userRef, { plannerUsage: { [mk]: usedAfter } }, { merge: true });
    });

    const lat = Number(req.data?.lat);
    const lng = Number(req.data?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new HttpsError("invalid-argument", "A valid location is required.");
    }

    const interests: string[] = Array.isArray(req.data?.interests)
      ? req.data.interests.filter((i: unknown) => typeof i === "string").slice(0, 20)
      : [];
    const timeOfDay = typeof req.data?.timeOfDay === "string"
      ? req.data.timeOfDay.slice(0, 40) : "afternoon";
    const durationMinutes = Math.min(600, Math.max(30,
      Math.floor(Number(req.data?.durationMinutes ?? 120)) || 120));

    // Candidates come from the client because that's where the live provider
    // results already are — re-fetching them here would double the API spend
    // for identical data. They're only ever used as an ALLOWLIST, so a client
    // sending junk gets a worse plan, never a wrong or unsafe one.
    const raw = Array.isArray(req.data?.candidates) ? req.data.candidates : [];
    const candidates: Candidate[] = raw
      .filter((c: unknown): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c: Record<string, unknown>) => ({
        id: String(c.id ?? "").slice(0, 200),
        name: String(c.name ?? "").slice(0, 200),
        category: typeof c.category === "string" ? c.category.slice(0, 60) : undefined,
        latitude: Number.isFinite(Number(c.latitude)) ? Number(c.latitude) : undefined,
        longitude: Number.isFinite(Number(c.longitude)) ? Number(c.longitude) : undefined,
        hours: typeof c.hours === "string" ? c.hours.slice(0, 120) : undefined,
      }))
      .filter((c: Candidate) => c.id && c.name)
      .slice(0, 40);

    if (candidates.length < 2) {
      throw new HttpsError("failed-precondition",
        "Not enough nearby places to plan an outing yet.");
    }

    // Read from the environment the secret binding populates: unlike .value() it logs no
    // "No value found for secret parameter" warning on every plan when no key is configured.
    const apiKey = modelKey();
    const nowMs = Date.now();
    const weather = await fetchWeather(lat, lng);

    // The rules engine is the default. The model runs only when a key is set,
    // and the engine still answers if the model call fails.
    let engine: "rules" | "model" = "rules";
    let plan: { title: string; intro: string; stops: Stop[]; notes?: string[] };
    if (apiKey) {
      try {
        const prompt = buildPrompt({ interests, timeOfDay, durationMinutes, weather, candidates });
        plan = await callClaude(prompt, apiKey, ADVENTURE_MODEL.value());
        engine = "model";
      } catch (e) {
        console.warn("[planAdventure] model failed; rules engine answers instead:", e instanceof Error ? e.message : e);
        plan = buildPlan({ candidates, interests, timeOfDay, durationMinutes, weather, lat, lng, nowMs });
      }
    } else {
      plan = buildPlan({ candidates, interests, timeOfDay, durationMinutes, weather, lat, lng, nowMs });
    }

    // THE GUARANTEE. Drop any stop that isn't a candidate we supplied, and
    // re-attach OUR name and coordinates rather than the model's — so even a
    // correct id can't come back with a subtly rewritten name.
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const stops = plan.stops
      .filter((s) => s && typeof s.placeId === "string" && byId.has(s.placeId))
      .slice(0, 6)
      .map((s, i) => {
        const c = byId.get(s.placeId)!;
        return {
          placeId: c.id,
          name: c.name,
          category: c.category ?? null,
          latitude: c.latitude ?? null,
          longitude: c.longitude ?? null,
          order: i + 1,
          minutes: Math.min(300, Math.max(5, Math.floor(Number(s.minutes)) || 30)),
          why: String(s.why ?? "").slice(0, 300),
        };
      });

    const dropped = plan.stops.length - stops.length;
    if (dropped > 0) {
      // Worth a log line: a model that keeps inventing places is a prompt
      // regression, and this is the only place it would ever show up.
      console.warn(`[planAdventure] dropped ${dropped} hallucinated stop(s)`);
    }

    if (stops.length === 0) {
      // The engine says why (everything closed after dark, nothing open for the time you have); the client shows this sentence.
      throw new HttpsError("failed-precondition", plan.notes?.[0] ?? "Not enough nearby places to plan an outing yet.");
    }

    // Vendor spend, recorded only once the plan actually succeeded — a failed
    // Claude call bills nothing and must not show up as burn, and a rules-engine
    // plan costs 0. Best-effort: a bookkeeping write must never fail a plan the
    // user already paid a quota slot for. Same /treasury/{yyyy-mm} bucket the
    // cash ledger uses, under a separate key so gift-card liability and API
    // spend stay distinguishable.
    try {
      await db().collection("treasury").doc(mk).set({
        plannerCalls: FieldValue.increment(1),
        plannerCostCents: FieldValue.increment(engine === "model" ? PLAN_VENDOR_COST_CENTS : 0),
        plannerRulesCalls: FieldValue.increment(engine === "rules" ? 1 : 0),
        plannerPlusCalls: FieldValue.increment(isPlus ? 1 : 0),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.error("[planAdventure] treasury write failed", e);
    }

    const result = {
      title: plan.title,
      intro: plan.intro,
      stops,
      notes: Array.isArray(plan.notes) ? plan.notes.slice(0, 4) : [],
      engine,
      weather: weather
        ? { temperatureF: Math.round(weather.temperatureF), summary: weather.summary,
            sunsetMs: weather.sunsetMs ?? null, attribution: "Weather data by Open-Meteo.com" }
        : null,
      plansRemaining: isPlus ? null : Math.max(0, FREE_PLANS_PER_MONTH - usedAfter),
      isPlus,
      generatedAtMs: Date.now(),
    };
    // Private member plan history makes successful place itineraries available
    // to their owner's offline packs; no other account can enumerate it.
    await db().collection("users").doc(uid).collection("adventurePlans").add(result);
    return result;
  }
);
