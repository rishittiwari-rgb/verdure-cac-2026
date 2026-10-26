import type { MetadataRoute } from "next";

/**
 * The web app manifest — what Android and Chrome read when the site is
 * added to a home screen, and where the maskable icon comes from.
 *
 * The icons are the same dark-plate mark as the favicon rather than the
 * bare compass: a transparent mark disappears into a dark launcher, and
 * "maskable" means the launcher may crop to a circle, which the plate's
 * padding is sized to survive.
 */
export default function manifest(): MetadataRoute.Manifest
{
  return {
    name: "Verdure",
    short_name: "Verdure",
    description:
      "A few real places near you each morning. Check in, build a streak, and get outside.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b120d",
    theme_color: "#0b120d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
