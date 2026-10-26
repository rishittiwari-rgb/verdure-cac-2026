"use client";

import {
  Building2,
  Trees,
  Library,
  HeartHandshake,
  CalendarDays,
  Leaf,
  TrendingUp,
  BarChart3,
  Megaphone,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useSound } from "@/providers/SoundProvider";
import PillButton from "@/components/ui/PillButton";
import SubmissionForm from "@/components/SubmissionForm";

/**
 * PartnershipsContent — full two-tone editorial restyle. Same real content
 * (who we partner with, what gets measured, the three models); bigger
 * display beats, full-width ink bands, no dead zones.
 */

let PARTNERS: { Icon: LucideIcon; label: string }[] = [
  { Icon: Building2, label: "City governments" },
  { Icon: Trees, label: "Parks departments" },
  { Icon: Library, label: "Libraries" },
  { Icon: HeartHandshake, label: "Nonprofits" },
  { Icon: CalendarDays, label: "Local event organizers" },
  { Icon: Leaf, label: "Eco & health brands" },
];

let BENEFITS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: TrendingUp,
    title: "More foot traffic",
    body: "Send a steady stream of motivated explorers to your space, with the lift in visits measured from day one.",
  },
  {
    Icon: BarChart3,
    title: "Engagement analytics",
    body: "See who's showing up, when, and how often, with dashboards that turn visits into insight.",
  },
  {
    Icon: Megaphone,
    title: "Promotion",
    body: "Get featured in-app to a local, opted-in audience already looking for their next outing.",
  },
  {
    Icon: Trophy,
    title: "Branded challenges & rewards",
    body: "Launch sponsored quests and reward programs that put your name on every check-in.",
  },
];

let MODELS = [
  {
    tier: "01",
    name: "Municipal",
    description:
      "Promotion and analytics deals with city governments and parks departments to revive public spaces.",
    features: ["In-app promotion", "Visit & engagement analytics", "Seasonal city challenges"],
    featured: false,
  },
  {
    tier: "02",
    name: "Sponsored Challenges",
    description:
      "Branded challenges and sponsored quests from eco-conscious and health brands, tied to real-world places.",
    features: ["Custom branded quests", "Reward & gem sponsorship", "Audience targeting"],
    featured: false,
  },
  {
    tier: "03",
    name: "Institutional Rewards",
    description:
      "Reward programs with libraries, schools, and nonprofits that turn participation into lasting habits.",
    features: ["Institutional reward programs", "Member challenge boards", "Impact reporting"],
    featured: true,
  },
];

export default function PartnershipsContent()
{
  let sound = useSound();

  let partnerTiles = PARTNERS.map(function (p)
  {
    return (
      <div
        key={p.label}
        data-reveal
        className="flex items-center gap-5 border-t border-cream/15 py-5"
      >
        <span
          className="flex h-11 w-11 flex-none rotate-45 items-center justify-center rounded-[10px]"
          style={{ background: "#A1CD3F", boxShadow: "0 0 24px -4px rgba(161,205,63,0.45)" }}
          aria-hidden="true"
        >
          <p.Icon size={18} strokeWidth={2.2} className="-rotate-45" style={{ color: "#0C120D" }} />
        </span>
        <span className="t-body1 font-bold">{p.label}</span>
      </div>
    );
  });

  let benefitCards = BENEFITS.map(function (b)
  {
    return (
      <div key={b.title} data-reveal className="border-t border-cream/20 pt-6">
        <b.Icon size={26} strokeWidth={2} className="text-cream" aria-hidden="true" />
        <h3 className="font-display mt-4 text-2xl font-semibold">{b.title}</h3>
        <p className="t-body2 mt-2 max-w-[32ch] text-cream/75">{b.body}</p>
      </div>
    );
  });

  let modelCards = MODELS.map(function (m)
  {
    let features = m.features.map(function (f)
    {
      return (
        <li key={f} className="flex items-start gap-2.5">
          <span
            className="mt-[0.45em] block h-2 w-2 flex-none rotate-45"
            style={{ background: "currentColor", opacity: 0.65 }}
            aria-hidden="true"
          />
          <span className="t-body2 font-semibold opacity-90">{f}</span>
        </li>
      );
    });

    return (
      <div
        key={m.name}
        data-reveal
        className="flex flex-col rounded-[22px] p-7 md:p-8"
        style={
          m.featured
            ? {
                background: "#16261A",
                color: "#F2F5EE",
                boxShadow:
                  "inset 0 0 0 1.5px rgba(161,205,63,0.55), 0 0 44px -10px rgba(161,205,63,0.3)",
              }
            : { border: "1.5px solid #24392C" }
        }
      >
        <span className="font-num text-[12px] tracking-[0.2em] opacity-70">
          TIER {m.tier}
        </span>
        <h3 className="font-display mt-3 text-[1.7rem] font-semibold leading-tight">
          {m.name}
        </h3>
        <p className="t-body2 mt-3 opacity-80">{m.description}</p>
        <ul className="mt-5 flex flex-col gap-2.5">{features}</ul>
      </div>
    );
  });

  return (
    <div>
      {/* ------------------------------------------------ intro */}
      <section className="page-pad overflow-hidden pb-16 pt-32 md:pb-24 md:pt-40">
        <div className="mx-auto max-w-[1400px]">
          <span data-reveal className="kicker mb-7 inline-block">
            Partnerships
          </span>
          <div className="grid items-end gap-10 lg:grid-cols-12">
            <h1
              data-reveal
              className="font-display t-h2 text-balance leading-[0.95] lg:col-span-8"
            >
              Put your space on the daily map.
            </h1>
            <p data-reveal className="t-body1 measure text-cream/70 lg:col-span-4">
              Verdure sends people to parks, libraries, and local landmarks
              every day. Partners sit at the heart of that loop.
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------- who we partner with */}
      <section className="page-pad py-16 md:py-24">
        <div className="mx-auto max-w-[1400px]">
          <span data-reveal className="kicker">
            Who we partner with
          </span>
          <div className="mt-8 grid gap-x-12 md:grid-cols-2 lg:grid-cols-3">
            {partnerTiles}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ measured */}
      <section className="band--ink page-pad py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <span data-reveal className="kicker">
                Real visits, real data, real reach
              </span>
              <h2 data-reveal className="font-display t-h2 mt-4 leading-[0.95]">
                Measured.
              </h2>
              <p data-reveal className="t-body1 measure mt-6 text-cream/80">
                Every check-in is a person who actually showed up. Partners see
                the lift, not a vanity metric.
              </p>
            </div>
            <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:col-span-7">
              {benefitCards}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------- three ways to play */}
      <section className="page-pad py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <span data-reveal className="kicker">
            Partnership models
          </span>
          <h2 data-reveal className="font-display t-h3 mt-4 leading-[0.98]">
            Three ways to play.
          </h2>
          <div className="mt-10 grid gap-5 md:mt-14 lg:grid-cols-3">{modelCards}</div>

          <div
            data-reveal
            className="mt-16 flex flex-col items-center gap-5 border-t border-cream/15 pt-12 text-center md:mt-20"
          >
            <p className="font-display t-sub1 max-w-[30ch] leading-snug">
              Bring a place worth walking to, and we&apos;ll bring the walkers.
            </p>
            <PillButton
              href="#interest"
              variant="ink"
              label="Get in touch"
              hoverLabel="Start the conversation"
              onHover={sound.playHover}
              onPress={sound.playClick}
            />
          </div>
        </div>
      </section>
      <section id="interest" className="submission-interest">
        <div className="submission-interest-intro"><span className="submission-eyebrow">Start a conversation</span>
          <h2>A place for your<br />community.</h2><p>Tell us what you organize or what your business could offer. Our team reviews every request.</p></div>
        <div className="submission-interest-grid">
          <section className="submission-panel"><h3>For organizers</h3><p>Bring your public events to Verdure.</p><SubmissionForm kind="organizer" /></section>
          <section className="submission-panel"><h3>For local businesses</h3><p>Explore an agreed offer for people nearby.</p><SubmissionForm kind="merchant" /></section>
        </div>
      </section>
    </div>
  );
}
