# Verdure next sprint: engineering report

Date: 2026-09-27. Scope: the supplied 584-line “Verdure — Next Sprint”
brief, applied to the Verdure iOS app in `Connectify App-iOS` and its Functions
and website companions. This is a local engineering report, not a release
certificate. No deploy, billing change, Apple Developer action, or production
environment flip was performed. `CLAUDE.md` deploy status was left untouched.

## Verdict

The sprint is **not fully complete**. The broad local implementation is in
place and builds, but several explicit acceptance gates cannot be passed with
the live `/events` collection empty. A named human must review 200 classifier
examples and label a 20-profile ranking golden set. Partner/API access, an
Idealist business contact, Apple/Blaze setup, and physical-device QA remain
external inputs. The simulator journey and structural accessibility suites
pass; the remaining gates below still prevent a release-complete claim.

This report does not turn an emulator pass into proof of live coverage, paid
model quality, real-device behavior, or launch readiness.

## What was built

| Area | Delivered locally | Evidence / limit |
| --- | --- | --- |
| A / B supply | Coverage baseline recorded; “Sports & Outdoors” label; source fingerprinter; SCU LiveWhale adapter; City and County probes; six additional source configurations; frozen source list before C0 lexicon work. | [Coverage](COVERAGE-SAN-JOSE.md), [survey](FEED-SURVEY-SAN-JOSE.md), [freeze](SOURCE-FREEZE-SAN-JOSE.md). The live collection has **0** documents, so coverage delta and duplicate rate against real cycles are not measurable. |
| C0 classification | Ingest-time multi-label enrichment, confidence/quality and eligibility fields, geocode cache, resumable dry-run-first backfill, low-confidence CLI and stratified reviewer sample. | [Audit packet](CLASSIFICATION-AUDIT.md). The 200-item human review and live backfill approval are outstanding. |
| C discovery and P3 cost | Bounded multi-strategy candidate retrieval, shared short-window area cache, client feed limit, 40-event Everything pages, interest synonyms, For You/Everything, implicit/explicit feedback, exploration, friends-going exception, and read counters. | [Read budget](READ-BUDGET.md), [ranking evaluation](RANKING-EVAL.md). Full Firestore read pricing and ranking quality require a populated corpus. |
| D design | Editorial serif display type, calmer radii/depth, disciplined accents, five-tab shell and refreshed screen hierarchy. | [Before/after Simulator captures](DESIGN-REFRESH.md). A DEBUG-only populated Plan card and structural accessibility pass now exist; live event imagery, full visual XL/dark/VoiceOver review and device contrast remain open. |
| E friends | Mutual request/accept/decline/remove, rules and server checks, minor protections, invite links/QR, accepted-only activity, Friends navigation and zero-friend state. Add Friends now includes adult accounts from a shared completed event, only if both RSVP'd before it ended. | Emulator tests passed; a real two-device invite and public website link need device/deploy access. The external share sheet cannot prove an SMS was sent. |
| F planner | Options-first UI, verified-event-only plan sessions, deterministic fallback, in-place refinements, date picker, quota and model cost accounting, group-plan entry, real image/fallback, RSVP and friends-going card elements. | Automated acceptance tests cover profile difference, repeat avoidance and no invention. The actual model secret and populated-event card review remain open. |
| G opportunities | Student/household fields and ranking signals; optional child ages, accessibility needs, usual transport and typical distance; Opportunity labels; organizer metadata capture/display/filter; volunteer/program minimum-count gates; four volunteer organizations fingerprinted. | [Supply findings](VOLUNTEER-SUPPLY-2026-09-27.md). Volunteer sources were not added after the P1 freeze because the C0 audit has not passed; the live threshold is unmet. |
| I / H | Verdure+ named interest profiles, saved filters, distance presets, exclusions and verified entitlement; group-plan invites, shortlist voting and independent RSVPs. | Emulator checks passed. Real purchase and multi-device UX remain open. Offline packs and AR are deferred and removed from sales copy. |
| Honest copy | App/website privacy, invite and pricing copy aligned with implemented benefits and the $49.99 annual paywall. | Local website build/tests passed. Website changes are not deployed. |

## Final Simulator pass and corrections

Computer inspected Discover, Places, Map, Plan and its date picker, Friends,
Rewards, Profile, Community, Collection, and the event filter sheet on an
iPhone 16 Plus Simulator. The captures are linked from
[DESIGN-REFRESH.md](DESIGN-REFRESH.md). Current event and social captures show
empty/signed-out states because there are no live events or test friendships.

That pass found and fixed four concrete defects:

1. Organizer attributes were shown on events but had no corresponding
   persisted setting, audience, group-size, accessibility or public-venue
   filter. Old filter snapshots now migrate without losing earlier choices.
2. A zero-result filter could silently restore unrelated event cards. Only
   the deliberate lone-category shortcut may widen the deck; other filters
   keep their empty result and a useful explanation.
3. With GPS unavailable, Map opened at a continent scale and Places did not
   fetch. Both now browse from the San Jose launch-area center, then refresh
   after a real fix. GPS-based check-ins still use the actual location only.
4. Places said “within 10 mi” while showing a 35-mile card. The browse center
   now applies to the same radius filter; the corrected capture shows one
   6.3-mile card under the 10-mile label.

Plan event cards gained source images with a fallback icon and accepted-friend
avatars. The filter sheet opens at full height for the longer form. A Rewards
empty-state sentence was changed so it does not assert that local partners
are already being signed up. The device QA checklist gained checks for these
flows; no checkbox was marked passed by simulator inspection alone.

The follow-up automation exposed five stale UI-test anchors from the old tab
structure. Those tests now use the five current tabs and the nested Community,
Collection, Places and Map routes. An offline, explicitly marked QA event lets
the Plan test render a populated stop and assert that Details clears the
floating tab bar; that event is excluded from rewards. The first structural
accessibility run then found small tap targets in Collection, Discover and
Plan, plus an announced decorative icon in Friends. The corrected run passed
all 13 screen audits. The populated-card screenshot and its limitation are
linked from [DESIGN-REFRESH.md](DESIGN-REFRESH.md).

The XL screenshot review found visual truncation that a structural audit
cannot detect. At accessibility sizes, the tab bar now uses shorter visible
labels with full VoiceOver names; Discover modes show text without crowded
icons; Plan choices stack as full-width controls; Profile statistics use two
columns; and the Community heading stays on one line. The Plan scroll now
reserves space above the enlarged tab bar, and a subtle top mask prevents
scrolled text from colliding with status-bar glyphs.

The Plan candidate rules were tightened on both sides. “This weekend” now
means the current local weekend, even on Sunday, and the server uses calendar
dates through daylight-saving changes. Walking and short-drive options require
known venue coordinates. “With kids” requires confirmed child/family metadata
instead of silently treating unknown suitability as a match.

## Final local scope pass

The brief's C9 household preferences were only partially represented by a
youngest-child setting in the earlier build. Profile now stores up to ten
children's ages and optional accessibility, transport and typical-distance
preferences. The ranker uses the youngest age for family suitability, boosts
events with every requested accessibility feature confirmed by the organizer,
and applies transport and radius to distance decay without removing events.
The event detail warns when selected accessibility features are unconfirmed;
it does not call an unannotated venue inaccessible. Firestore rules bound the
new fields, and the app, active website and legacy website privacy copy now
describe them. The old youngest-age field remains readable for migration.

The E3 shared-event friend path was also missing. A new rate-limited callable
looks only at the requester's own RSVP event IDs. It excludes current and
future events, requires both RSVP timestamps to precede the event end,
excludes minors, unknown-age accounts, blocked accounts and existing friends,
and caps candidate reads/results. An old feed listing may be marked inactive
after it disappears from the source; that does not erase a verified past RSVP,
while moderated or removed listings remain excluded. Add Friends shows these candidates below
link/QR and exact username options. The invitation share action is prominent;
the existing `invite_sent` and `invite_accepted` client events occur on friend
request creation and acceptance. A share-sheet opening is not counted as a
completed SMS send, so installed-app conversion still needs field validation.

## Verification record

- Latest iOS Simulator build: **passed** after the final Household and Add
  Friends changes. The full iOS unit suite was rerun and passed **103 tests,
  0 failures**; the focused discovery-filter suite previously passed **12/12**.
  The latest full unit log is `/tmp/verdure-final-ios-units-20260927.log` on
  this machine.
- UI journeys: **10 tests, 0 failures**. Structural accessibility audits:
  **13 tests, 0 failures** after fixing the findings above. A ten-test
  Dynamic Type screenshot matrix initially had one failing Adventure Planner
  test: XCTest auto-scrolled its tile underneath the enlarged tab bar and
  tapped Friends. The reserved scroll area and test were corrected; focused
  Adventure Planner light/dark, Plan, Friends, Explore light/dark and Profile
  XL checks passed afterward. The final captures are in
  [DESIGN-REFRESH.md](DESIGN-REFRESH.md). This is simulator evidence, not a
  physical-device VoiceOver pass.
- Functions TypeScript build and all Functions unit suites passed. Ranking:
  **52/52**; planner: **13/13**, including current-weekend, DST, known venue
  and confirmed child-suitability cases.
- Backend emulator E2E rerun after the final household and friend changes: **337/337**. It used a
  temporary port-5002 config because a pre-existing Python service owns 5001.
  The temporary config was removed and the checked-in Firebase config was not
  changed. Log: `/tmp/verdure-final-e2e-20260927.log`.
- Red team: **49 attacks blocked, 0 vulnerable** after the final rules and friend changes. Active
  website tests and production build passed after the invite and pricing
  changes; the active website production build was repeated after the
  household privacy update. Logs: `/tmp/verdure-final-redteam-20260927.log`
  and `/tmp/verdure-active-web-household-build-20260927.log`.

## Exact remaining gates and inputs

The later [populated local corpus and live public-read check](LOCAL-CORPUS-AND-PUBLIC-READ-2026-09-27.md)
exercised 9,813 upcoming event documents in a disposable emulator and measured
359 candidate documents for the first area-cache refresh. It also identified
a current live-app blocker: the deployed Firestore rules require authentication
for every `/events` read, so the signed-out iOS feed gets `permission-denied`.
The local rules and backend are not deployed, per the owner's instruction.
The same read-only audit found zero deployed Cloud Functions and zero composite
Firestore indexes, so production needs a coordinated release rather than a
single rule update.
An opt-in DEBUG simulator build subsequently used a populated local Firestore
emulator: For You displayed 48 events, Everything loaded 40, and an event
detail opened. [The screenshots](DESIGN-REFRESH.md) show the actual iOS UI on
local public-source records. The feed queries now demand a server response so
an empty Firestore disk cache cannot masquerade as a successful refresh and
erase the app's own saved events. This does not close the production feed gate.
The same full-size corpus exposed and helped fix backfill drift: the final
dry run proposed zero changes to 9,832 already enriched documents. A separate
emulator check proved legacy migration and second-pass idempotence. It counted
3,349 predictions below 0.65 confidence, which still require human review.

The subsequent no-cost, no-deploy pass is recorded in
[FREE-EXTERNAL-GATES-2026-09-27.md](FREE-EXTERNAL-GATES-2026-09-27.md).
It confirmed 11 working public adapters, 3,213 dated/geocoded source records
within the 25-mile launch radius in 30 days, and 55 provisional Volunteer
candidates before deduplication or review. A targeted classifier correction
and regenerated 200-row packet are in [CLASSIFICATION-AUDIT.md](CLASSIFICATION-AUDIT.md).
The registered Firebase Verdure iOS app matches this project's bundle ID and
plist. The active website's `/terms` and `/support` routes return 404, and
Verdure has no receiving email yet. The owner requested no deployment and no
email setup at this time. None of these preview counts pass a live gate.
For the ranking reviewer, a separate read-only export froze 233 source-linked
events and 20 unlabeled profile contexts with a matching snapshot hash;
[RANKING-EVAL.md](RANKING-EVAL.md) gives the handoff. No human relevance
judgments or precision score were fabricated.

1. Populate the event index through an authorized ingest path; re-run the
   baseline/end coverage measurement, by-source delta, duplicate rate,
   backfill dry run and read-budget measurement on real documents. Current
   zero-document evidence is in the coverage report.
2. Assign a named reviewer for all 200 classifier samples and a named owner
   for 20 human-judged ranking profiles. Record per-category accuracy,
   precision@10 and corrections. The frozen source list prevents adding G4
   volunteer feeds until this audit passes or is explicitly rerun.
3. Obtain permitted structured endpoints or organizer access for four
   volunteer organizations. A fingerprint is not an ingest. The prepared
   Idealist application needs a verified organization/contact name and email.
   National API access is documented in [NATIONAL-API-EVALUATION.md](NATIONAL-API-EVALUATION.md).
4. Configure the planner model secret in an authorized environment and test
   actual model sequencing, cost and sponsor trust against real candidates.
5. Run populated-event, full VoiceOver and dark-mode, cellular/GPS, queue
   replay and two-device friend/group/RSVP QA; then resolve any defects. The
   targeted Simulator Dynamic Type matrix passed after layout fixes.
   Apple Developer, Blaze, partner agreements and device access are launch
   inputs outside this local sprint. See [DEVICE-QA.md](../DEVICE-QA.md).
6. Review the active website's legacy policy and settle the app/listing
   `verdure.app` URLs versus the active `verdure-app.com` domain before
   publishing. Deploying the local invite page needs a separate release step.

The current, shorter checklist is [SPRINT-STATUS-2026-09-27.md](SPRINT-STATUS-2026-09-27.md).
