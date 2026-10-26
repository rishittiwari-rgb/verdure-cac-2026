import type { MetadataRoute } from "next";
import { absoluteUrl, PAGE_UPDATED } from "@/lib/seo";

/**
 * /sitemap.xml — every public route, absolute against the canonical host so
 * the vercel.app copies of this build still point a crawler home.
 *
 * The signed-in routes (/account, /login, /signup, /auth/*) are deliberately
 * absent: a sitemap is a list of pages you want indexed, and those are
 * noindex.
 *
 * lastModified is a DATE PER ROUTE, maintained by hand, and the hand-
 * maintenance is the point.
 *
 * It used to be `new Date()` evaluated at build time, which stamped every route
 * with the moment the bundle was compiled. The comment defending it argued the
 * pages "only change when a build ships", and that is true and still the wrong
 * signal: a deploy that fixes a typo on the homepage also told Google that the
 * privacy policy — declared `yearly` two lines below — had changed that
 * afternoon. Repeat that on every push and lastmod stops meaning anything.
 * Google's published guidance is that it ignores the value outright once it
 * proves unreliable, so the cost of overstating it is losing the field
 * altogether, including on the one occasion something really did change.
 *
 * A date that is out of date is a much smaller problem than a date that is
 * always wrong: the first understates, and the worst case is a crawler arriving
 * a little later than it might have. So these move only when the page's actual
 * copy moves. If you rewrite the roadmap, change its date; if you fix a CSS
 * token, do not.
 */

type ChangeFrequency = MetadataRoute.Sitemap[number]["changeFrequency"];

interface Route
{
  path: string;
  priority: number;
  changeFrequency: ChangeFrequency;
}

// The dates live in lib/seo.ts (PAGE_UPDATED) because the JSON-LD on each page
// publishes the same fact as dateModified. Two hand-maintained copies of "when
// did this page last change" is two chances to disagree, in a pair of files
// nobody edits together.
let ROUTES: Route[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/roadmap", priority: 0.8, changeFrequency: "weekly" },
  { path: "/story", priority: 0.7, changeFrequency: "monthly" },
  { path: "/partnerships", priority: 0.7, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/support", priority: 0.5, changeFrequency: "monthly" },
  { path: "/remove", priority: 0.4, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap
{
  return ROUTES.map(function (route)
  {
    return {
      url: absoluteUrl(route.path),
      lastModified: PAGE_UPDATED[route.path],
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    };
  });
}
