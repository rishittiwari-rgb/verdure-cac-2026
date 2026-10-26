# Website /remove page (W4.6) — 2026-10-20

Built locally in `Verdure-website--main/` (the live Next.js 15 site: it has
`src/app/api`, `src/app/admin` and `supabase/`; `Verdure Website/` is the older
marketing site and was not touched). **Not deployed.** Nothing in this
workstream changes Firebase, rules, indexes, env flags or `PROJECT-NOTES.md`.

## What it does

`/remove` is the self-service opt-out for a website whose public calendar
Verdure's discovery (`functions/src/discovery/*`) has picked up. It is a thin
client for the two HTTP endpoints exported from `functions/src/index.ts`:

| Endpoint | Contract (from `functions/src/discovery/removal.ts`) |
|---|---|
| `GET {base}/removalToken?host=…` | `{ host, isSource, activeEvents, requiresToken, token, path }`; 400 bad host; 429 after 30/hour per address |
| `POST {base}/requestSourceRemoval` body `{ host, contact?, reason? }` | 200 `RemovalOutcome` (removed) or 403 `RemovalOutcome` (token required; body carries `token` + `message`); 400 bad host; 405 non-POST; 429 after 5/day per address; 500 `{ error }` |

`{base}` is `NEXT_PUBLIC_VERDURE_FUNCTIONS_URL` (documented in
`.env.local.example`; production would be
`https://us-central1-connectify-19dd8.cloudfunctions.net`, emulator
`http://127.0.0.1:5001/connectify-19dd8/us-central1`). When it is empty or
unset the page still builds and renders a visible "Removal requests are not
enabled on this build" notice with the support email instead of the form.
The value is read on the server in `page.tsx` and passed as a prop, so the
client bundle never does an env lookup.

The page copy states exactly what the server does, in this order:

1. most hosts are removed immediately (every `/sources` doc on the host set to
   `removed`);
2. events are hidden on the next ingest cycle (`applyRemovals`, daily, so up to
   24 h);
3. the host goes on `/removedHosts` and is never rediscovered;
4. a host with more than 100 active events (`LARGE_SOURCE_EVENTS`) must publish
   its token at `/.well-known/verdure-remove.txt` or as
   `<meta name="verdure-remove" content="…">`; the "Get my token" button calls
   `removalToken` and shows the token, the exact path and the meta tag;
5. the rate limits (5 removals/day, 30 token lookups/hour per address) and
   that the request, contact, reason and a hash of the address are logged to
   `/removalRequests`.

Terms and privacy are linked from the form note. Server responses are shown
verbatim (`message` for 200/403, `error` for 400/429/500; a 429 without a
body gets a sentence naming the limits).

## Files

- `Verdure-website--main/src/app/remove/page.tsx` — server page, metadata via
  `pageMetadata`, JSON-LD (`webPageLd`, `breadcrumbLd`), `PageShell`, the
  explanatory copy, reuses the `.submission-page` / `.submission-panel` layout
  used by `/support`.
- `Verdure-website--main/src/app/remove/RemoveForm.tsx` — client form; reuses
  the `.submission-form` / `.submission-field` / `.submission-submit` /
  `.submission-confirmation` / `.submission-error` styles. Submit and
  "Get my token" are disabled until the host is valid client-side.
- `Verdure-website--main/src/lib/removal/host.ts` — `normalizeHost` and
  `validHost`, a literal mirror of the server's (`removal.ts`, `inspect.ts`),
  plus `functionsBaseUrl()`.
- `Verdure-website--main/remove-host.test.mjs` — 34 assertions, same shape
  and runner as `ip-normalise.test.mjs` (compiles the TS with `tsc` into a
  temp dir, imports it, prints PASS/FAIL per case). `npm run test:remove`;
  also wired into `npm test`.
- `Verdure-website--main/src/app/sitemap.ts` + `src/lib/seo.ts` — `/remove`
  listed with `PAGE_UPDATED["/remove"] = "2026-10-20"`.
- `Verdure-website--main/.env.local.example`, `README.md` — the new env var and
  a short section on the page.

## Verification (all run locally on 2026-10-20, $0, nothing deployed)

| Command (in `Verdure-website--main/`) | Result |
|---|---|
| `npm ci` | exit 0 (lockfile present) |
| `npx tsc --noEmit` | exit 0, no errors |
| `npm run test:remove` | 34 / 34 checks passed |
| `NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key NEXT_PUBLIC_SITE_URL=http://localhost:3000 npm run build` | exit 0; `/remove` prerendered static (2.75 kB, 118 kB first load). The Supabase placeholders are the ones `.env.local.example` lists; `NEXT_PUBLIC_VERDURE_FUNCTIONS_URL` was deliberately unset, so the built page is the "not enabled" variant. |
| `npx next lint --dir src/app/remove --dir src/lib/removal` | exit 0, no ESLint warnings or errors (the only build warning is the pre-existing Supabase process.version notice in src/lib/supabase/middleware.ts) |

Not verified here: an end-to-end click-through against the Functions emulator
(this brief forbids running emulators) and the production Functions URL (not
deployed; see DEPLOY STATUS in `PROJECT-NOTES.md`). To exercise the form locally, run
the Functions emulator from the repo root, put
`NEXT_PUBLIC_VERDURE_FUNCTIONS_URL=http://127.0.0.1:5001/connectify-19dd8/us-central1`
in `.env.local`, and `npm run dev`.

## Go-live notes

- Set `NEXT_PUBLIC_VERDURE_FUNCTIONS_URL` in the Vercel project once
  `requestSourceRemoval` and `removalToken` are deployed; until then the page
  honestly says the form is disabled.
- The server allows `*` CORS on both endpoints, so no proxy route is needed.
- Consider linking `/remove` from the footer next to Support; this workstream
  did not edit `Footer.tsx` (shared component, not in its brief).
