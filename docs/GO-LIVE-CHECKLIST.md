# Go-live checklist — paid launch steps in order

Written 2026-10-20 against branch `codex/rishit-handoff-2026-09-27`. Nothing on
this page has been done: **no purchase has been made, nothing is deployed, no
environment flag has been flipped.** The live project is still on Spark with 0
functions and no Storage bucket (see the DEPLOY STATUS table in `PROJECT-NOTES.md`,
which is the only authority on live state). Every row names a cost, an owner
*role*, and the exact command that proves the step landed. Rows marked
**COSTS MONEY** cannot be run by an engineer alone; they need the account
holder's approval first. Rows marked **$0** are free at the stated volumes.

Order matters: steps 1-3 are the only human-in-a-browser steps and nothing
after them can run until they are done. Run from the repo root unless the
command says otherwise. The Firebase CLI is pinned to 13 in every repo script
(`npx firebase-tools@13`); use the same here.

| # | Step | Cost | Owner (role) | Verify with |
|---|---|---|---|---|
| 1 | **Apple Developer Program** enrolment (organization enrolment needs a legal entity, D-U-N-S number and an Account Holder). Needed for TestFlight, App Store, subscriptions and production APNs. | **COSTS MONEY: $99/year** | Account holder / company officer | Log in at developer.apple.com, Membership shows "Active". No CLI check exists; record the expiry date in `docs/RISHIT-ACCOUNTS-AND-BUDGET-2026-09-27.md`. |
| 2 | **Firebase Blaze** upgrade on `connectify-19dd8` plus a **Cloud Billing budget alert** (alerts warn, they do not cap). Suggested first budget: $25/month, alerts at 50/90/100 %. | **COSTS MONEY: $0 plan fee, pay as used** (free quotas listed under first-week checks) | Account holder (billing) + backend owner (thresholds) | `npx firebase-tools@13 projects:list` (auth), then `npx firebase-tools@13 deploy --only functions --non-interactive` errors with a Spark message while still unpaid. Budget: console.cloud.google.com, Billing, Budgets & alerts shows one budget linked to the project. |
| 3 | **Storage bucket**: console, Build, Storage, Get started (default location, production rules). The bucket does not exist today; proof photos and profile pictures have nowhere to go without it. | $0 at launch volumes (5 GB free) | Backend owner | `npx firebase-tools@13 storage:rules:get` fails with "no bucket" until done; the console Storage tab lists one bucket. |
| 4 | **Secrets**: set every secret declared in `functions/src` (full list below). Deploys succeed without them; the feature that needs a missing secret reports "not configured" instead. | $0 to store (Secret Manager free tier covers 6 active versions; about $0.06/version/month above that) | Backend owner, keys supplied by each vendor account owner | `npx firebase-tools@13 functions:secrets:access <NAME>` prints a value for each name. |
| 5 | **Non-secret config** in `functions/.env`: set `APPLE_APP_APPLE_ID` (numeric App Store id, required before production IAP). Leave `APPLE_IAP_ENVIRONMENT=sandbox` and `TREMENDOUS_ENV=sandbox` until the matching accounts are live. | $0 | Backend owner | `grep -E "APPLE_APP_APPLE_ID|APPLE_IAP_ENVIRONMENT|TREMENDOUS_ENV" functions/.env` |
| 6 | **Deploy, in this order:** rules, storage rules, indexes, functions. Rules are the lockdown the callables assume; indexes must exist before the first client query or the ranked feed fails. Commands under "Deploy order" below. | $0 for rules/indexes; a functions deploy builds containers (Cloud Build free tier 120 build-min/day; Artifact Registry about $0.10/GB-month) | Backend owner | Each command below has its own read-back verification. |
| 7 | **Seed `config/ranking`** from `functions/seed/ranking-config.json` (created in this sprint by the ranking workstream; shape is `coerceRankingConfig()` in `functions/src/ranking-v2.ts`, default `{version:"v1", interleave:{enabled:false, minSessions:300, nudge:0.05}}`). v2 stays off until the blind judge says so. | $0 (one write) | Backend owner | Firestore console shows `config/ranking`; `ranking.ts` reads it with a short in-process cache, so a change is visible within a minute. |
| 8 | **Seed `/sources`** from today's configuration: `cd functions && npm run build && node scripts/migrate-sources.mjs --live` with `GOOGLE_APPLICATION_CREDENTIALS` set. The script **refuses to run** without `--live` when `FIRESTORE_EMULATOR_HOST` is unset, is idempotent (existing documents keep their status and decision) and never writes a deny-listed seed (it prints "Denied seeds were not written"). Rehearse first with `npm run migrate:sources:emulator`. | $0 (about 14 writes) | Backend owner | The script's JSON output lists `active` per area; 14 expected: ticketmaster, libcal, 5 bibliocommons, 2 localist, livewhale, legistar, midpen, nps, serpapi. |
| 9 | **App Store Connect products**: two auto-renewable subscriptions in one group, `com.verdure-app.verdure.plus.monthly` ($4.99/month) and `com.verdure-app.verdure.plus.yearly` ($49.99/year). The ids are pinned in `functions/src/subscriptions.ts` (`PLUS_PRODUCT_IDS`), `Verdure/Verdure/Models/StoreService.swift` and `Verdure/Verdure.storekit`. Also: Paid Apps Agreement, banking and tax forms, an App Store Server API key (yields `APPLE_IAP_PRIVATE_KEY`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID` for step 4) and App Store Server Notifications V2 pointed at the deployed `appStoreNotifications` URL. | **COSTS MONEY: Apple's commission on receipts** (15-30 %); no up-front fee beyond step 1 | Account holder (agreements) + backend owner (keys, URL) | Sandbox tester purchase on a device; `refreshMySubscription` returns a non-null `plusProductId`; the `appStoreNotifications` function log shows one verified notification. |
| 10 | **APNs auth key** (.p8) uploaded to Firebase Cloud Messaging; Push Notifications capability on the App ID. Code is done; nothing delivers without this. | $0 | Account holder (creates the key) + iOS owner (uploads) | Firebase console, Project settings, Cloud Messaging shows the APNs key; a test push from the console reaches a device with the app installed. |
| 11 | **App Review demo account**: register `appreview@verdure-app.com` in the app, then `GOOGLE_APPLICATION_CREDENTIALS=<path> node functions/scripts/seed-review-account.mjs <uid>` (sets 150,000 points and one perk code; idempotent; prints `[LIVE PROJECT]`). Requires functions live, because points are server-authoritative. Then RSVP two events from the device by hand. | $0 | Backend owner (seed) + listing owner (credentials in `AppStore/LISTING.md`) | Re-run the script: balance stays 150,000, not doubled. Sign in on a device and reach the redemption flow. |
| 12 | **TestFlight**: archive from Xcode with the Verdure scheme, upload, internal group first, then the two field testers run `DEVICE-QA.md` (runs 2 and 3 need the backend live). | $0 (needs step 1) | iOS owner | App Store Connect, TestFlight shows the build as "Ready to Test"; `DEVICE-QA.md` filled in with results. |

## Secrets to set (step 4)

Every `defineSecret` in `functions/src`, grouped by the feature it unlocks.
`functions/src/secrets.ts` holds the shared four; the rest are declared in the
module that uses them. Run from `functions/`:

```bash
# Places proxy (functions/src/secrets.ts): the app runs without them, categories stay thin
npx firebase-tools@13 functions:secrets:set RECREATION_GOV_KEY
npx firebase-tools@13 functions:secrets:set NPS_API_KEY
# Event ingest (functions/src/secrets.ts)
npx firebase-tools@13 functions:secrets:set TICKETMASTER_KEY
npx firebase-tools@13 functions:secrets:set SERPAPI_KEY          # capped at 90 calls/month in code, under the free 250
# Gift cards (functions/src/fulfillment.ts): COSTS MONEY (card face value) once TREMENDOUS_ENV=production
npx firebase-tools@13 functions:secrets:set TREMENDOUS_API_KEY
npx firebase-tools@13 functions:secrets:set TREMENDOUS_FUNDING_SOURCE_ID
npx firebase-tools@13 functions:secrets:set TREMENDOUS_CATALOG   # {"starbucks-5":"<product id>", ...}
# Verdure+ (functions/src/subscriptions.ts)
npx firebase-tools@13 functions:secrets:set APPLE_IAP_PRIVATE_KEY # .p8 CONTENTS
npx firebase-tools@13 functions:secrets:set APPLE_IAP_KEY_ID
npx firebase-tools@13 functions:secrets:set APPLE_IAP_ISSUER_ID
# Planners (functions/src/adventure.ts, functions/src/eventPlanner.ts): COSTS MONEY, usage-based
npx firebase-tools@13 functions:secrets:set ANTHROPIC_API_KEY
```

The four keys in `secrets.ts` previously shipped inside the iOS bundle via
`Secrets.xcconfig` and are considered compromised: **rotate them at the
vendor** before setting them here (the file header says so).

Non-secret values live in `functions/.env` (committed): `TREMENDOUS_ENV`,
`TREMENDOUS_CAMPAIGN_ID`, `APPLE_BUNDLE_ID`, `APPLE_APP_APPLE_ID`,
`APPLE_IAP_ENVIRONMENT`, `ADVENTURE_MODEL`.

## Deploy order (step 6)

```bash
# 0. Local gates: must be green before anything leaves the machine
cd functions && npm run check:classifier && npm run check:indexes && npm run build && cd ..

# 1. Rules: the lockdown every callable assumes
npx firebase-tools@13 deploy --only firestore:rules
npx firebase-tools@13 firestore:rules:get      # must match firestore.rules

# 2. Storage rules (the bucket from step 3 must exist)
npx firebase-tools@13 deploy --only storage

# 3. Composite indexes (every composite in firestore.indexes.json; building takes minutes)
npx firebase-tools@13 deploy --only firestore:indexes
npx firebase-tools@13 firestore:indexes        # every entry READY, none CREATING

# 4. Functions (predeploy runs npm run build via firebase.json)
npx firebase-tools@13 deploy --only functions
npx firebase-tools@13 functions:list           # non-empty; includes ingestCivic, discoverSources,
                                               # recheckSourcesWeekly, requestSourceRemoval, removalToken
```

Do not trust the deploy output alone: the `functions:list` and
`firestore:rules:get` reads are the proof, and the DEPLOY STATUS table in
`PROJECT-NOTES.md` is updated only from those reads.

## First-week checks (after step 12)

| Check | How often | Cost | Owner | Command / where |
|---|---|---|---|---|
| **Firestore usage against the free tier** (50,000 reads, 20,000 writes, 20,000 deletes per day; $0.03 per 100k reads beyond, us-central1 Standard, checked 2026-09-27). Scenario floor from `docs/READ-BUDGET.md`: 120 reads/user/day, so 100 users is about 36,000 reads/day (inside the quota) and 1,000 users about 360,000/day, $3.24 gross per 30 days. Ingest: a **populating** run writes about 8,700 documents (exceeds the daily write quota on day one; expect cents), an **unchanged** run writes 18 (`docs/HALFWAY-REPORT-2026-10-18.md`). | daily for 7 days | $0 to look | Backend owner | console.cloud.google.com, Firestore, Usage; `treasury/{month}.readTelemetry` for candidate reads (not invoice-grade). Compare with the budget alert from step 2. |
| **Ingest ran and sources are healthy**: `ingestCivic` / `ingestTicketed` logs; `/sources` `failureStreak` all 0; no source auto-paused (3 consecutive failures or a sudden zero pause it; a 304 counts as a successful run). | daily | $0 | Backend owner | `npx firebase-tools@13 functions:log --only ingestCivic`; Firestore console `/sources` where `status == "paused"` should be empty; `/sourceHealth`. |
| **Discovery daily job** (`discoverSources`, every 24 h, 300 inspections/day, one request per host per 10 s): one `discoveryRuns` document per run, candidates in `/sourceCandidates` with a stored decision, at least one new host activated in the first week with no human action, every rejection carrying its rule evidence. The OpenStreetMap (Overpass) origin is cached weekly in `/discoveryCache`. | daily | $0 (Overpass is free; the UA in `functions/src/discovery/http.ts` identifies us) | Backend owner | `npx firebase-tools@13 functions:log --only discoverSources`; the staff callable `runDiscoveryNow` for an on-demand run; `auditActiveSources()` output in the run report. |
| **Weekly re-check** (`recheckSourcesWeekly`, Mondays 06:00): sources whose robots or terms tightened are paused; paused sources that pass again resume. | Monday | $0 | Backend owner | `npx firebase-tools@13 functions:log --only recheckSourcesWeekly` shows the `paused` and `resumed` arrays. |
| **Removal endpoint** reachable and logged: `requestSourceRemoval` and `removalToken` HTTP functions (v2 default region, so `https://us-central1-connectify-19dd8.cloudfunctions.net/requestSourceRemoval`). A small host is removed immediately; a host with more than 100 active events must publish its token first (`removalToken` returns it); every request lands in `/removalRequests`, removed hosts in `/removedHosts` and are never rediscovered; their events are hidden on the next ingest cycle (`applyRemovals`). | day 1, then per request | $0 | Backend owner + support inbox owner (`support@verdure-app.com` must be live) | `curl -s -X POST <removalToken url> -d "host=example.org"` returns a token string; a request for a host we do not ingest returns a structured answer and exactly one `/removalRequests` row. |
| **Push and reminders**: `sendEventReminders` digest reaches at least one opted-in test account (2/week cap, quiet hours). | by day 3 | $0 | iOS owner | `npx firebase-tools@13 functions:log --only sendEventReminders`; the device shows it. |
| **Gift-card fulfilment stays in sandbox** until a funded Tremendous account exists; `sweepFulfilments` runs every 30 min over `/fulfillments`. | daily | COSTS MONEY (face value) once production | Backend owner + finance | `grep TREMENDOUS_ENV functions/.env` still says `sandbox`; `/fulfillments` has no `failed` rows. |
| **Crash-free sessions** at or above 99 % on the TestFlight build. | daily | $0 | iOS owner | Firebase console, Crashlytics (baseline in `docs/CRASHLYTICS-2026-10-04.md`). |

## What this checklist deliberately does not do

- It does not flip `APPLE_IAP_ENVIRONMENT` or `TREMENDOUS_ENV` to `production`.
  Those are launch-day decisions by the account holder once step 9 and the
  Tremendous production approval are done.
- It does not enable ranking v2 (`config/ranking.version`); that waits on the
  W6.1 blind judge.
- It does not recruit the three sources that return 403 (City of San José,
  Santa Clara University, Santa Clara County Parks). A human has to ask; see
  `docs/FEED-SURVEY-SAN-JOSE.md`.
