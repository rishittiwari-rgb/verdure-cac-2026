// One place that decides how the Supabase session cookie is written, so the
// middleware and the Server Actions cannot drift apart.
//
// @supabase/ssr 0.12 ships DEFAULT_COOKIE_OPTIONS as
// { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 days }.
//
// - sameSite "lax" is what we want and is pinned here so a library default
//   change cannot quietly widen it to "none".
// - Secure is NOT in those defaults, so the cookie would be sent over plain
//   http. We force it on in production.
// - httpOnly is forced ON, overriding the library default of false. Nothing
//   in the browser reads this cookie any more: sign-in, sign-up, sign-out and
//   the code exchange all run in Server Actions / Route Handlers, and the
//   Navbar learns the signed-in state from /auth/session instead of
//   document.cookie. Because the CSP deliberately carries 'unsafe-inline'
//   (see lib/security/csp.ts), HttpOnly is the property that keeps any
//   injected script from exfiltrating the session token.

let IS_PROD = process.env.NODE_ENV === "production";

// Thirty days, chosen here rather than inherited.
//
// @supabase/ssr defaults this to 400 days, which is the browser's maximum and
// an odd fit for a consumer account: it means a cookie captured from a shared
// or resold machine stays useful for well over a year, and that somebody who
// signed in once and never returned is still authenticated when they do. A
// month is long enough that nobody is re-typing a password every week, and
// short enough to bound both of those.
//
// This is a CEILING on the cookie, not on the session. Supabase still expires
// and refreshes its own tokens on its own schedule underneath; when the cookie
// outlives the token, getUser() rejects it anyway, which is the direction that
// fails safe.
let SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;


// Takes exactly one bit from the caller: whether this write is a DELETE.
//
// The previous version took no argument at all, on the reasoning that every
// field is decided here and a parameter that is accepted and ignored reads
// like the library still has a say. That reasoning was right about the
// fields and wrong about the verb. @supabase/ssr does not have a remove()
// path — it deletes by calling setAll() with an empty value and maxAge 0
// (see cookies.js, removeCookieOptions). Forcing maxAge to thirty days threw
// that 0 away, so every deletion the client performed was written as "set
// this cookie to empty for another thirty days" instead of "expire it now".
//
// Driving the flow showed it: after sign-out and after the confirmation-code
// exchange, sb-…-auth-token and sb-…-auth-token-code-verifier both survived
// with a zero-length value and a fresh thirty-day expiry. Nobody stayed
// signed in — an empty value reads as no session, which is why this hid for
// so long — but the browser kept sending two dead cookies on every request
// to the origin, and a deletion that only works because the value happens to
// be blank is not a deletion.
//
// So the argument is deliberately not "options". Reinstating a spread is the
// hole this file was written to close. maxAge === 0 is the library's own
// signal for removal and it is the only thing read out of what it passes;
// every other field is still decided below and cannot be influenced.
export function hardenCookie(options?: { maxAge?: number })
{
  let isRemoval = options?.maxAge === 0;

  // Built field by field, with NO `...options` spread.
  //
  // Two rounds of this were wrong. First `path: options?.path ?? "/"`, which
  // only overrides when the library passes null/undefined and yields to any
  // value it actually supplies — the precise drift the function claims to
  // prevent. Forcing those four fixed that, but the spread was still there,
  // so every field NOT named below continued to pass through untouched. That
  // included `domain`, which has a larger effect on cookie scope than any of
  // the four: a domain of ".example.com" widens the cookie to every subdomain,
  // and this function would have forwarded it while its own comment claimed
  // the library could not widen anything.
  //
  // An allowlist is the only shape that makes the claim true, because it
  // cannot be outflanked by a field that did not exist when it was written.
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: IS_PROD,
    httpOnly: true,
    // Omitted rather than forwarded: a host-only cookie is scoped to exactly
    // the host that set it, which is what we want on a single-origin site.
    // Forwarding a library-supplied domain would widen the cookie to every
    // subdomain, which is the single largest scope change available and
    // precisely the drift this function exists to stop.
    domain: undefined,
    // Decided here, not inherited. A cookie the library sets to expire in
    // 400 days is a decision about how long a stolen session stays useful,
    // and that decision belongs in this file with the other three. The one
    // exception is a removal, where 0 IS the instruction rather than a
    // library default to be overruled.
    maxAge: isRemoval ? 0 : SESSION_MAX_AGE_SECONDS,
  };
}
