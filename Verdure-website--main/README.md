# Verdure

Verdure is a free mobile app (launching soon) that gives you a few real places to explore near you each day and rewards you for actually going. Check in when you arrive, earn points, keep a streak, and see local events happening nearby.

This repo is the marketing site: a pre-launch landing page with a waitlist.

## Stack

- Next.js 14 (App Router)
- Tailwind CSS (claymorphism "Warm Forest" system)
- GSAP + ScrollTrigger for scroll reveals
- Lenis for smooth scroll
- Supabase for the waitlist (optional; see `SUPABASE_SETUP.md`)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Layout

- `src/app` routes, layout, and metadata
- `src/components/sections` landing page sections
- `src/components/ui` shared UI (navbar, marquee, demo modal)
- `src/providers` Lenis, sound, and boot providers
- `src/lib/supabase` Supabase client and server helpers

The waitlist form accepts signups even when Supabase is not configured, so nothing breaks locally. Wire up Supabase to actually persist emails.

## ⚠️ Never delete `public/google334099a9270ba7da.html`

That 53-byte file is the Google Search Console ownership token for
`https://verdure-app.com/`. It is not junk, it is not a leftover, and it is not
a scaffold artefact — it is load-bearing.

**If it is deleted, moved, renamed, or edited by even one byte, the property
silently un-verifies.** Google re-checks it on an ongoing schedule, not just
once at setup. Losing verification means losing the Search Console account for
this domain: no index coverage, no sitemap submissions, no manual-action
notices, no search performance data. Getting it back means starting the
verification flow over.

Specifically, do not:

- delete it during any cleanup, dead-file sweep, or `public/` tidy-up
- rename it, or "fix" the filename — the name IS the token
- add a comment, a newline, a licence header, or a formatter pass to it. The
  body must stay byte-exact: `google-site-verification: <filename>`. There is
  deliberately no comment inside the file explaining this, because a comment
  would itself break it. That is why this note lives here instead.
- add it to `robots.txt`'s disallow list — Google has to be able to fetch it

It lives in the repo rather than being hand-uploaded precisely so it survives
every redeploy without anyone having to remember it.

Verify it is still serving at any time:

```bash
curl -s "https://verdure-app.com/google334099a9270ba7da.html?cb=$RANDOM"
# must print exactly: google-site-verification: google334099a9270ba7da.html
```

The same applies to any *additional* verification token added later (a second
property, a Bing token, and so on) — same rules, same reasons.

## /remove — publisher opt-out

`src/app/remove` lets a website owner remove their site from Verdure's
automatic event discovery. It is a thin client for two Cloud Functions HTTP
endpoints (`functions/src/discovery/removal.ts`):

- `GET  {base}/removalToken?host=…` — the token a large host must publish
- `POST {base}/requestSourceRemoval` `{ host, contact?, reason? }` — 200 removed,
  403 token required (both return the outcome), 400 bad host, 429 rate-limited

`{base}` is `NEXT_PUBLIC_VERDURE_FUNCTIONS_URL` (see `.env.local.example`).
When it is unset the page builds and renders a visible "not enabled" notice
instead of the form, so a deploy without the backend is safe. Host
normalisation (`src/lib/removal/host.ts`) mirrors the server and is pinned by
`npm run test:remove`. Design notes: `docs/WEBSITE-REMOVE-2026-10-20.md` at the
repository root.
