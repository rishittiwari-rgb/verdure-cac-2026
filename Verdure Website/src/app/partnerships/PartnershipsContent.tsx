"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
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

gsap.registerPlugin(ScrollTrigger);

const partners: { Icon: LucideIcon; label: string }[] = [
  { Icon: Building2, label: "City governments" },
  { Icon: Trees, label: "Parks departments" },
  { Icon: Library, label: "Libraries" },
  { Icon: HeartHandshake, label: "Nonprofits" },
  { Icon: CalendarDays, label: "Local event organizers" },
  { Icon: Leaf, label: "Eco & health brands" },
];

const benefits: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: TrendingUp,
    title: "More foot traffic",
    body: "Send a steady stream of motivated explorers to your space — we target a +20% lift in the first year.",
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

// Partnership models, presented with the gamification rarity tiers.
const tiers = [
  {
    tier: "Tier 01",
    name: "Municipal",
    accentVar: "var(--aqua-depth)",
    accentClass: "text-aqua-depth",
    ring: "ring-aqua-depth/30",
    description:
      "Promotion and analytics deals with city governments and parks departments to revive public spaces.",
    features: ["In-app promotion", "Visit & engagement analytics", "Seasonal city challenges"],
    glow: false,
  },
  {
    tier: "Tier 02",
    name: "Sponsored Challenges",
    accentVar: "var(--cherry)",
    accentClass: "text-cherry",
    ring: "ring-cherry/30",
    description:
      "Branded challenges and sponsored quests from eco-conscious and health brands, tied to real-world places.",
    features: ["Custom branded quests", "Reward & gem sponsorship", "Audience targeting"],
    glow: false,
  },
  {
    tier: "Tier 03",
    name: "Institutional Rewards",
    accentVar: "var(--cherry)",
    accentClass: "text-cherry",
    ring: "ring-cherry/40",
    description:
      "Reward programs with libraries, schools, and nonprofits that turn participation into lasting habits.",
    features: ["Institutional reward programs", "Member challenge boards", "Impact reporting"],
    glow: true,
  },
];

export default function PartnershipsContent() {
  const rootRef = useRef<HTMLDivElement>(null);
  const sound = useSound();

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.fromTo(
          el,
          { y: 42, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.9,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 95%" },
          }
        );
      });
      requestAnimationFrame(() => {
        ScrollTrigger.refresh();
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          if (el.getBoundingClientRect().top < window.innerHeight) {
            gsap.set(el, { opacity: 1, y: 0 });
          }
        });
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef}>
      {/* ───────────────────── Intro ───────────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 pt-28 pb-14 md:pt-36 md:pb-20 overflow-hidden">
          <div
            className="glow-radial"
            style={{
              width: 600,
              height: 600,
              top: "-8%",
              right: "-4%",
              background:
                "radial-gradient(circle, rgba(5,242,214,0.10), transparent 70%)",
            }}
          />
          <div className="max-w-6xl mx-auto relative z-10">
            <span
              data-reveal
              className="kicker inline-block mb-7 px-5 py-2 rounded-full"
              style={{ border: "1px solid rgba(22,32,46,0.15)" }}
            >
              Partnerships
            </span>
            <div className="grid lg:grid-cols-12 gap-10 items-end">
              <h1
                data-reveal
                className="lg:col-span-8 text-[2.7rem] md:text-6xl lg:text-7xl font-display italic font-black leading-[0.95] tracking-tight text-balance text-ink"
              >
                Bring your space{" "}
                <span className="text-cherry">back to life.</span>
              </h1>
              <p
                data-reveal
                className="lg:col-span-4 text-ink-soft text-base md:text-lg leading-relaxed measure"
              >
                Verdure turns parks, libraries, and local landmarks into
                destinations worth the trip — and turns partners into the
                heart of the experience.
              </p>
            </div>
          </div>
        </section>

        {/* ───────────────── Who we partner with ───────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 py-16 md:py-20">
          <div className="max-w-6xl mx-auto">
            <h2
              data-reveal
              className="kicker mb-8"
            >
              Who we partner with
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {partners.map((p) => (
                <div
                  key={p.label}
                  data-reveal
                  className="flex items-center gap-4 clay clay-press rounded-xl px-5 py-4 transition-colors duration-400 group"
                  onMouseEnter={sound.playHover}
                >
                  <span className="flex items-center justify-center w-10 h-10 rounded-lg clay-sm ring-1 ring-ink/10 group-hover:ring-aqua-depth/45 transition-colors duration-300 shrink-0">

                    <p.Icon size={18} strokeWidth={1.75} className="text-ink-soft" />
                  </span>
                  <span className="text-sm md:text-[15px] text-ink font-medium">
                    {p.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────────────── What partners get ───────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 py-20 md:py-28">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-12 gap-10 items-end mb-14">
              <div className="lg:col-span-7">
                <span
                  data-reveal
                  className="kicker"
                >
                  What partners get
                </span>
                <h2
                  data-reveal
                  className="mt-4 text-3xl md:text-5xl font-display italic font-bold leading-tight text-ink text-balance"
                >
                  Real visits, real data, real reach.
                </h2>
              </div>
              {/* Headline stat */}
              <div
                data-reveal
                className="lg:col-span-5 lg:text-right"
              >
                <div className="font-num text-6xl md:text-7xl font-bold text-cherry tracking-tight">
                  +20%
                </div>
                <p className="text-ink-soft text-sm mt-2 lg:ml-auto max-w-[26ch] lg:text-right">
                  target lift in foot traffic for partner locations within the
                  first year.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              {benefits.map((b) => (
                <div
                  key={b.title}
                  data-reveal
                  className="clay clay-press rounded-2xl p-7 transition-colors duration-500 group"
                  onMouseEnter={sound.playHover}
                >
                  <span className="flex items-center justify-center w-12 h-12 rounded-xl clay-sm ring-1 ring-ink/10 group-hover:ring-aqua-depth/45 transition-colors duration-300">

                    <b.Icon size={22} strokeWidth={1.75} className="text-ink-soft" />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-semibold text-ink">
                    {b.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                    {b.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────────────── Partnership models (rarity tiers) ───────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 py-20 md:py-28">
          <div className="max-w-6xl mx-auto clay-lg p-10 md:p-16 rounded-[36px]">
            <div className="max-w-2xl mb-14">
              <span
                data-reveal
                className="kicker"
              >
                Partnership models
              </span>
              <h2
                data-reveal
                className="mt-4 text-3xl md:text-5xl font-display italic font-bold leading-tight text-ink text-balance"
              >
                Three ways to play.
              </h2>
            </div>

            <div className="grid md:grid-cols-3 gap-5">
              {tiers.map((t) => (
                <div
                  key={t.name}
                  data-reveal
                  className={`relative clay rounded-2xl p-7 flex flex-col ring-1 ${t.ring} hover:-translate-y-1 transition-transform duration-500 overflow-hidden`}
                  onMouseEnter={sound.playHover}
                >
                  {t.glow && (
                    <div
                      className="glow-radial"
                      style={{
                        width: 240,
                        height: 240,
                        top: "-30%",
                        right: "-20%",
                        background:
                          "radial-gradient(circle, rgba(5,242,214,0.12), transparent 70%)",
                      }}
                    />
                  )}
                  {/* Top accent bar */}
                  <span
                    className="absolute top-0 left-0 right-0 h-[3px]"
                    style={{ backgroundColor: t.accentVar }}
                  />
                  <span className="font-num text-[11px] tracking-[0.2em] uppercase text-ink-soft relative z-10">
                    {t.tier}
                  </span>
                  <h3
                    className={`mt-2 font-display text-2xl font-bold relative z-10 ${t.accentClass}`}
                  >
                    {t.name}
                  </h3>
                  <p className="mt-3 text-sm text-ink-soft leading-relaxed relative z-10">
                    {t.description}
                  </p>
                  <ul className="mt-6 space-y-2.5 relative z-10">
                    {t.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2.5 text-sm text-ink"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={t.accentVar}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="mt-0.5 shrink-0"
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────────────── Partner with us CTA ───────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 py-20 md:py-28 overflow-hidden">
          <div
            className="glow-radial"
            style={{
              width: 760,
              height: 760,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background:
                "radial-gradient(circle, rgba(5,242,214,0.10), transparent 66%)",
            }}
          />
          <div className="max-w-3xl mx-auto text-center relative z-10">
            <h2
              data-reveal
              className="text-4xl md:text-6xl font-display italic font-bold leading-tight text-ink text-balance"
            >
              Partner with us.
            </h2>
            <p
              data-reveal
              className="mt-6 text-ink-soft text-lg leading-relaxed measure mx-auto"
            >
              Tell us about your space or brand and we&apos;ll show you what a
              Verdure partnership could look like — from pilot to launch.
            </p>
            <form
              data-reveal
              className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                sound.playSuccess();
              }}
            >
              <input
                type="email"
                required
                placeholder="Work email"
                aria-label="Work email"
                className="w-full sm:w-auto px-6 py-4 rounded-full clay-inset text-ink placeholder:text-ink/55 text-sm focus:outline-none transition-colors duration-300 min-w-[280px]"
                onFocus={sound.playFocus}
              />
              <button
                type="submit"
                className="w-full sm:w-auto clay-cherry clay-press btn-clay whitespace-nowrap cursor-pointer"
                onMouseEnter={sound.playHover}
              >
                Start the conversation
              </button>
            </form>
            <p className="text-ink/55 text-xs mt-4">
              We&apos;ll only use your email to talk partnerships.
            </p>
          </div>
        </section>
    </div>
  );
}
