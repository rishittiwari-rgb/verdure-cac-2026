# Website submissions, age gate and legal pages — local evidence

B4 and E1–E3 are implemented and verified locally. No production migration,
website publication, environment flip, billing or key change occurred. The
complete sprint remains active; park/offline, programs/supply, optional features,
indexes, Crashlytics and physical-device gates remain on the requirement ledger.

## Data and access

Support, organizer and merchant forms write to Supabase through a bounded,
same-origin server route with explicit payload fields. Native forms use POST to
a fixed destination before JavaScript is ready; personal fields do not enter a
query string. Requests return confirmation only after persistence. Public forms
cannot set handled status, timestamps, notes or staff actors. Calendar URLs are
validated HTTP(S) candidate sources, not fetched or automatically ingested.

The server-only `SUPABASE_SERVICE_ROLE_KEY` is never a `NEXT_PUBLIC_` value.
Authenticated website profiles, including editable `admin` metadata, cannot read
requests or execute RPCs. Every staff list/handle/audit request first checks the
canonical Firebase admin claim server-side. Staff identity comes from that check.
The Supabase tables have RLS, no public policies and explicit service-only grants.
RPCs are invoker functions with empty search paths and restricted execute grants.
Handling and its before/after audit commit atomically. Audit update/delete is
forbidden even to the service role. Read audits and handling history are shown
in the inbox. Handling notes are required; cursors use timestamp plus UUID.

The existing website limiter is per-process: six submissions per connection per
ten minutes across all form kinds. It is not a distributed or durable limiter.
Development module recompilation/process restart resets these counters; the
regression measures consecutive calls after the routes are warmed.

Website requests have no automatic retention expiry. App account deletion does
not delete independently submitted website forms or immutable staff audits.
This is stated in both privacy copies; no invented deletion guarantee is made.

## Local setup and exact reruns

The Supabase CLI-created migration is
`20261004090351_website_submissions.sql`. The local stack applied all existing
migrations; the pending migration was also replayed fresh in a transaction and
rolled back to preserve existing local rows. The two legacy constant waitlist
SQL helpers now have immutable empty search paths. Security advisors report no
issues. No production schema or authorization configuration was changed.

```sh
cd Verdure-website--main
# Use your running Docker context; this host's existing local runtime is Colima.
DOCKER_CONTEXT=colima ./node_modules/.bin/supabase start --exclude studio,postgres-meta,imgproxy,edge-runtime,logflare,vector,supavisor
DOCKER_CONTEXT=colima npm run submissions:local
```

The runner gets only local CLI credentials, requires a loopback database, and
passes them to the owned localhost Next child without modifying `.env.local` or
printing secrets. Local mode refuses production execution. The separate local
Firebase sprint emulator must already run on Auth 9099, Firestore 8899 and
Functions 5002 after a fresh Functions build. In another terminal:

```sh
cd Verdure-website--main
DOCKER_CONTEXT=colima FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node scripts/submissions-e2e.mjs
DOCKER_CONTEXT=colima node scripts/submissions-migration-check.mjs
DOCKER_CONTEXT=colima ./node_modules/.bin/supabase db advisors --local --type security --fail-on warn
```

Start the browser regression with a clean owned development process; earlier
runs intentionally exhaust its limiter. The test uses a temporary headless
Chrome context, fictional requests and local accounts, cleans its own request
rows, and leaves immutable fictional audit evidence. It never uses a personal
browser profile. The replay verifier changes definitions only inside a local
rollback transaction and requires `psql`.

43 browser/server/database checks passed: real three-form persistence, native
POST fallback, exact fields, staff inbox and handled history, escaped markup,
verified actors, immutable audits, forced audit-failure rollback, same-time
105-row pagination, invalid inputs, body bounds, same-origin checks, denied anon,
website/non-admin access, revoked old cookie denial for all three actions,
per-process rate limit and mobile overflow checks.

## Legal pages and app signup

`/terms` and `/support` build locally; footer and sitemap link them. Privacy
removes the legacy phone/payment-card/shipping/cart/provider claims and describes
actual account data, location, attendance evidence, social activity, optional
preferences, recommendation analytics, website forms, web analytics, staff
audits, planner requests and separate retention. App and website document bodies
match exactly. No offline, AR, Always-location or Crashlytics collection is
advertised before those features exist.

The app's restored Terms button uses `Legal.termsOfServiceURL`. Release always
uses the canonical domain. For explicit DEBUG emulator QA only,
`QAUseFirestoreEmulator=YES` plus `QAWebsiteBaseURL=http://127.0.0.1:3105` (or a
private-LAN host) routes legal buttons to the unpublished local website.
Malformed/public overrides fall back to the canonical URL. Bundled documents
remain available offline. Public website publication is still pending.

```sh
# Stop the owned Next development process before building .next.
cd Verdure-website--main
npm run build
npm run lint
npm test
./node_modules/.bin/next start --hostname 127.0.0.1 --port 3105
# In another terminal:
node scripts/legal-pages-e2e.mjs
```

Fresh production build/lint, 39 IP and 47 existing security checks passed.
15 page checks passed, including the first cold production browser request
hydrating, native POST fallback, terms/privacy HTTP 200, linked contents/support,
mobile overflow, form hydration, sitemap, exact cross-platform document parity
and no JavaScript errors. Mobile support/privacy screenshots were visually
inspected. Earlier cold development hydration stalls remain unexplained; warmed
development and cold production-build checks passed, which is a narrower claim.

Signup now asks a blank neutral birth year before name/email/password/account
type/student fields. Under-13 ends the flow, clears the in-memory answer/draft,
shows no account/guest creation action and does not persist onboarding interests
or radius. The service age guard runs before processing credentials or calling
Firebase. Existing eligible-member `registerAgeBand` handling is unchanged.
The unused legacy signup form was removed to keep one active entry path.

```sh
cd Verdure
xcodebuild -quiet -project Verdure.xcodeproj -scheme Verdure \
  -destination 'platform=iOS Simulator,name=iPhone 16 Plus' \
  -only-testing:VerdureTests \
  -only-testing:VerdureUITests/JourneyTests/testUnder13NeutralAnswerEndsSignupWithoutAccountFields \
  -only-testing:VerdureUITests/JourneyTests/testEligibleMinorReachesAccountFieldsOnlyAfterAgeScreen test
```

112 passed / 0 failed / 0 skipped on iPhone 16 Plus, iOS 18.4 Simulator before
adding the connected Terms test. Result bundle:
`Test-Verdure-2026.10.04_02-52-52--0700.xcresult` in the project DerivedData Logs/Test.
The subsequent focused core/signup run passed 13 / 0 / 0, including Swift's
actual local Terms HTTP 200 and rejecting public/disabled debug overrides:
`Test-Verdure-2026.10.04_02-56-53--0700.xcresult`. A fresh focused rerun of the final connected Terms test passed 1 / 0 / 0:
`Test-Verdure-2026.10.04_03-02-44--0700.xcresult`. It explicitly skips if the
local website is absent; start port 3105 for the connected gate rather than count a skip as proof.

No physical two-phone, outdoor GPS/offline, live index, push delivery, purchase
or readable physical Crashlytics result is claimed by these tests.
