"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

let team = [
  {
    name: "Rishit Tiwari",
    role: "Co-Founder & CEO",
    bio: "Visionary leader steering Verdure's mission and direction.",
    initials: "RT",
  },
  {
    name: "Lalith Satheesh",
    role: "Co-Founder & CTO",
    bio: "Engineering leader building the tech that powers Verdure.",
    initials: "LS",
  },
  {
    name: "Adithya Prabhu",
    role: "Chief Marketing Officer",
    bio: "Driving Verdure's brand, growth, and marketing strategy.",
    initials: "AP",
  },
  {
    name: "Advaith Prabhu",
    role: "Chief Financial Officer",
    bio: "Financial strategist ensuring Verdure's sustainable growth.",
    initials: "AP",
  },
  {
    name: "Vishvak Gurram",
    role: "Head of Product Strategy",
    bio: "Shaping Verdure's product direction, roadmap, and polish.",
    initials: "VG",
  },
];

export default function TeamSection()
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

      gsap.from(".team-card", {
        y: 40,
        scale: 0.9,
        opacity: 0,
        duration: 0.75,
        ease: "back.out(1.7)",
        stagger: { each: 0.1, grid: "auto", from: "start" },
        scrollTrigger: { trigger: ".team-grid", start: "top 86%" },
      });
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  let members = team.map(function (m, i)
  {
    let isAqua = i % 2 === 0;
    return (
      <article key={i} className="team-card clay clay-press flex flex-col p-7">
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
            isAqua ? "clay-aqua" : "clay-gold"
          }`}
          aria-hidden="true"
        >
          <span className="font-display text-lg font-bold text-ink">
            {m.initials}
          </span>
        </span>
        <h3 className="font-display mt-5 text-[clamp(1.3rem,2.2vw,1.7rem)] font-semibold tracking-tight text-ink">
          {m.name}
        </h3>
        <p className="mt-1.5 font-num text-[11px] font-bold uppercase tracking-[0.14em] text-cherry">
          {m.role}
        </p>
        <p className="mt-3 text-[0.92rem] leading-relaxed text-ink-soft">
          {m.bio}
        </p>
      </article>
    );
  });

  return (
    <section
      ref={sectionRef}
      id="team"
      className="relative mx-auto max-w-[1400px] px-6 py-24 md:px-10 md:py-32 lg:px-[clamp(2rem,5vw,5.5rem)]"
    >
      <div ref={headingRef} className="grid grid-cols-12 items-end gap-x-8 gap-y-6">
        <div className="col-span-12 lg:col-span-7">
          <div className="flex items-center gap-3">
            <span className="font-num text-sm font-bold text-cherry">06</span>
            <span className="kicker">The Team</span>
          </div>
          <h2 className="font-display mt-6 text-[clamp(2rem,5vw,4rem)] font-semibold leading-[1.02] tracking-tight text-ink">
            The people behind <span className="text-cherry">Verdure.</span>
          </h2>
        </div>
        <p className="measure col-span-12 text-[0.98rem] leading-relaxed text-ink-soft lg:col-span-4 lg:col-start-9">
          A small team of designers, engineers, and community builders making
          Verdure happen.
        </p>
      </div>

      <div className="team-grid mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 md:mt-20 md:gap-8">
        {members}
      </div>
    </section>
  );
}
