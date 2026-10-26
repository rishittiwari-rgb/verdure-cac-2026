import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The session cookie is HttpOnly (lib/supabase/cookies.ts), so client code
// cannot read auth state out of document.cookie any more. This route is the
// one sanctioned window: it answers a single boolean — signed in or not —
// and nothing else about the user reaches the page. The Navbar is its only
// consumer.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse>
{
  let supabase = await createClient();
  let signedIn = false;

  // No identity budget is spent here, and that is not an omission. The
  // middleware charges it for this path before the request ever arrives, and
  // answers {"signedIn":false} itself when the source is over budget — see
  // lib/supabase/middleware.ts. Doing it there rather than here is what keeps
  // it ONE bucket: middleware and route handlers run in different runtimes, so
  // an in-memory counter incremented in both places is two budgets wearing one
  // name, and the ceiling silently doubles.
  if (supabase)
  {
    // getUser() revalidates the token with Supabase rather than trusting the
    // cookie's own claims, so a forged cookie reads as signed out here too.
    let {
      data: { user },
    } = await supabase.auth.getUser();

    signedIn = Boolean(user);
  }

  return NextResponse.json(
    { signedIn },
    { headers: { "Cache-Control": "no-store" } }
  );
}
