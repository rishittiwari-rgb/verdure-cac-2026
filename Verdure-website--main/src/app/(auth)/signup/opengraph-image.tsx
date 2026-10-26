import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

// /signup needs its card declared in its OWN segment, not inherited.
//
// A parent opengraph-image is only merged in when the page has not defined an
// openGraph block of its own, and this page does (pageMetadata with
// indexable: false, so it is unlisted but still previewable). The result was
// the one route with no card at all — measured: /login and the 404 inherited
// the root card, /signup emitted zero og:image tags — and this is the link
// pasted most, since four public pages point at it.
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Verdure — Join the waitlist.";

export default function Image()
{
  return ogCard({ kicker: "Waitlist", title: "Join the walk. Launching soon." });
}
