/**
 * Partner trust-rule tests.
 *
 * These are the tests that protect the user from us. Each one asserts a limit
 * on what a paying partner can buy, and the most valuable are the ones that
 * prove a placement does NOT appear.
 */
import {
  MAX_SPONSORED_PER_SESSION, ALLOWED_SURFACES, isAllowedSurface,
  perkRelevance, choosePlacement,
  nearYouEligible, partnerHasAgreement,
} from "../lib/partners.js";
import { perkStatus } from "../lib/partner-status.js";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${e}`); } };

const perk = (id, o = {}) => ({
  id, title: `Perk ${id}`, partner: "Local Co", description: "d", kind: "discount",
  pointCost: 800, categories: [], hours: [], claimable: true, ...o,
});
const none = new Set();
const currentPerk = { active: true, pointCost: 500, codePoolCount: 2, expiresAt: { toMillis: () => 1000 } };
const currentStatus = perkStatus(currentPerk), soldOutStatus = perkStatus({ ...currentPerk, codePoolCount: 0 });
ok("status: sold-out offer stays visible but is unavailable", soldOutStatus.visible && !soldOutStatus.available);
ok("status: withdraw sold-out changes visibility and revision", !perkStatus({ ...currentPerk, codePoolCount: 0, active: false }).visible &&
   perkStatus({ ...currentPerk, codePoolCount: 0, active: false }).revision !== soldOutStatus.revision);
ok("status: partial stock change invalidates displayed count", perkStatus({ ...currentPerk, codePoolCount: 1 }).revision !== currentStatus.revision);
ok("status: hidden and removed offers are invisible", !perkStatus({ ...currentPerk, hidden: true }).visible && !perkStatus({ ...currentPerk, removed: true }).visible);
ok("status: invalid price is invisible", !perkStatus({ ...currentPerk, pointCost: 10 }).visible);
ok("status: public metadata contains no private offer/contact/code fields", Object.keys(currentStatus).sort().join(",") === "available,expiresAtMs,revision,revisionVersion,visible");
ok("status: visibility/stock revision schema is explicitly versioned", currentStatus.revisionVersion === 2);

console.log("── rule 4: never in Friends Activity ──");
ok("friends_activity is not an allowed surface", !isAllowedSurface("friends_activity"));
ok("the allowlist contains no activity/social surface",
   !ALLOWED_SURFACES.some((s) => /friend|activity|social|feed_social/.test(s)), ALLOWED_SURFACES.join(","));
ok("unknown surfaces are refused rather than defaulted",
   !isAllowedSurface("") && !isAllowedSurface("anything") && !isAllowedSurface("FRIENDS_ACTIVITY"));
ok("the five dedicated surfaces are allowed",
   ["map", "near_you", "planner", "rewards", "event_detail"].every(isAllowedSurface));
ok("organic For You and Everything surfaces refuse partner content",
   ["events_feed", "for_you", "everything"].every((s) => !isAllowedSurface(s)));
const ctx = { lat: 37.3382, lng: -121.8863, localHour: 9 };
const localCoffee = perk("coffee", { latitude: ctx.lat, longitude: ctx.lng, partnerCategory: "coffee" });
ok("near you: nearby coffee appears in the morning", nearYouEligible(localCoffee, ctx, 1));
ok("near you: coffee stays silent in the evening", !nearYouEligible(localCoffee, { ...ctx, localHour: 20 }, 1));
ok("near you: no location means no card", !nearYouEligible(localCoffee, {}, 1));
ok("near you: distant coffee never fills an empty card", !nearYouEligible({ ...localCoffee, latitude: 37.4 }, ctx, 1));
ok("near you: food only appears at meal times", !nearYouEligible({ ...localCoffee, partnerCategory: "food" }, ctx, 1) &&
  nearYouEligible({ ...localCoffee, partnerCategory: "food" }, { ...ctx, localHour: 12 }, 1));
ok("near you: activities are weekend offers", !nearYouEligible({ ...localCoffee, partnerCategory: "activities" }, ctx, 1) &&
  nearYouEligible({ ...localCoffee, partnerCategory: "activities" }, ctx, 6));
ok("activation: a missing agreement cannot surface", !partnerHasAgreement({ active: true }));
ok("activation: a complete recorded agreement is required", partnerHasAgreement({ active: true,
  agreement: { agreedBy: "Fictional fixture owner", reference: "emulator-fixture-agreement", agreedAt: { toMillis: () => 1 } } }));

console.log("\n── rule 3: at most one per session ──");
ok("the cap is 1", MAX_SPONSORED_PER_SESSION === 1);
ok("a second placement in the same session returns null",
   choosePlacement([perk("a", { categories: ["Market"] })], { nearCategory: "Market" }, none, 1) === null);
ok("the first placement in a session is allowed",
   choosePlacement([perk("a", { categories: ["Market"] })], { nearCategory: "Market" }, none, 0) !== null);

console.log("\n── rule 2: always labelled ──");
{
  const p = choosePlacement([perk("a", { categories: ["Market"] })], { nearCategory: "Market" }, none, 0);
  ok("sponsored is true and set by the chooser, not the caller", p.sponsored === true);
  ok("a reason is always present", typeof p.reason === "string" && p.reason.length > 0, p.reason);
}

console.log("\n── rule 5: dismissal is remembered ──");
ok("a dismissed perk is never chosen again",
   choosePlacement([perk("a", { categories: ["Market"] })], { nearCategory: "Market" }, new Set(["a"]), 0) === null);
ok("dismissing one perk does not suppress another", (() => {
    const p = choosePlacement(
      [perk("a", { categories: ["Market"] }), perk("b", { categories: ["Market"] })],
      { nearCategory: "Market" }, new Set(["a"]), 0);
    return p?.perkId === "b";
  })());

console.log("\n── no filler: irrelevant perks are simply not shown ──");
ok("a perk with no contextual match at the wrong hour is not shown",
   choosePlacement([perk("a", { categories: ["Sports"], hours: [7, 8, 9] })],
                   { nearCategory: "Workshop", localHour: 21 }, none, 0) === null);
ok("an empty perk list yields no placement", choosePlacement([], { nearCategory: "Market" }, none, 0) === null);
ok("no context at all still produces no filler for a niche perk",
   choosePlacement([perk("a", { categories: ["Sports"], hours: [7, 8] })], {}, none, 0) === null);

console.log("\n── relevance behaves sensibly ──");
ok("a category match raises relevance",
   perkRelevance(perk("a", { categories: ["Market"] }), { nearCategory: "Market" }) >
   perkRelevance(perk("a", { categories: ["Market"] }), { nearCategory: "Sports" }));
ok("the wrong time of day lowers relevance",
   perkRelevance(perk("a", { hours: [7, 8, 9] }), { localHour: 8 }) >
   perkRelevance(perk("a", { hours: [7, 8, 9] }), { localHour: 22 }));
ok("nearby beats far", (() => {
    const near = perkRelevance(perk("a", { latitude: 37.3382, longitude: -121.8863, categories: ["Market"] }),
                               { lat: 37.3382, lng: -121.8863, nearCategory: "Market" });
    const far = perkRelevance(perk("a", { latitude: 37.7749, longitude: -122.4194, categories: ["Market"] }),
                              { lat: 37.3382, lng: -121.8863, nearCategory: "Market" });
    return near > far;
  })());
ok("relevance stays within 0..1 for every input shape", (() => {
    const cases = [
      perkRelevance(perk("a"), {}),
      perkRelevance(perk("a", { categories: ["Market"], hours: [9], latitude: 37.3, longitude: -121.9 }),
                    { nearCategory: "Market", localHour: 9, lat: 37.3, lng: -121.9 }),
      perkRelevance(perk("a", { hours: [3] }), { localHour: 15 }),
    ];
    return cases.every((c) => c >= 0 && c <= 1);
  })());

console.log("\n── rule 6: membership changes claimability, never placement ──");
{
  // Same perk, same context; only `claimable` differs (early access). The
  // chosen perk and its position must be identical for both members and
  // non-members — otherwise a subscription buys a different feed.
  const free = choosePlacement([perk("a", { categories: ["Market"], claimable: false }),
                               perk("b", { categories: ["Sports"] })],
                              { nearCategory: "Market" }, none, 0);
  const plus = choosePlacement([perk("a", { categories: ["Market"], claimable: true }),
                               perk("b", { categories: ["Sports"] })],
                              { nearCategory: "Market" }, none, 0);
  ok("free and member are offered the SAME perk", free.perkId === plus.perkId, `${free.perkId} vs ${plus.perkId}`);
  ok("only claimability differs", free.claimable === false && plus.claimable === true);
  ok("a locked perk is still surfaced, not hidden", free !== null);
}

console.log("\n── determinism ──");
ok("ties break by id, so the same request gives the same answer", (() => {
    const a = choosePlacement([perk("z", { categories: ["Market"] }), perk("a", { categories: ["Market"] })],
                              { nearCategory: "Market" }, none, 0);
    const b = choosePlacement([perk("a", { categories: ["Market"] }), perk("z", { categories: ["Market"] })],
                              { nearCategory: "Market" }, none, 0);
    return a.perkId === b.perkId && a.perkId === "a";
  })());

console.log(`\n══ ${pass} passed, ${fail} failed ══`);
process.exit(fail ? 1 : 0);
