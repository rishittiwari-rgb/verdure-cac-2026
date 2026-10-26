"use client";

import { ReactNode, useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Sprout, Trees, Building2, Rocket, Check, Flag } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

type Phase = {
  label: string;
  window: string;
  title: string;
  summary: string;
  Icon: typeof Sprout;
  tile: string;
  iconLight: boolean;
  accent: string;
  milestones: ReactNode[];
};

let phases: Phase[] = [
  {
    label: "Phase 01",
    window: "Now",
    title: "Pilot & Closed Beta",
    summary:
      "Prove the loop in the real world with a tight group of founding explorers.",
    Icon: Sprout,
    tile: "clay-aqua",
    iconLight: false,
    accent: "var(--aqua-depth)",
    milestones: [
      <>
        Launch in <span className="font-num font-semibold">2–3</span> urban areas
      </>,
      <>Ship core features: Daily Gems, check-ins, XP &amp; badges</>,
      <>Gather feedback and tune the experience</>,
    ],
  },
  {
    label: "Phase 02",
    window: "Next",
    title: "Open Beta & Community",
    summary:
      "Open the doors, wire in local partners, and let the community drive growth.",
    Icon: Trees,
    tile: "clay-gold",
    iconLight: false,
    accent: "var(--gold-depth)",
    milestones: [
      <>Community boards go live</>,
      <>Partnerships with libraries &amp; parks</>,
      <>Referral program for organic growth</>,
      <>Load-test the systems for scale</>,
    ],
  },
  {
    label: "Phase 03",
    window: "Then",
    title: "Public Launch & Monetization",
    summary:
      "Go wide, turn on revenue, and bring institutions on board at volume.",
    Icon: Building2,
    tile: "clay-cherry",
    iconLight: true,
    accent: "var(--cherry)",
    milestones: [
      <>Premium subscription launches</>,
      <>
        <span className="font-num font-semibold">100+</span> institutional partners
      </>,
      <>Branded challenges with sponsors</>,
    ],
  },
  {
    label: "Phase 04",
    window: "Beyond",
    title: "Scale",
    summary:
      "Expand city by city, deepen partnerships, and reach a sustainable footing.",
    Icon: Rocket,
    tile: "clay-evergreen",
    iconLight: true,
    accent: "var(--ink)",
    milestones: [
      <>Expand to new metros</>,
      <>Deepen partnerships nationwide</>,
      <>
        Hit <span className="font-num font-semibold">1M</span> collective outdoor hours
      </>,
      <>Reach break-even</>,
    ],
  },
];

export default function RoadmapSection()
{
  let sectionRef = useRef<HTMLElement>(null);
  let headerRef = useRef<HTMLDivElement>(null);
  let trailWrapRef = useRef<HTMLDivElement>(null);
  let trailFillRef = useRef<HTMLDivElement>(null);

  useEffect(function ()
  {
    let reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let ctx = gsap.context(function ()
    {
      if (reduce)
      {
        gsap.set(trailFillRef.current, { scaleY: 1 });
        return;
      }

      gsap.from(headerRef.current, {
        y: 34,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top 82%" },
      });

      // The trail draws itself as you walk the journey.
      gsap.fromTo(
        trailFillRef.current,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: "none",
          scrollTrigger: {
            trigger: trailWrapRef.current,
            start: "top 72%",
            end: "bottom 78%",
            scrub: 0.6,
          },
        }
      );

      let stops = gsap.utils.toArray<HTMLElement>(".trail-stop");
      stops.forEach(function (stop)
      {
        let node = stop.querySelector(".trail-node");
        let card = stop.querySelector(".trail-card");
        gsap.from(node, {
          scale: 0.3,
          opacity: 0,
          duration: 0.6,
          ease: "back.out(2.4)",
          scrollTrigger: { trigger: stop, start: "top 80%" },
        });
        gsap.from(card, {
          y: 40,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: stop, start: "top 80%" },
        });
      });
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  let stops = phases.map(function (p, i)
  {
    let onLeft = i % 2 === 0;
    let Icon = p.Icon;

    let milestones = p.milestones.map(function (m, mi)
    {
      return (
        <li key={mi} className="flex items-start gap-2.5 text-[0.92rem] text-ink-soft">
          <Check
            size={16}
            strokeWidth={3}
            className="mt-0.5 shrink-0"
            style={{ color: p.accent }}
            aria-hidden="true"
          />
          <span>{m}</span>
        </li>
      );
    });

    let card = (
      <div className="trail-card clay clay-press flex flex-col p-7 md:p-8">
        <div className="flex items-center justify-between gap-3">
          <span className="font-num text-sm font-bold tracking-[0.12em] text-ink-soft">
            {p.label}
          </span>
          <span
            className="clay-sm px-3 py-1 font-num text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: p.accent }}
          >
            {p.window}
          </span>
        </div>
        <h3 className="font-display mt-3 text-[clamp(1.4rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
          {p.title}
        </h3>
        <p className="mt-2.5 text-[0.95rem] leading-relaxed text-ink-soft">
          {p.summary}
        </p>
        <ul className="mt-5 grid gap-y-2.5">{milestones}</ul>
      </div>
    );

    return (
      <div
        key={p.label}
        className="trail-stop relative py-7 md:grid md:grid-cols-2 md:gap-x-24 md:py-9"
      >
        {/* Milestone node sitting on the trail */}
        <div className="trail-node absolute left-[28px] top-7 z-10 -translate-x-1/2 md:left-1/2 md:top-9">
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-full ${p.tile}`}
          >
            <Icon
              size={24}
              strokeWidth={2.1}
              className={p.iconLight ? "text-white" : "text-ink"}
            />
          </span>
        </div>

        {/* Card — alternates sides on desktop, stacks right of trail on mobile */}
        <div
          className={`pl-20 md:pl-0 ${
            onLeft ? "md:col-start-1 md:pr-4" : "md:col-start-2 md:pl-4"
          }`}
        >
          {card}
        </div>
      </div>
    );
  });

  return (
    <section
      ref={sectionRef}
      id="roadmap"
      className="relative mx-auto max-w-[1280px] px-6 py-24 md:px-10 md:py-32 lg:px-[clamp(2rem,5vw,5.5rem)]"
    >
      <div ref={headerRef} className="grid grid-cols-12 items-end gap-x-8 gap-y-6">
        <div className="col-span-12 lg:col-span-7">
          <div className="flex items-center gap-3">
            <span className="font-num text-sm font-bold text-cherry">05</span>
            <span className="kicker">The Journey</span>
          </div>
          <h2 className="font-display mt-6 text-[clamp(2rem,5vw,4rem)] font-semibold leading-[1.02] tracking-tight text-ink">
            From pilot to <span className="text-cherry">scale.</span>
          </h2>
        </div>
        <p className="measure col-span-12 text-[0.98rem] leading-relaxed text-ink-soft lg:col-span-4 lg:col-start-9">
          Four stops on the trail — concrete milestones for how Verdure grows
          from a closed beta into a self-sustaining community platform.
        </p>
      </div>

      {/* The trail */}
      <div ref={trailWrapRef} className="relative mt-16 md:mt-24">
        {/* Start marker */}
        <div className="absolute left-[28px] top-0 z-10 -translate-x-1/2 md:left-1/2">
          <span className="clay-sm flex h-9 items-center gap-1.5 rounded-full px-3">
            <Sprout size={14} strokeWidth={2.4} style={{ color: "var(--aqua-depth)" }} />
            <span className="font-num text-[10px] font-bold uppercase tracking-[0.16em] text-ink-soft">
              Start
            </span>
          </span>
        </div>

        {/* Trail groove + drawn progress fill */}
        <div
          className="pointer-events-none absolute bottom-10 top-12 left-[28px] w-1.5 -translate-x-1/2 rounded-full clay-inset md:left-1/2"
          aria-hidden="true"
        />
        <div
          ref={trailFillRef}
          className="pointer-events-none absolute bottom-10 top-12 left-[28px] w-1.5 origin-top -translate-x-1/2 rounded-full md:left-1/2"
          style={{
            transform: "translateX(-50%) scaleY(0)",
            background:
              "linear-gradient(180deg, var(--aqua), var(--gold) 50%, var(--cherry))",
          }}
          aria-hidden="true"
        />

        <div className="relative pt-12">{stops}</div>

        {/* Goal marker */}
        <div className="absolute bottom-0 left-[28px] z-10 -translate-x-1/2 md:left-1/2">
          <span className="clay-cherry flex h-11 w-11 items-center justify-center rounded-full">
            <Flag size={18} strokeWidth={2.3} className="text-white" />
          </span>
        </div>
      </div>
    </section>
  );
}
