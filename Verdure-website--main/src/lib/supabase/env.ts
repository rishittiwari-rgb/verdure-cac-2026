// Centralised, validated access to the public Supabase env vars.
// These two are safe to expose to the browser (anon key is row-level-security
// gated). Anything privileged must NOT live behind a NEXT_PUBLIC_ prefix.

function readEnv(name: string): string
{
  let value = process.env[name];

  if (!value)
  {
    throw new Error(
      `Missing environment variable: ${name}. ` +
        `Copy .env.local.example to .env.local and fill in your Supabase keys.`
    );
  }

  return value;
}

// True only when BOTH public Supabase vars are present. Auth is an optional
// layer on top of the marketing site, so every consumer checks this first and
// degrades gracefully (no session refresh, no route gating) when it's false —
// the public site must never 500 just because Supabase isn't wired up yet.
export function hasSupabaseEnv(): boolean
{
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getSupabaseUrl(): string
{
  return readEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string
{
  return readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}
