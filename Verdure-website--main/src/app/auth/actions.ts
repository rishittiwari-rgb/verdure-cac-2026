"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request-ip";
import { safeInternalPath } from "@/lib/security/safe-path";
import { getSiteUrl } from "@/lib/site-url";

// Shape returned to the client form via useActionState.
export type AuthState = {
  error?: string;
  message?: string;
};

let EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let MAX_EMAIL_LENGTH = 254;
let MIN_PASSWORD_LENGTH = 8;
// Matches the CHECK on profiles.full_name. Long enough for any real name
// including the ones Western forms usually mangle, short enough that nobody is
// storing a paragraph in a greeting.
let MAX_NAME_LENGTH = 80;
// Long enough that no real passphrase is refused, short enough that nobody
// makes us hash a megabyte.
let MAX_PASSWORD_LENGTH = 200;

// Ten login attempts per address per fifteen minutes; signup is rarer and
// costs us an outbound email, so it gets a tighter budget.
let LOGIN_LIMIT = 10;
let LOGIN_WINDOW_MS = 15 * 60 * 1000;
let SIGNUP_LIMIT = 5;
let SIGNUP_WINDOW_MS = 60 * 60 * 1000;
// Sign-out is cheap and legitimate users do it rarely; the budget exists to
// cap the Supabase round trip a forged cookie can trigger, not to inconvenience
// anyone signing out of several tabs.
let SIGNOUT_LIMIT = 20;
let SIGNOUT_WINDOW_MS = 15 * 60 * 1000;

// The ONLY failure message login ever returns. Wrong password, unknown
// address, malformed input and a Supabase outage all produce this exact
// string, so the response cannot be used to test whether an account exists.
let LOGIN_FAILED = "Incorrect email or password.";
let TOO_MANY_ATTEMPTS = "Too many attempts from this connection. Try again in a few minutes.";
let AUTH_UNAVAILABLE = "Accounts aren't available just yet. Please check back soon.";

// Sent for a fresh signup AND for an address that already has an account.
// Identical responses are the whole point.
let SIGNUP_PENDING =
  "Almost there. Check your inbox and confirm your email to finish creating your account.";

// Supabase error codes that may be shown to a visitor.
//
// THE RULE, which matters more than the list: an error code may only appear
// here if it is reachable for an address that ALREADY HAS AN ACCOUNT as
// readily as for one that does not. Anything Supabase can only produce while
// processing a new signup is a membership oracle, because the attacker learns
// "this address is new" from receiving it and "this address exists" from not.
//
// Two entries have now failed that rule. over_email_send_rate_limit went
// first: Supabase only sends confirmation mail for an address without an
// account. weak_password is the same shape and survived the first pass —
// Supabase short-circuits an existing address before it ever evaluates the
// password, so submitting a deliberately weak password to a target address
// answers the question outright. Removing one instance and leaving its twin
// is exactly the instance-versus-class mistake this file keeps making.
//
// Password quality is now enforced BEFORE Supabase is called (isStrongEnough
// below), so a genuinely weak password still gets a specific message — from
// our own validation, which never touches the address.
//
// validation_failed is also gone: our own checks run first, so it is
// unreachable in practice, and it is not worth a code path that might carry
// address-shaped detail.
//
// over_request_rate_limit is retained on the reasoning that it is keyed on the
// REQUESTER (IP / project), not on the submitted address, so it cannot vary
// with membership. That reasoning is analytic, not measured — it is on the
// re-test list to confirm by timing against a live project.
let SAFE_SIGNUP_ERRORS = new Map([
  ["over_request_rate_limit", TOO_MANY_ATTEMPTS],
]);

// Absolute origin for the confirmation link we ask Supabase to email. Moved to
// lib/site-url.ts so /auth/callback can share it: this file is "use server", so
// it can only export async functions, and the callback route was left deriving
// its own origin from the request's Host header as a result.

// Only allow same-site relative redirect targets to avoid open-redirects.
// The parse-based check lives in lib/security/safe-path.ts; the previous
// startsWith("//") test missed "/\evil.com", which browsers read as
// protocol-relative and would have carried a freshly logged-in visitor
// straight onto an attacker's page.
function safeRedirect(target: FormDataEntryValue | null): string
{
  return safeInternalPath(target, "/account");
}

function readCredentials(formData: FormData)
{
  let email = String(formData.get("email") ?? "").trim().toLowerCase();
  let password = String(formData.get("password") ?? "");
  return { email, password };
}

// Password quality, checked by US before Supabase sees the request, so that a
// weak password is answered by our own address-independent validation instead
// of by a Supabase error code that only new addresses can reach. Deliberately
// modest: length is what actually correlates with strength, and a thicket of
// character-class rules mostly teaches people to write Password1!.
function isStrongEnough(password: string): boolean
{
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH)
  {
    return false;
  }

  // A single repeated character ("aaaaaaaa") clears a length check and nothing
  // else. Anything with at least four distinct characters is past the floor.
  return new Set(password).size >= 4;
}

// A name is one line of text and nothing else.
//
// Deliberately permissive about WHICH characters: any rule cleverer than
// "no control characters" ends up rejecting somebody's actual name, and the
// only thing this value is used for is being displayed back to its own owner
// through React, which escapes it. The control-character check is here because
// a newline is the one thing that is never part of a name and is occasionally
// part of an injection attempt somewhere downstream.
function isPlausibleName(name: string): boolean
{
  if (name.length < 1 || name.length > MAX_NAME_LENGTH)
  {
    return false;
  }

  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001F\u007F]/.test(name);
}

function isWellFormed(email: string, password: string): boolean
{
  return (
    email.length <= MAX_EMAIL_LENGTH &&
    EMAIL_RE.test(email) &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState>
{
  let { email, password } = readCredentials(formData);
  let destination = safeRedirect(formData.get("redirect"));

  let limited = rateLimit("login:" + (await clientIp()), LOGIN_LIMIT, LOGIN_WINDOW_MS);

  if (!limited.ok)
  {
    return { error: TOO_MANY_ATTEMPTS };
  }

  // Malformed input returns the same message as a failed login. Telling the
  // visitor which field was wrong would let a script skip the ones it has
  // already ruled out.
  if (!isWellFormed(email, password))
  {
    return { error: LOGIN_FAILED };
  }

  let supabase = await createClient();

  if (!supabase)
  {
    return { error: AUTH_UNAVAILABLE };
  }

  let { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error)
  {
    return { error: LOGIN_FAILED };
  }

  // No revalidatePath here. It used to purge the whole route tree on every
  // successful login, which is the same unauthenticated-purge bug that was
  // fixed in signOut, only one authentication step further back — and on a
  // site with open self-service signup, "authenticated" costs an attacker one
  // free account, after which ten logins per fifteen minutes is more than
  // enough to hold the prerender cache permanently cold.
  //
  // It is also unnecessary: no cached page renders anything user-specific.
  // The marketing pages are static and identical for everyone, the navbar
  // resolves its state client-side through /auth/session, and /account reads
  // cookies so it is dynamic and never cached in the first place.
  redirect(destination);
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState>
{
  let { email, password } = readCredentials(formData);
  let name = String(formData.get("name") ?? "").trim();

  let limited = rateLimit("signup:" + (await clientIp()), SIGNUP_LIMIT, SIGNUP_WINDOW_MS);

  if (!limited.ok)
  {
    return { error: TOO_MANY_ATTEMPTS };
  }

  // Checked before the address, because it is the only field here whose error
  // message can be specific without telling anybody whether an account exists.
  if (!isPlausibleName(name))
  {
    return { error: `Enter your name (up to ${MAX_NAME_LENGTH} characters).` };
  }

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))
  {
    return { error: "Enter a valid email address." };
  }
  if (!isStrongEnough(password))
  {
    return {
      error:
        `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} ` +
        "characters and use at least four different ones.",
    };
  }

  let supabase = await createClient();

  if (!supabase)
  {
    return { error: AUTH_UNAVAILABLE };
  }

  let { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
      // Lands on auth.users.raw_user_meta_data, which handle_new_user() copies
      // into profiles.full_name. Validated above, and bounded again by a CHECK
      // constraint in the database — this endpoint is reachable directly with
      // the publishable key, so our validation is not the only thing standing
      // between the form and that column.
      data: { full_name: name },
    },
  });

  if (error)
  {
    let safe = error.code ? SAFE_SIGNUP_ERRORS.get(error.code) : undefined;

    if (safe)
    {
      return { error: safe };
    }

    // Anything else — including "user already registered" — returns the same
    // pending message a brand new signup gets. Passing error.message straight
    // through, which is what this used to do, told an attacker exactly which
    // addresses already have accounts.
    console.error("[signup] suppressed error:", error.code, error.message);
    return { message: SIGNUP_PENDING };
  }

  // When email confirmation is OFF, Supabase returns an active session and we
  // can drop the user straight into their account.
  if (data.session)
  {
    // No revalidatePath — same reasoning as login().
    redirect("/account");
  }

  // Email confirmation is ON: a verification link was emailed.
  return { message: SIGNUP_PENDING };
}

export async function signOut(): Promise<void>
{
  // A Server Action is a public HTTP endpoint. The framework's origin check
  // stops a BROWSER on another site from invoking this, but it stops nothing
  // holding a socket — one curl with a matching Origin reaches this code — so
  // the two gates below exist to make an unauthenticated POST cost nothing.
  //
  // They used to protect a revalidatePath("/", "layout") that ran here. That
  // call is gone: no cached page renders anything user-specific, since the
  // navbar resolves its state client-side through /auth/session and /account
  // reads cookies and so is never cached. With nothing to purge, the getUser()
  // round trip that guarded the purge went with it — signOut() on an invalid
  // session is a no-op, so verifying the session first only bought a second
  // call to Supabase.

  // No auth cookie at all: nothing to sign out. One local read, no network.
  let cookieStore = await cookies();
  let hasAuthCookie = cookieStore.getAll().some(function (cookie)
  {
    return cookie.name.startsWith("sb-");
  });

  if (!hasAuthCookie)
  {
    redirect("/login");
  }

  // A forged cookie gets past that, so the Supabase round trip it would
  // trigger is rate limited like every other endpoint here.
  let limited = rateLimit("signout:" + (await clientIp()), SIGNOUT_LIMIT, SIGNOUT_WINDOW_MS);

  if (!limited.ok)
  {
    redirect("/login");
  }

  let supabase = await createClient();

  if (supabase)
  {
    await supabase.auth.signOut();
  }

  redirect("/login");
}
