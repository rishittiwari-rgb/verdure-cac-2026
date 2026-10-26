"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";
import { useBoot } from "@/providers/BootProvider";
import { useSound } from "@/providers/SoundProvider";

// Hash links are absolute (/#id) so they resolve from sub-pages too.
let NAV_LINKS = [
  { label: "Story", href: "/story" },
  { label: "Roadmap", href: "/#roadmap" },
  { label: "Community", href: "/#community" },
  { label: "Partners", href: "/partnerships" },
  { label: "Team", href: "/#team" },
];

interface NavbarProps
{
  /** Extra stagger applied after the boot gate releases. */
  entranceDelay?: number;
}

export default function Navbar({ entranceDelay = 0.2 }: NavbarProps)
{
  let navRef = useRef<HTMLElement>(null);
  let played = useRef(false);
  let [scrolled, setScrolled] = useState(false);
  let { isReady } = useBoot();
  let sound = useSound();

  useEffect(function ()
  {
    if (!isReady || played.current) return;
    played.current = true;
    gsap.fromTo(
      navRef.current,
      { y: -64, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, ease: "power3.out", delay: entranceDelay }
    );
  }, [isReady, entranceDelay]);

  useEffect(function ()
  {
    let onScroll = function ()
    {
      setScrolled(window.scrollY > 48);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return function ()
    {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  let links = NAV_LINKS.map(function (link)
  {
    return (
      <Link
        key={link.label}
        href={link.href}
        className="link-underline link-underline-cherry text-sm font-medium text-ink-soft transition-colors duration-300 hover:text-ink"
        onMouseEnter={sound.playHover}
        onClick={sound.playClick}
      >
        {link.label}
      </Link>
    );
  });

  return (
    <nav
      ref={navRef}
      className={`fixed left-0 right-0 top-0 z-50 transition-all duration-500 ${
        scrolled ? "py-3" : "py-5"
      }`}
      style={{
        opacity: 0,
        background: scrolled ? "rgba(237,230,211,0.82)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(12px)" : "none",
        boxShadow: scrolled ? "0 10px 30px rgba(190,178,150,0.5)" : "none",
      }}
    >
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 md:px-10">
        {/* Wordmark */}
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          onMouseEnter={sound.playHover}
          onClick={sound.playClick}
        >
          <span
            className="inline-block h-3 w-3 rounded-full transition-transform duration-300 group-hover:scale-110"
            style={{
              background: "var(--gold)",
              boxShadow: "inset 1px 1px 2px var(--gold-gloss), inset -1px -1px 2px var(--gold-depth)",
            }}
            aria-hidden="true"
          />
          <span className="font-display text-xl font-bold tracking-tight text-ink">
            Verdure
          </span>
        </Link>

        {/* Center nav */}
        <div className="hidden items-center gap-8 lg:flex">{links}</div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            className="link-underline link-underline-cherry hidden whitespace-nowrap text-sm font-medium text-ink-soft transition-colors duration-300 hover:text-ink sm:inline-block"
            onMouseEnter={sound.playHover}
            onClick={sound.playClick}
          >
            Log In
          </button>

          <button
            className="clay-cherry clay-press rounded-full px-5 py-2.5 text-sm font-bold text-white"
            onMouseEnter={sound.playHover}
            onClick={sound.playClick}
          >
            Get Access
          </button>
        </div>
      </div>
    </nav>
  );
}
