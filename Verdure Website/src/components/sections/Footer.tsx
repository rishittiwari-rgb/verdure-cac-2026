"use client";

import Link from "next/link";
import { useSound } from "@/providers/SoundProvider";

let PRODUCT_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Gamification", href: "/#gamification" },
  { label: "Community", href: "/#community" },
  { label: "Roadmap", href: "/#roadmap" },
];

let COMPANY_LINKS = [
  { label: "Our Story", href: "/story" },
  { label: "Partnerships", href: "/partnerships" },
  { label: "Team", href: "/#team" },
  // Both are linked from the App Store listing, so they must stay reachable.
  { label: "Support", href: "/support" },
  { label: "Privacy", href: "/privacy" },
];

let SOCIAL_LINKS = [
  { label: "Twitter", short: "X", href: "#" },
  { label: "Instagram", short: "IG", href: "#" },
  { label: "LinkedIn", short: "LI", href: "#" },
];

export default function Footer()
{
  let sound = useSound();

  let column = function (links: { label: string; href: string }[])
  {
    return links.map(function (link)
    {
      return (
        <Link
          key={link.label}
          href={link.href}
          className="link-underline link-underline-cherry block w-fit text-sm font-medium text-ink-soft transition-colors duration-300 hover:text-ink"
          onMouseEnter={sound.playHover}
        >
          {link.label}
        </Link>
      );
    });
  };

  let socials = SOCIAL_LINKS.map(function (s)
  {
    return (
      <a
        key={s.label}
        href={s.href}
        aria-label={s.label}
        className="clay-sm clay-press flex h-10 w-10 items-center justify-center font-num text-xs font-bold text-ink-soft transition-colors duration-300 hover:text-cherry"
        onMouseEnter={sound.playHover}
      >
        {s.short}
      </a>
    );
  });

  return (
    <footer
      className="relative overflow-hidden px-6 pb-10 pt-24 md:px-10 lg:px-[clamp(2rem,5vw,5.5rem)]"
      style={{ zIndex: 1, borderTop: "1px solid rgba(22,32,46,0.08)" }}
    >
      <div className="mx-auto max-w-[1400px]">
        <div className="grid grid-cols-12 gap-x-8 gap-y-12">
          {/* Brand */}
          <div className="col-span-12 lg:col-span-5">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{
                  background: "var(--gold)",
                  boxShadow: "inset 1px 1px 2px var(--gold-gloss), inset -1px -1px 2px var(--gold-depth)",
                }}
                aria-hidden="true"
              />
              <span className="font-display text-2xl font-bold tracking-tight text-ink">
                Verdure
              </span>
            </div>
            <p className="measure-tight mt-5 text-sm leading-relaxed text-ink-soft">
              Transforming forgotten outdoor spaces into vibrant adventures. Step
              outside. Connect within.
            </p>
          </div>

          {/* Product */}
          <div className="col-span-6 lg:col-span-2 lg:col-start-7">
            <h4 className="kicker mb-5">Product</h4>
            <div className="flex flex-col gap-3">{column(PRODUCT_LINKS)}</div>
          </div>

          {/* Company */}
          <div className="col-span-6 lg:col-span-2">
            <h4 className="kicker mb-5">Company</h4>
            <div className="flex flex-col gap-3">{column(COMPANY_LINKS)}</div>
          </div>

          {/* Social */}
          <div className="col-span-12 lg:col-span-1">
            <h4 className="kicker mb-5">Follow</h4>
            <div className="flex gap-3">{socials}</div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="mt-20 flex flex-col items-start justify-between gap-4 pt-8 md:flex-row md:items-center"
          style={{ borderTop: "1px solid rgba(22,32,46,0.08)" }}
        >
          <p className="font-num text-xs text-ink-soft">
            © 2026 Verdure. All rights reserved.
          </p>
          <div className="flex items-center gap-7">
            {["Privacy", "Terms", "Cookies"].map(function (link)
            {
              return (
                <a
                  key={link}
                  href="#"
                  className="link-underline link-underline-cherry text-xs font-medium text-ink-soft transition-colors duration-300 hover:text-ink"
                  onMouseEnter={sound.playHover}
                >
                  {link}
                </a>
              );
            })}
          </div>
        </div>

        {/* Oversized signoff wordmark */}
        <div
          aria-hidden="true"
          className="font-display pointer-events-none mt-16 select-none text-[18vw] font-bold leading-[0.8] tracking-tight text-ink/[0.05]"
        >
          Verdure
        </div>
      </div>
    </footer>
  );
}
