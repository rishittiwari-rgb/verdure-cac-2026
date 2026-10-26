"use client";

import { useState } from "react";
import Link from "next/link";
import DemoModal from "@/components/ui/DemoModal";
import PillButton, { PlayGlyph } from "@/components/ui/PillButton";
import WaitlistForm from "@/components/ui/WaitlistForm";
import HomeOpening from "@/components/fx/site-background/HomeOpening";
import { useSound } from "@/providers/SoundProvider";
import {
  MapPin,
  ScanLine,
  Sunrise,
  Compass,
  Users,
  Building2,
  type LucideIcon,
} from "lucide-react";

/**
 * The homepage — the 300vh photographic opening carries the wordmark and
 * the two beats of copy that used to open the page, then the content-first
 * read continues underneath: how it works, who it's for, why it matters,
 * links out to the deeper pages, and the waitlist close.
 */

let STEPS: { Icon: LucideIcon; caption: string; body: string }[] = [
  {
    Icon: MapPin,
    caption: "Your map drops a few real places.",
    body: "Three spots picked for the morning — a park, a mural, a bench you have never met.",
  },
  {
    Icon: ScanLine,
    caption: "Check in when you arrive.",
    body: "One tap on site. The day counts, the points land.",
  },
  {
    Icon: Sunrise,
    caption: "Come back tomorrow, the map changes.",
    body: "A fresh set at sunrise. Miss a day and the streak starts over.",
  },
];

let AUDIENCES: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Compass,
    title: "Explorers",
    body: "Students and anyone who wants somewhere to actually go — quests, streaks, and hangout spots near you.",
  },
  {
    Icon: Users,
    title: "Neighbors",
    body: "Adults and parents reconnecting with the parks, libraries, and people around them.",
  },
  {
    Icon: Building2,
    title: "Partners",
    body: "Cities, libraries, and local brands that want real foot traffic they can measure.",
  },
];

// The opening's summary of the loop. Deliberately NOT the STEPS copy: the
// "How it unfolds" section below already carries that in full, and running
// the same three sentences twice on one page reads as a mistake. This is
// the one-glance version; that one is the read.
let LOOP_SUMMARY = [
  { verb: "Open the map", note: "Three places, chosen overnight." },
  { verb: "Go and check in", note: "One tap, on site. The day counts." },
  { verb: "Keep the streak", note: "Points, rewards, and a reason to repeat." },
];

// Numbered on review: as three identical pills they read as one control
// repeated rather than three destinations. The blurb is what actually
// tells them apart, the number is what makes you look.
let MORE_PAGES = [
  { label: "Our Story", href: "/story", blurb: "Why we built the nudge we wanted." },
  { label: "Pricing", href: "/pricing", blurb: "Free forever, or Verdure+ at $4.99." },
  { label: "Roadmap", href: "/roadmap", blurb: "Closed beta, then partners, then cities." },
];

export default function HomeSections()
{
  let [demoOpen, setDemoOpen] = useState(false);
  let sound = useSound();

  let steps = STEPS.map(function (step, i)
  {
    return (
      <div key={step.caption} className="glass-ink rounded-2xl p-7 group">
        <div className="flex items-center gap-3 mb-5">
          <span className="step-dot" aria-hidden="true">{i + 1}</span>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-accent-ink transition-all duration-300 group-hover:border-accent/40 group-hover:bg-accent/10"
            aria-hidden="true"
          >
            <step.Icon size={17} strokeWidth={1.8} />
          </span>
        </div>
        <h3 className="font-display text-[1.45rem] font-semibold leading-tight">
          {step.caption}
        </h3>
        <p className="t-body2 mt-2.5 text-cream/65">{step.body}</p>
      </div>
    );
  });

  let audiences = AUDIENCES.map(function (a)
  {
    return (
      <div key={a.title} className="glass-ink rounded-2xl p-7 group">
        <span
          className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-elev text-accent-ink transition-all duration-300 group-hover:border-accent/40 group-hover:bg-accent/10"
          aria-hidden="true"
        >
          <a.Icon size={20} strokeWidth={1.6} />
        </span>
        <h3 className="font-display text-[1.5rem] font-semibold leading-tight">{a.title}</h3>
        <p className="t-body2 mt-2.5 text-cream/65">{a.body}</p>
      </div>
    );
  });

  let morePages = MORE_PAGES.map(function (page, i)
  {
    return (
      <Link
        key={page.href}
        href={page.href}
        className="glass-ink rounded-2xl p-6 group"
        onMouseEnter={sound.playHover}
        onClick={sound.playClick}
      >
        <div className="flex items-center justify-between">
          <span className="step-dot" aria-hidden="true">{i + 1}</span>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-accent-ink transition-all duration-300 group-hover:border-accent/40 group-hover:bg-accent/10"
            aria-hidden="true"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
        <span className="mt-5 block font-display text-[1.25rem] font-semibold">{page.label}</span>
        <span className="t-body2 mt-1.5 block text-cream/65">{page.blurb}</span>
      </Link>
    );
  });

  // The opening's two slots. Both carry copy that used to sit in the
  // page below, moved rather than duplicated.
  // The right half of the opening's second screen. Review found that side
  // empty and the copy alone too thin to explain the app, so the daily
  // loop states itself here instead of waiting for the section below.
  let openingLoop = (
    <ol className="vd-loopcard" aria-label="The daily loop">
      {LOOP_SUMMARY.map(function (step, i)
      {
        return (
          <li key={step.verb} className="vd-loopcard__row">
            <span className="step-dot" aria-hidden="true">{i + 1}</span>
            <span>
              <span className="vd-loopcard__title">{step.verb}</span>
              <span className="vd-loopcard__body">{step.note}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );

  let openingLead = (
    <div className="vd-bg-copy">
      {/* The visible opening is a kicker and a lead, neither of which is a
          heading, so the page needs a real h1 and this is it. It says what
          the page is rather than repeating the tagline, which is what both a
          crawler and a screen reader want from the first heading — the
          tagline itself is right below, in the kicker. */}
      <h1 className="sr-only">
        Verdure — explore local places near you, every day
      </h1>
      <span className="kicker" aria-hidden="true">
        Step outside. Connect within.
      </span>
      {/* Review read the old line as a GPS: it said where the places were
          and nothing about what happens when you go. This keeps the map
          in the first clause and spends the rest on the parts that make
          it a habit — the streak, what the points are worth, and the
          people already there. */}
      <p className="vd-lead mt-5 max-w-[30ch] text-balance">
        Three real places near you, every morning.
      </p>
      <p className="t-body1 mt-4 max-w-[46ch]">
        Show up and check in to build a streak, earn points worth real gift
        cards, and run into the neighbours already out there. The map
        resets at sunrise, so there is always somewhere new to go.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <PillButton
          href="/signup"
          label="Get Access"
          hoverLabel="Join the waitlist"
          onHover={sound.playHover}
          onPress={sound.playClick}
        />
        <PillButton
          variant="ink"
          label="Watch the demo"
          hoverLabel="2 min tour"
          glyph={<PlayGlyph />}
          onHover={sound.playHover}
          onPress={function ()
          {
            sound.playClick();
            setDemoOpen(true);
          }}
        />
      </div>
    </div>
  );

  let openingLeadRow = (
    <div className="vd-bg-split">
      {openingLead}
      {openingLoop}
    </div>
  );

  // The streak, drawn. Review found the left of this screen empty and the
  // copy hard to pin down; a week of filled days says "this is the thing
  // you keep" faster than the sentence does.
  let streakStrip = (
    <div className="vd-streak" aria-hidden="true">
      <span className="vd-streak__label">A week in</span>
      <span className="vd-streak__days">
        {["M", "T", "W", "T", "F", "S", "S"].map(function (d, i)
        {
          return (
            <span
              key={d + i}
              className={"vd-streak__day" + (i < 5 ? " is-done" : "")}
            >
              {d}
            </span>
          );
        })}
      </span>
      <span className="vd-streak__caption">5 days out. Two to go.</span>
    </div>
  );

  let openingHabit = (
    <div className="vd-bg-split vd-bg-split--habit">
      {streakStrip}
      <div className="vd-bg-copy">
        <h2 className="font-display text-[clamp(2rem,4.4vw,3rem)] font-semibold leading-[1.05]">
          One habit
        </h2>
        {/* Gold, not the pale green it shared with the paragraph under it —
            review could not tell the two lines apart. */}
        <p className="t-sub2 vd-goldline mt-3">Walk. Check in. Grow.</p>
        <p className="t-body1 measure mt-5">
          No feed, no scroll, nothing to catch up on. Verdure opens on a map,
          you check in where you actually stand, and the streak is the only
          number that grows.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <HomeOpening sectionTwo={openingLeadRow} sectionThree={openingHabit} />

      <div className="vd-page-body">
        {/* ------------------------------------------------ how it works */}
        <section id="how" className="band--ink page-pad py-16 md:py-24">
          <div className="mx-auto max-w-[1120px]">
            <span className="kicker">How it unfolds</span>
            <div className="mt-8 grid gap-5 md:grid-cols-3">{steps}</div>
          </div>
        </section>

        {/* ------------------------------------------------ who it's for */}
        <section id="for" className="page-pad py-16 md:py-24">
          <div className="mx-auto max-w-[1120px]">
            {/* Review asked for this one bigger and in gold — it was
                labelling three cards and reading like their caption. */}
            <h2 className="kicker kicker--lg">Made for everyone.</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">{audiences}</div>
          </div>
        </section>

        {/* ------------------------------------------------ why it matters.
            The "One habit" half of this now opens the page, over the
            photograph, so only the ReDiscovered half is left here. */}
        {/* Review clocked this as visibly shorter than the two sections
            above it. It was: those carry a three-card grid and this was a
            heading over two lines. It keeps the same vertical rhythm and
            fills the width with the contrast it is actually making. */}
        <section id="why" className="band--ink page-pad py-16 md:py-24">
          <div className="mx-auto max-w-[1120px]">
            <span className="kicker">The shift</span>
            <h2 className="font-display mt-5 text-[clamp(2rem,4.4vw,3rem)] font-bold leading-[1.05]">
              Re<em className="not-italic text-accent-ink">Discovered</em>.
            </h2>
            <p className="t-body1 measure mt-5 text-cream/75">
              A daily loop that makes going outside the easy option.
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <div className="glass-ink rounded-2xl p-7">
                <span className="kicker">By default</span>
                <p className="t-body1 mt-3 text-cream/75">
                  Same couch. Same glow. The feed always wins — while the best
                  bench in town sits empty.
                </p>
              </div>
              <div className="glass-ink rounded-2xl p-7">
                <span className="kicker">With Verdure</span>
                <p className="t-body1 mt-3 text-cream/75">
                  Three places worth the walk, picked before you wake up, and a
                  streak that only counts the days you actually went.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ more pages */}
        <section className="page-pad py-16 md:py-24">
          <div className="mx-auto max-w-[1120px]">
            <div className="grid gap-5 md:grid-cols-3">{morePages}</div>
          </div>
        </section>

        {/* ------------------------------------------------ the close */}
        <section id="join" className="band--ink page-pad py-16 md:py-24">
          <div className="mx-auto max-w-[820px] text-center">
            <h2 className="font-display text-balance text-[clamp(2.1rem,5vw,3.4rem)] font-semibold leading-[1.04]">
              One map. Every morning.
            </h2>
            <p className="t-body1 mx-auto mt-4 max-w-[44ch] text-cream/75">
              A few real places worth leaving the house for, picked while you
              sleep — and a streak that only grows outside.
            </p>
            <div className="mt-8">
              <WaitlistForm source="home" tone="cream" />
            </div>
          </div>
        </section>
      </div>

      <DemoModal open={demoOpen} onClose={function () { setDemoOpen(false); }} />
    </>
  );
}
