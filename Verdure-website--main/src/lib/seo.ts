import type { Metadata } from "next";
import { PLANS } from "@/lib/plans";

/**
 * One source for every SEO fact on the site: the canonical host, the shared
 * copy, and the builders for per-page metadata and JSON-LD.
 *
 * The canonical host matters more here than on a normal site. This build is
 * served on two hostnames — verdure-app.com and the connectify-proto.vercel.app
 * deployment behind it — plus a preview URL per push. Without a canonical on
 * every page a crawler sees three identical copies of the same six pages and
 * splits the ranking signal between them. Everything below resolves against
 * SITE_URL so the copies all point home.
 */

export let SITE_URL = "https://verdure-app.com";
export let SITE_NAME = "Verdure";
export let SUPPORT_EMAIL = "support@verdure-app.com";

/**
 * ~155 characters on purpose: Google truncates the snippet around 160, so a
 * longer description loses its tail rather than gaining anything.
 */
export let SITE_DESCRIPTION =
  "Three real places to explore near you, every day. Check in to build a streak, earn points worth real gift cards, and find local events nearby. Launching soon.";

/** The brand line. Kept for share cards, where voice beats keywords. */
export let SITE_TAGLINE = "Verdure · Step Outside. Connect Within.";

let OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Verdure — three real places near you, every day",
};

export interface PageSeo
{
  /**
   * The page name only — the root layout's title template appends
   * "· Verdure". Omit it on the homepage to take the root default.
   */
  title?: string;
  description: string;
  /** Route path, e.g. "/pricing". Becomes the canonical and the og:url. */
  path: string;
  /** Share-card headline, when it should read differently from the title. */
  socialTitle?: string;
  /**
   * False for pages that must stay out of the index but are still shared as
   * links — /signup above all, which is the call to action on four public
   * pages and, pasted into Slack or iMessage, rendered as a bare URL with no
   * card at all.
   *
   * Setting this emits `noindex` AND drops the canonical, which is the part
   * that matters: a canonical is a request to index THIS url as the preferred
   * copy, so pairing one with noindex asks a crawler for two contradictory
   * things and lets it choose. The Open Graph block stays, because og:* is
   * read by link unfurlers rather than by the index, and a page can be
   * unlisted and still worth previewing.
   */
  indexable?: boolean;
}

/**
 * Per-page metadata: canonical, plus an Open Graph and Twitter card that
 * describe *this* page. Without the override every sub-page inherits the
 * homepage card, so a link to /pricing shared anywhere reads "Step Outside.
 * Connect Within." instead of what the page is about.
 */
export function pageMetadata(page: PageSeo): Metadata
{
  let socialTitle =
    page.socialTitle || (page.title ? page.title + " · " + SITE_NAME : SITE_TAGLINE);
  let indexable = page.indexable !== false;

  return {
    // Spread rather than `title: page.title` — an explicit `undefined` here
    // does not fall through to the root layout's default, it overrides it,
    // and the homepage ships with no <title> at all.
    ...(page.title ? { title: page.title } : {}),
    description: page.description,
    ...(indexable
      ? { alternates: { canonical: page.path } }
      : { robots: { index: false, follow: true } }),
    // No `images` on either block, deliberately.
    //
    // Each route now ships an opengraph-image.tsx, and Next's file convention
    // only fills in og:image when metadata has not already named one — so
    // hardcoding the shared /og.png here would silently win and every page
    // would keep unfurling as the same card. Omitting it lets the nearest
    // opengraph-image apply, which for /login, /signup and the 404 is the one
    // at the app root, so nothing is left without a card.
    //
    // twitter:image is omitted for the same reason and costs nothing: X, Slack,
    // iMessage and Discord all fall back to og:image when twitter:image is
    // absent, so a second declaration would only be a second thing to keep in
    // step with the first.
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: page.path,
      title: socialTitle,
      description: page.description,
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: page.description,
    },
  };
}

/** An absolute URL for JSON-LD, which may not use site-relative paths. */
export function absoluteUrl(path: string): string
{
  return path === "/" ? SITE_URL : SITE_URL + path;
}

/**
 * The date each page's COPY last actually changed, in one place.
 *
 * Two consumers need this and they must never disagree: sitemap.ts publishes it
 * as <lastmod>, and webPageLd() below publishes it as schema.org dateModified.
 * A crawler that reads both and finds two different answers for one URL learns
 * to trust neither, so this lives here rather than being typed out twice.
 *
 * Move a date only when the page's words move. A dependency bump or a CSS token
 * is not a modification of the document — see the longer note in sitemap.ts.
 */
export let PAGE_UPDATED: Record<string, string> = {
  "/": "2026-07-28",
  "/pricing": "2026-07-28",
  "/roadmap": "2026-07-28",
  "/story": "2026-07-28",
  "/partnerships": "2026-10-04",
  // Matches UPDATED in privacy/PrivacyContent.tsx — the date shown to a reader
  // and the date given to a crawler describe the same document.
  "/privacy": "2026-10-04",
  "/terms": "2026-10-04",
  "/support": "2026-10-04",
  "/remove": "2026-10-20",
};

/* --------------------------------------------------------------- JSON-LD */

let ORGANIZATION_ID = SITE_URL + "/#organization";
let WEBSITE_ID = SITE_URL + "/#website";

/**
 * The sitewide graph, emitted once from the root layout. Organization and
 * WebSite are the two entities every other node on the site points back at,
 * which is what lets a crawler treat six pages as one brand rather than six
 * unrelated documents.
 */
export function siteGraphLd(): Record<string, unknown>
{
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: SITE_NAME,
        url: SITE_URL,
        email: SUPPORT_EMAIL,
        description: SITE_DESCRIPTION,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl("/icon-512.png"),
          width: 512,
          height: 512,
        },
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: SUPPORT_EMAIL,
            availableLanguage: "English",
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}

/**
 * "$4.99" -> "4.99", "or $39.99/yr" -> "39.99". The plan file stores display
 * strings, not numbers, so a price for schema.org has to be recovered from one.
 *
 * This was `display.replace(/[^0-9.]/g, "")` — strip every non-digit — which is
 * correct for exactly the strings lib/plans.ts happens to hold today and fails
 * silently for the obvious next edits to a file that calls itself display copy:
 *
 *   "Free"                     -> ""        an Offer with an empty price
 *   "or $39.99/yr (save 33%)"  -> "39.9933" a wrong price, shipped confidently
 *
 * Neither raises anything. Both put invalid structured data in front of Google,
 * where the feedback loop is a Search Console warning weeks later, if ever.
 *
 * Matching the FIRST number instead of concatenating every digit fixes the
 * second case, and throwing fixes the first. Throwing is safe precisely because
 * this runs at build time over constants: it cannot fail on a user's request,
 * only on a deploy, which is where a pricing typo should surface.
 */
let numericPrice = function (display: string): string
{
  let match = display.match(/\d+(?:\.\d+)?/);

  if (!match)
  {
    throw new Error(
      "lib/plans.ts: price string has no number in it: " + JSON.stringify(display)
    );
  }

  return Number(match[0]).toFixed(2);
};

/**
 * Every price the site sells at, monthly and annual. The homepage's
 * AggregateOffer used to read plan.price only, so it advertised a range topping
 * out at $4.99 while /pricing listed a $39.99 annual Offer on the same site —
 * two documents disagreeing about what the product costs.
 */
let allPrices = PLANS.flatMap(function (plan)
{
  let prices = [Number(numericPrice(plan.price))];

  if (plan.annual)
  {
    prices[prices.length] = Number(numericPrice(plan.annual));
  }

  return prices;
});

/**
 * The app itself, for the homepage. There is deliberately no aggregateRating:
 * the app has not launched, so it has no ratings, and inventing one is both a
 * lie and a manual-action risk. Availability is PreOrder for the same reason.
 */
export function appLd(): Record<string, unknown>
{
  return {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "@id": SITE_URL + "/#app",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "LifestyleApplication",
    applicationSubCategory: "Outdoor recreation",
    operatingSystem: "iOS",
    image: absoluteUrl("/og.png"),
    publisher: { "@id": ORGANIZATION_ID },
    isPartOf: { "@id": WEBSITE_ID },
    featureList: [
      "Three curated places near you each day",
      "Check in where you actually stand",
      "Daily streaks",
      "Points redeemable for gift cards",
      "Local community events",
    ],
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: Math.min(...allPrices).toFixed(2),
      highPrice: Math.max(...allPrices).toFixed(2),
      // Counts every purchasable Offer, which is what /pricing enumerates —
      // not the number of plan tiers. Verdure+ sold monthly and annually is two
      // offers, and claiming otherwise made this block contradict pricingLd().
      offerCount: allPrices.length,
      availability: "https://schema.org/PreOrder",
    },
  };
}

/**
 * The plan table, for /pricing. Every price is read from lib/plans.ts — the
 * owner-supplied prices are the only ones that exist, so nothing here may
 * hardcode a number of its own.
 */
export function pricingLd(): Record<string, unknown>
{
  let offers = PLANS.flatMap(function (plan)
  {
    let monthly = {
      "@type": "Offer",
      name: plan.name,
      description: plan.tagline,
      price: numericPrice(plan.price),
      priceCurrency: "USD",
      availability: "https://schema.org/PreOrder",
      url: absoluteUrl("/pricing"),
    };

    if (!plan.annual)
    {
      return [monthly];
    }

    return [
      monthly,
      {
        "@type": "Offer",
        name: plan.name + " (annual)",
        description: "Billed annually",
        price: numericPrice(plan.annual),
        priceCurrency: "USD",
        availability: "https://schema.org/PreOrder",
        url: absoluteUrl("/pricing"),
      },
    ];
  });

  return {
    "@context": "https://schema.org",
    // The SAME node as the homepage's app, by @id — not a second product.
    //
    // This was an anonymous `SoftwareApplication` with no @id and a /pricing
    // url, which reads to a crawler as a different thing that merely shares a
    // name with the MobileApplication on the homepage. Every Offer below then
    // attached to that phantom, so the page describing what Verdure costs was
    // pricing a product the rest of the graph had never heard of. The type is
    // matched too: one entity cannot be a MobileApplication on one page and a
    // SoftwareApplication on another.
    //
    // url stays the canonical homepage so the two declarations of #app do not
    // assert conflicting values for one identity; mainEntityOfPage is the
    // property that says "and this page is where it is described".
    "@type": "MobileApplication",
    "@id": SITE_URL + "/#app",
    name: SITE_NAME,
    url: SITE_URL,
    mainEntityOfPage: absoluteUrl("/pricing"),
    description:
      "Verdure Free costs nothing forever. Verdure+ adds unlimited planning, early partner perks, cash gift cards, advanced stats and interest profiles.",
    applicationCategory: "LifestyleApplication",
    operatingSystem: "iOS",
    publisher: { "@id": ORGANIZATION_ID },
    offers: offers,
  };
}

/**
 * The page itself, as an entity.
 *
 * Until now each URL emitted only its content schema (the app, the plans) plus
 * a BreadcrumbList, and nothing said what the PAGE was or tied it to the site.
 * The graph therefore had a well-described organisation, a well-described
 * product, and six anonymous documents floating beside them.
 *
 * A WebPage node closes that: it gives every URL a stable @id, hangs it off the
 * WebSite by isPartOf, points it at the entity it is about, and — the part that
 * earns its place — carries dateModified, which is the freshness signal Google
 * reads from structured data rather than inferring. `breadcrumb` links to the
 * BreadcrumbList the page already emits instead of restating the trail.
 *
 * `type` exists because schema.org distinguishes kinds of page and the more
 * specific one is free: /story is an AboutPage, /privacy is a WebPage whose
 * subject is the policy. Using AboutPage where it fits is a stronger statement
 * than six identical WebPages.
 */
export interface PageEntity
{
  path: string;
  name: string;
  description: string;
  type?: "WebPage" | "AboutPage" | "CollectionPage" | "ContactPage";
  /** The thing this page is primarily about. Defaults to the organisation. */
  about?: "app" | "organization";
}

export function webPageLd(page: PageEntity): Record<string, unknown>
{
  let url = absoluteUrl(page.path);

  return {
    "@context": "https://schema.org",
    "@type": page.type || "WebPage",
    "@id": url + "#webpage",
    url: url,
    name: page.name,
    description: page.description,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": page.about === "app" ? SITE_URL + "/#app" : ORGANIZATION_ID },
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: absoluteUrl(OG_IMAGE.url),
      width: OG_IMAGE.width,
      height: OG_IMAGE.height,
    },
    // Absent rather than invented when a page is not in the table. An omitted
    // dateModified costs a freshness hint; a wrong one costs the field's
    // credibility across the whole site.
    ...(PAGE_UPDATED[page.path]
      ? { dateModified: PAGE_UPDATED[page.path] }
      : {}),
    ...(page.path === "/" ? {} : { breadcrumb: { "@id": url + "#breadcrumb" } }),
  };
}

export interface Crumb
{
  name: string;
  path: string;
}

/**
 * Breadcrumbs for a sub-page. Google renders these in place of the raw URL in
 * the result, so /pricing shows "Verdure › Pricing" rather than the path.
 */
export function breadcrumbLd(trail: Crumb[]): Record<string, unknown>
{
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    // Addressable, so the page's WebPage node can point `breadcrumb` at this
    // list by @id rather than duplicating the trail inside it. Keyed on the
    // page the trail ends at, which is the page emitting it.
    "@id": absoluteUrl(trail[trail.length - 1].path) + "#breadcrumb",
    itemListElement: trail.map(function (crumb, index)
    {
      return {
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: absoluteUrl(crumb.path),
      };
    }),
  };
}
