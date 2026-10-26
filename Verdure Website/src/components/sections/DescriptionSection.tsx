"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * DescriptionSection — plain-language statement of what Verdure is.
 * Sits directly under the hero, before any statistics. The eyebrow is bold and
 * dark; the statement is the focus. Flat on the cream canvas (long text is
 * never clay), body voice = Rubik.
 */
export default function DescriptionSection()
{
  let sectionRef = useRef<HTMLElement>(null);

  useEffect(function ()
  {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx = gsap.context(function ()
    {
      gsap.from(".desc-line", {
        y: 24,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.1,
        scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
      });
    }, sectionRef);

    return function ()
    {
      ctx.revert();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="mx-auto max-w-[940px] px-6 pb-14 pt-8 text-center md:px-10 md:pb-20 md:pt-12"
    >
      <span className="desc-line inline-flex items-center gap-2.5">
        <span
          className="inline-block h-2.5 w-2.5 rotate-45"
          style={{ background: "var(--gold)" }}
          aria-hidden="true"
        />
        <span className="text-[0.9rem] font-bold uppercase tracking-[0.18em] text-ink">
          What is Verdure?
        </span>
      </span>

      <p className="desc-line mx-auto mt-7 max-w-[24ch] text-balance text-[clamp(1.6rem,3.4vw,2.5rem)] font-semibold leading-[1.22] tracking-tight text-ink">
        A{" "}
        <span className="text-cherry">gamified community-discovery platform</span>{" "}
        that helps young people find local events, outdoor spaces, and ways to
        connect with their community.
      </p>
    </section>
  );
}
