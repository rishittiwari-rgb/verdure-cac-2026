"use client";

import Link from "next/link";
import { useSound } from "@/providers/SoundProvider";
import Logo from "@/components/ui/Logo";

// Every link resolves to a real destination: homepage anchors or a real
// sub-page. Dead anchors don't ship.
let PRODUCT_LINKS = [
  { label: "How it works", href: "/#how" },
  { label: "Pricing", href: "/pricing" },
  { label: "Roadmap", href: "/roadmap" },
  { label: "Join the waitlist", href: "/#join" },
];

let COMPANY_LINKS = [
  { label: "Our Story", href: "/story" },
  { label: "Team", href: "/story#team" },
  { label: "Partnerships", href: "/partnerships" },
  { label: "Support", href: "/support" },
  { label: "Log In", href: "/login" },
];

/**
 * Footer — the site closer: brand, the two link columns, and the fine
 * print with the build stamp.
 */
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
          className="link-underline !flex min-h-[44px] w-fit items-center text-sm font-semibold text-cream/75 transition-colors duration-300 hover:text-cream"
          onMouseEnter={sound.playHover}
        >
          {link.label}
        </Link>
      );
    });
  };

  return (
    <footer className="band--ink relative">
      <div className="page-pad mx-auto max-w-[1400px] pb-10 pt-16 md:pt-20">
        <div className="grid grid-cols-12 gap-x-4 gap-y-12 md:gap-x-8">
          {/* Brand */}
          <div className="col-span-12 lg:col-span-6">
            <div className="flex items-center gap-3">
              <Logo size={34} />
              <span className="font-display text-2xl font-bold tracking-tight">
                Verdure
              </span>
            </div>
            <p className="font-display t-sub1 mt-6 max-w-[20ch] leading-tight">
              Stay close to the trail. Walk with Verdure.
            </p>
          </div>

          {/* Product */}
          <div className="col-span-6 lg:col-span-2 lg:col-start-8">
            <h4 className="kicker mb-3">Product</h4>
            <div className="flex flex-col">{column(PRODUCT_LINKS)}</div>
          </div>

          {/* Company */}
          <div className="col-span-6 lg:col-span-2">
            <h4 className="kicker mb-3">Company</h4>
            <div className="flex flex-col">{column(COMPANY_LINKS)}</div>
          </div>
        </div>

        {/* Bottom bar. The build stamp and the "trail's end" sign-off both
            came off here — the line is the legal footer, and neither was
            saying anything to a visitor. The build id still ships in the
            <meta name="build-stamp"> tag and the console line, which is
            where it was ever actually read from. */}
        <div className="mt-14 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-7">
          <p className="font-num text-[13px] text-cream/75">
            © 2026 Verdure. All rights reserved.
          </p>
          <Link
            href="/privacy"
            className="link-underline !flex min-h-[44px] items-center font-num text-[13px] text-cream/75 transition-colors duration-300 hover:text-cream"
            onMouseEnter={sound.playHover}
            onClick={sound.playClick}
          >
            Privacy Policy
          </Link>
          <Link href="/terms" className="link-underline !flex min-h-[44px] items-center font-num text-[13px] text-cream/75 transition-colors duration-300 hover:text-cream" onMouseEnter={sound.playHover} onClick={sound.playClick}>
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  );
}
