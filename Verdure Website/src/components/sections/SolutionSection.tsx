"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

let steps = [
  {
    idx: "1",
    title: "Daily Gems",
    description:
      "Open the app each morning to find new spots marked on your personal map. Walk there, check in, and collect points — every stroll becomes a small treasure hunt.",
  },
  {
    idx: "2",
    title: "Community Boards",
    description:
      "Browse and post local events, pickup games, and meetups happening nearby. The app surfaces what's relevant to your interests and where you are.",
  },
  {
    idx: "3",
    title: "Gamified Exploration",
    description:
      "Earn XP for every check-in, unlock badges for streaks, and climb the leaderboard against friends. Going outside starts to feel like leveling up.",
  },
];

export default function SolutionSection()
{
  let sectionRef = useRef<HTMLElement>(null);
  let headingRef = useRef<HTMLDivElement>(null);

  useEffect(function ()
  {
    let reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let ctx = gsap.context(function ()
    {
      gsap.from(headingRef.current, {
        y: 34,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: headingRef.current, start: "top 82%" },
      });

      // Each step drops in and settles with weight — numbered marker leads,
      // the card follows. Choreographed, not a uniform slide.
      let cards = gsap.utils.toArray<HTMLElement>(".step-card");
      cards.forEach(function (card)
      {
        let marker = card.querySelector(".step-marker");
        let body = card.querySelector(".step-body");

        gsap.from(marker, {
          scale: 0.4,
          opacity: 0,
          duration: 0.7,
          ease: "back.out(2.2)",
          scrollTrigger: { trigger: card, start: "top 84%" },
        });
        gsap.from(body, {
          x: 28,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          delay: 0.08,
          scrollTrigger: { trigger: card, start: "top 84%" },
        });
      });
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  let rows = steps.map(function (s)
  {
    return (
      <article
        key={s.idx}
        className="step-card grid grid-cols-[auto_1fr] items-start gap-5 md:gap-8"
      >
        {/* Numbered clay step marker */}
        <div
          className="step-marker clay-aqua flex h-16 w-16 shrink-0 items-center justify-center rounded-full md:h-20 md:w-20"
          aria-hidden="true"
        >
          <span className="font-display text-2xl font-bold text-ink md:text-3xl">
            {s.idx}
          </span>
        </div>

        <div className="step-body clay clay-press min-w-0 p-6 md:p-8">
          <h3 className="font-display text-[clamp(1.4rem,3vw,2.1rem)] font-semibold leading-tight tracking-tight text-ink">
            {s.title}
          </h3>
          <p className="measure mt-3 text-[0.98rem] leading-relaxed text-ink-soft">
            {s.description}
          </p>
        </div>
      </article>
    );
  });

  return (
    <section
      ref={sectionRef}
      id="features"
      className="relative mx-auto max-w-[1100px] px-6 py-24 md:px-10 md:py-32 lg:px-[clamp(2rem,5vw,5.5rem)]"
    >
      <div ref={headingRef} className="max-w-[44rem]">
        <div className="flex items-center gap-3">
          <span className="font-num text-sm font-bold text-cherry">02</span>
          <span className="kicker">How It Works</span>
        </div>
        <h2 className="font-display mt-6 text-[clamp(2rem,5vw,4rem)] font-semibold leading-[1.02] tracking-tight text-ink">
          Three steps to turn your routine into an{" "}
          <span className="text-cherry">adventure.</span>
        </h2>
      </div>

      <div className="mt-14 flex flex-col gap-8 md:mt-20 md:gap-10">{rows}</div>
    </section>
  );
}
