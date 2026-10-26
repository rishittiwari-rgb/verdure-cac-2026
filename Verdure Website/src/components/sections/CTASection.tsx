"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useSound } from "@/providers/SoundProvider";

gsap.registerPlugin(ScrollTrigger);

export default function CTASection()
{
  let sectionRef = useRef<HTMLElement>(null);
  let panelRef = useRef<HTMLDivElement>(null);
  let sound = useSound();

  useEffect(function ()
  {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx = gsap.context(function ()
    {
      // The CTA block inflates into view as one weighted clay object.
      gsap.from(panelRef.current, {
        y: 48,
        scale: 0.92,
        opacity: 0,
        duration: 1,
        ease: "back.out(1.4)",
        scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
      });
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  let onSubmit = function (e: React.FormEvent)
  {
    e.preventDefault();
    sound.playClick();
  };

  return (
    <section
      ref={sectionRef}
      id="early-access"
      className="mx-auto max-w-[1100px] px-6 py-24 md:px-10 md:py-32 lg:px-[clamp(2rem,5vw,5.5rem)]"
    >
      {/* High-contrast clay surface: dark ink on silica. */}
      <div ref={panelRef} className="clay-lg p-8 text-center md:p-16">
        <span className="clay-sm inline-flex items-center gap-2 px-4 py-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--aqua-depth)" }}
            aria-hidden="true"
          />
          <span className="kicker !text-ink">Be First In</span>
        </span>

        <h2 className="font-display mx-auto mt-7 max-w-[16ch] text-[clamp(2.2rem,6vw,4.8rem)] font-bold leading-[0.98] tracking-tight text-ink">
          Ready to explore <span className="text-cherry">your world?</span>
        </h2>

        <p className="measure mx-auto mt-5 text-[1.02rem] leading-relaxed text-ink-soft">
          We&apos;re launching soon. Join the waitlist to be first in line when
          the app drops — early users get exclusive badges and perks.
        </p>

        <form
          onSubmit={onSubmit}
          className="mx-auto mt-10 flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:items-center"
        >
          <div className="flex-1">
            <label htmlFor="cta-email" className="sr-only">
              Email address
            </label>
            <input
              id="cta-email"
              type="email"
              required
              placeholder="you@email.com"
              onFocus={sound.playFocus}
              className="clay-inset w-full px-5 py-4 text-base text-ink outline-none placeholder:text-ink/55"
            />
          </div>
          <button
            type="submit"
            className="clay-cherry clay-press btn-clay w-full sm:w-auto"
            onMouseEnter={sound.playHover}
          >
            Join the Waitlist
          </button>
        </form>

        <p className="mt-4 font-num text-[12px] tracking-[0.04em] text-ink-soft">
          No spam. Unsubscribe anytime.
        </p>
      </div>
    </section>
  );
}
