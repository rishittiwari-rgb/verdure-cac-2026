"use client";

import { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
// Type-only, so the 821-line scene module and its shaders are erased from this
// import and reach the browser solely through the dynamic import in the effect
// below. A value import here would pull the whole thing into the root layout's
// chunk, which is exactly what it used to do.
import type { SceneSettings } from "./scene";
import "lenis/dist/lenis.css";

/**
 * SiteBackdrop — the ground the whole site stands on. A photographic plate
 * redrawn every frame in WebGL2: the depth map pushes it into parallax, a
 * fluid field the cursor stirs bends it, and fog, grain, bloom and a lens
 * profile sit on top.
 *
 * It mounts once in the root layout, so it survives every client-side
 * navigation and the GL context is built one time per page load rather
 * than per route.
 *
 * The still plate underneath is not a placeholder. It renders on the
 * server, it is what a visitor without WebGL2 keeps, and the canvas only
 * cross-fades over it once a frame has actually been drawn.
 */

// The JPEG is the fallback the <img> keeps; the AVIF/WebP ladder below is what
// almost every real browser actually takes.
//
// This plate is the site's Largest Contentful Paint element — a full-viewport
// <img> in the root layout, painted before any text, and React hoists its
// fetchPriority="high" into a genuine <link rel=preload>. It was ONE 3840x2563
// JPEG at 1.8 MB, with no srcset and no modern format, downloaded in full on
// every route including /privacy. A 390px phone at 2x needs ~780px of image and
// was being handed 3840 — about 96% of those pixels decoded and thrown away, on
// the exact resource the LCP measurement is waiting for.
//
// Same frame, same crop, now 55 KB on that phone.
let COLOR_SRC = "/bg/mountain.jpg";
let COLOR_AVIF =
  "/bg/mountain-1280.avif 1280w, /bg/mountain-1920.avif 1920w, /bg/mountain-2560.avif 2560w";
let COLOR_WEBP =
  "/bg/mountain-1280.webp 1280w, /bg/mountain-1920.webp 1920w, /bg/mountain-2560.webp 2560w";
// The plate always covers the viewport, so the width the browser needs is the
// viewport width. Nothing here is ever laid out at a fraction of it.
let COLOR_SIZES = "100vw";
let DEPTH_SRC = "/bg/mountain-depth.jpg";
let PLATE_BG = "#0b120d";

type SiteBackdropProps = {
  /** How hard the cursor pushes the fluid field. 0 to 2.5. */
  fluidStrength?: number;
  /** Seconds the wake takes to fade once the cursor has gone. 0.4 to 4. */
  fluidDecay?: number;
  /** How closely the camera chases the scroll. 0.4 to 2.5. */
  scrollSpeed?: number;
  /** Weight of the aerial haze over the far ridges. 0 to 2. */
  fogDensity?: number;
  /** Bloom and the low sun halo. 0 to 2. */
  sunGlow?: number;
};

export default function SiteBackdrop({
  // Was 2.5 — the top of the range. Review liked the effect and asked for
  // less of it, so the cursor now stirs the field at about a third of
  // that: still there when you move, no longer a visible warp.
  fluidStrength = 0.85,
  fluidDecay = 0.4,
  scrollSpeed = 1,
  fogDensity = 0.2,
  sunGlow = 0,
}: SiteBackdropProps)
{
  // Restores the head-start that moving to <picture> gave up.
  //
  // A bare <img fetchPriority="high"> was hoisted by React into a real
  // <link rel=preload> in the head, so the plate began downloading before the
  // parser reached the body. React cannot do that for a <picture> — it has no
  // way to know which candidate the browser will choose — so the LCP image went
  // back to being discovered only when the parser reached it.
  //
  // ReactDOM.preload rather than rendering a <link> in the JSX: a raw
  // <link rel="preload"> is NOT hoisted (measured — it landed in the body at
  // byte 5522, after </head> at 4275, which buys nothing over the <img> a
  // thousand bytes later). This API is the one that injects into the head
  // during SSR.
  //
  // imageSrcSet and imageSizes are byte-identical to the AVIF <source> below,
  // and that is a correctness requirement rather than tidiness: the preload is
  // only reused if the browser resolves it to the same URL it later picks from
  // the picture. A mismatch downloads the plate twice, silently.
  //
  // AVIF only, gated by type. Preloading both formats would make every browser
  // that supports both fetch two plates; one that cannot decode AVIF ignores
  // this entirely and discovers the WebP or JPEG at parse time exactly as it
  // does today, so the fallback path is no worse than before.
  ReactDOM.preload(COLOR_SRC, {
    as: "image",
    type: "image/avif",
    imageSrcSet: COLOR_AVIF,
    imageSizes: COLOR_SIZES,
    fetchPriority: "high",
  });

  let plateRef = useRef<HTMLImageElement | null>(null);
  let canvasRef = useRef<HTMLCanvasElement | null>(null);
  let settingsRef = useRef<SceneSettings>({
    fluidStrength: fluidStrength,
    fluidDecay: fluidDecay,
    scrollSpeed: scrollSpeed,
    fogDensity: fogDensity,
    sunGlow: sunGlow,
  });

  // The scene reads settings through the ref, so a prop change lands on
  // the next frame instead of rebuilding the whole GL context.
  useEffect(function ()
  {
    settingsRef.current = {
      fluidStrength: fluidStrength,
      fluidDecay: fluidDecay,
      scrollSpeed: scrollSpeed,
      fogDensity: fogDensity,
      sunGlow: sunGlow,
    };
  }, [fluidStrength, fluidDecay, scrollSpeed, fogDensity, sunGlow]);

  useEffect(function ()
  {
    let canvas = canvasRef.current;
    if (!canvas) return;

    let root = document.documentElement;
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // vd-bg-on is what flips the site's surface tokens dark. It goes on
    // before anything paints over the plate and comes off on teardown.
    root.classList.add("vd-bg-on");
    root.classList.remove("vd-bg-pinned");

    // The GL bring-up is deferred, and deliberately only the bring-up.
    //
    // Loading the module, compiling two shader programs, allocating the
    // ping-pong FBOs and uploading a multi-megapixel texture is a few hundred
    // milliseconds of main thread, and it used to run synchronously inside
    // hydration on every route — including /privacy and /pricing, where the
    // plate sits behind a tint at low opacity and nobody can tell it is live.
    // That lands squarely in the window Interaction to Next Paint measures.
    //
    // What is NOT deferred is the plate itself: the <picture> below is server
    // rendered and is the LCP element, so it paints on schedule regardless.
    // The scene is designed to cross-fade in only once it has drawn a frame
    // (see the note at the top of this file), which means arriving late is the
    // behaviour it already expects, not a regression.
    let cancelled = false;
    let scene: { destroy: () => void } | null = null;

    let start = function ()
    {
      // currentSrc, not COLOR_SRC. The scene loads the colour plate itself, by
      // URL, through its own new Image() — so it must ask for the exact file
      // the <picture> already resolved. Handing it the JPEG while the browser
      // chose an AVIF would download the plate a second time, at full size,
      // and undo the responsive ladder on the request that matters most.
      let plate = plateRef.current;

      import("./scene").then(function (mod)
      {
        // The component can unmount while the chunk is in flight, and a scene
        // created after that would never be destroyed — a leaked GL context
        // per navigation.
        if (cancelled || !canvasRef.current) return;

        scene = mod.createScene({
          canvas: canvas,
          plate: plate,
          colorSrc: plate?.currentSrc || COLOR_SRC,
          depthSrc: DEPTH_SRC,
          reduced: reduced,
          settings: function ()
          {
            return settingsRef.current;
          },
          onPinned: function (isPinned)
          {
            root.classList.toggle("vd-bg-pinned", isPinned);
          },
        });
      });
    };

    // requestIdleCallback where it exists (not Safari), with a timeout so a
    // busy main thread cannot postpone the background indefinitely.
    let idleId = 0;
    let timerId = 0;

    if (typeof window.requestIdleCallback === "function")
    {
      idleId = window.requestIdleCallback(start, { timeout: 500 });
    }
    else
    {
      timerId = window.setTimeout(start, 1);
    }

    return function ()
    {
      cancelled = true;

      if (idleId && typeof window.cancelIdleCallback === "function")
      {
        window.cancelIdleCallback(idleId);
      }

      if (timerId) window.clearTimeout(timerId);

      if (scene) scene.destroy();

      root.classList.remove("vd-bg-on");
      root.classList.remove("vd-bg-pinned");
    };
  }, []);

  return (
    <div className="vd-bg-layer" style={{ background: PLATE_BG }} aria-hidden="true">
      {/* <picture> rather than srcset on the <img> alone, because AVIF needs a
          type-gated source: a browser that cannot decode it must never be
          offered it, and only <source type> expresses that. The <img> keeps the
          JPEG so anything that understands neither format still gets a plate. */}
      <picture>
        <source type="image/avif" srcSet={COLOR_AVIF} sizes={COLOR_SIZES} />
        <source type="image/webp" srcSet={COLOR_WEBP} sizes={COLOR_SIZES} />
        {/* eslint-disable-next-line @next/next/no-img-element -- this is the
            WebGL colour plate and the no-WebGL fallback in one element; a
            next/image wrapper buys nothing over a fixed decorative layer. */}
        <img
          ref={plateRef}
          className="vd-bg-plate"
          src={COLOR_SRC}
          alt=""
          fetchPriority="high"
          decoding="async"
          draggable={false}
        />
      </picture>
      <canvas ref={canvasRef} className="vd-bg-canvas" />
    </div>
  );
}
