import { execSync } from "node:child_process";

// Build identity — one short-sha stamp injected at build time and shown on
// three surfaces (meta tag, boot log, footer fine print), so any screenshot
// can be matched against git log in seconds.
let sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
if (!sha)
{
  try
  {
    sha = execSync("git rev-parse HEAD").toString().trim();
  }
  catch
  {
    sha = "dev";
  }
}
let shortSha = sha.slice(0, 7);
let two = function (n)
{
  return String(n).padStart(2, "0");
};
let now = new Date();
let stamp = shortSha + " · " + two(now.getMonth() + 1) + "." + two(now.getDate());

// Security headers that are the same on every request. The one header that
// cannot live here is Content-Security-Policy: it differs between development
// and production (dev needs 'unsafe-eval' and a websocket for HMR), so it is
// built per-request in middleware instead — see src/lib/security/csp.ts.
//
// That file, not this comment, is the authority on what the policy contains.
// This said the CSP "carries a per-request nonce", which it does not and cannot:
// every page here is statically prerendered, so there is no per-request render
// in which to stamp a nonce onto the inline hydration scripts. csp.ts explains
// the trade in full. Stale comments about a security control are worse than no
// comment — this one described a defense the site does not have.
//
// geolocation is scoped rather than blanket-denied on purpose. Verdure is a
// place-based product and the web surface will need to ask for location; this
// keeps that possible for our own origin while denying it to anything we
// embed. Every other powerful feature the site has no use for is denied
// outright.
let PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=(self)",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

let SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Belt and braces with the CSP's frame-ancestors 'none' — X-Frame-Options
  // is what older clients and some scanners actually read.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Responses from this origin may only be embedded by this origin —
  // Spectre-class cross-site read protection. Browser-enforced only, so
  // server-side fetchers (link unfurlers, crawlers reading og.png) are
  // unaffected.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Legacy Flash/PDF cross-domain policy files: none exist, none may be
  // implied.
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

/** @type {import('next').NextConfig} */
let nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_STAMP: stamp,
  },
  // next/image is used for exactly one small static logo, so the image
  // optimizer — and with it the sharp/libvips native decode surface
  // (GHSA-f88m-g3jw-g9cj) and the optimizer's DoS/cache-growth advisory
  // history — is switched off outright. Files under /public serve as-is.
  images: {
    unoptimized: true,
  },
  // Nothing gains from announcing the framework and version to scanners.
  poweredByHeader: false,
  generateBuildId: async function ()
  {
    return shortSha;
  },
  headers: async function ()
  {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
