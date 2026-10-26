"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { resetSiteScroll } from "./scene";

/**
 * ScrollReset — puts every route change back at the top.
 *
 * Next already scrolls to the top on navigation, but it does that against
 * the document as the router understands it, and Lenis is driving the
 * scroll from its own cached geometry. When the two disagree — which they
 * do on any navigation away from the 300vh opening, because every sub-page
 * is shorter — Lenis wins the last frame and writes back the offset it
 * held on the page you left. Clamped to the shorter document, that is the
 * bottom of the new page.
 *
 * So this re-asserts the top after the route has actually committed, and
 * makes Lenis re-measure while it is there.
 *
 * An in-page anchor is the one case where landing away from the top is the
 * whole point (`/#how`, `/story#team`), so a hash opts out.
 */
export default function ScrollReset()
{
  let pathname = usePathname();
  let isFirstRender = useRef(true);

  useEffect(function ()
  {
    // Only route changes. On a fresh load there is nothing stale to
    // correct, and firing here would throw away the browser's own scroll
    // restoration and yank a reloading visitor back to the top.
    if (isFirstRender.current)
    {
      isFirstRender.current = false;
      return;
    }

    if (window.location.hash) return;

    // After paint: the new page has to be laid out before a scroll to the
    // top means anything, and before Lenis can measure the right height.
    let frame = window.requestAnimationFrame(function ()
    {
      resetSiteScroll();
    });

    return function ()
    {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
