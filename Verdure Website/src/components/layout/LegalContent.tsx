"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * LegalContent — shared shell for the plain-language policy pages
 * (/privacy, /support). Same kicker + display-italic heading rhythm as the
 * other sub-pages, but tuned for long-form reading: a single measure-width
 * column, generous leading, and headings that stay scannable.
 */
export default function LegalContent({
  kicker,
  title,
  accent,
  intro,
  updated,
  children,
}: {
  kicker: string;
  title: React.ReactNode;
  accent?: string;
  intro: string;
  updated: string;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.fromTo(
          el,
          { y: 32, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 88%" },
          }
        );
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef}>
      <section className="relative px-6 md:px-12 lg:px-24 pt-28 pb-10 md:pt-36 md:pb-14 overflow-hidden">
        <div
          className="glow-radial"
          style={{
            width: 620,
            height: 620,
            top: "-8%",
            left: "-6%",
            background:
              "radial-gradient(circle, rgba(5,242,214,0.10), transparent 70%)",
          }}
        />
        <div className="max-w-3xl mx-auto relative z-10">
          <span
            data-reveal
            className="kicker inline-block mb-7 px-5 py-2 rounded-full"
            style={{ border: "1px solid rgba(22,32,46,0.15)" }}
          >
            {kicker}
          </span>
          <h1
            data-reveal
            className="text-[2.4rem] md:text-5xl lg:text-6xl font-display italic font-black leading-[0.98] tracking-tight text-balance text-ink"
          >
            {title}
            {accent ? <span className="text-cherry">{accent}</span> : null}
          </h1>
          <p
            data-reveal
            className="mt-7 text-ink-soft text-base md:text-lg leading-relaxed"
          >
            {intro}
          </p>
          <p data-reveal className="mt-4 text-sm text-ink-soft/70">
            Last updated {updated}
          </p>
        </div>
      </section>

      <section className="relative px-6 md:px-12 lg:px-24 pb-24 md:pb-32">
        <div className="max-w-3xl mx-auto legal-prose">{children}</div>
      </section>

      {/* Long-form typography, scoped to these pages so the marketing pages
          keep their own rhythm. */}
      <style jsx global>{`
        .legal-prose h2 {
          font-family: var(--font-display), serif;
          font-style: italic;
          font-weight: 800;
          font-size: 1.6rem;
          line-height: 1.15;
          letter-spacing: -0.01em;
          margin-top: 3rem;
          margin-bottom: 0.9rem;
          color: rgb(var(--ink-rgb));
        }
        .legal-prose h3 {
          font-weight: 700;
          font-size: 1.05rem;
          margin-top: 1.9rem;
          margin-bottom: 0.5rem;
          color: rgb(var(--ink-rgb));
        }
        .legal-prose p,
        .legal-prose li {
          color: rgb(var(--ink-soft-rgb));
          font-size: 1rem;
          line-height: 1.75;
        }
        .legal-prose p {
          margin-bottom: 1.05rem;
        }
        .legal-prose ul {
          margin: 0 0 1.3rem 0;
          padding-left: 1.15rem;
          list-style: disc;
        }
        .legal-prose li {
          margin-bottom: 0.55rem;
        }
        .legal-prose strong {
          color: rgb(var(--ink-rgb));
          font-weight: 650;
        }
        .legal-prose a {
          color: rgb(var(--cherry-rgb));
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .legal-prose .callout {
          border: 1px solid rgba(22, 32, 46, 0.12);
          border-radius: 18px;
          padding: 1.15rem 1.35rem;
          margin: 1.6rem 0;
          background: rgba(255, 255, 255, 0.4);
        }
        .legal-prose .callout p:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </div>
  );
}
