"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSound } from "@/providers/SoundProvider";
import Logo from "@/components/ui/Logo";
import PillButton from "@/components/ui/PillButton";

/**
 * Navbar — one light bar: the compass-and-leaf mark and wordmark left,
 * Log in + the pill CTA right. Sub-pages stay reachable through the
 * footer; the bar keeps out of the content's way.
 */
export default function Navbar()
{
  let sound = useSound();
  let [signedIn, setSignedIn] = useState(false);
  let pathname = usePathname();

  // The session cookie is HttpOnly (lib/supabase/cookies.ts), so the browser
  // cannot read auth state out of document.cookie. The server answers a
  // single boolean through /auth/session instead; re-checked on every route
  // change so the bar catches a login or logout that happened in between.
  useEffect(function ()
  {
    let cancelled = false;

    fetch("/auth/session", { cache: "no-store" })
      .then(function (response)
      {
        return response.ok ? response.json() : { signedIn: false };
      })
      .then(function (data)
      {
        if (!cancelled)
        {
          setSignedIn(Boolean(data && data.signedIn));
        }
      })
      .catch(function ()
      {
        // Offline or blocked — keep the logged-out default.
      });

    return function ()
    {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <nav
      className="vd-nav fixed inset-x-0 top-0 z-50"
      style={{
        background: "var(--nav-bg)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--line)",
      }}
      aria-label="Main navigation"
    >
      <div className="page-pad mx-auto flex h-16 max-w-[1400px] items-center justify-between">
        <Link
          href="/"
          className="flex min-h-[44px] items-center gap-2.5"
          onMouseEnter={sound.playHover}
          onClick={sound.playClick}
          aria-label="Verdure home"
        >
          <Logo size={30} />
          <span className="font-display text-[1.3rem] font-bold tracking-tight">
            Verdure
          </span>
        </Link>

        <div className="flex items-center gap-4 md:gap-5">
          <Link
            href="/story#team"
            className="link-underline hidden whitespace-nowrap text-sm font-semibold text-cream/75 transition-colors duration-300 hover:text-cream sm:inline-block"
            onMouseEnter={sound.playHover}
            onClick={sound.playClick}
          >
            Team
          </Link>
          {signedIn ? (
            <PillButton
              href="/account"
              variant="chrome"
              small
              label="Account"
              onHover={sound.playHover}
              onPress={sound.playClick}
            />
          ) : (
            <>
              <Link
                href="/login"
                className="link-underline hidden whitespace-nowrap text-sm font-semibold text-cream/75 transition-colors duration-300 hover:text-cream sm:inline-block"
                onMouseEnter={sound.playHover}
                onClick={sound.playClick}
              >
                Log in
              </Link>
              <PillButton
                href="/signup"
                variant="chrome"
                small
                label="Get Access"
                hoverLabel="Join the waitlist"
                onHover={sound.playHover}
                onPress={sound.playClick}
              />
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
