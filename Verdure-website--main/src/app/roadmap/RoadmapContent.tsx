"use client";

import Link from "next/link";
import PillButton from "@/components/ui/PillButton";
import { useSound } from "@/providers/SoundProvider";
import { MILESTONES, type Milestone } from "@/lib/milestones";

/**
 * RoadmapContent — the dedicated /roadmap page: the four owner-approved
 * milestones from lib/milestones.ts (shared with the landing Roadmap beat)
 * walked as a left-rail trail of ink-glass cards. No dates are invented;
 * status chips carry the only promises we make.
 */
export default function RoadmapContent()
{
  let sound = useSound();

  let milestoneCard = function (m: Milestone, i: number)
  {
    let chipStyle = m.filled
      ? { background: "var(--accent)", color: "var(--on-accent)" }
      : { border: "1px solid var(--line)", color: "var(--text)" };

    return (
      <li key={m.title} className="relative">
        {/* diamond waypoint on the rail */}
        <span
          className={
            "absolute -left-[39px] top-[0.55rem] block h-3 w-3 rotate-45 md:-left-[63px] " +
            (m.filled
              ? "bg-accent"
              : "bg-elev shadow-[inset_0_0_0_1.5px_var(--line)]")
          }
          aria-hidden="true"
        />

        {/* No card — the words carry the trail. */}
        <div className="max-w-3xl">
          {/* The stage marker was "01 / 04" in fine grey type, which review
              found hard to follow down the page. It is the same numbered
              circle the rest of the site uses now, with the total kept
              beside it so the sequence still has an end. */}
          <div className="flex flex-wrap items-center gap-4">
            <span className="step-dot" aria-hidden="true">{i + 1}</span>
            <span className="font-num text-[13px] tracking-[0.2em] text-cream/55">
              of 0{MILESTONES.length}
            </span>
            <span className="kicker rounded-full px-4 py-1.5 !text-[12px]" style={chipStyle}>
              {m.status}
            </span>
          </div>
          <h2 className="font-display mt-5 text-balance text-[clamp(2.4rem,7vw,4.2rem)] leading-[1.02]">
            {m.title}
          </h2>
          <p className="t-body1 measure mt-4 text-cream/70">{m.body}</p>
        </div>
      </li>
    );
  };

  let milestones = MILESTONES.map(milestoneCard);

  return (
    <div>
      {/* ------------------------------------------------ intro */}
      <section className="page-pad overflow-hidden pb-16 pt-32 md:pb-20 md:pt-44">
        <div className="mx-auto max-w-[1400px]">
          <span data-reveal className="kicker mb-7 inline-block">
            The trail ahead
          </span>
          <div className="grid items-end gap-10 lg:grid-cols-12">
            <h1
              data-reveal
              className="font-display t-h2 text-balance leading-[0.95] lg:col-span-8"
            >
              Where the trail goes next.
            </h1>
            <p data-reveal className="t-body1 measure text-cream/70 lg:col-span-4">
              Four milestones, in the order we&apos;ll walk them. No dates we
              can&apos;t keep — when a step gets close, the waitlist hears it
              first.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ the trail */}
      <section className="page-pad pb-24 md:pb-32">
        <div className="mx-auto max-w-[1400px]">
          <ol className="relative ml-1.5 flex flex-col gap-16 border-l border-line pl-8 md:ml-2.5 md:gap-24 md:pl-14">
            {milestones}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------ the close */}
      <section className="band--ink page-pad py-24 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <div className="max-w-3xl">
            <span data-reveal className="kicker">
              Walk it with us
            </span>
            <h2
              data-reveal
              className="font-display t-h3 mt-5 text-balance leading-[0.98]"
            >
              Be there when the doors open.
            </h2>
            <p data-reveal className="t-body1 measure mt-6 text-cream/80">
              Join the waitlist and you&apos;ll hear about each milestone as
              it lands — and walk in first at launch.
            </p>
            <div
              data-reveal
              className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4"
            >
              <PillButton
                href="/signup"
                label="Get Access"
                hoverLabel="Join the waitlist"
                onHover={sound.playHover}
                onPress={sound.playClick}
              />
              <Link
                href="/story"
                className="link-underline text-base font-bold text-cream"
                onMouseEnter={sound.playHover}
                onClick={sound.playClick}
              >
                Read our story
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
