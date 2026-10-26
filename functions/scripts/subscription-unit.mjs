// appAccountToken derivation tests — no emulator, no Apple credentials.
//
//   node functions/scripts/subscription-unit.mjs
//
// WHY THIS IS PINNED.
// `appAccountTokenFor(uid)` is the whole ownership check for Verdure+. The app
// attaches the token to a purchase, Apple signs it into the transaction, and
// the server later recomputes it from `request.auth.uid` and compares. Three
// properties have to hold, and two of them fail SILENTLY and PERMANENTLY:
//
//   • Deterministic — the same uid must always produce the same token, or a
//     member's own subscription stops verifying on their next launch.
//   • Stable FOREVER — if the namespace constant or the hash changes, every
//     purchase ever made stops matching and every existing subscriber loses
//     their entitlement with no error anyone would notice in testing. The
//     golden vector below exists to make that change fail loudly, here.
//   • Distinct per uid — two accounts sharing a token would mean either could
//     claim the other's subscription.
//
// The token deliberately isn't secret: an attacker replaying someone else's
// transaction id still computes their OWN token, which won't match the one
// Apple signed. Predictability buys nothing, so there's no salt to rotate.

import { appAccountTokenFor } from "../lib/subscriptions.js";

let passed = 0, failed = 0;
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name} ${extra}`); }
}

console.log("── Verdure+ appAccountToken derivation ──");

const a1 = appAccountTokenFor("firebase-uid-abc123");
const a2 = appAccountTokenFor("firebase-uid-abc123");
const b = appAccountTokenFor("firebase-uid-xyz789");

ok("same uid → same token (a member keeps verifying across launches)", a1 === a2, a1);
ok("different uid → different token (no cross-account claims)", a1 !== b, `${a1} vs ${b}`);

// StoreKit requires a UUID; a malformed value is rejected at purchase time.
const uuidV5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
ok("token is a well-formed RFC 4122 v5 UUID (StoreKit requires a UUID)",
   uuidV5.test(a1), a1);

// GOLDEN VECTOR — do not "fix" this by updating the expected value.
// If this fails, the derivation changed and EVERY existing subscriber will
// silently lose their entitlement. Revert the derivation instead.
const GOLDEN_UID = "verdure-golden-uid";
const GOLDEN_TOKEN = appAccountTokenFor(GOLDEN_UID);
const EXPECTED = "e3f978b2-dc2c-592b-93d1-c0241e7bb70c";
ok("golden vector unchanged (a mismatch means every existing purchase breaks)",
   GOLDEN_TOKEN === EXPECTED,
   `\n     got      ${GOLDEN_TOKEN}\n     expected ${EXPECTED}\n     → if you changed the namespace or hash, REVERT — do not update this value.`);

// Edge cases that must not throw or collide.
ok("empty uid still yields a valid uuid (never throws)", uuidV5.test(appAccountTokenFor("")));
ok("unicode uid is handled", uuidV5.test(appAccountTokenFor("uid-🌲-ünïcode")));
ok("long uid is handled", uuidV5.test(appAccountTokenFor("u".repeat(500))));
ok("uids differing by one character diverge",
   appAccountTokenFor("uid-1") !== appAccountTokenFor("uid-2"));

console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed > 0 ? 1 : 0);
