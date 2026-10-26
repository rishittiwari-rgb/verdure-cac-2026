# Staff console: local implementation and evidence

The existing website now has `/admin` with Moderation, Organizers, Partners
and Operations tabs. B4 (submissions inbox) is still pending, as are the website
forms it must read. This checkpoint does not complete the sprint.

## Access and audit

Firebase Auth is separate from the website's Supabase login. A CLI grants or
revokes the admin custom claim; there is no grant endpoint or interface.
`common.isAdmin()` verifies both the presented claim and the current canonical
Auth user's claim/disabled state. Every callable checks it server-side.

The website signs in server-side and holds the ID token in a one-hour HttpOnly,
SameSite=Strict cookie (Secure in production). Tokens are never stored in browser
JavaScript. POST/DELETE routes require same-origin JSON with bounded bodies.
The backend proxy has a fixed endpoint allowlist and no caller-selected URL.
Local mode requires `VERDURE_STAFF_EMULATOR=1` and cannot run in production mode.
Production configuration is deliberately not enabled by this sprint.

Direct changes commit immutable before/after staff audits in their transaction.
Read actions record the actor, filters, returned IDs and time. Legacy long jobs
(ingestion, supply reports, reconciliation, fulfilment and manual moderation
sweeps) write intent before work, then completion/failure records. A crashed job
remains `started` rather than appearing successful. Auth claim changes likewise
record requested and terminal outcomes because Auth/Firestore cannot share a
transaction. Client writes to audit/job rows are denied, even for admins.

## Review and partner behavior

- Reports have oldest-first pagination, context/author, reasons/counts, age and
  the 20-hour highlight, status/type filters and resolved history. Reasons are
  required for remove, restore, warn and suspend. Removed prose is preserved
  for restoration. Queue/target/audit changes are atomic; per-reporter statuses
  reconcile in audited groups of at most 200 against the current decision.
  Up to 100 detailed reports are displayed with the full count/reason summary.
- Applications have oldest-first pagination, approval/rejection reasons and
  the 50-approval cap. Concurrent attempts at the last slot admit exactly one.
  Rejection does not release a slot; reinstatement retains the original slot.
  Existing event visibility follows the current organizer decision in bounded
  audited transactions.
- Partners save a server-geocoded address and contacts. Activation requires who
  agreed, when and a written-confirmation reference. Fictional test agreements
  are explicitly labelled fixtures; no real business is activated by tests.
- Perks enforce integer costs of 500–2,000, terms, future expiry and valid early
  access. CSV batches accept up to 400 codes, reject malformed input and
  case-insensitive duplicates (including redeemed legacy codes), and report
  loaded/unused counts. Editing a perk preserves stock and redeemed codes.
  Low stock means fewer than 10 unused codes.
- Deactivation is canonical: map/nearby/catalog/redemption recheck the active,
  agreement-backed partner and perk. The console and server refuse inactive
  offers immediately. Safe known-document metadata now invalidates stationary map pins/cards,
  including a real SDK/timed-expiry test. Active catalog reads page beyond 500.
  Rewards and other sponsored client caches still need an invalidation audit.

The geocoder uses the fixed US Census Public_AR_Current address endpoint.
Coordinates cannot be submitted by a client. It requires exactly one valid
match. These are address-range coordinates, not a verified entrance or walking
route. A read-only public request for San José City Hall returned valid
coordinates on October 4; deterministic tests instead use loopback-only raw
response fixtures that deployed code cannot read. Provider outage behavior is
covered locally; real-business address QA remains separate.

Provider: [Census geocoding API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html).

## Operations

Every source run persists its outcome before updating per-source health.
An outage retains the preceding successful run and its event count. Older run
logs are queried when no summary exists; concurrent older successes cannot
erase newer failures. The console shows the current error, latest run/returned
count, last success and active upcoming events by primary source.

Supply metrics scan the complete active/upcoming/visible launch-area corpus in
500-document pages, using field projection. The duplicate rate uses the existing
title/time/venue/proximity heuristic and is explicitly labelled suspected,
not human-validated accuracy. Queue counts use server aggregation; oldest age
comes from the actual oldest open report.

Month-to-date reward commitments and fulfilled dollars are separate against
the $200 cap. Planner cents convert to dollars and include both planner types.
Planner/SerpApi amounts are labelled recorded estimates, not vendor invoices;
the existing ledger can omit failed/unrecorded model calls. SerpApi shows the
configured free quota and any recorded charges. No billing setup changed.

## Re-run and observed results

Start local services from the root after a Functions build:

```sh
node functions/scripts/sprint-emulators.mjs
```

The focused scripts below require the working Firestore/Auth/Functions suite on
8899/9099/5002. Run budget/cap/operations scenarios serially, because they save
and temporarily replace local fixture counters.

```sh
cd functions
npm run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/staff-access-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/staff-moderation-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/staff-organizers-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/staff-partners-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/staff-pagination-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/staff-operations-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/staff-jobs-e2e.mjs
```

Observed: access 29, moderation 19, organizers 20, partner management 47,
pagination/601-report decisions 14, operations 14, legacy jobs 12 passed.
The backend-wide fresh run passed 286 unit checks, 337 end-to-end checks and
49 red-team probes with zero vulnerabilities. It uses a second clean suite:

```sh
# Root; builds first, starts isolated local ports, runs broad checks, shuts down.
node functions/scripts/sprint-regressions.mjs
```

Do not rerun the fixed-name broad fixtures against a populated working suite:
existing ingested events, usernames and redeemed codes legitimately conflict.
An attempted repeat there failed 16 checks; the isolated fresh runner passed.
The runner validates loopback-only targets and leaves the working suite intact.

For browser verification, start the local website in one terminal:

```sh
cd Verdure-website--main
VERDURE_STAFF_EMULATOR=1 npm run dev -- --port 3104 --hostname 127.0.0.1
```

Then from the root:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node Verdure-website--main/scripts/staff-console-e2e.mjs
```

Observed: 23 actual browser/server checks passed. Includes sign-in/CSRF,
reports/applications beyond the first 100, removal/restoration, approval/cap,
agreement gate, perk creation, native CSV upload, map visibility/deactivation,
an actual missing-key adapter failure in Operations, mobile width and sign-out.
It uses an isolated Chrome session and fictional data. The final conditional
author/venue labels are additionally covered by the fresh server context check
and website build; they are not a separate browser assertion.

Website typecheck/lint and production build passed. Existing website IP/security
tests passed 39/47 checks respectively. Stop the dev server before a production
build: both use `.next`, so overlapping them invalidates browser evidence.

No deployment, physical-device QA, device push delivery or production index
verification is implied. H1's complete query inventory/check remains pending.

## Submissions inbox checkpoint (B4)

The fifth console tab reads support, organizer and merchant requests stored in
local Supabase. Each list, handle and audit request first verifies the canonical
Firebase admin claim through `staffSession`. Supabase website login or editable
user metadata cannot authorize access. Server-only service credentials call
explicitly restricted invoker RPCs; public table reads and direct RPCs are denied.
Staff handling and its immutable before/after audit share a Postgres transaction.
Reads also record actor, filters and returned IDs; audit history is visible in
the console. Browser-selected actors are ignored. A forced audit failure leaves
the request pending with no handling note.

43 native browser/server/database checks passed, including all three denied
non-admin actions and old-cookie denial after CLI revocation. Fresh pending
migration replay and local security advisors passed with zero findings.
See WEBSITE-SUBMISSIONS-2026-10-04.md for exact reruns and limitations.
