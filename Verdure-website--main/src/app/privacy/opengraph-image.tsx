import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

// Per-route share card. The shared renderer lives in lib/og-card.tsx; this file
// supplies only the words, so the six cards cannot drift apart visually.
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Verdure — What we store, and what we never will.";

export default function Image()
{
  return ogCard({ kicker: "Privacy", title: "What we store, and what we never will." });
}
