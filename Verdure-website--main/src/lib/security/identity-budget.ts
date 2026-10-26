import { rateLimit } from "./rate-limit";

// Ceiling on how many Supabase identity lookups one source may force.
//
// getUser() is an outbound call to Supabase Auth on every invocation — that is
// the point of it, since it revalidates the token rather than trusting the
// cookie's own claims. It is also therefore an amplifier: a junk sb-* cookie
// plus repeated GETs buys one outbound call per request, which burns function
// budget and, worse, the project's shared auth rate limit — the same limit
// real users need in order to log in.
//
// This module exists because the budget lived inside the middleware and one
// route escaped it. /auth/session is a Route Handler that calls getUser()
// itself; the middleware's `needsUser` test does not name it, so it took the
// early return and the handler then called out with nothing counting the
// calls. Measured, same junk cookie, same minute, before this file existed:
//
//   100x /account       ->  60 outbound getUser calls   (capped)
//   100x /auth/session  -> 100 outbound getUser calls   (uncapped)
//
// THE CALLER MUST BE THE MIDDLEWARE, and that constraint is the reason this is
// a module rather than two calls to rateLimit(). The first attempt at the fix
// put a second check inside the route handler with the same key and the same
// number, which reads as one budget and measured as two: 50 requests to
// /auth/session plus 50 to /account cost 100 lookups, not 60. Middleware runs
// in a different runtime from Route Handlers, so the Map below is not the same
// Map. Charging in one place is what makes the number mean anything.
//
// It is still per-instance within that runtime — see the note at the top of
// rate-limit.ts, which is honest about cold starts. This bounds the cheap,
// single-source flood that actually happens; it is not a distributed quota.
//
// ONE BUDGET PER PURPOSE, not one budget per source, and the split is the fix
// for a lockout the single shared bucket made possible. Exhaustion fails CLOSED
// on a protected route and OPEN on an auth page, which is individually right and
// jointly a loop: an attacker spending the whole budget on unauthenticated
// GET /auth/session took /account away from every OTHER visitor sharing that
// egress address — a corporate NAT, a campus, a CGNAT pool, an ISP /64. Those
// visitors were bounced to /login, logged in successfully, were redirected back
// to /account, and bounced again, for as long as the attacker kept spending
// about one request a second. Cheap, and invisible: the Navbar probe fails the
// same way, so the victim cannot even see that they are signed in.
//
// Separate keys mean the traffic an anonymous stranger can generate cannot
// consume the allowance the signed-in visitor beside them needs. The aggregate
// per-source ceiling rises from 60 to 130, which is the deliberate cost: a
// single number that anyone can drain is not a smaller amplifier, it is a
// smaller amplifier and a denial-of-service switch.
let IDENTITY_LOOKUP_WINDOW_MS = 60 * 1000;

// gate     the middleware's own getUser() for /account, /login and /signup.
//          What a signed-in visitor actually needs, so it is protected from the
//          other two.
// probe    /auth/session, the Navbar's signed-in check. Fires on every page
//          view, hence the same generous ceiling, and reachable with no cookie
//          at all — which is exactly why it must not share with `gate`.
// exchange /auth/callback's PKCE code exchange. Tight, because a real user
//          clicks a confirmation link once or twice, while a replayed ?code is
//          one outbound Supabase Auth call per request. Anything above single
//          digits per minute from one source is not a person confirming email.
let IDENTITY_LOOKUP_LIMITS = {
  gate: 60,
  probe: 60,
  exchange: 10,
};

export type IdentityPurpose = keyof typeof IDENTITY_LOOKUP_LIMITS;

// True when the caller may spend one identity lookup of this KIND; false when
// that budget is exhausted for this source. Callers MUST fail closed — answer
// from the cookie's own untrusted state, or refuse — rather than calling
// Supabase anyway. Every such fallback can only err towards treating somebody as
// signed out, which is the direction that costs a person one login rather than
// costing everyone the project's auth quota.
export function canSpendIdentityLookup(
  ip: string,
  purpose: IdentityPurpose
): boolean
{
  return rateLimit(
    "identity:" + purpose + ":" + ip,
    IDENTITY_LOOKUP_LIMITS[purpose],
    IDENTITY_LOOKUP_WINDOW_MS
  ).ok;
}
