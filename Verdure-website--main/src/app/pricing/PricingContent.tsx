"use client";

import Link from "next/link";
import PillButton from "@/components/ui/PillButton";
import { useSound } from "@/providers/SoundProvider";
import { PLANS, type Plan } from "@/lib/plans";

/**
 * PricingContent — the dedicated /pricing page. Two plans, from
 * lib/plans.ts (the single owner-approved source). Clean light cards;
 * Verdure+ carries the highlight.
 */
export default function PricingContent()
{
  let sound = useSound();

  let tierCard = function (plan: Plan)
  {
    let features = plan.features.map(function (f)
    {
      return (
        <li key={f} className="flex items-start gap-3 text-left">
          <span
            className="mt-[0.42em] block h-2 w-2 flex-none rotate-45 bg-accent"
            aria-hidden="true"
          />
          <span className="t-body2 font-semibold text-cream/85">{f}</span>
        </li>
      );
    });

    return (
      <div
        key={plan.name}
        className={
          "relative flex flex-col rounded-2xl p-8 md:p-10 " +
          (plan.featured
            ? "border border-[color:var(--accent)] bg-elev shadow-[0_2px_4px_rgba(34,33,27,0.05),0_28px_52px_-28px_rgba(34,33,27,0.28)]"
            : "glass-ink")
        }
      >
        {plan.featured && (
          <span className="kicker absolute -top-3.5 left-8 whitespace-nowrap rounded-full bg-accent px-3.5 py-1.5 !text-[12px] !text-[color:var(--on-accent)]">
            Most popular
          </span>
        )}

        <p className="kicker !text-[12px]">{plan.name}</p>
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-display text-5xl font-bold leading-none md:text-6xl">
            {plan.price}
          </span>
          {plan.cadence && (
            <span className="font-num text-sm text-cream/60">{plan.cadence}</span>
          )}
          {plan.annual && (
            <span className="font-num text-sm text-cream/60">{plan.annual}</span>
          )}
        </p>
        <p className="t-sub2 mt-3 text-cream/70">{plan.tagline}</p>

        <ul className="mt-7 flex flex-col gap-3 border-t border-line pt-7">
          {features}
        </ul>
        {plan.note && <p className="t-body2 mt-4 text-cream/70">{plan.note}</p>}

        <div className="mt-auto pt-9">
          <PillButton
            href="/signup"
            variant={plan.featured ? "cream" : "ink"}
            label="Get Access"
            hoverLabel="Join the waitlist"
            onHover={sound.playHover}
            onPress={sound.playClick}
          />
        </div>
      </div>
    );
  };

  let tiers = PLANS.map(tierCard);

  return (
    <div>
      {/* ------------------------------------------------ intro */}
      <section className="page-pad pb-12 pt-28 md:pb-16 md:pt-36">
        <div className="mx-auto max-w-[1120px]">
          <span className="kicker mb-6 inline-block">Pick your pace</span>
          <div className="grid items-end gap-8 lg:grid-cols-12">
            <h1 className="font-display text-balance text-[clamp(2.4rem,5.5vw,3.8rem)] leading-[1.02] lg:col-span-8">
              One habit. Two ways to walk it.
            </h1>
            <p className="t-body1 measure text-cream/70 lg:col-span-4">
              Verdure is a paid app with a free way to start. Every plan runs
              the same daily loop — real places, real check-ins — the tiers
              decide how far you can take it.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ the plans */}
      <section className="page-pad pb-20 md:pb-28">
        <div className="mx-auto max-w-[1120px]">
          <div className="grid items-stretch gap-6 pt-6 md:gap-8 lg:grid-cols-2">
            {tiers}
          </div>
          <p className="t-body2 mt-10 max-w-[54ch] text-cream/60">
            Verdure is launching soon. Every plan starts from the waitlist —
            and the waitlist walks in first.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ the close */}
      <section className="band--ink page-pad py-20 md:py-28">
        <div className="mx-auto max-w-[1120px]">
          <div className="max-w-3xl">
            <span className="kicker">Start free</span>
            <h2 className="font-display t-h3 mt-5 text-balance leading-[0.98]">
              Begin on the free trail. Upgrade when the habit sticks.
            </h2>
            <p className="t-body1 measure mt-6 text-cream/75">
              Verdure Free costs nothing and keeps the streak honest. When you
              want unlimited planning, early partner perks, and advanced stats,
              Verdure+ is waiting on the same map.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <PillButton
                href="/signup"
                label="Get Access"
                hoverLabel="Join the waitlist"
                onHover={sound.playHover}
                onPress={sound.playClick}
              />
              <Link
                href="/"
                className="link-underline text-base font-bold text-cream"
                onMouseEnter={sound.playHover}
                onClick={sound.playClick}
              >
                See the full journey
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
