# Verdure sprint status — 2026-09-27

This is the **Verdure iOS app** in the directory named `Connectify App-iOS`.
The source is the 584-line “Verdure — Next Sprint” brief supplied for this
week. No production deployment, billing upgrade, Apple Developer action or
environment switch has been performed. `PROJECT-NOTES.md` deploy status is untouched.

## Built locally

- A1 coverage measurement ran first: the live `/events` collection has zero
  documents. See `COVERAGE-SAN-JOSE.md`. A2 now says Sports & Outdoors.
- B source list was widened and committed before C0 tuning in `462c0a1`:
  SCU LiveWhale, four libraries and City Legistar. Fingerprints and source
  probes are recorded in `FEED-SURVEY-SAN-JOSE.md`.
- C0 classifier and event enrichment run on ingest. Resumable dry-run-first
  backfill, low-confidence CLI and a 200-row stratified reviewer sample exist.
  The human audit is still unreviewed; see `CLASSIFICATION-AUDIT.md`.
- P3's read model is in `READ-BUDGET.md`. The server merges bounded time,
  quality and category candidates into a five-minute shared area cache;
  accepted friends' RSVPs enter separately. Treasury counts candidate query
  returns. The client limits its first feed to 80, and Everything pages 40
  events at a time. Live cost validation remains open with the empty corpus.
- C2 uses a curated interest synonym map. Discover offers For You and
  Everything. Ranking now uses quality, saved events, attended categories and
  organizers, mutual friends, timing, 90-day decaying feedback and a labelled
  exploration slot. Event details offer More like this and Less like this.
  `rank-eval.mjs` is ready for the 20-profile human golden set; no human
  relevance labels have been invented.
  Onboarding and the interest picker now sync declared interests to Firestore,
  which closes a prior gap where the server ranker could not see those choices.
- D's typography, radius, depth and accent tokens landed in `c8ef3cb` before
  the new views. E has five tabs, mutual friend requests, invite links/QR,
  adult-only exact username lookup and accepted-only social activity. Friends
  has an honest zero-friend state. The active website has a local invite page.
  Add Friends also offers adult accounts from a completed event only when both
  RSVP'd before it ended; upcoming attendees, minors and blocked accounts are
  excluded server-side. Friend-request creation and acceptance emit the
  existing invite funnel events. Real share/install conversion remains a
  device and deployed-link check.
- F now has an options-first Plan UI backed by a server session. The ranker
  selects real candidate documents; the model can only sequence verified IDs,
  and a deterministic fallback serves the same verified IDs when the model key
  is unavailable. Refinements stay in the same session without a model call.
  The date option now opens a calendar picker and filters verified candidates
  to that local day, as the brief specifies.
  Plan cards now use real source images when present, a clear fallback when
  absent, compact RSVP controls and the accepted-friends avatar stack.
  Monthly free-plan quota is transactional; model cost is counted in treasury.
  Emulator acceptance checks cover profile difference, no invention and
  repeat avoidance. The actual model path still needs a configured key and
  review on a populated index.
  Client and server now constrain “This weekend” to the current local weekend,
  including Sunday and daylight-saving transitions. Walking and short-drive
  choices require known venue coordinates. A DEBUG-only offline QA event
  exercises a populated card without entering the live index or earning points.
- G1 stores private age band, optional student status and school, with a
  student ranking boost. G2's Opportunity labels and G3's organizer event
  attributes (age, size, setting, accessibility, venue, deadline) are local.
  Confirmed setting, age audience, group size, accessibility and public-venue
  details can now be filtered in Discover; old saved filters still decode.
  Empty filter results no longer restore unrelated events. Places and Map now
  browse from San Jose when GPS is unavailable, with the same center applied
  to the radius filter; check-ins still require a real location fix.
  C9 now stores optional child ages, accessibility needs, usual transport and
  typical distance in Household. They affect ranking without filtering;
  event details warn about age, late endings and unconfirmed accessibility
  features where metadata supports them. App and both website privacy copies
  were updated for these fields. Volunteer filters stay
  hidden until 30 upcoming listings with coordinates fall within the chosen
  radius. Four G4 organizations were fingerprinted read-only; findings and
  the prepared Idealist inquiry are in `VOLUNTEER-SUPPLY-2026-09-27.md`.
- I2/I3 copy audit found the active website selling deferred offline maps and
  AR and showing an obsolete $39.99 yearly price. The local pricing source,
  metadata and structured data now match the iOS paywall's existing $49.99
  yearly plan and four built benefits. App Store listing copy now matches the
  paywall's Advanced Stats benefit. No website deployment was made.
- I1 now has server-verified Verdure+ interest profiles, active-profile ranking,
  distance presets, permanent category exclusions and saved filter sets.
  Discover and Plan can open the profile switcher. Free accounts keep the one
  implicit profile and their ranked feed. The fifth Plus benefit was added
  only after the profile-switch ranking test passed.
- C11 now records server-scored For You slates and visible-card impressions,
  including rank position, contributing terms and ignored/tap/save/RSVP/dismiss
  outcomes. Clients cannot forge a slate entry or read/write the telemetry
  collection directly. Group plans (H) use verified Plan-session events,
  private invitations to accepted friends, shortlists and independent RSVPs.

## Verification

- iOS Simulator Debug build and the full unit suite passed **103/103** after
  the final Household and Add Friends changes. The focused
  DiscoveryFilters suite passed **12/12**.
- The previously stalled UI runner completed when parallel testing was
  disabled. The five-tab journey suite passed **10/10** after updating stale
  pre-redesign navigation anchors. The structural accessibility audit found
  small tap targets and a decorative image label; those were corrected, then
  all **13/13** audits passed. Ten accessibility XL/default screenshot tests
  were exercised; one initially failed because XCTest tapped a tile under the
  enlarged tab bar. After reserving more space and scrolling the tile into
  view, its light/dark chip checks passed. Focused XL checks also passed on
  Plan, Friends, Explore light/dark and Profile. Community's heading wrap was
  corrected and its XL capture and audit passed. The XL captures are linked from
  `DESIGN-REFRESH.md`.
- Functions TypeScript build: passed.
- Ranking units: **52 passed, 0 failed**; planner units: **13 passed, 0 failed**
  after weekend, DST, venue-coordinate and child-suitability cases.
- Backend emulator E2E was rerun after the final household and friend changes: **337 passed,
  0 failed**, including group invitations, shortlist votes, telemetry opt-out
  and access revocation. The Functions emulator used temporary port 5002
  because an existing Python process occupies 5001; the temporary config was
  removed afterward.
- Red team: **49 attacks blocked, 0 vulnerable** after the final rules and friend changes.
- All Functions unit suites passed; active website tests and production build
  passed after the invite and pricing changes.
- Computer inspected the five tabs plus Places, Map, Community, Collection and
  the Plan date picker on iPhone 16 Plus, and saved the visible states in
  `DESIGN-REFRESH.md`. It confirmed Map centered on San Jose without GPS and
  Places loading nearby results. It also found a radius-label mismatch, which
  prompted the fallback filter fix. A separate offline QA capture now shows
  the populated Plan card; live event imagery, populated ranking and a real
  Plan result remain unverified because the index is empty.

## Open completion gates

**Populated local gate and live-read finding:** a disposable Firestore emulator
ingested 9,813 upcoming active public-feed records. Its suspected duplicate
rate was 0.12%, and one shared ranking refresh returned 359 candidate documents
for 285 distinct cached candidates; four sample profiles received different
top tens. [Details and limits](LOCAL-CORPUS-AND-PUBLIC-READ-2026-09-27.md).
The full-size backfill dry run now proposes zero changes to 9,832 already
enriched records after an idempotence fix; a legacy-record migration and
second pass also passed in a separate emulator check. 3,349 local records
remain below the classifier's 0.65 confidence threshold pending human review.
The exact public iOS feed query against the live project returned
`permission-denied`, matching the Simulator's “Couldn't reach the event store”
message. A read-only Rules API check confirmed the active live ruleset still
requires authentication to read any event, while the tested local rules allow
visible broadcast events to guests. The live project also reports zero deployed
Cloud Functions and zero composite Firestore indexes. No deployment occurred.
This environment gap must be resolved in
addition to populating the currently empty live corpus.

**Populated iOS Simulator pass:** an opt-in DEBUG-only simulator connection to
the local Firestore emulator displayed 48 For You events, 40 Everything
listings, and an opened event detail. [Screenshots](DESIGN-REFRESH.md) show the
actual app with public source records. Server-only feed reads now distinguish a
failed refresh from a successful empty local cache, preserving the app's saved
events on an offline failure. This is local UI evidence; the live guest feed
still fails under deployed rules, and no production data was written.

**Free follow-up on September 27:** all 11 public adapters responded again;
3,213 dated, geocoded source records fell within 25 miles over the next 30
days, including 55 provisional Volunteer classifications before deduplication
or review. The 200-row classifier sample was regenerated after correcting
obvious library/sports/volunteer false positives; 56 rows remain below 0.65
confidence, with no human accuracy score. Ingest unit checks passed 122/122,
and the iOS Simulator build passed after switching the in-app website base to
`verdure-app.com` and removing the dead public Terms button. The registered
Firebase Verdure iOS app matches the local bundle ID and plist. No production
write or deploy occurred.
An additional read-only source snapshot now gives the ranking reviewer 233
source-linked, geocoded events and a 20-profile unlabeled template; see
`RANKING-EVAL.md`. The evaluator requires a named reviewer and matching corpus
hash before it will calculate precision. This does not replace the later
populated-production-corpus evaluation.

| Scope | Still needed |
| --- | --- |
| A/B | Populate live events; re-run coverage and record the delta; assess County Parks/volunteer structured access; verify duplicate rate under 5% against live cycles. The required City and County path probes are recorded, and six new sources are configured. |
| C0/P2 | John reviews all 200 sampled classifications; calculate category accuracy and fix misses; review a populated-corpus backfill dry run before writing it live. |
| P3/C1 | Measure full Firestore reads against a populated index, including user context, client reads and index entries, before enabling the feed at scale. |
| C3/C10/C11 | Full radius and filter behavior against a dense corpus; John labels the 20-profile golden set after classification; live measurement of impression/outcome coverage and cost. |
| D/E | Populated **production** event screens, full VoiceOver reading order, broader dark-mode and physical-device QA; real installed-app invite round trip. The local-emulator Discover and detail screens are captured. The shared-past-event friend path is implemented and emulator-tested. Structural audits and targeted XL Simulator captures pass. The website invite page needs deployment before public links work. |
| F | Configure and exercise the actual model secret; review sequencing, sponsor trust and session spend against a populated index. Emulator tests prove the verified-ID fallback and session mechanics. |
| G | At least 30 live local volunteer listings before surfacing that subtype; the Volunteer chip is hidden below this threshold. Partner/API access and Idealist application remain; any post-freeze source addition requires a renewed classification audit. |
| I/H | Profile and group-plan controls need device QA and a real two-phone invite test. Offline packs and AR stay deferred and are no longer advertised. |
| Legal/web alignment | Have the owner review the active website's legacy policy, which still lists phone, billing and shipping data and under-16 language was locally corrected to under-13. The app and listing now use the confirmed `verdure-app.com` domain; `/terms`, `/support`, and the receiving support/privacy inbox remain unavailable. Rishit plans free forwarding, pending a delivery test, and said no deployment yet. |

The sprint is **not complete**. The table separates engineering still to do
from the required live corpus, named human review, device QA and external
accounts/partners. No unmeasured ranking or coverage claim is treated as a
release pass.

The account, budget, email, and owner request list for Rishit is in
[RISHIT-ACCOUNTS-AND-BUDGET-2026-09-27.md](RISHIT-ACCOUNTS-AND-BUDGET-2026-09-27.md).

## Rishit's September 27 handoff decisions

- `verdure-app.com` is the sole public and email domain. Local iOS legal and
  safety contact strings, backend responses and both website trees now use
  `support@verdure-app.com`. Rishit plans free forwarding for support and
  privacy; neither address is considered working until delivery is tested.
- John owns the [200-row classification audit](CLASSIFICATION-AUDIT.md), then
  the [20-profile ranking set](RANKING-EVAL.md). A
  [forwardable packet](JOHN-REVIEW-HANDOFF.md) and frozen source files are
  prepared. No human labels or evaluation scores have been claimed.
- Rishit approves privacy, terms and App Store copy. Advaith owns the 24-hour
  safety response; Adithya needs queue access and the
  [moderation handoff](MODERATION-HANDOFF.md). They are different people.
  No live staff access exists while Functions remain undeployed.
- Rishit will create a free Verdure GitHub organization. The repository still
  lives at `github.com/lalubalu/appc`; transfer and admin verification
  wait for the organization's slug and Rishit's GitHub identity.
- The live website uses Vercel, but its owning account/team and plan could not
  be verified: the local CLI is logged out and the dashboard requires sign-in.
  Rishit needs to provide the project/team or an invitation before its Hobby
  versus Pro status can be confirmed.
- Free Apple Account device QA is the next hardware step. Xcode currently
  reports the discovered iPhone as unavailable, so no real-device check has
  passed. See [DEVICE-QA.md](../DEVICE-QA.md).
- No purchases, Blaze upgrade, Apple membership, Anthropic or Tremendous
  activation, production deployment, or website publication is authorized.
  Bandsintown and Songkick were dropped from active scope.
