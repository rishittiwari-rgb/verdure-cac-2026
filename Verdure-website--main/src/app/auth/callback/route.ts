import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/security/safe-path";
import { getSiteUrl } from "@/lib/site-url";

// Supabase redirects here after the user clicks the email confirmation (or
// magic) link. We exchange the one-time ?code for a session cookie, then
// forward the user on.
//
// The identity budget for this route is charged in middleware, not here — see
// AUTH_CALLBACK_PATH in lib/supabase/middleware.ts. exchangeCodeForSession is
// an outbound call to Supabase Auth, so a caller replaying a junk ?code was an
// uncapped amplifier against the project's shared auth limits until the
// middleware started paying for it. Charging there rather than here keeps it
// one budget: the two runtimes do not share a map, so counting in both places
// is two budgets wearing one name.
export async function GET(request: NextRequest)
{
  let { searchParams } = new URL(request.url);
  let code = searchParams.get("code");

  // Guard against open-redirects via the ?next param — parse-based, because
  // prefix checks miss the "/\evil.com" spellings browsers accept.
  let next = safeInternalPath(searchParams.get("next"), "/account");

  // Built from the configured origin rather than the request's. This used to
  // destructure `origin` out of new URL(request.url), which resolves from the
  // Host / X-Forwarded-Host header — client-supplied, and validated only by the
  // hosting platform. Vercel checks it against the project's configured
  // domains, so it was safe where this runs today and would have quietly become
  // an open redirect on a self-hosted deployment, sending a user who had just
  // authenticated straight to whatever host the request claimed to be.
  let origin = getSiteUrl();

  if (code)
  {
    let supabase = await createClient();

    if (supabase)
    {
      let { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error)
      {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
