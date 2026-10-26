"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * BootProvider — single source of truth for the preloader unlock gate.
 *
 * The hero must never be skipped while the intro plays, so scrolling stays
 * locked until BOTH of these are true:
 *   1. countDone  — the preloader count/reveal animation has finished
 *   2. fontsReady — web fonts have loaded (document.fonts.ready)
 *
 * markFirstFrame() is retained as a no-op for API compatibility (the site no
 * longer renders a WebGL hero, so there is no frame to wait on).
 * LenisProvider consumes `isReady` to release the scroll lock.
 *
 * Used outside a provider (e.g. on sub-pages with no preloader), the hook
 * returns a ready-by-default context so nothing locks.
 */

type BootContextValue = {
  countDone: boolean;
  fontsReady: boolean;
  firstFrameReady: boolean;
  isReady: boolean;
  markCountDone: () => void;
  markFirstFrame: () => void;
};

let READY_FALLBACK: BootContextValue = {
  countDone: true,
  fontsReady: true,
  firstFrameReady: true,
  isReady: true,
  markCountDone: function () {},
  markFirstFrame: function () {},
};

let BootContext = createContext<BootContextValue | null>(null);

export function BootProvider({ children }: { children: React.ReactNode })
{
  let [countDone, setCountDone] = useState(false);
  let [fontsReady, setFontsReady] = useState(false);
  // No WebGL hero anymore — first frame is satisfied by default.
  let [firstFrameReady] = useState(true);

  // Gate on web fonts, with a hard fallback so the boot can never hang on it.
  useEffect(function ()
  {
    let active = true;
    let done = function ()
    {
      if (active) setFontsReady(true);
    };

    if (typeof document !== "undefined" && "fonts" in document)
    {
      document.fonts.ready.then(done).catch(done);
      let safety = window.setTimeout(done, 4000);
      return function ()
      {
        active = false;
        window.clearTimeout(safety);
      };
    }

    done();
    return function ()
    {
      active = false;
    };
  }, []);

  let markCountDone = useCallback(function ()
  {
    setCountDone(true);
  }, []);
  let markFirstFrame = useCallback(function () {}, []);

  let isReady = countDone && fontsReady;

  let value = useMemo<BootContextValue>(function ()
  {
    return {
      countDone,
      fontsReady,
      firstFrameReady,
      isReady,
      markCountDone,
      markFirstFrame,
    };
  }, [countDone, fontsReady, firstFrameReady, isReady, markCountDone, markFirstFrame]);

  return <BootContext.Provider value={value}>{children}</BootContext.Provider>;
}

export function useBoot(): BootContextValue
{
  return useContext(BootContext) ?? READY_FALLBACK;
}
