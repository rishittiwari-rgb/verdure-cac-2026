import { ImageResponse } from "next/og";

/**
 * The shared renderer behind every route's opengraph-image.
 *
 * Until now all six pages pointed at one static /og.png, so a link to /pricing
 * and a link to /story unfurled as the same picture. That is a wasted signal in
 * the one place a link competes for a click: the card is most of what a person
 * sees before deciding whether to open it, and an identical card for every page
 * tells them nothing about which page they were sent.
 *
 * Generated at build time (each opengraph-image route is statically rendered),
 * so this costs build seconds rather than request latency, and the output is a
 * plain PNG on the CDN like the static file it replaces.
 *
 * Deliberately typographic: no photograph. The plate the site uses everywhere
 * is a 4K JPEG, and embedding it here would mean decoding it once per card at
 * build. Type on the brand's own dark green reads at thumbnail size, which is
 * the size that actually matters — most of these are seen at a few hundred
 * pixels wide in a chat window.
 */

export let OG_SIZE = { width: 1200, height: 630 };
export let OG_CONTENT_TYPE = "image/png";

// The site's canvas colour (viewport themeColor) and its ink, so a card sits
// beside the page it came from rather than looking like a different product.
let INK = "#0B120D";
let CREAM = "#F4F1E8";
let SAGE = "#9DB89F";

export function ogCard(options: { kicker: string; title: string }): ImageResponse
{
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: "72px 80px",
          // A wash of green off the top-left, echoing the site's low sun.
          backgroundImage:
            "radial-gradient(1000px 560px at 12% 0%, rgba(157,184,159,0.20), rgba(11,18,13,0))",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 8,
              textTransform: "uppercase",
              color: SAGE,
            }}
          >
            {options.kicker}
          </div>
          <div
            style={{
              marginTop: 34,
              fontSize: 82,
              lineHeight: 1.06,
              color: CREAM,
              // Wrapping is left to the renderer rather than hand-broken: these
              // strings change with the pages' copy, and a manual line break
              // that was right for one headline is wrong for the next.
              maxWidth: 940,
            }}
          >
            {options.title}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: SAGE,
            fontSize: 28,
          }}
        >
          <div style={{ display: "flex" }}>Verdure</div>
          <div style={{ display: "flex" }}>Step Outside. Connect Within.</div>
        </div>
      </div>
    ),
    OG_SIZE
  );
}
