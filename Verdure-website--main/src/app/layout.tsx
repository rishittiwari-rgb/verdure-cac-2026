import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { BuildLog } from "@/components/ui/BuildStamp";
import SiteBackdrop from "@/components/fx/site-background/SiteBackdrop";
import PlateCredit from "@/components/fx/site-background/PlateCredit";
import ScrollReset from "@/components/fx/site-background/ScrollReset";
import JsonLd from "@/components/seo/JsonLd";
import { SITE_DESCRIPTION, SITE_URL, siteGraphLd } from "@/lib/seo";
import "./globals.css";

let BUILD_STAMP = process.env.NEXT_PUBLIC_BUILD_STAMP || "dev";

/**
 * Google Search Console's HTML-tag verification, if that is the method used.
 * Unset is the normal case — DNS TXT verification needs nothing here — so the
 * tag is omitted rather than emitted empty.
 */
let GOOGLE_VERIFICATION = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

// Body / UI voice — Manrope: geometric, refined, highly legible at all sizes.
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// Display voice — Cormorant Garamond: a high-contrast editorial serif with
// elegant thin strokes and classical proportions.
//
// `style` is deliberately absent, which means normal only. It used to request
// ["normal", "italic"] and nothing on the site has ever set font-style: italic
// — the single occurrence of the word in src/ is a Tailwind `not-italic` that
// switches it OFF. next/font emits a @font-face set per style, and Next
// preloads them, so the italic set was 129 KB shipped and 38 KB fetched at high
// priority on every route to render zero glyphs. It also doubled the @font-face
// blocks in the critical CSS.
//
// The weights are free by comparison: Cormorant resolves to a variable font, so
// all four map onto the same file and cost nothing extra. Styles are the axis
// that actually multiplies downloads. If italic copy is ever wanted, add it back
// here — but add it in the same change that uses it.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  // The real domain, now that it is serving. OG/social images and every
  // canonical resolve against this host, so the vercel.app copies of this
  // same build point their ranking signal back here instead of competing
  // with it.
  metadataBase: new URL(SITE_URL),
  title: {
    // The tagline alone said nothing a person would ever search for. The
    // default title now carries what the app is; the tagline keeps its place
    // on the share cards and in the opening copy.
    //
    // Phrase first, brand second. This led with "Verdure —", which spends the
    // most heavily weighted characters of the title on a term with essentially
    // no search volume: nobody looks for an app that has not launched by name.
    // The words someone might actually type now come first, and the brand still
    // closes the line for anyone who already knows it.
    default: "Explore Local Places Near You, Every Day — Verdure",
    // Sub-pages set the page name only: "Pricing" renders as
    // "Pricing · Verdure".
    template: "%s · Verdure",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Verdure",
  authors: [{ name: "Verdure" }],
  creator: "Verdure",
  publisher: "Verdure",
  category: "Lifestyle",
  keywords: [
    "Verdure",
    "Verdure app",
    "places to explore near me",
    "outdoor exploration app",
    "local discovery app",
    "get outside daily",
    "walking streak app",
    "community discovery",
    "local events near me",
    "neighborhood adventure",
  ],
  // Phone numbers in body copy being auto-linked by Safari rewrites the DOM
  // under the type system and is never wanted here.
  formatDetection: { telephone: false, address: false, email: false },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Defaults cap the snippet and shrink the thumbnail. This site's whole
      // argument is photographic, so let the image run at full size.
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  ...(GOOGLE_VERIFICATION
    ? { verification: { google: GOOGLE_VERIFICATION } }
    : {}),
  // Greppable build identity — `curl | grep build-stamp` answers "which
  // build is this URL serving" without opening a browser.
  other: { "build-stamp": BUILD_STAMP },
  // No canonical or og:url here on purpose: an inherited canonical would
  // point every sub-page and the 404 at the homepage. Each page sets its own
  // through pageMetadata() in lib/seo.ts.
};

export const viewport: Viewport = {
  themeColor: "#0B120D",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${cormorant.variable} antialiased`}>
        {/* Organization + WebSite, once for the whole site. Every other
            schema node on every page points back at these two by @id, which
            is what lets a crawler read six pages as one brand.

            In the body rather than the head because that is what Next
            documents for JSON-LD, and because a hand-written <head> in a
            root layout fights the metadata API. Google reads a data block in
            either place. */}
        <JsonLd data={siteGraphLd()} />
        {/* The plate is the ground for every route, so it mounts once here
            rather than per page. It survives client-side navigation, which
            means the GL context is built one time per page load. */}
        <SiteBackdrop />
        <ScrollReset />
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <BuildLog />
        {children}
        <PlateCredit />
        {/* Vercel Web Analytics — page views only, no cookie and no
            cross-site identifier, which is why it needs no consent gate.
            In production it serves from /_vercel/insights on our own
            origin, so the CSP needs no third-party host for it; only the
            dev debug script is remote. See lib/security/csp.ts. */}
        <Analytics />
      </body>
    </html>
  );
}
