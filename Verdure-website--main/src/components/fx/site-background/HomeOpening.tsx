"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { attachMark, setPlateExposed } from "./scene";

/**
 * HomeOpening — the 300vh the homepage opens on, laid over the site
 * backdrop. The wordmark rides from the middle of the screen to the
 * top-left corner across the first quarter of the scroll and then stays
 * there; the site nav holds off until it lands.
 *
 * There is no canvas here. The plate belongs to SiteBackdrop, which runs
 * behind every route; this only contributes the wordmark and the two
 * copy slots. Pass the page's own copy in.
 */

/* The mark is composed rather than a single lockup image. The lockup art
   is green throughout, and green letterforms on the sunlit fog bank this
   opens over are close to unreadable. Composing it keeps the compass in
   full colour, which is the brand, and sets the wordmark in the site's own
   display face in white, which holds at any size on any part of the plate. */
let GLYPH_SRC = "/verdure-mark.png";

type HomeOpeningProps = {
  sectionTwo?: ReactNode;
  sectionThree?: ReactNode;
};

export default function HomeOpening({ sectionTwo = null, sectionThree = null }: HomeOpeningProps)
{
  let markRef = useRef<HTMLDivElement | null>(null);
  let rootRef = useRef<HTMLDivElement | null>(null);
  let cueRef = useRef<HTMLDivElement | null>(null);
  let firstScreenRef = useRef<HTMLElement | null>(null);

  useEffect(function ()
  {
    let root = document.documentElement;

    // vd-bg-home is what tells the nav to wait; without it the chrome is
    // always on, which is what every other route wants.
    root.classList.add("vd-bg-home");
    attachMark(markRef.current);

    // The opening is the one place the plate is bare, so it is the one
    // place worth rendering at full rate. Once it is off screen the plate
    // is under the tint and the scene throttles itself.
    let observer: IntersectionObserver | null = null;
    let opening = rootRef.current;
    if (opening)
    {
      observer = new IntersectionObserver(function (entries)
      {
        setPlateExposed(entries[0].isIntersecting);
      });
      observer.observe(opening);
    }
    else
    {
      setPlateExposed(true);
    }

    // The cue is placed at the foot of the first screen, which means a
    // single screen of scrolling carries it UP to the top of the viewport
    // rather than off the bottom — where it collided with the wordmark
    // arriving in the corner. It fades the moment the first screen stops
    // being the thing you are looking at.
    let cueObserver: IntersectionObserver | null = null;
    let firstScreen = firstScreenRef.current;

    if (firstScreen && cueRef.current)
    {
      let cue = cueRef.current;

      cueObserver = new IntersectionObserver(
        function (entries)
        {
          cue.classList.toggle("is-gone", entries[0].intersectionRatio < 0.75);
        },
        { threshold: [0, 0.75, 1] }
      );
      cueObserver.observe(firstScreen);
    }

    return function ()
    {
      if (observer) observer.disconnect();
      if (cueObserver) cueObserver.disconnect();
      setPlateExposed(false);
      attachMark(null);
      root.classList.remove("vd-bg-home");
    };
  }, []);

  return (
    <div className="vd-bg-root" ref={rootRef}>
      <div className="vd-bg-mark-layer">
        <div ref={markRef} className="vd-bg-mark" role="img" aria-label="Verdure">
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative
              half of a mark driven by a per-frame transform. */}
          <img
            className="vd-bg-mark__glyph"
            src={GLYPH_SRC}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="vd-bg-mark__word">Verdure</span>
        </div>
      </div>

      {/* The opening reads as a loading animation without this. Review
          landed here and waited for the page to take them somewhere,
          because a wordmark on a photograph is not obviously a document
          you scroll. It fades out as soon as the scroll starts, so it
          never becomes furniture. */}
      <div className="vd-bg-scrollcue" ref={cueRef} aria-hidden="true">
        <span className="vd-bg-scrollcue__label">Scroll</span>
        <span className="vd-bg-scrollcue__rail">
          <span className="vd-bg-scrollcue__bead" />
        </span>
      </div>

      <div className="vd-bg-column">
        <section className="vd-bg-screen" ref={firstScreenRef} />
        <section className="vd-bg-screen vd-bg-screen--two">
          <div data-reserved="section-two-copy" className="vd-bg-slot vd-bg-slot--two">
            {sectionTwo}
          </div>
        </section>
        <section className="vd-bg-screen vd-bg-screen--three">
          <div data-reserved="section-three-copy" className="vd-bg-slot vd-bg-slot--three">
            {sectionThree}
          </div>
        </section>
      </div>
    </div>
  );
}
