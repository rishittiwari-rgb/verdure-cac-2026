import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata =
{
  // The root layout's title template appends "· Verdure".
  title: "Lost on the trail",
  // Its own line rather than the inherited SITE_DESCRIPTION, which described
  // the product to someone who had just failed to find a page.
  description:
    "That page isn't here. Head back to the trail — or read why Verdure exists.",
  // A 404 already answers with a 404 status, but Next serves this component
  // for any unmatched path and a stray crawl of one shouldn't bank a soft
  // 404 against the site.
  robots: { index: false, follow: true },
};

/**
 * Branded 404 — keeps the Park Walk metaphor: the trail simply runs out.
 * Server component, inherits the cream canvas + fonts from RootLayout.
 */
export default function NotFound()
{
  return (
    <main
      id="main-content"
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-24 text-center"
    >
      <div className="relative z-10 flex flex-col items-center">
        {/* Trail marker — the path runs out here */}
        <span className="mb-6 flex flex-col items-center" aria-hidden="true">
          <span
            className="h-2.5 w-2.5 rotate-45"
            style={{ background: "var(--accent)", boxShadow: "0 0 14px rgba(0,230,118,0.45)" }}
          />
          <span
            className="mt-2 h-14 w-px"
            style={{ borderLeft: "2px dashed var(--line)" }}
          />
        </span>

        <span className="kicker mb-5">Off the trail</span>

        <h1 className="font-display text-[clamp(5.5rem,24vw,16rem)] font-semibold leading-[0.82] tracking-tight text-cream">
          404
        </h1>

        <p className="font-display mt-6 text-balance text-[clamp(1.5rem,4vw,2.6rem)] font-semibold leading-tight tracking-tight text-cream">
          You wandered off the path.
        </p>
        <p className="measure mx-auto mt-4 text-[1.02rem] leading-relaxed text-cream/70">
          This trail doesn&apos;t lead anywhere, but the neighborhood is still
          out there. Let&apos;s get you back on the walk.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href="/" className="pill pill--ink pill--static">
            Back to the trail
          </Link>
          <Link href="/story" className="link-underline text-base font-bold text-cream">
            Read our story
          </Link>
        </div>
      </div>
    </main>
  );
}
