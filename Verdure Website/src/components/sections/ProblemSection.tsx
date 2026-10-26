"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

let problems = [
  {
    idx: "01",
    stat: "80",
    unit: "%",
    label: "of adults spend less than two hours outdoors on an average day",
    variant: "silica",
  },
  {
    idx: "02",
    stat: "62",
    unit: "%",
    label: "of community spaces sit underused or quietly forgotten",
    variant: "aqua",
  },
  {
    idx: "03",
    stat: "45",
    unit: "%",
    label: "report feeling disconnected from the neighborhood around them",
    variant: "silica",
  },
];

export default function ProblemSection()
{
  let sectionRef = useRef<HTMLElement>(null);
  let headingRef = useRef<HTMLDivElement>(null);

  useEffect(function ()
  {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx = gsap.context(function ()
    {
      gsap.from(headingRef.current, {
        y: 36,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: headingRef.current, start: "top 82%" },
      });

      // Tiles inflate with weight and a varied lead — not a uniform fade.
      gsap.from(".stat-tile", {
        scale: 0.78,
        y: 40,
        opacity: 0,
        duration: 0.85,
        ease: "back.out(1.7)",
        stagger: { each: 0.14, from: "start" },
        scrollTrigger: { trigger: ".stat-grid", start: "top 84%" },
      });
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  let tiles = problems.map(function (p)
  {
    let isAqua = p.variant === "aqua";
    let numberClass = isAqua ? "text-ink" : "text-cherry";
    return (
      <div
        key={p.idx}
        className={`stat-tile clay-press flex flex-col p-8 md:p-9 ${
          isAqua ? "clay-aqua" : "clay"
        }`}
      >
        <span
          className={`font-num text-sm font-semibold tracking-[0.16em] ${
            isAqua ? "text-ink/70" : "text-ink-soft"
          }`}
        >
          {p.idx}
        </span>
        <div className="mt-4 flex items-start">
          <span
            className={`font-display text-[clamp(3.6rem,8vw,6.4rem)] font-bold leading-[0.85] tracking-tight ${numberClass}`}
          >
            {p.stat}
          </span>
          <span
            className={`mt-2 font-display text-[clamp(1.4rem,2.4vw,2.2rem)] font-semibold ${
              isAqua ? "text-ink/80" : "text-ink-soft"
            }`}
          >
            {p.unit}
          </span>
        </div>
        <p
          className={`mt-5 text-[0.97rem] leading-relaxed ${
            isAqua ? "text-ink/85" : "text-ink-soft"
          }`}
        >
          {p.label}
        </p>
      </div>
    );
  });

  return (
    <section
      ref={sectionRef}
      className="relative mx-auto max-w-[1400px] px-6 py-24 md:px-10 md:py-32 lg:px-[clamp(2rem,5vw,5.5rem)]"
    >
      <div ref={headingRef} className="max-w-[40rem]">
        <div className="flex items-center gap-3">
          <span className="font-num text-sm font-bold text-cherry">01</span>
          <span className="kicker">The Problem</span>
        </div>
        <h2 className="font-display mt-6 text-[clamp(2rem,5vw,4rem)] font-semibold leading-[1.04] tracking-tight text-ink text-balance">
          The world outside{" "}
          <span className="text-cherry">deserves more attention.</span>
        </h2>
      </div>

      <div className="stat-grid mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 md:mt-20 md:gap-8">
        {tiles}
      </div>
    </section>
  );
}
