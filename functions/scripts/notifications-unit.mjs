/**
 * Notification gate tests. No emulator, no push.
 *
 * These assert RESTRAINT. Every test that matters here proves a notification is
 * NOT sent — the failure mode for push is not "we missed one", it is "the user
 * turned us off forever", and that is unrecoverable.
 */
import {
  MAX_PUSH_PER_WEEK, MIN_QUALIFYING_EVENTS, DEFAULT_PREFS,
  readPrefs, inQuietHours, localHour, weekKey, decideDigest,
} from "../lib/notifications.js";

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${e}`); } };

const LA = "America/Los_Angeles";
const at = (h, day = 15) => Date.UTC(2026, 8, day, h, 0, 0);
const prefs = (o = {}) => ({ ...DEFAULT_PREFS, timeZone: LA, ...o });
const ids = (n) => Array.from({ length: n }, (_, i) => `e${i}`);

console.log("── defaults are conservative ──");
ok("quiet hours default to 21:00-08:00 (opt-out, not opt-in)",
   DEFAULT_PREFS.quietStart === 21 && DEFAULT_PREFS.quietEnd === 8);
ok("the weekly cap is 2", MAX_PUSH_PER_WEEK === 2);
ok("the qualifying floor is 5", MIN_QUALIFYING_EVENTS === 5);
ok("RSVP promotional offers default off", DEFAULT_PREFS.rsvpPartnerOffers === false);
ok("RSVP opt-in requires boolean true", readPrefs({ notificationPrefs: { rsvpPartnerOffers: true } }).rsvpPartnerOffers &&
  !readPrefs({ notificationPrefs: { rsvpPartnerOffers: "true" } }).rsvpPartnerOffers);

console.log("\n── prefs parsing is defensive ──");
ok("missing prefs fall back to defaults", (() => {
    const p = readPrefs(undefined);
    return p.eventSuggestions && p.friendActivity && p.quietStart === 21;
  })());
ok("an explicit false is honoured (not treated as missing)",
   readPrefs({ notificationPrefs: { eventSuggestions: false } }).eventSuggestions === false);
ok("out-of-range quiet hours fall back rather than corrupting the window",
   readPrefs({ notificationPrefs: { quietStart: 99, quietEnd: -4 } }).quietStart === 21);
ok("a junk timezone falls back to a real one",
   readPrefs({ notificationPrefs: { timeZone: 42 } }).timeZone === DEFAULT_PREFS.timeZone);

console.log("\n── quiet hours, including the overnight wrap ──");
// 21:00-08:00 wraps midnight. A naive h >= start && h < end gets this backwards
// and would deliver ONLY during quiet hours.
ok("22:00 local is quiet", inQuietHours(at(5), prefs()), `localHour=${localHour(at(5), LA)}`);   // 05:00Z = 22:00 PDT prev day
ok("03:00 local is quiet", inQuietHours(at(10), prefs()), `localHour=${localHour(at(10), LA)}`); // 10:00Z = 03:00 PDT
ok("17:00 local is NOT quiet", !inQuietHours(at(0, 16), prefs()), `localHour=${localHour(at(0, 16), LA)}`);
ok("09:00 local is NOT quiet", !inQuietHours(at(16), prefs()), `localHour=${localHour(at(16), LA)}`);
ok("a non-wrapping window still works (01:00-06:00)", (() => {
    const p = prefs({ quietStart: 1, quietEnd: 6 });
    return inQuietHours(at(10), p) && !inQuietHours(at(0, 16), p);
  })());
ok("start === end means no quiet window, not an always-quiet one",
   !inQuietHours(at(5), prefs({ quietStart: 0, quietEnd: 0 })));
ok("midnight is hour zero, including a 00:00-01:00 quiet window",
   localHour(at(7), LA) === 0 && inQuietHours(at(7), prefs({ quietStart: 0, quietEnd: 1 })));
ok("quiet hours are evaluated in the USER's timezone, not the server's", (() => {
    const ny = { ...prefs(), timeZone: "America/New_York" };
    const la = prefs();
    // 04:00Z = 00:00 EDT (quiet in NY) but 21:00 PDT the previous day (also quiet)
    // 12:00Z = 08:00 EDT (awake in NY) and 05:00 PDT (quiet in LA) — they differ.
    return !inQuietHours(at(12), ny) && inQuietHours(at(12), la);
  })());

console.log("\n── week keys ──");
ok("the same week gives the same key", weekKey(at(12, 15)) === weekKey(at(12, 17)));
ok("crossing into the next week changes the key", weekKey(at(12, 15)) !== weekKey(at(12, 23)));
ok("key looks like an ISO week", /^\d{4}-W\d{2}$/.test(weekKey(at(12, 15))), weekKey(at(12, 15)));

console.log("\n── the digest decision (every gate proves a NON-send) ──");
const awake = at(0, 16);   // 17:00 PDT
ok("sends when everything is satisfied",
   decideDigest({ prefs: prefs(), atMs: awake, qualifying: ids(6), budgetAvailable: true }).send === true);
ok("preference off → no send", (() => {
    const d = decideDigest({ prefs: prefs({ eventSuggestions: false }), atMs: awake, qualifying: ids(9), budgetAvailable: true });
    return d.send === false && d.reason === "prefs_off";
  })());
ok("quiet hours → no send even with plenty of events and budget", (() => {
    const d = decideDigest({ prefs: prefs(), atMs: at(10), qualifying: ids(20), budgetAvailable: true });
    return d.send === false && d.reason === "quiet_hours";
  })());
ok("weekly cap spent → no send", (() => {
    const d = decideDigest({ prefs: prefs(), atMs: awake, qualifying: ids(20), budgetAvailable: false });
    return d.send === false && d.reason === "weekly_cap";
  })());
ok("four qualifying events is below the floor → no send at all", (() => {
    const d = decideDigest({ prefs: prefs(), atMs: awake, qualifying: ids(4), budgetAvailable: true });
    return d.send === false && d.reason === "below_floor";
  })());
ok("exactly five qualifies (the floor is inclusive)",
   decideDigest({ prefs: prefs(), atMs: awake, qualifying: ids(5), budgetAvailable: true }).send === true);
ok("zero events → no send, and no crash",
   decideDigest({ prefs: prefs(), atMs: awake, qualifying: [], budgetAvailable: true }).send === false);
ok("a non-send never carries event ids (nothing to leak into a payload)", (() => {
    const cases = [
      decideDigest({ prefs: prefs({ eventSuggestions: false }), atMs: awake, qualifying: ids(9), budgetAvailable: true }),
      decideDigest({ prefs: prefs(), atMs: at(10), qualifying: ids(9), budgetAvailable: true }),
      decideDigest({ prefs: prefs(), atMs: awake, qualifying: ids(9), budgetAvailable: false }),
      decideDigest({ prefs: prefs(), atMs: awake, qualifying: ids(2), budgetAvailable: true }),
    ];
    return cases.every((c) => c.send === false && c.eventIds.length === 0);
  })());
ok("a send is capped at 3 highlighted events regardless of how many qualify",
   decideDigest({ prefs: prefs(), atMs: awake, qualifying: ids(40), budgetAvailable: true }).eventIds.length === 3);

console.log("\n── gate ordering ──");
// Preferences must be checked BEFORE the budget, or a user who turned
// suggestions off would still burn their weekly slot and be silently blocked
// from friend-activity pushes they DID want.
ok("preferences are evaluated before the budget", (() => {
    const d = decideDigest({ prefs: prefs({ eventSuggestions: false }), atMs: awake, qualifying: ids(9), budgetAvailable: false });
    return d.reason === "prefs_off";
  })());
ok("quiet hours are evaluated before the budget", (() => {
    const d = decideDigest({ prefs: prefs(), atMs: at(10), qualifying: ids(9), budgetAvailable: false });
    return d.reason === "quiet_hours";
  })());

console.log(`\n══ ${pass} passed, ${fail} failed ══`);
process.exit(fail ? 1 : 0);
