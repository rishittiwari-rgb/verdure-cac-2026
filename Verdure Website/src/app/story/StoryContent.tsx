"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Sparkles, Trees, HeartPulse } from "lucide-react";
import { useSound } from "@/providers/SoundProvider";

gsap.registerPlugin(ScrollTrigger);

const pillars = [
  {
    Icon: Trees,
    title: "Revitalize",
    body: "Bring underused parks, libraries, and landmarks back to life as places people actually want to be.",
  },
  {
    Icon: HeartPulse,
    title: "Reconnect",
    body: "Turn solo errands and idle scrolling into real-world moments with neighbors and nature.",
  },
  {
    Icon: Sparkles,
    title: "Strengthen",
    body: "Build healthier routines and stronger local ties, one small outdoor adventure at a time.",
  },
];

const problemStats = [
  { value: "22%", label: "of US adults experience mental illness each year" },
  { value: "50%+", label: "of them go untreated" },
  { value: "$10B", label: "in public amenities sit underused" },
];

export default function StoryContent() {
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
        <section className="relative px-6 md:px-12 lg:px-24 pt-28 pb-16 md:pt-36 md:pb-24 overflow-hidden">
          <div
            className="glow-radial"
            style={{
              width: 620,
              height: 620,
              top: "-6%",
              left: "-4%",
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
              Our Story
            </span>
            <div className="grid lg:grid-cols-12 gap-10 items-end">
              <h1
                data-reveal
                className="lg:col-span-8 text-[2.7rem] md:text-6xl lg:text-7xl font-display italic font-black leading-[0.95] tracking-tight text-balance text-ink"
              >
                Reconnecting people with their{" "}
                <span className="text-cherry">place</span> — and each other.
              </h1>
              <p
                data-reveal
                className="lg:col-span-4 text-ink-soft text-base md:text-lg leading-relaxed measure"
              >
                Verdure began with a simple frustration: our streets, parks,
                and libraries are full of life waiting to happen — and most of us
                walk right past them, heads down.
              </p>
            </div>
          </div>
        </section>

        {/* ───────────────────── Mission ───────────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 py-20 md:py-28">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-12 gap-12">
              <div className="lg:col-span-5">
                <span
                  data-reveal
                  className="kicker"
                >
                  The Mission
                </span>
                <h2
                  data-reveal
                  className="mt-4 text-3xl md:text-4xl lg:text-5xl font-display italic font-bold leading-tight text-ink text-balance"
                >
                  Make the world outside your door worth stepping into.
                </h2>
              </div>
              <p
                data-reveal
                className="lg:col-span-7 self-center text-ink-soft text-lg md:text-xl leading-relaxed measure"
              >
                We&apos;re building Verdure to reconnect people with their
                local environments and with each other — to revitalize the
                underused public spaces around us, from neighborhood parks to
                libraries to landmarks, and to drive healthier lifestyles and
                stronger communities in the process.
              </p>
            </div>

            {/* Three pillars */}
            <div className="grid md:grid-cols-3 gap-5 mt-16">
              {pillars.map((p) => (
                <div
                  key={p.title}
                  data-reveal
                  className="clay rounded-2xl p-7 transition-colors duration-500 group clay-press"
                  onMouseEnter={sound.playHover}
                >
                  <span className="flex items-center justify-center w-12 h-12 rounded-xl clay-sm ring-1 ring-ink/10 group-hover:ring-aqua-depth/45 transition-colors duration-300">

                    <p.Icon size={22} strokeWidth={1.75} className="text-ink-soft" />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-semibold text-ink">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ──────────────── The problem (raised panel section) ──────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 py-20 md:py-28">
          <div className="max-w-6xl mx-auto clay-lg rounded-[36px] p-10 md:p-16">
            <div className="max-w-2xl">
              <span
                data-reveal
                className="kicker"
              >
                The Problem We Exist For
              </span>
              <h2
                data-reveal
                className="mt-4 text-3xl md:text-5xl font-display italic font-bold leading-tight text-ink text-balance"
              >
                Sedentary, disconnected lifestyles are quietly costing us.
              </h2>
              <p
                data-reveal
                className="mt-6 text-ink-soft text-lg leading-relaxed measure"
              >
                We spend more time indoors and online than any generation before
                us. The toll shows up in our health, our happiness, and in the
                public spaces we&apos;ve stopped using.
              </p>
            </div>

            <div
              className="grid sm:grid-cols-3 gap-8 md:gap-6 mt-16 pt-12"
              style={{ borderTop: "1px solid rgba(22,32,46,0.10)" }}
            >
              {problemStats.map((s) => (
                <div key={s.label} data-reveal>
                  <div className="font-num text-5xl md:text-6xl font-bold text-cherry tracking-tight">
                    {s.value}
                  </div>
                  <p className="mt-3 text-ink/55 text-sm leading-relaxed max-w-[22ch]">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────────────────── The insight ───────────────────── */}
        <section className="relative px-6 md:px-12 lg:px-24 py-20 md:py-28 overflow-hidden">
          <div className="max-w-6xl mx-auto">
            <span
              data-reveal
              className="kicker"
            >
              The Insight
            </span>

            <blockquote
              data-reveal
              className="mt-6 max-w-4xl text-2xl md:text-4xl lg:text-[2.75rem] font-display italic font-medium leading-[1.25] text-ink text-balance"
            >
              The smallest outdoor moments — a hello to a stranger, a walk
              through the trees — do{" "}
              <span className="text-cherry">measurable</span> good.
            </blockquote>

            <div className="grid md:grid-cols-3 gap-6 mt-16">
              <div data-reveal className="clay rounded-2xl p-7">
                <p className="text-ink-soft leading-relaxed">
                  Casual{" "}
                  <span className="text-ink font-medium">weak-tie</span>{" "}
                  interactions — the barista, a neighbor, a fellow dog-walker —
                  measurably improve mental health.
                </p>
              </div>
              <div data-reveal className="clay rounded-2xl p-7">
                <p className="text-ink-soft leading-relaxed">
                  <span className="text-ink font-medium">Nature-based</span>{" "}
                  activity is shown to reduce anxiety and lift mood, even in
                  short doses.
                </p>
              </div>
              <div
                data-reveal
                className="clay rounded-2xl p-7"
                style={{ outline: "1px solid rgba(2,158,139,0.30)" }}
              >
                <div className="font-num text-5xl font-bold text-cherry tracking-tight">
                  82%
                </div>
                <p className="mt-3 text-ink-soft leading-relaxed">
                  of 18–34 year-olds say walking is good for their mental
                  health.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ───────────────────── Vision / close ───────────────────── */}
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
                "radial-gradient(circle, rgba(5,242,214,0.12), transparent 66%)",
            }}
          />
          <div className="max-w-3xl mx-auto text-center relative z-10">
            <span
              data-reveal
              className="kicker"
            >
              Where We&apos;re Headed
            </span>
            <h2
              data-reveal
              className="mt-5 text-4xl md:text-6xl font-display italic font-bold leading-tight text-ink text-balance"
            >
              Turning forgotten public space into{" "}
              <span className="text-cherry">vibrant community hubs.</span>
            </h2>
            <p
              data-reveal
              className="mt-6 text-ink-soft text-lg leading-relaxed measure mx-auto"
            >
              Gamified, social, and rooted in the real world — Verdure gives
              people a reason to step outside, and gives every park, plaza, and
              library a second life.
            </p>
            <div
              data-reveal
              className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link
                href="/#features"
                className="clay-cherry clay-press btn-clay cursor-pointer"
                onMouseEnter={sound.playHover}
                onClick={sound.playClick}
              >
                Explore the app
              </Link>
              <Link
                href="/partnerships"
                className="btn-ghost cursor-pointer"
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
