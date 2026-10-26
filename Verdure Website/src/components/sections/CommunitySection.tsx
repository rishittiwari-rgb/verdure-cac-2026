"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

let audiences = [
  {
    idx: "01",
    title: "Young Adults",
    age: "21–40",
    description:
      "Swap doomscrolling for real-world exploration. The app curates spots and events matched to your vibe, a short walk from where you already are.",
  },
  {
    idx: "02",
    title: "Students",
    age: "13–20",
    description:
      "Complete campus challenges, discover hidden study spots, and turn ordinary hangouts into adventures — all tracked, all rewarded.",
  },
  {
    idx: "03",
    title: "Parents & Families",
    age: "",
    description:
      "Find safe, engaging outdoor activities nearby, and connect with other local families looking for the same thing.",
  },
];

export default function CommunitySection()
{
  let sectionRef = useRef<HTMLElement>(null);
  let headingRef = useRef<HTMLDivElement>(null);

  useEffect(function ()
  {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx = gsap.context(function ()
    {
      gsap.from(headingRef.current, {
        y: 34,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: headingRef.current, start: "top 82%" },
      });

      // Cards rise and settle on a loose stagger.
      gsap.from(".aud-card", {
        y: 46,
        scale: 0.9,
        opacity: 0,
        duration: 0.8,
        ease: "back.out(1.6)",
        stagger: 0.16,
        scrollTrigger: { trigger: ".aud-grid", start: "top 86%" },
      });
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  let cards = audiences.map(function (a)
  {
    return (
      <article key={a.idx} className="aud-card clay clay-press flex flex-col p-7 md:p-8">
        <div className="flex items-center justify-between gap-3">
          <span className="font-num text-sm font-bold text-cherry">{a.idx}</span>
          {a.age && (
            <span className="clay-sm px-3 py-1 font-num text-[11px] font-semibold tracking-[0.1em] text-ink-soft">
              {a.age}
            </span>
          )}
        </div>
        <h3 className="font-display mt-5 text-[clamp(1.5rem,2.8vw,2.1rem)] font-semibold leading-tight tracking-tight text-ink">
          {a.title}
        </h3>
        <p className="mt-3 text-[0.97rem] leading-relaxed text-ink-soft">
          {a.description}
        </p>
      </article>
    );
  });

  return (
    <section
      ref={sectionRef}
      id="community"
      className="relative mx-auto max-w-[1400px] px-6 py-24 md:px-10 md:py-32 lg:px-[clamp(2rem,5vw,5.5rem)]"
    >
      <div ref={headingRef} className="max-w-[34rem]">
        <div className="flex items-center gap-3">
          <span className="font-num text-sm font-bold text-cherry">04</span>
          <span className="kicker">For Everyone</span>
        </div>
        <h2 className="font-display mt-6 text-[clamp(2rem,5vw,4rem)] font-semibold leading-[1.02] tracking-tight text-ink text-balance">
          Who is the app for?
        </h2>
      </div>

      <div className="aud-grid mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 md:mt-20 md:gap-8">
        {cards}
      </div>
    </section>
  );
}
