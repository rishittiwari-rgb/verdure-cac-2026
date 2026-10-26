"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request-ip";

export type WaitlistResult = {
  ok: boolean;
  error?: string;
};

let EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// RFC 5321 caps an address at 254 characters. Anything longer is not an
// address, it is someone testing what the column will swallow.
let MAX_EMAIL_LENGTH = 254;
let DUPLICATE_CODE = "23505"; // Postgres unique_violation

// `source` is written straight into the table, so it is an allowlist rather
// than whatever the client felt like sending.
let ALLOWED_SOURCES = new Set([
  "home",
  "landing-cta",
  "pricing",
  "roadmap",
  "story",
  "partnerships",
]);
let FALLBACK_SOURCE = "unknown";

// Five per address per ten minutes. A real person needs one.
let RATE_LIMIT = 5;
let RATE_WINDOW_MS = 10 * 60 * 1000;

// Nobody reads the page, types an address and submits inside a second and a
// half. Scripts that POST the form the instant it renders do.
let MIN_FILL_MS = 1500;
// A form left open for half a day is a replayed capture, not a visitor.
let MAX_FORM_AGE_MS = 6 * 60 * 60 * 1000;

let GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export async function joinWaitlist(formData: FormData): Promise<WaitlistResult>
{
  // The honeypot is a field no sighted user can see and no keyboard user can
  // tab into. Anything that fills it is automated. It gets a success response
  // so the operator of the script has nothing to tune against.
  let honeypot = String(formData.get("company") ?? "").trim();

  if (honeypot)
  {
    return { ok: true };
  }

  let ip = await clientIp();
  let limited = rateLimit("waitlist:" + ip, RATE_LIMIT, RATE_WINDOW_MS);

  if (!limited.ok)
  {
    return {
      ok: false,
      error: "That is a lot of signups from one place. Try again shortly.",
    };
  }

  // Time-to-submit trap. The timestamp comes from the client so it is not
  // tamper-proof on its own, which is why it sits behind the honeypot and the
  // rate limit rather than in front of them. If the form ever takes real
  // abuse, this is the check to replace with a signed token or Turnstile.
  let renderedAt = Number(formData.get("rendered_at"));
  let elapsed = Date.now() - renderedAt;

  if (!Number.isFinite(renderedAt) || elapsed < MIN_FILL_MS || elapsed > MAX_FORM_AGE_MS)
  {
    return { ok: true };
  }

  let email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))
  {
    return { ok: false, error: "Please enter a valid email address." };
  }

  let requestedSource = String(formData.get("source") ?? "");
  let source = ALLOWED_SOURCES.has(requestedSource) ? requestedSource : FALLBACK_SOURCE;

  // The ordinary anon-key client. The waitlist table itself grants that key
  // nothing — the insert happens inside join_waitlist(), a SECURITY DEFINER
  // function anon may only EXECUTE (see supabase/migrations/*_schema.sql). So no privileged
  // credential exists in this deployment to leak, and a duplicate address is
  // indistinguishable from a new one at the database rather than only in the
  // branch below.
  let supabase = await createClient();

  // Supabase not wired up — FAIL, loudly. The owner collects these emails; a
  // fake success that silently drops the address is worse than an error.
  if (!supabase)
  {
    console.error(
      "[waitlist] REJECTED a signup: NEXT_PUBLIC_SUPABASE_URL / " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY are not set on this deployment."
    );
    return {
      ok: false,
      error: "The waitlist is having a moment. Please try again shortly.",
    };
  }

  let { error } = await supabase.rpc("join_waitlist", {
    p_email: email,
    p_source: source,
  });

  if (error)
  {
    // Kept as belt and braces. The function swallows duplicates with ON
    // CONFLICT DO NOTHING, so this branch should now be unreachable — but if
    // the schema is ever rolled back to a direct insert, this is what stops
    // the response from announcing who is already on the list.
    if (error.code === DUPLICATE_CODE)
    {
      return { ok: true };
    }

    // The detail stays in the server log; the visitor gets nothing that
    // describes our schema or our database back.
    console.error("[waitlist] insert failed:", error.code, error.message);
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true };
}
