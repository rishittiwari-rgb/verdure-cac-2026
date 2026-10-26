import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import HomeSections from "@/components/home/HomeSections";
import JsonLd from "@/components/seo/JsonLd";
import { appLd, pageMetadata, SITE_DESCRIPTION, webPageLd } from "@/lib/seo";

// No `title` — the homepage takes the root default. Everything else here is
// the canonical and the share card, which the root layout deliberately does
// not set.
export const metadata: Metadata = pageMetadata({
  description: SITE_DESCRIPTION,
  path: "/",
});

/**
 * The landing page — the 300vh photographic opening, then the short
 * content-first read underneath it: how it works, who it's for, why it
 * matters, links to the deeper pages, and the waitlist close.
 */
export default function Home()
{
  return (
    <PageShell>
      {/* The app itself, as an entity. No rating: it has not launched, so
          it has none, and a fabricated one is a manual action waiting to
          happen. */}
      <JsonLd data={appLd()} />
      {/* The homepage as a document, distinct from the app it describes. No
          breadcrumb reference — a single-item trail back to itself is noise. */}
      <JsonLd
        data={webPageLd({
          path: "/",
          name: "Verdure — Explore Local Places Near You, Every Day",
          description: SITE_DESCRIPTION,
          about: "app",
        })}
      />
      <HomeSections />
    </PageShell>
  );
}
