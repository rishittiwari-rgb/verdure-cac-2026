import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

// Per-route share card. The shared renderer lives in lib/og-card.tsx; this file
// supplies only the words, so the six cards cannot drift apart visually.
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Verdure — Putting the neighborhood back on the map.";

export default function Image()
{
  return ogCard({ kicker: "Our Story", title: "Putting the neighborhood back on the map." });
}
