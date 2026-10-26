"use client";

import { useEffect } from "react";

/**
 * Build identity — the short-sha stamp from next.config, surfaced so
 * "which build am I looking at" is a five-second check against git log.
 */

let STAMP = process.env.NEXT_PUBLIC_BUILD_STAMP || "dev";

let logged = false;

/** Logs the running build once per page load; renders nothing. */
export function BuildLog()
{
  useEffect(function ()
  {
    if (logged) return;
    logged = true;
    console.log("verdure build " + STAMP);
  }, []);

  return null;
}

// The visible footer stamp was removed on request — the build id now
// travels only in the <meta name="build-stamp"> tag and the console line
// above, which is where deploy checks actually read it from.
