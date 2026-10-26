"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Sunrise, Gem, Users, Footprints } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

// Each challenge gets its OWN identity — distinct tile colour, accent bar and
// rarity chip — so no two cards read the same (team feedback).
let challenges = [
  {
    idx: "01",
    title: "Morning Explorer",
    description: "Visit three new outdoor spots before 10 AM.",
    xp: 150,
    rarity: "Common",
    Icon: Sunrise,
    tile: "clay-aqua",
    iconLight: false,
    bar: "var(--aqua)",
    accent: "var(--aqua-depth)",
  },
  {
    idx: "02",
    title: "Gem Collector",
    description: "Find five Daily Gems in your neighborhood.",
    xp: 300,
    rarity: "Rare",
    Icon: Gem,
    tile: "clay-gold",
    iconLight: false,
    bar: "var(--gold)",
    accent: "var(--gold-depth)",
  },
  {
    idx: "03",
    title: "Community Champion",
    description: "Organize a local outdoor event with ten or more people.",
    xp: 500,
    rarity: "Legendary",
    Icon: Users,
    tile: "clay-cherry",
    iconLight: true,
    bar: "var(--cherry)",
    accent: "var(--cherry)",
  },
  {
    idx: "04",
    title: "Trail Blazer",
    description: "Walk a total of fifty kilometres across your area this week.",
    xp: 250,
    rarity: "Epic",
    Icon: Footprints,
    tile: "clay-evergreen",
    iconLight: true,
    bar: "var(--ink)",
    accent: "var(--ink)",
  },
];

export default function GamificationSection()
{
  let sectionRef = useRef<HTMLElement>(null);
  let headingRef = useRef<HTMLDivElement>(null);
  let levelBarRef = useRef<HTMLDivElement>(null);

  useEffect(function ()
  {
    let reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let ctx = gsap.context(function ()
    {
      if (!reduce)
      {
        gsap.from(headingRef.current, {
          y: 36,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: headingRef.current, start: "top 82%" },
        });

        let cards = gsap.utils.toArray<HTMLElement>(".game-card");
        cards.forEach(function (card, i)
        {
          gsap.from(card, {
            y: -34,
            x: i % 2 === 0 ? -18 : 18,
            scale: 0.85,
            opacity: 0,
            duration: 0.8,
            ease: "back.out(1.9)",
            scrollTrigger: { trigger: card, start: "top 88%" },
          });
        });
      }

      gsap.fromTo(
        levelBarRef.current,
        { width: "0%" },
        {
          width: "71%",
          duration: reduce ? 0 : 1.5,
          ease: "power3.out",
          scrollTrigger: { trigger: levelBarRef.current, start: "top 90%" },
        }
      );
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  let cards = challenges.map(function (c)
  {
    let Icon = c.Icon;
    return (
      <article
        key={c.idx}
        className="game-card clay clay-press relative flex flex-col overflow-hidden p-7 md:p-8"
      >
        {/* Distinct accent bar — each card's identity */}
        <span
          className="absolute left-0 top-0 h-1.5 w-full"
          style={{ background: c.bar }}
          aria-hidden="true"
        />

        <div className="flex items-start justify-between gap-4">
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-2xl ${c.tile}`}
            aria-hidden="true"
          >
            <Icon
              size={24}
              className={c.iconLight ? "text-white" : "text-ink"}
              strokeWidth={2.2}
            />
          </span>
          <span
            className="font-num text-3xl font-bold"
            style={{ color: c.accent, opacity: 0.22 }}
          >
            {c.idx}
          </span>
        </div>

        <h3 className="font-display mt-6 text-[clamp(1.3rem,2.4vw,1.8rem)] font-semibold tracking-tight text-ink">
          {c.title}
        </h3>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">
          {c.description}
        </p>

        <div className="mt-6 flex items-center justify-between">
          <span className="clay-sm inline-flex items-center gap-2 px-3 py-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: c.accent }}
              aria-hidden="true"
            />
            <span
              className="font-num text-[11px] font-bold uppercase tracking-[0.12em]"
              style={{ color: c.accent }}
            >
              {c.rarity}
            </span>
          </span>
          <span className="font-num text-base font-bold text-ink">
            +{c.xp}
            <span className="text-ink-soft"> XP</span>
          </span>
        </div>
      </article>
    );
  });

  return (
    <section
      ref={sectionRef}
      id="gamification"
      className="relative mx-auto max-w-[1400px] px-6 py-24 md:px-10 md:py-32 lg:px-[clamp(2rem,5vw,5.5rem)]"
    >
      <div ref={headingRef} className="grid grid-cols-12 items-end gap-x-8 gap-y-6">
        <div className="col-span-12 lg:col-span-7">
          <div className="flex items-center gap-3">
            <span className="font-num text-sm font-bold text-cherry">03</span>
            <span className="kicker">Gamification</span>
          </div>
          <h2 className="font-display mt-6 text-[clamp(2rem,5vw,4rem)] font-semibold leading-[1.02] tracking-tight text-ink">
            Your world. <span className="text-cherry">Your adventure.</span>
          </h2>
        </div>
        <p className="measure col-span-12 text-[0.98rem] leading-relaxed text-ink-soft lg:col-span-4 lg:col-start-9">
          Inside the app you&apos;ll find daily and weekly challenges tuned to
          your area. Complete them to earn XP and unlock real rewards.
        </p>
      </div>

      {/* Challenge cards — four distinct features */}
      <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 md:mt-16 md:gap-8">
        {cards}
      </div>

      {/* Level meter — the clay "active state" moment */}
      <div className="clay-lg mt-12 p-7 md:mt-16 md:p-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <span className="kicker">Your Level</span>
            <div className="font-display mt-1.5 text-3xl font-bold text-ink md:text-4xl">
              Level <span className="font-num align-baseline text-cherry">12</span>
            </div>
          </div>
          <div className="text-right">
            <span className="kicker">Next Reward</span>
            <div className="mt-1.5 font-num text-base font-semibold text-ink md:text-lg">
              850 <span className="text-ink-soft">/ 1200 XP</span>
            </div>
          </div>
        </div>
        <div className="clay-inset mt-5 h-4 w-full overflow-hidden rounded-full p-0.5">
          <div
            ref={levelBarRef}
            className="h-full rounded-full"
            style={{
              width: "0%",
              background: "linear-gradient(90deg, var(--aqua-depth), var(--aqua) 55%, var(--gold))",
              boxShadow: "inset 0 2px 4px var(--aqua-gloss)",
            }}
          />
        </div>
      </div>
    </section>
  );
}
