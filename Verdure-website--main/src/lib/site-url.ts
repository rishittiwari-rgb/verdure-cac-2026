import { SITE_URL } from "@/lib/seo";

// The absolute origin this deployment believes it is serving from.
//
// It lives here rather than in app/auth/actions.ts, where it started, because
// two places need it and "use server" files can only export async functions —
// so the callback route could not import it and was deriving its own origin
// from the request instead. One definition means the confirmation link Supabase
// emails and the destination the user lands on after clicking it cannot
// disagree.
//
// Deriving an origin from the request is the thing this exists to avoid.
// `new URL(request.url).origin` resolves from the Host / X-Forwarded-Host
// header, which is client-supplied: on Vercel it is checked against the
// project's configured domains, but nothing in this codebase enforces that, so
// a self-hosted deployment would happily build a redirect onto whatever host a
// request claimed. A constant cannot be poisoned.
//
// The fallback chain used to end at a bare "http://localhost:3000", which is a
// live footgun rather than a default: forget the env var on the deployment and
// every confirmation email points a new user at their own machine, so no
// account can ever be confirmed and the failure is invisible from the server
// side. In production the canonical host — the same constant the canonicals and
// JSON-LD already use — is always a better guess than a loopback address.
export function getSiteUrl(): string
{
  let configured = process.env.NEXT_PUBLIC_SITE_URL;

  if (configured)
  {
    return configured;
  }

  // NODE_ENV is "production" for Vercel PREVIEW builds too, so falling back to
  // the canonical host here would have a preview signup email a confirmation
  // link pointing at production — confirming an account against a different
  // deployment than the one being tested. VERCEL_ENV distinguishes them, and
  // VERCEL_URL is the deployment's own hostname.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL)
  {
    return "https://" + process.env.VERCEL_URL;
  }

  if (process.env.NODE_ENV === "production")
  {
    console.error(
      "[auth] NEXT_PUBLIC_SITE_URL is not set; falling back to the canonical " +
        "host for email links. Set it on this deployment."
    );
    return SITE_URL;
  }

  return "http://localhost:3000";
}
