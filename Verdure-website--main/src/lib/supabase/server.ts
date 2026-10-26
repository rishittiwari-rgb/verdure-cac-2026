import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseEnv } from "./env";
import { hardenCookie } from "./cookies";

// Server-side Supabase client. Reads/writes the session cookie so Server
// Components, Route Handlers and Server Actions all share one auth context.
// Returns null when Supabase isn't configured so callers degrade gracefully.
// Async because Next 15 made cookies() a Promise.
export async function createClient(): Promise<SupabaseClient | null>
{
  if (!hasSupabaseEnv())
  {
    return null;
  }

  let cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll()
      {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet)
      {
        try
        {
          cookiesToSet.forEach(function (cookie)
          {
            cookieStore.set(cookie.name, cookie.value, hardenCookie(cookie.options));
          });
        }
        catch
        {
          // `setAll` is called from a Server Component render in some flows,
          // where cookies are read-only. The middleware refreshes the session,
          // so this is safe to ignore.
        }
      },
    },
  });
}
