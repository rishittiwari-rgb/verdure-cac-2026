"use client";

import Link from "next/link";
import { useSound } from "@/providers/SoundProvider";
import PillButton from "@/components/ui/PillButton";
import { TEAM, initialsOf } from "@/lib/team";

/**
 * StoryContent — trimmed, editorial. The problem first, then the mission,
 * then the insight. Full-width bands, display-scale type, no dead zones.
 */

let PROBLEM_FACTS = [
  {
    value: "$10B",
    label: "of public-space budgets sit underutilized",
  },
  {
    value: "22%",
    label: "of US adults experience mental illness — over half untreated",
  },
  {
    value: "82%",
    label: "of 18–34s say walking improves their mental health",
  },
];

// The three findings the insight rests on. Kept to what the copy already
// claims — nothing here asserts a statistic the page cannot stand behind.
let INSIGHTS = [
  {
    claim: "A short walk beats no walk.",
    source: "Brief time outdoors moves mood more reliably than longer plans people skip.",
  },
  {
    claim: "Weak ties still count.",
    source: "Passing conversation with familiar strangers measurably lifts wellbeing.",
  },
  {
    claim: "Proximity decides use.",
    source: "People use the green space nearest them, not the best one in the city.",
  },
];

let PILLARS = [
  {
    index: "1",
    title: "Use the spaces",
    body: "Parks, libraries, and landmarks become places people actually go.",
  },
  {
    index: "2",
    title: "Meet the neighbors",
    body: "Solo errands turn into real moments with the people around you.",
  },
  {
    index: "3",
    title: "Keep the habit",
    body: "Streaks and small rewards make going out a routine, not a resolution.",
  },
];

export default function StoryContent()
{
  let sound = useSound();

  let facts = PROBLEM_FACTS.map(function (f)
  {
    return (
      <div key={f.value} data-reveal>
        <div className="font-display text-5xl font-semibold tracking-tight md:text-6xl">
          {f.value}
        </div>
          <p className="t-body2 mt-3 max-w-[22ch] text-cream/70">{f.label}</p>
      </div>
    );
  });

  let pillars = PILLARS.map(function (p)
  {
    return (
      <div key={p.title} data-reveal className="border-t border-cream/15 pt-6">
        <span className="step-dot" aria-hidden="true">{p.index}</span>
        <h3 className="font-display mt-4 text-2xl font-semibold">{p.title}</h3>
        <p className="t-body2 mt-2 text-cream/70">{p.body}</p>
      </div>
    );
  });

  let members = TEAM.map(function (m)
  {
    return (
      <div key={m.name} className="glass-ink flex gap-5 rounded-2xl p-6">
        <span className="initial-dot" aria-hidden="true">
          {initialsOf(m.name)}
        </span>
        <div>
          <p className="text-[1rem] font-semibold leading-tight">{m.name}</p>
          <p className="kicker mt-1 !text-[11px]">{m.role}</p>
          <p className="t-body2 mt-2 text-cream/65">{m.line}</p>
        </div>
      </div>
    );
  });

  return (
    <div>
      {/* ------------------------------------------------ intro */}
      <section className="page-pad overflow-hidden pb-16 pt-32 md:pb-24 md:pt-40">
        <div className="mx-auto max-w-[1400px]">
          <span data-reveal className="kicker mb-7 inline-block">
            Our story
          </span>
          <div className="grid items-end gap-10 lg:grid-cols-12">
            <h1
              data-reveal
              className="font-display t-h2 text-balance leading-[0.95] lg:col-span-8"
            >
              We&apos;re putting the neighborhood back on the map.
            </h1>
            <p data-reveal className="t-body1 measure text-cream/70 lg:col-span-4">
              Verdure began with a simple frustration: our streets, parks, and
              libraries are full of life waiting to happen, and most of us walk
              right past them, heads down.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------- the problem (first) */}
      <section className="band--ink page-pad py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <div className="max-w-2xl">
            <span data-reveal className="kicker">
              The problem
            </span>
            <h2 data-reveal className="font-display t-h3 mt-4 text-balance leading-[0.98]">
              Sedentary, disconnected lifestyles are quietly costing us.
            </h2>
          </div>

          <div className="mt-14 grid gap-10 border-t border-cream/20 pt-10 sm:grid-cols-3 md:mt-16">
            {facts}
          </div>
        </div>
      </section>

      {/* ------------------------------------------- the mission */}
      <section className="page-pad py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <span data-reveal className="kicker">
                The mission
              </span>
              <h2
                data-reveal
                className="font-display t-h3 mt-4 text-balance leading-[0.98]"
              >
                Make the world outside your door worth stepping into.
              </h2>
            </div>
            <p
              data-reveal
              className="t-body1 measure self-center text-cream/70 lg:col-span-7"
            >
              We&apos;re building Verdure so the spaces around us get used
              again. People who go out more are healthier, and blocks where
              people know each other are better places to live.
            </p>
          </div>

          <div className="mt-16 grid gap-x-10 gap-y-10 md:grid-cols-3">{pillars}</div>
        </div>
      </section>

      {/* ------------------------------------------- the insight
          Two columns on review: the claim held the left and the whole
          right of the band was empty plate. The evidence behind the claim
          moves over there, which fills it with something load-bearing
          rather than decoration. */}
      <section className="band--ink page-pad py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <span data-reveal className="kicker">
            The insight
          </span>
          <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <blockquote
                data-reveal
                className="font-display t-h3 text-balance leading-[1.05]"
              >
                The smallest outdoor moments do measurable good.
              </blockquote>
              <p data-reveal className="t-body1 mt-8 max-w-xl text-cream/75">
                Casual hellos lift mood. Green space lowers anxiety, even
                briefly. Walking is the simplest thing that reliably helps.
                None of it needs a program — it just needs going.
              </p>
            </div>
            <ul data-reveal className="lg:col-span-5 lg:self-center">
              {INSIGHTS.map(function (item)
              {
                return (
                  <li
                    key={item.claim}
                    className="border-t border-cream/15 py-5 first:border-t-0 first:pt-0"
                  >
                    <p className="font-display text-[1.35rem] font-semibold leading-tight">
                      {item.claim}
                    </p>
                    <p className="t-body2 mt-1.5 text-cream/65">{item.source}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ the team */}
      <section id="team" className="page-pad py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <span className="kicker">The people</span>
          <h2 className="font-display t-h3 mt-4 max-w-[22ch] text-balance leading-[0.98]">
            The best places near us sat empty. So we built the nudge we wanted.
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------- the close */}
      <section className="band--ink page-pad overflow-hidden py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <span data-reveal className="kicker">
            Where we&apos;re headed
          </span>
          <h2 data-reveal className="font-display t-h2 mt-5 text-balance leading-[0.95]">
            Parks with people in them.
          </h2>
          <p data-reveal className="t-body1 measure mx-auto mt-5 text-cream/70">
            Verdure is gamified, social, and rooted in the real world. It
            nudges people out the door and gives every park a second life.
          </p>
          <div
            data-reveal
            className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <PillButton
              href="/#how"
              variant="ink"
              label="Explore the app"
              hoverLabel="See the loop"
              onHover={sound.playHover}
              onPress={sound.playClick}
            />
            <Link
              href="/partnerships"
              className="link-underline text-base font-semibold text-cream"
              onMouseEnter={sound.playHover}
              onClick={sound.playClick}
            >
              Partner with us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
