import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseEnv } from "./env";
import { hardenCookie } from "./cookies";
import {
  canSpendIdentityLookup,
  type IdentityPurpose,
} from "@/lib/security/identity-budget";
import { resolveClientIp } from "@/lib/security/ip";

// Routes that require an authenticated user. Unauthenticated visitors are
// bounced to /login; the original path is preserved as ?redirect=.
let PROTECTED_PREFIXES = ["/account"];

// Auth pages that an already-signed-in user shouldn't see — send them to
// their account instead.
let AUTH_PREFIXES = ["/login", "/signup"];

// The Navbar's signed-in probe. It is a Route Handler that calls getUser()
// itself, so this middleware does not perform the lookup for it — but it does
// CHARGE for it, because the budget has to be spent in one runtime to be one
// budget. See the identity-budget block below.
let SESSION_PROBE_PATH = "/auth/session";

// The PKCE exchange. Same shape as the probe — it reaches Supabase Auth on its
// own (exchangeCodeForSession), so it is charged here and not looked up here.
//
// It was missed when the budget was written, and the miss was the same bug the
// budget exists to fix, one route over: /auth/callback matches neither
// PROTECTED_PREFIXES nor AUTH_PREFIXES, so it took the early return below and
// was never charged at all. Anyone who signs up once keeps their verifier
// cookie — auth-js does not clear it when the exchange fails — and can then
// replay GET /auth/callback?code=junk forever, one outbound Supabase Auth call
// per request, unauthenticated. Those calls leave from the deployment's egress
// address, so what they exhaust is the project-wide token_verifications limit
// that real users need to confirm their email.
let AUTH_CALLBACK_PATH = "/auth/callback";

// Next parses these off the inbound request when it is working out a CSP
// nonce, and GHSA-ffhc-5mcf-pf4q (Next < 15.5.16) could reflect a malformed
// inbound value into the rendered HTML. The Next 15.5.22 this site runs is
// patched; the strip stays because nothing downstream of us has any business
// reading a client-supplied value for either header, and dropping them costs
// nothing.
let STRIPPED_REQUEST_HEADERS = ["content-security-policy", "x-nonce"];

function startsWithAny(pathname: string, prefixes: string[]): boolean
{
  return prefixes.some(function (prefix)
  {
    return pathname === prefix || pathname.startsWith(prefix + "/");
  });
}

// Middleware runs before next/headers is available, so the address is read off
// the request directly. Shares the whole resolver — not just the parser — with
// lib/security/request-ip.ts, so the two cannot disagree about what one client
// is. They previously shared only normalizeIp and had the header precedence
// copied into both, which is drift waiting to happen: the identity budget is
// charged here and spent there, and two rules for reading an address would have
// made that one budget into two.
function middlewareIp(request: NextRequest): string
{
  return resolveClientIp(function (name)
  {
    return request.headers.get(name);
  });
}

// Refreshes the Supabase session on every request and enforces route access.
// Must run in middleware so the refreshed cookie is written back to the
// response before any Server Component reads it.
export async function updateSession(request: NextRequest)
{
  // Rebuilt rather than captured once: request.cookies.set() below writes
  // through to request.headers, and the refreshed cookie has to reach the
  // render or the very next Server Component read sees the stale session.
  let forwardHeaders = function (): Headers
  {
    let headers = new Headers(request.headers);

    STRIPPED_REQUEST_HEADERS.forEach(function (name)
    {
      headers.delete(name);
    });

    return headers;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

  // Auth not configured → behave like a plain static site. Skipping here keeps
  // the middleware (which runs on every route) from throwing and 500-ing the
  // whole site when Supabase env vars are absent. The CSP is applied by the
  // caller either way.
  if (!hasSupabaseEnv())
  {
    return response;
  }

  let pathname = request.nextUrl.pathname;
  let needsUser =
    startsWithAny(pathname, PROTECTED_PREFIXES) || startsWithAny(pathname, AUTH_PREFIXES);

  // Only the routes whose behaviour depends on WHO is asking pay for an
  // identity lookup. This used to run on every non-asset request, which
  // handed anyone a cheap amplifier: send a junk sb-* cookie to a marketing
  // page and each request became a middleware invocation plus an outbound
  // call to Supabase Auth — burning function budget and, worse, the project's
  // auth rate limits, which are shared with real users trying to log in.
  //
  // The cost of skipping: a session no longer refreshes while someone reads
  // marketing pages. It refreshes the moment they touch /account or an auth
  // route, which is the only place a fresh session is required.
  // Routes that reach Supabase Auth under their own steam. The middleware pays
  // for them and then gets out of the way rather than spending a second call.
  let isSessionProbe = pathname === SESSION_PROBE_PATH;
  let isAuthCallback = pathname === AUTH_CALLBACK_PATH;
  let callsAuthItself = isSessionProbe || isAuthCallback;

  if (!needsUser && !callsAuthItself)
  {
    return response;
  }

  // One budget, spent here, for every path that can reach Supabase Auth.
  //
  // /auth/session had been escaping it. That route calls getUser() itself, and
  // `needsUser` does not name it, so it took the early return above and then
  // called out with nothing counting the calls. Measured, same junk cookie,
  // same minute: 100 requests to /account cost 60 outbound lookups, 100 to
  // /auth/session cost 100. It is the worst route to have missed, because the
  // Navbar hits it from every page on the site.
  //
  // The obvious fix — a second limiter inside the route handler — was tried
  // and measured too, and it does not work: middleware and Route Handlers run
  // in different runtimes, so the in-memory map is not the same map. Two
  // counters of 60 is a budget of 120, and the test that proved it showed
  // 50 + 50 requests costing 100 lookups instead of 60. So the charge happens
  // here, in one runtime, and the route below trusts it.
  // Which allowance this request draws on. Keeping them separate is what stops
  // anonymous probe traffic from taking /account away from everyone sharing an
  // egress address — see the note in lib/security/identity-budget.ts.
  let purpose: IdentityPurpose = isSessionProbe
    ? "probe"
    : isAuthCallback
      ? "exchange"
      : "gate";

  if (!canSpendIdentityLookup(middlewareIp(request), purpose))
  {
    // Over budget: refuse to spend a Supabase call. Every branch fails towards
    // "signed out", which costs a person one login rather than costing
    // everyone the project's auth quota.
    if (isSessionProbe)
    {
      return NextResponse.json(
        { signedIn: false },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // The exchange is refused without being attempted, which is the entire
    // point of charging for it: the outbound call is what is being rationed, so
    // "over budget" has to mean the request never reaches Supabase. The user
    // sees the same failure a stale link gives them and can click it again.
    if (isAuthCallback)
    {
      let callbackUrl = request.nextUrl.clone();
      callbackUrl.pathname = "/login";
      callbackUrl.search = "";
      callbackUrl.searchParams.set("error", "auth_callback_failed");
      return NextResponse.redirect(callbackUrl);
    }

    // A protected route falls back to the login redirect (fail closed); an
    // auth route just renders.
    if (startsWithAny(pathname, PROTECTED_PREFIXES))
    {
      let redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  // Paid for; the Route Handler makes the call. Nothing further to do here —
  // running getUser() as well would double the outbound cost of the one route
  // that is hit from every page, and on the callback it would spend a lookup on
  // a request whose whole purpose is to mint the session that lookup wants.
  if (callsAuthItself)
  {
    return response;
  }

  let supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll()
      {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet)
      {
        cookiesToSet.forEach(function (cookie)
        {
          request.cookies.set(cookie.name, cookie.value);
        });

        response = NextResponse.next({ request: { headers: forwardHeaders() } });

        cookiesToSet.forEach(function (cookie)
        {
          response.cookies.set(
            cookie.name,
            cookie.value,
            hardenCookie(cookie.options)
          );
        });
      },
    },
  });

  // IMPORTANT: getUser() revalidates the token with Supabase. Do not gate
  // access on getSession() alone — that only reads the (spoofable) cookie.
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && startsWithAny(pathname, PROTECTED_PREFIXES))
  {
    let redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && startsWithAny(pathname, AUTH_PREFIXES))
  {
    let redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/account";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
