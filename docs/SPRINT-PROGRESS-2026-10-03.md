# Completing the product — execution and evidence

Scope: [the complete attached sprint](SPRINT-SCOPE-2026-10-03.txt). This tracker
does not replace or narrow its requirements. Work remains on
`codex/rishit-handoff-2026-09-27`. No deployments, production writes, billing
changes, environment flips or key rotations. `ranking.ts` weights, signals and
synonym map remain untouched; `CLAUDE.md` deploy status remains untouched.

## Requirement ledger

| Item | Required outcome | Current evidence |
| --- | --- | --- |
| D1 | Internship → Program; source-metadata mappings; fixed-input before/after confidence overall/per source/reason; regenerated 200-row sample; finishing commit and classifier freeze | Complete at `d4b7150`: 12,165 fixed inputs; 32.77% → 11.68%; 200 rows with blank human labels. 274 Functions units and 103 iOS units passed. Hash guard records frozen classifier/source mappings. See CLASSIFICATION-AUDIT.md. |
| A1 | No partners in organic For You/Everything; allowed map/near_you surfaces; regression | Implemented locally; allowed surfaces and organic-feed regression: 16 focused checks. See PARTNER-SURFACES-2026-10-04.md. |
| A2 | Distinct partner map pins; per-user persistent default-on toggle; detail/distance/dismissal | Implemented locally; default-on per-user toggle, distinct pins/detail, dismissal; scoped simulator control/audit checked. Full active catalog now paged beyond 500 and stationary pins invalidated by safe public metadata. 25 connected catalog/listener checks and an actual iOS SDK invalidation/expiry test passed. |
| A3 | One walking-distance/time-appropriate Discover card; When-In-Use only; persistent dismissal; no far fallback | Implemented locally; 800 m, server local-time rules, one session slot, dismissal and hour expiry; focused checks. Stationary card invalidation, real timed expiry and account clearing tested with SDK listeners. Physical venue QA pending. |
| A4 | Nearby default rewards sort with location; existing fallback | Implemented locally; distance/fallback/tie tests and scoped Rewards UI checked. 502-fixture Rewards catalog returned in full. Live stock/price/business/withdrawal/expiry/account updates pass real SDK tests, including legacy metadata compatibility. 30 catalog/listener/rules checks and ten focused native tests passed. Actual live withdrawal closes the Rewards confirmation; offline-pack UI regression passed. See PARTNER-SURFACES-2026-10-04.md. |
| A5 | One partner alert per RSVP; event venue proximity; shared weekly cap/quiet hours/preference; emulator proof | Implemented and locally checked: 19 RSVP-job checks, atomic shared budget and once-only notice; device push explicitly untested/excluded. |
| A6 | Opt-in adult-only live promotional alerts; consent/Always toggle; nearest 20 regions; shared cap/privacy | Implemented locally, not cut: default-off adult-only dedicated consent, Always permission only in its flow, nearest-20 region/significant-change monitoring, no continuous GPS, shared atomic weekly cap and local opt-out/retry. 27 actual backend/SDK checks and actual consent/cancel UI passed. Five new cold-wake regressions, including actual Firebase Auth restoration/sign-out without a foreground view, pass in the fresh 181-test broad suite. Physical region/wake delivery remains untested. See OPTIONAL-EXPLORATION-2026-10-04.md. |
| B0 | Firebase admin claim CLI only; every endpoint server-gated; immutable admin-only before/after audit; red-team per path | Implemented locally: claim CLI, canonical Auth server checks, immutable audits for reads/mutations and intent/outcome for long jobs. 29 access checks and 12 legacy-job checks; see STAFF-CONSOLE-2026-10-04.md. |
| B1 | Contextual moderation queue/history/filters/age, >20h highlight; reason-required remove/restore/warn/suspend | Implemented locally: 19 server workflow checks, 14 pagination/601-report checks, browser removal/restoration and >100 rows. Detailed reports show a bounded preview plus all reasons/count. |
| B2 | Organizer approval/rejection reasons, 50-cap used/remaining | Implemented locally: 20 server checks including concurrent final-slot approvals; browser approval/cap and >100 application rows. |
| B3 | Geocoded partners; activation requires recorded agreement; perks 500–2,000; CSV duplicate checks/counts; stock <10; immediate deactivation with reason | Implemented locally: 47 management checks and actual browser geocoding/agreement/perk/CSV/deactivation. Canonical stock/withdrawal listeners and actual Rewards/open-map-sheet withdrawal UI passed. Historical codes retained; no real business activated. Final saved simulated-location wrapper ran successfully (1/1); before/after screenshots inspected. See PARTNER-SURFACES-2026-10-04.md. |
| B4 | Support/organizer/merchant submissions; handled status/note | Implemented locally: 43 browser/server/database checks, canonical Firebase authorization for all 3 actions, Supabase immutable read/mutation audits and rollback proof. See WEBSITE-SUBMISSIONS-2026-10-04.md. |
| B5 | Per-source ingestion failures/last success/count; duplicate rate; queue age; organizer count; treasury/planner/SerpApi spend | Implemented locally: persistent source failures/history, full current supply/duplicate heuristic, aggregated queues, recorded spend estimates. 14 server checks and actual adapter failure visible in browser; invoice reconciliation is not claimed. |
| C1 | Separate weekly official place pipeline; licenses recorded before ingestion; geometry joins; loud console-visible failures | Backend implemented locally: five permission-checked sources, Tuesday schedule, complete atomic catalog, exact geometry/hole joins, source health and actual browser outage/recovery. 59 new units + 33 pipeline/browser checks; 5,507 real usable features read back with every geometry checksum. Native coordinate joins and public park-week events are now integrated with C2; see PARK-GUIDE-2026-10-04.md as well as PARK-PIPELINE-2026-10-04.md. |
| C2 | Free parks: confirmed amenities/ages/events/trails/story/hours/access/status; filters; required attribution | Implemented locally: free canonical guide, geometry/events/confirmed amenities/ages/access/status/attribution and shared filters; 80 units, 29 callables and native SDK/UI source-backed flows. F1 story display and authorized pack payloads are integrated and separately tested. Physical park/device acceptance remains pending. See PARK-GUIDE-2026-10-04.md and PLACE-STORIES-2026-10-04.md. |
| C3 | Free source-backed trail attributes/overlays/location; official closure link/notice; no navigation | Online overview implemented locally: source attributes and lossless MapKit overlays, user annotation/recenter control, parent/trail status, notice and official closure link. Real County source flow passed in Simulator and screenshot inspected. Physical/outdoor GPS and offline-pack behavior remain pending with G/C4. No cut. |
| C4 | Plus server entitlement; park/set/area packs; events/thumbnails/places/saves/plans/view-only perks; size preview/hard cap; storage/delete/age; Wi-Fi refresh/7-day expiry; offline overlays/location; no offline writes/check-in/base imagery caching | Implemented locally: server-gated private chunks, exact size preview and 50 MB cap, full snapshots and compressed thumbnails, native account-isolated storage/delete/expiry, Wi-Fi replacement, stored guides/trails/events, online-action refusal and legacy attendance-queue removal. 24 offline units, 32 callable/rules/content/cleanup checks and actual native SDK/UI flows passed. Physical airplane-mode/moving GPS gates remain required with G. See OFFLINE-PACKS-2026-10-04.md. |
| C5 | Working-feature paywall/listing/website copy: offline park and place packs | Included in the same working feature change, with seven-day/no-base-imagery explanation and matching privacy/App Privacy notes. Fresh website build/lint and 18 production-page/copy-parity checks passed. No publication. |
| D2 | Existing supply audit; nine volunteer source fingerprints/terms; deduplicated in-radius count >=30; document exclusions | Required local survey and minimum complete: nine hosts fingerprinted with explicit permission/feed/venue exclusion reasons; existing licensed feeds ingested through the frozen classifier. Final deduplicated radius read-back: 137 classified current listings, 80 reviewed direct-service invitations (36 within 30 days). Full native supply/29-vs-30 checks passed. Save The Bay is excluded until reuse permission and official venue geometry exist; no fabricated ingestion or outreach. See VOLUNTEER-SUPPLY-2026-09-27.md. |
| D3 | Program taxonomy/client; staff curation with required age/cost/location/deadline/official link; >=10 radius threshold; age eligibility and deadline expiry; link-out only | Implemented locally: 34 policy units, 42 actual callable/rules/security checks, 8 actual staff browser checks, canonical age/deadline filtering without ranking tuning, full native supply/account/deep-link checks and a passing Program UI/accessibility journey. Saved eligible Programs work in private offline packs and open details recheck age/expiry. See PROGRAM-CURATION-2026-10-04.md; physical/final gates remain pending. |
| E1 | Neutral signup age gate; under-13 exits without retaining personal data; preserve 13–17 protections | Implemented locally: neutral blank birth year before account fields, under-13 ends/clears volatile draft, signup age guard precedes credential processing, existing registerAgeBand unchanged. Two actual signup UI flows plus age boundary/persistence units passed. |
| E2 | Local terms/support pages and restored app link; Supabase support → console; accurate privacy | Implemented locally: build plus 15 production-page/parity checks, 43 submission checks, Swift Terms URL resolves HTTP 200 against explicit local website. Public publication remains outside this sprint. |
| E3 | Organizer/calendar and merchant interest forms; Supabase → console | Implemented locally: both native browser forms save exact fields in real local Supabase and appear in staff inbox; no partner activation from interest. 43 checks passed. |
| F1 | Approved place-owner-only <=400-char stories; report/moderation; shown/read engagement | Implemented locally: staff-verified approved owner editing, 400 Unicode code points/version conflicts, reporting/moderation/deletion, canonical native display and historical pack warning, consent-aware shown/expanded/end-visible telemetry. 34 policy, 61 connected story/offline/engagement, 19 moderation, 7 browser and native SDK/UI checks passed separately. Full-suite draft independence and exact native telemetry read-back passed; one shown, one expanded and one end-visible event for the current story/version. See PLACE-STORIES-2026-10-04.md. |
| F2 | Optional free beta camera/GPS/compass view; permission only on open; no frames saved/transmitted; matching privacy; no pricing claim | Implemented locally, not cut: optional free Explore view (beta), camera permission only on open, GPS/compass labels, list/map fallback and no saved/transmitted frames. Fresh two projection units + one actual Simulator UI passed. Privacy/listing changed; no pricing claim. Physical camera/heading/moving GPS untested. See OPTIONAL-EXPLORATION-2026-10-04.md. |
| G1 | Free-team installs on two real iPhones; local populated emulator via DEBUG opt-in | UNTESTED: October 4 inventory still has one unavailable iPhone 16 Pro Max and no second connected iPhone; no free-team physical installation. See DEVICE-QA-RESULTS-2026-10-04.md. |
| G2 | Full DEVICE-QA and all sprint additions, outdoor offline trail/GPS test, two-phone flows, a11y/network/power/performance/StoreKit | UNTESTED: every legacy/device addition explicitly recorded (73 items), including outdoor offline GPS, accessibility/network/power/corpus/StoreKit and two-phone flows. Simulator evidence does not close this gate. |
| G3 | Dated device/iOS/item results; defects fixed/regressed; committed; membership/deploy-dependent behavior explicitly untested | Dated item-by-item result artifact created with unavailable-device identity and honest reasons; no physical pass/fix claimed. Required successful device runs/results still pending. See DEVICE-QA-RESULTS-2026-10-04.md. |
| H1 | All app/backend/console compound queries inventoried and mapped to matching indexes with locations; missing indexes added; undocumented-query regression check | Complete locally: final 114 source variants, 38 compound mappings and 97 distinct shapes; 32 composite definitions and 13 field overrides. Regenerated file/line mappings and 49 positive/negative guard checks pass; six-file D1 freeze passes. No live index deployment/readiness claim. See FIRESTORE-INDEXES.md. |
| H2 | Crashlytics integration/symbol upload; physical readable test crash; accurate privacy/App Privacy in same change | SDK/build phase/dSYM settings/runtime gating/privacy implemented locally. Fresh Simulator and unsigned ARM64 iPhone binary/dSYM UUID matches proved; read-only Firebase registration confirms the bundled Verdure identity. Collection/upload disabled in local tests. Physical symbol upload and readable dashboard test crash remain UNTESTED, so H2 is incomplete. See CRASHLYTICS-2026-10-04.md. |
| Final gate | Fresh iOS/backend unit/E2E/red-team checks green; every scope item audited; no deploy/status change | Local software gate passed: fresh broad native r4 181/181 plus separate simulated-GPS map withdrawal 1/1, zero failures/skips in both, on recovery source `706e1ee`. Backend/website: 465 units, 49 index checks, 337 E2E, 49 attacks blocked, production build and 18 legal/parity checks. All scope items audited. Physical G/H2 remain incomplete. |

## Evidence discipline

Current baseline is inspected source and a fresh TypeScript build, not the
older sprint's reported test counts. Classification capture/replay reads only
public feeds; the immutable response snapshot makes confidence deltas
re-runnable without moving input data. Confidence is not human accuracy.

Device gates remain required. No simulator result will be recorded as physical
GPS, two-phone, crash delivery or outdoors/airplane-mode proof.

The first fresh iOS unit run passed 103 tests, but its host attempted analytics
writes against the configured Firebase project (refused permission-denied).
Test-host emulator isolation was then fixed: 107 fresh iOS units passed with local Firestore/Auth/Functions/Storage startup and remote push skipped. This is
an observed local test defect, not a successful production write/deploy claim.

## October 4 local checkpoint

Staff console browser/server workflow: 23 passed. Backend gates on a fresh,
separate emulator: 286 units, 337 end-to-end, 49 attacks blocked. Website build,
typecheck/lint and existing IP/security checks passed. Evidence and exact reruns
are in STAFF-CONSOLE-2026-10-04.md. A reused working-emulator broad run failed
16 fixture-collision checks; the isolated runner resolves that test setup issue.

Remaining software work includes Rewards/other sponsored cache correctness and A6;
C2 story integration and C4/C5 offline work; D2/D3 curation/supply; F stories/optional explore;
H1 inventory and H2 Crashlytics. No optional feature has been silently cut.
Physical two-phone and outdoor offline GPS/crash gates remain required.
The full sprint and final gate are still incomplete.

## October 4 continuation checkpoint

- Partner catalogue and invalidation: Functions fresh build and 286 units;
  25 catalogue/live-listener checks; 47 partner-management regressions;
  108 iOS units including real SDK invalidation/expiry before the age changes.
- Submissions: 43 actual browser/server/Supabase checks; fresh pending migration
  replay in a rollback transaction, NULL accountability rejection and zero local
  security-advisor findings. Data and secrets stay local/server-side.
- Website: fresh production build, lint, 39 IP and 47 existing security checks;
  15 legal/production-page checks, including cold production hydration and
  exact app/website document parity. Development cold hydration stalls observed
  earlier remain unexplained; a clean warmed development run passed.
- iOS: fresh 112 passed / 0 failed / 0 skipped (110 units plus two signup UI
  paths) at `Test-Verdure-2026.10.04_02-52-52--0700.xcresult`; subsequent
  13 focused core/UI checks included the connected local Terms link, followed
  by a fresh focused rerun of that link. See the website evidence document.

No physical-device, outdoor GPS, production index, push delivery, purchase or
crash-report proof is implied by these local results.

## October 4 park-pipeline checkpoint

- Permission was recorded before capture. Five official sources returned
  5,510 public features; 5,507 have usable geometry. Three null trail geometries
  are surfaced in source health. One City zero-area component is explicitly
  normalized, with its valid polygon retained and the change recorded.
- The complete catalog was published only to the local Firestore emulator and
  fully read back with all geometry checksums verified. Atomic publication
  prevents incomplete downloads from replacing the catalog. Old concurrent
  runs cannot erase newer failures or results.
- New park checks: 59 units and 33 pipeline/browser checks passed, including
  actual staff-screen outage/prior-success/recovery, direct SDK rules and
  multi-chunk lossless geometry. The browser's mobile layout was inspected.
- Fresh isolated backend gates: 345 units, 337 end-to-end checks, 49 attacks
  blocked. Website production build and lint passed.
- C1 backend scheduling, normalization, source-health and geometry helpers are
  implemented. Native geometry connection, C2–C5 and all other pending rows
  above remain part of the full sprint. No scope has been cut or redefined.

See PARK-PIPELINE-2026-10-04.md for exact reruns, source/permission limits,
counts and evidence. Neither native/device park behavior nor deployment has
been claimed.

## October 4 park-guide checkpoint

- The real local catalog now includes a checksummed compact 651-park index.
  Public/free guide callables preserve holes/islands, source status and all
  pages; park-week events are joined by coordinates, with privacy/age/block
  filtering. No extra collectible IDs or point awards were added.
- Native Discover/Map/Collection use confirmed amenity filters. Existing place
  detail connects to guides by geometry and no longer invents hours, amenities
  or accessibility. The trail view draws original source lines and boundaries,
  includes attribution/notice/official link, and has no route guidance.
- Fresh backend: 366 units, including 80 park checks and the unchanged D1 freeze;
  29 new callable checks; 28 pipeline regressions. Fresh focused native: 7/7
  with no skips, including real-source SDK and actual UI flows. Screenshots were
  inspected and are saved under docs/evidence. These are local results only.
- A device inventory found one registered iPhone 16 Pro Max marked unavailable;
  no two-phone install or outdoor run was performed. Hardware availability was
  requested while software work continued.
- C4/C5, D2/D3, F1/F2, A6, remaining partner-cache audit, H1/H2 and G/final gates
  remain in the full scope. C2's F1 story field is not yet implemented. Nothing
  was cut, deployed or represented as complete without evidence.

## October 4 offline-pack checkpoint

- Paid/free/other-account actual callable paths, direct client SDK staging rules,
  exact download size/hash, selection geometry, authorized saves/plans, compressed
  image bytes, view-only perks, subscription/staging expiry and bounded cleanup
  are checked locally. The final focused pack run passed 32 checks. Public
  guide regression passed 29.
- Native actual Firebase SDK tests verify full download, private file storage,
  backup exclusion, reopening, corruption/owner/expiry rejection, deletion,
  account cleanup, offline-action refusal and successful Wi-Fi replacement.
  The latest full native snapshot passed 122 tests with no failures or skips.
  The expanded journey separately covers stored-event refusal, source trail
  overlay, accessibility audits and storage deletion.
- Broad backend snapshot: 390 units, 337 end-to-end, 49 attacks blocked. The
  later bounded staging-cleanup adjustment has separate fresh 32-check evidence.
  Final whole-sprint gates remain pending after the other sections.
- Paywall, listing, website pricing and identical app/website privacy changed
  with the feature. Website production build/lint and 18 page/parity checks
  passed. Simulator screenshots were inspected; they include system imagery,
  and the DEBUG offline preflight is not physical airplane-mode proof.
- C4's physical/outdoor gate, D2/D3, F1/F2, A6, remaining partner-cache audit,
  H1/H2, G and final acceptance remain in scope. No optional cut or deployment
  has been made. See OFFLINE-PACKS-2026-10-04.md and docs/evidence.

## October 4 Program checkpoint

- Staff creates, edits and deactivates official Program listings with required
  facts, canonical admin authorization and immutable audits. Programs have no
  attendance points, RSVP, invitations, group outings or park-week event slots.
- Eligibility is checked against canonical account age, visibility and deadline
  after existing ranking, before telemetry, and in the independent complete
  Program supply query. Ten unique current eligible listings in radius are
  required for the chip; account changes fail closed.
- Fresh isolated backend: 424 units, 337 end-to-end checks, 49 attacks blocked.
  Additional actual Program 42 and offline 35 checks passed. Staff browser: 8.
  Website build/lint/typecheck and 18 legal/production-page checks passed.
- Native: 123 full units passed; the combined attempt's UI failure is retained
  honestly. The corrected Program UI separately passed, followed by the new
  offline deadline/age unit and the actual offline download/trail/storage UI.
  Both fixture scripts were cleaned after verification. Screenshots inspected.
- D3 software is locally implemented; D2 supply, F1/F2, A6, remaining partner
  caches, H1/H2, physical G and final acceptance remain required. The current
  working emulator has been found to contain test remnants rather than the
  complete public corpus; a configured-public-source refresh and deduplicated
  volunteer audit are now in progress. No silent cut, production write or
  deployment occurred. See PROGRAM-CURATION-2026-10-04.md.

## October 4 volunteer-supply checkpoint

- The configured public source refresh completed all six adapters, using the
  frozen classifier and actual deduplicating store. Source outcomes and actual
  persisted Volunteer IDs are committed as re-runnable evidence. The earlier
  test-only working corpus is no longer mistaken for the real public supply.
- Current 25-mile supply: 137 classified public listings, 53 within 30 days.
  A conservative invitation-evidence subset verifies 80 direct-service listings,
  including 36 within 30 days. Four apparent classification false positives and
  53 service-group/orientation records are excluded from that lower bound.
  Description digests prevent changed facts from inheriting a prior review.
- Native discovery now pages the whole public Volunteer supply independently
  of the first 80 chronological cards. A fresh four-test connected run passed
  full public IDs, 29/30 threshold edges and Program account/eligibility regressions.
  The new query's index definition is local; H1 and production deployment are
  not inferred from the emulator pass. Fictional Program fixtures were cleaned.
- All nine requested organization fingerprints and permission dispositions are
  recorded. Save The Bay's real feed requires reuse/precise-venue follow-up;
  several other permissions or supported feeds remain unverified. These source
  tasks remain pending, rather than being quietly cut after meeting the minimum.
- F1/F2, A6, remaining partner caches, H1/H2, physical G and final acceptance
  still remain. No ranking/classifier drift, deployment or optional cut occurred.

## October 4 Firestore-index checkpoint

- H1 inventories current native Swift, Functions, website-console server paths
  and four operational scripts. Alias builders, status/filter branches, finite
  collection selectors and the offline paging helper are included. Conservative
  builder prefixes are documented explicitly; these counts do not claim 109
  separate executed queries.
- Added nine composite definitions and four collection-group overrides. The
  previously missing follower-event, invite cleanup and account-deletion group
  mappings are covered alongside the ranking, ingestion and console queries.
- The guard verifies source locations/shapes against the documentation and
  actual index fields/scope/direction/array modes. Unknown syntax fails closed.
  Temporary-fixture tests prove new backend/Swift files, Web SDK queries and
  operational scripts cannot silently bypass inventory; missing definitions and
  undocumented changes are rejected. Output is deterministic across locales.
- Fresh TypeScript build and all 424 existing backend checks passed; the 49
  index-guard cases passed both in the full command and the final focused run.
  D1's six-file freeze passed. CI is configured to run the guard; no remote CI
  run or live index deployment was performed. Logs and source digests are saved.
- Remaining partner caches, F1/F2, A6, D2 permission/venue follow-up, H2,
  physical G and final whole-sprint acceptance remain in scope. Nothing was cut
  or deployed. The full sprint remains incomplete.

## October 4 Rewards-cache checkpoint

- Rewards now receives canonical partner/perk revision metadata. Stock changes,
  business/price edits, withdrawal and expiry update a stationary catalog through
  actual SDK listeners/timers. Sold-out offers stay visible; withdrawing one
  still changes its revision. SDK sign-out clears the catalog and issued codes;
  withdrawal preserves legitimate historical codes.
- Versioned perk metadata avoids repeated invalidation by older persisted hashes.
  Both native map and Rewards tests exercise that compatibility boundary, then
  observe real invalidation. The free/Plus early-access catalog verdict was also
  corrected and checked against actual local server responses.
- Latest backend: 431 units, 49 index-guard cases, six-file D1 freeze and 30
  connected catalog/rules/listener checks passed after fresh builds. Ten scoped
  native tests passed in the recorded combined attempts; their UI failures are
  retained separately. The final standalone UI test passed with a fresh build,
  actual staff withdrawal and accessibility audit. The offline-pack UI journey
  also passed. Saved before/after Rewards screenshots were visually inspected.
- The initial native map/card timeout remains unexplained; stage diagnostics
  now make recurrence actionable. SDK ownership compile failures and UI
  positioning/already-redeemed fixture failures are recorded honestly. The UI
  journey now uses its own offer, rather than erasing redemption history.
- Downloaded perks remain view-only snapshots offline with an availability
  warning. Online, those rows use the current canonical catalog for pack IDs.
  The open-detail dismissal was subsequently verified by the actual pin/open-sheet/staff-withdrawal UI journey; see the next checkpoint.
  Rewards/offline disposable accounts and offers were cleaned; immutable local
  staff audits remain. No real business was activated.
- Remaining: open-detail UI proof, A6, F1/F2 (including C2 stories), D2 reuse/
  precise-venue follow-up, H2, all physical G gates and final complete-sprint
  regression/audit. No optional cut, ranking/classifier drift or deployment.


## October 4 story-foundation and open-detail checkpoint

- Actual map pin/open-detail withdrawal passed a fresh native build/test with
  streaming simulated location. Its saved before/after screenshots were viewed.
  Prior AX, duplicate-code and fallback-location failures remain in evidence;
  the separate Rewards helper regression passed in the recorded mixed attempt.
  Simulator location was cleared and known fictional Rewards fixtures cleaned.
- Place-story ownership is staff-verified and audited. Only its canonical approved
  organizer can publish up to 400 Unicode code points. Transfers create distinct
  moderation targets, stale edits fail, and public reads enforce ownership,
  approval, suspension, moderation and blocks. Account deletion removes old prose
  and queue excerpts while preserving a successor's ownership.
- The existing report/queue/remove/restore/suspend flow includes place stories.
  Minimal live story/publisher metadata is protected against enumeration/writes;
  triggers read current state to avoid old decisions restoring stale eligibility.
  Free park guides and private pack payloads use canonical story visibility.
- Fresh local evidence: 465 backend units plus 49 index-guard cases; 51 connected
  story checks, 19 existing moderation regressions and 7 real staff-form checks.
  The index inventory is now 113 variants / 38 compound mappings / 96 shapes,
  with the new owner paging index defined locally. D1 freeze passed.
- Matching app/website privacy text covers stories and private ownership records,
  and now correctly states that first-party usage rows may include account UID.
  No story engagement instrumentation is claimed yet. Native F1 editing/display,
  online/offline cache handling, engagement and full native proof remain pending.
- A6, F2, D2 reuse/venue follow-up, H2, physical G and final full-sprint gates
  remain required. No optional cut, ranking/classifier edit, deploy or completion
  claim was made. The sprint remains active and incomplete.

## October 4 final feature implementation checkpoint

The requirement ledger above is current; earlier chronological checkpoints
retain their historical pending work and do not override it. No optional
feature was cut. Stories, A6 and Explore beta are now implemented, and H2's
SDK/symbol/privacy integration is in the same local change. D2's required
fingerprint/exclusion survey is closed with final count evidence; unsupported
future source onboarding is not represented as ingestion.

A fresh isolated backend run passed 465 units, 49 index-guard cases, 337 E2E
checks and 49 blocked attacks. The later A6 venue-clock and nested-consent
rules correction passed 27 actual callable/SDK cases, including shared-cap
concurrency and ordinary profile editing after consent. The first final native
run passed 170 and failed five: the Program journey exposed an actual duplicate
ID dictionary crash, while cached live data/filter leakage, an offscreen Gem tap
and a nonempty story fixture broke four other journeys. Crash stack and failed
result summary are retained; event-ID deduplication, a regression unit, isolated
fixture/filter initialization, a reachable tap and explicit owner draft setup
were added. A fresh full rerun is the next required gate.

Physical availability has not changed. DEVICE-QA.md now runs against the local
LAN emulators and updates obsolete offline attendance expectations to C4's
prohibition. DEVICE-QA-RESULTS-2026-10-04.md records all 73 physical checklist
items as UNTESTED, plus free-team setup, excluded membership/cellular behavior
and the missing readable physical crash. The full sprint remains incomplete.

## October 4 native final follow-up

The fresh full r2 run passed 175 and failed one Program structural-audit timeout
(176 total, zero skips). Its actual Program detail/official-link journey reached
the screen without crashing. A six-check follow-up passed four and failed the
same audit plus a consent wrapper tap; both failures remain in evidence. A fresh
simulator/audit-service restart and native-switch targeting passed the consent
check, while the combined Program audit still timed out. Running the SAME three
structural types separately then passed the actual Program journey with zero
failures/skips. Timeouts were never treated as passes or actual findings hidden.

The latest per-test outcomes now pass all 176 tests covered by the broad run;
this is a union of the named broad and focused receipts, not a claim that the
failed full run was entirely green. Manual onboarding/Daily Gem launches now
explicitly use the local QA path. The duplicate feed crash has a passing
regression; the story UI has exactly one shown/expanded/end-visible record.
The final saved simulated-GPS map wrapper passed (1 test, zero failures/skips), freshly compiling the latest source. Before/after screenshots were inspected; the wrapper cleared simulated GPS and cleaned its reserved fixture. The final native aggregation now contains 177 unique tests with latest Passed outcomes, retaining every broad/focused run count and provenance. Known fictional Program/offline/story fixtures were also cleaned; actual public corpus and park catalog remain populated.

Local implementation and verification are complete and ready for the finishing commit. Physical G/H2 remain incomplete: two real iPhones, outdoor/offline GPS, the full 73-item device checklist and readable physical Crashlytics report have no passing evidence.


## October 4 cold-wake audit and native r3

The unsigned ARM64 iPhone build of `16c1bad` passed with matching binary/dSYM UUID and current app/Firebase bundle identifier equality; see the separate device-target receipt. It did not install or upload anything. The r3 broad native run of that source passed 174 and failed two, with zero skips. Its summary retains both failures: stationary partner withdrawal was not observed within the integration-test deadline, and the Program UI attempted a swipe on an offscreen category row. The Program gesture now uses the actual visible row bounds; the SDK test records cached IDs/account/error on a failed observation. No unproved production-listener fix or timeout relaxation was made.

A separate source audit found that A6 cleared OS-persisted regions at cold Auth restoration and dropped pre-consent entry callbacks. This contradicted the intended background wake behavior. The correction starts its Auth observer after Firebase setup independently of RootView, preserves OS regions only on a first restore to the recorded same UID, buffers registered entry identifiers in memory (maximum 20, maximum 60 seconds), and checks current server consent/eligibility and a freshly returned partner catalog before alert evaluation. Sign-out, account changes, opt-out and stale/withdrawn entries clear or discard the buffer. Only the monitor owner UID is retained locally; location samples, region catalogs and prose are not persisted by this change. Permission requests remain inside opt-in. An account-change race in failed opt-in completion is also guarded.

Five new regressions cover actual SDK Auth restoration/sign-out without a foreground view, same-owner cold entry, account/sign-out isolation, expired/withdrawn/unregistered entries, and the bounded buffer. A fresh focused native run is in progress. Physical OS wake/delivery remains UNTESTED and cannot be inferred from these checks. The native final software gate and full sprint remain incomplete.


The recovery-focused run built current source and passed all five new regressions, stationary partner invalidation, promotional-consent UI and optional Explore UI (8 pass/1 Program AX-hittability failure/0 skips). The native Program test now checks actual rendered bounds instead of querying offscreen AX hittability; its fresh final rerun passed the full sign-in/chip/detail/official-link journey and the same three required structural audits (1 pass/0 fail/0 skips). No production listener patch or timeout relaxation was used to obtain the separate SDK pass. A fresh broad run remains required after the production startup correction. Earlier native attempts remain recorded, not overwritten with fabricated passes.


Committed recovery source: `706e1ee`. Fresh unsigned ARM64 iPhone build passed with matching binary/dSYM UUID; explicit receipt is saved. Fresh broad native r4 is running against recreated reserved fixtures at `/tmp/verdure-sprint-native-final-20261004-r4.xcresult`; no success is claimed until its terminal summary is inspected. Physical G/H2 remain incomplete.

## October 4 final local software gate

The fresh broad native r4 run on recovery source `706e1ee` passed **181/181**, with zero failures and zero skips. The separately built simulated-GPS map withdrawal run on the same source passed **1/1**, also with zero failures/skips. These are two explicitly scoped runs, totaling 182 passing native tests; the broad suite itself is green. Receipts: `docs/evidence/sprint-native-final-r4-2026-10-04.json` and `docs/evidence/native-map-recovery-final-2026-10-04.json`. Earlier failed attempts above remain historical evidence and are superseded by these fresh passing runs.

Before/after map screenshots were inspected: the actual open partner sheet and Discover offer both disappear after canonical staff withdrawal. The wrapper cleared simulated GPS and cleaned its reserved Rewards fixture. Exact native story telemetry was read back after r4: one shown, one expanded and one end-visible event for the current story/version. Reserved Program/offline/story fixtures were then cleaned, preserving the real public corpus, park catalog and immutable staff audits.

Local implementation and software verification are complete. No deployment, production write, billing change, ranking change or classifier-freeze change was made. **The full sprint remains incomplete:** G1–G3 require two physical iPhones and all 73 device items, including outdoor/offline GPS; H2 still requires physical symbol upload and a readable Crashlytics test crash. Firebase identity registration and unsigned compilation do not close those gates.
