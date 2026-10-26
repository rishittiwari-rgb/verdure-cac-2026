"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useBoot } from "./BootProvider";

gsap.registerPlugin(ScrollTrigger);

let LenisContext = createContext<Lenis | null>(null);

/** Access the live Lenis instance (e.g. to stop/start scroll for a modal). */
export let useLenis = function ()
{
  return useContext(LenisContext);
};

// Keys that scroll the page — blocked while the preloader is active.
let SCROLL_KEYS = new Set([
  " ",
  "Spacebar", // legacy
  "PageDown",
  "PageUp",
  "End",
  "Home",
  "ArrowUp",
  "ArrowDown",
]);

let isTypingTarget = function (el: EventTarget | null)
{
  let node = el as HTMLElement | null;
  if (!node) return false;
  let tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
};

export default function LenisProvider({
  children,
}: {
  children: React.ReactNode;
})
{
  let lenisRef = useRef<Lenis | null>(null);
  let releaseRef = useRef<(() => void) | null>(null);
  let { isReady } = useBoot();

  // First-render readiness: on the home page this is false (preloader runs, so
  // we lock); on sub-pages with no BootProvider it's true (never lock).
  let lockOnMountRef = useRef(!isReady);

  useEffect(function ()
  {
    let lenis = new Lenis({
      duration: 1.2,
      easing: function (t: number)
      {
        return Math.min(1, 1.001 - Math.pow(2, -10 * t));
      },
      touchMultiplier: 2,
    });
    lenisRef.current = lenis;

    // Keep ScrollTrigger in lockstep with Lenis' smoothed scroll, and drive
    // Lenis from GSAP's ticker so scrub/pin updates never desync.
    lenis.on("scroll", ScrollTrigger.update);

    let tick = function (time: number)
    {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    let onResize = function ()
    {
      ScrollTrigger.refresh();
    };
    window.addEventListener("resize", onResize);

    let safetyId = 0;

    if (lockOnMountRef.current)
    {
      // Always begin at the hero, regardless of the browser restoring scroll.
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
      window.scrollTo(0, 0);
      lenis.stop();

      let body = document.body;
      let prev = {
        overflow: body.style.overflow,
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
      };
      body.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.top = "0";
      body.style.width = "100%";

      let preventScroll = function (e: Event)
      {
        e.preventDefault();
      };
      let onKeyDown = function (e: KeyboardEvent)
      {
        if (isTypingTarget(e.target)) return;
        if (SCROLL_KEYS.has(e.key)) e.preventDefault();
      };

      window.addEventListener("wheel", preventScroll, { passive: false });
      window.addEventListener("touchmove", preventScroll, { passive: false });
      window.addEventListener("keydown", onKeyDown, { passive: false });

      releaseRef.current = function ()
      {
        releaseRef.current = null; // idempotent
        window.removeEventListener("wheel", preventScroll);
        window.removeEventListener("touchmove", preventScroll);
        window.removeEventListener("keydown", onKeyDown);
        body.style.overflow = prev.overflow;
        body.style.position = prev.position;
        body.style.top = prev.top;
        body.style.width = prev.width;
        // Force the hero one last time so we never reveal mid-page.
        window.scrollTo(0, 0);
        lenis.start();
        // Body was position:fixed during boot — re-measure every trigger now
        // that the real document height is back.
        ScrollTrigger.refresh();
      };

      // Failsafe: never trap the user if a gate never resolves.
      safetyId = window.setTimeout(function ()
      {
        releaseRef.current?.();
      }, 12000);
    }

    return function ()
    {
      if (safetyId) window.clearTimeout(safetyId);
      releaseRef.current?.();
      gsap.ticker.remove(tick);
      window.removeEventListener("resize", onResize);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  // Release the lock the moment every boot gate has resolved.
  useEffect(function ()
  {
    if (isReady) releaseRef.current?.();
  }, [isReady]);

  return (
    <LenisContext.Provider value={lenisRef.current}>
      {children}
    </LenisContext.Provider>
  );
}
