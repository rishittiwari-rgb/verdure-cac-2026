"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { useBoot } from "@/providers/BootProvider";
import { useSound } from "@/providers/SoundProvider";
import DemoModal from "@/components/ui/DemoModal";

gsap.registerPlugin(SplitText);

// The 3D logo is client-only WebGL — never render it on the server.
let HeroLogo3D = dynamic(function ()
{
  return import("@/components/ui/HeroLogo3D");
}, { ssr: false });

export default function HeroSection()
{
  let containerRef = useRef<HTMLElement>(null);
  let kickerRef = useRef<HTMLDivElement>(null);
  let titleRef = useRef<HTMLHeadingElement>(null);
  let subtitleRef = useRef<HTMLParagraphElement>(null);
  let ctaRef = useRef<HTMLDivElement>(null);
  let scrollRef = useRef<HTMLDivElement>(null);
  let logoRef = useRef<HTMLDivElement>(null);
  let played = useRef(false);
  let [demoOpen, setDemoOpen] = useState(false);
  let sound = useSound();
  let { isReady } = useBoot();

  useEffect(function ()
  {
    if (!isReady || played.current) return;
    played.current = true;

    let reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let ctx = gsap.context(function ()
    {
      gsap.set(titleRef.current, { opacity: 1 });

      if (reduce)
      {
        gsap.set(
          [
            kickerRef.current,
            subtitleRef.current,
            ctaRef.current,
            scrollRef.current,
            logoRef.current,
          ],
          { opacity: 1, y: 0, scale: 1 }
        );
        return;
      }

      let tl = gsap.timeline({ delay: 0.1 });

      tl.from(kickerRef.current, {
        y: 16,
        opacity: 0,
        scale: 0.9,
        duration: 0.6,
        ease: "back.out(2)",
      });

      // Signature moment: masked headline lines reveal from below.
      let split = new SplitText(titleRef.current, {
        type: "lines",
        mask: "lines",
        linesClass: "hero-line",
      });

      tl.from(
        split.lines,
        {
          yPercent: 118,
          duration: 1.15,
          ease: "expo.out",
          stagger: 0.13,
          onComplete: function ()
          {
            split.revert();
          },
        },
        "-=0.2"
      );

      // The logo medallion inflates into place — weighted, not a flat fade.
      tl.from(
        logoRef.current,
        {
          scale: 0.62,
          opacity: 0,
          duration: 1.2,
          ease: "back.out(1.5)",
        },
        "-=1.0"
      );

      tl.from(
        subtitleRef.current,
        { y: 20, opacity: 0, duration: 0.7, ease: "power3.out" },
        "-=0.7"
      );
      tl.from(
        ctaRef.current,
        { y: 18, opacity: 0, scale: 0.96, duration: 0.7, ease: "back.out(1.6)" },
        "-=0.5"
      );
      tl.from(
        scrollRef.current,
        { y: -12, opacity: 0, duration: 0.7, ease: "power2.out" },
        "-=0.3"
      );

      // Scroll cue — a soft, weighted bob on the chevron (not a bubble).
      gsap.to(scrollRef.current?.querySelector(".scroll-chev") as Element, {
        y: 7,
        duration: 1.1,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    }, containerRef);

    return function ()
    {
      ctx.revert();
    };
  }, [isReady]);

  return (
    <section
      ref={containerRef}
      className="relative w-full min-h-[100svh] overflow-hidden"
    >
      {/* 3D Verdure logo — drag to spin on desktop; decorative accent on mobile */}
      <div
        ref={logoRef}
        className="pointer-events-none absolute z-0 right-[-12%] top-[3%] h-[62vw] w-[62vw] opacity-75 sm:top-[2%] sm:h-[50vw] sm:w-[50vw] sm:opacity-90 md:right-[-3%] md:top-[5%] md:h-[44vw] md:w-[44vw] md:opacity-100 lg:pointer-events-auto lg:right-[-5%] lg:top-1/2 lg:h-[clamp(400px,43vw,620px)] lg:w-[clamp(400px,43vw,620px)] lg:-translate-y-1/2"
      >
        <HeroLogo3D />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[1400px] flex-col justify-center px-6 pb-28 pt-36 md:px-10 md:pt-44 lg:px-[clamp(2rem,5vw,5.5rem)]">
        {/* Kicker chip */}
        <div ref={kickerRef} className="pointer-events-none">
          <span className="clay-sm inline-flex items-center gap-2.5 px-4 py-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--gold)" }}
              aria-hidden="true"
            />
            <span className="kicker !text-ink">Beta · 2026 · Reimagine Your Outdoors</span>
          </span>
        </div>

        {/* Headline */}
        <h1
          ref={titleRef}
          className="font-display pointer-events-none mt-8 max-w-[15ch] text-[clamp(2.9rem,10vw,8.4rem)] font-bold leading-[0.94] tracking-[-0.02em] text-ink md:mt-10"
          style={{ opacity: 0 }}
        >
          <span className="block">Step Outside.</span>
          <span className="block">
            Connect <span className="text-cherry">Within.</span>
          </span>
        </h1>

        {/* Subhead */}
        <p
          ref={subtitleRef}
          className="measure pointer-events-none mt-8 text-lg leading-relaxed text-ink-soft md:mt-10 md:text-xl lg:max-w-[27rem]"
        >
          The app that turns your neighborhood into an adventure. Discover hidden
          spots, earn rewards, and connect with your community — all from your
          phone.
        </p>

        {/* CTAs */}
        <div ref={ctaRef} className="mt-10 flex flex-wrap items-center gap-4 md:mt-12">
          <button
            className="clay-cherry clay-press btn-clay w-full sm:w-auto"
            onMouseEnter={sound.playHover}
            onClick={sound.playClick}
          >
            Download the App
          </button>

          <button
            className="btn-ghost"
            onMouseEnter={sound.playHover}
            onClick={function ()
            {
              sound.playClick();
              setDemoOpen(true);
            }}
            aria-haspopup="dialog"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            Watch Demo
          </button>
        </div>
      </div>

      {/* Scroll cue — text + a thick chevron (no bubble) */}
      <div
        ref={scrollRef}
        className="pointer-events-none absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
      >
        <span className="kicker text-ink-soft">Scroll to explore</span>
        <svg
          className="scroll-chev"
          width="22"
          height="14"
          viewBox="0 0 22 14"
          fill="none"
          stroke="var(--cherry)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 2l9 9 9-9" />
        </svg>
      </div>

      <DemoModal open={demoOpen} onClose={function () { setDemoOpen(false); }} />
    </section>
  );
}
