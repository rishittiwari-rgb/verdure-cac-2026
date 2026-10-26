# Final sprint — halfway report (Part 1 complete)

Date: 2026-10-18 (baseline run #2 finished 2026-10-19 00:33 UTC, so its file carries that date).
Commits: `7172974` (step 0), `a8ccca3` (W1), `e892106` (W1 review fixes, W2, W3, W4.1).
Everything below was built and verified on the local Firebase emulator on Windows. Nothing was deployed, purchased or flipped. The iOS changes were not compiled: there is no macOS or Xcode on this machine, so the Swift work is reported as **not run**, not as passing.

## 1. What landed

| Item | Status | Where |
| --- | --- | --- |
| Step 0 baseline script, recorded corpus fixture (11,603 records, six feeds), John's engine staged at `0ab11e6` | done | `functions/scripts/baseline.mjs`, `functions/test-fixtures/corpus/`, `reference/verdure-discovery/` |
| W1.1 `annotate.ts`: `adultOnly` (never missing) and `topicTags` (John's 19 labels, whole-word) on every stored event; interest mapping in code | done | `functions/src/ingest/annotate.ts`, `store.ts` |
| W1.2 listing checks (port of `validate.py` blocking rules) → `/rejectedListings`, 30-day expiry, counted per source | done | `store.ts` `listingChecks` |
| W1.3 fuzzy duplicate pass (port of `dedupe.py`: Jaccard ≥ 0.7, 30 min, same venue or 0.25 mi) | done | `store.ts` `isFuzzyDuplicate` |
| W1.4 write only what changed (content hash, 24 h refresh), staleness unchanged, backfill script | done | `store.ts`, `functions/scripts/backfill-annotate.mjs` |
| W2 rules gate, client query filters, server surfaces, indexes | done (iOS not compiled) | `firestore.rules`, `EventsAPIService.swift`, `social.ts`, `parks/api.ts`, `eventPlanner.ts`, `groupPlans.ts`, `notifications.ts`, `ranking.ts` |
| W3.1 staging, W3.2 switch, W3.3 port, W3.4 product rules, W3.5 constraints, W3.6 feedback + affinity + first-shown, W3.7 reads measured, W3.8 notify eligibility | done | `functions/src/ranking-v2.ts`, `ranking.ts`, `program-feed.ts`, `feedTelemetry.ts`, `notifications.ts` |
| W4.1 sources as data: `/sources`, migration, active-only reads, deny-list in code, rules and indexes | done | `functions/src/ingest/sources-config.ts`, `sources-registry.ts`, `areas.ts`, `index.ts`, `functions/scripts/migrate-sources.mjs` |

Nothing in Part 1 is half-done. The deviations and limits are in section 5.

## 2. Baseline run #2 — before and after

Same command both times: `npm run build && npx firebase-tools@13 emulators:exec --only firestore --project connectify-19dd8 "node functions/scripts/baseline.mjs --label <start|halfway>"`, replaying the recorded corpus `san-jose-ca-2026-10-18.json.gz` (sha256 `0e3d8efd…`). Files: `docs/BASELINE-2026-10-18-start.json`, `docs/BASELINE-2026-10-19-halfway.json`.

| Measure | Start (`7172974`) | Halfway (`e892106`) | Target | Note |
| --- | ---: | ---: | --- | --- |
| Active upcoming events | 8,446 | 8,410 | — | −36: 20 listings rejected by John's blocking rules, the rest merged by the fuzzy pass (see per-source table) |
| Active in-radius events | 6,825 | 6,815 | — | |
| Active sources (`/sources` documents) | 0 (code only) | 14 active | — | ticketmaster, libcal, 5 bibliocommons, 2 localist, livewhale, legistar, midpen, nps (no park codes), serpapi |
| Duplicate rate, John's rule, report-only | 0.45% (38) | 0.00% (0) | < 5% | legacy heuristic: 16 → 7 suspected |
| Writes on an unchanged ingestion run | 8,675 | 18 | ≥ 90% fewer | −99.8%; the 18 are per-source bookkeeping documents (3 per source), 0 event writes |
| Writes on the populating run | 8,675 | 8,684 | — | +20 rejected-listing rows, fewer event creates; not a regression |
| Reads per feed open, cold (candidate refresh) | 369 | 371 | within READ-BUDGET.md (≤ 400-slot snapshot) | +2: `config/ranking` and the viewer's user document |
| Reads per feed open, warm, v1 | 7 | 7 | within budget | |
| Reads per feed open, warm, v2 | not available | 7 | within budget | same snapshot, no per-user `/events` scan |
| Events with coordinates | 92.2% | 92.5% | — | |
| Events with an image | 82.2% | 82.2% | — | |
| Events with a price or "free" | 93.6% | 93.6% | — | |
| Events with `adultOnly` / `topicTags` / `contentHash` | 0% | 100% | every event | |
| `/rejectedListings` rows | 0 | 20 | — | libcal 2, livewhale 6, localist 12 |

Per source (populating run, created / merged / rejected):

| Source | Start created | Halfway created | Merged start → halfway | Rejected (reason) |
| --- | ---: | ---: | --- | --- |
| bibliocommons | 7,766 | 7,737 | 170 → 203 | 0 |
| livewhale | 386 | 382 | 8 → 11 | 6 (5 outside_region, 1 already_ended) |
| localist | 199 | 188 | 1 → 0 | 12 (12 already_ended, 1 also cancelled) |
| libcal | 56 | 54 | 0 → 0 | 2 (1 already_ended, 1 cancelled) |
| legistar | 16 | 14 | 0 → 2 | 0 |
| midpen | 55 | 55 | 0 → 0 | 0 |

The rejected and merged listings are the intended effect of W1.2 and W1.3, not a migration effect: the W4.1 migration check (section 3) shows identical per-source and per-feed counts through `/sources` and through the old configuration on the same code.

### Product consequence to be aware of

`adultOnly` over the upcoming corpus, computed offline by running `annotateEvent` over the recorded records (`node scratch/corpus-annotate-stats.mjs`, figures reproduced in this report):

| Source | Upcoming | adultOnly | Share | Main reason |
| --- | ---: | ---: | ---: | --- |
| bibliocommons | 10,853 | 4,206 | 38.8% | 4,116 structured audience labels ("Adults, ages 18+", "Seniors, ages 65+"); 89 text age limits; 1 alcohol |
| libcal | 54 | 11 | 20.4% | 10 text age limits, 1 alcohol |
| localist | 184 | 2 | 1.1% | |
| livewhale | 392 | 2 | 0.5% | alcohol |
| legistar, midpen | 71 | 0 | 0% | |
| **All** | **11,554** | **4,221** | **36.5%** | |

The spec says structured age fields take precedence and to err toward true, so adult library programs (book clubs for adults, senior classes) are hidden from minors and signed-out readers. That is what the rule says; it is also a visible product change for a signed-out first-time user browsing library events. The reason is stored on every event (`adultOnlyReason`), so a later product decision to treat "structured-age-limit" differently from "alcohol" is one rule change, not a re-annotation.

## 3. Full suites at halfway

All run on 2026-10-18/19 against commit `e892106` (the sources E2E after its last fixture fix). Commands from `functions/`.

| Suite | Command | Result |
| --- | --- | --- |
| Classifier freeze | `npm run check:classifier` | verified `d4b71507…` (6 files, untouched) |
| Index inventory | `npm run check:indexes` | passed (49 checks; 104 query shapes, 38 composites, 14 overrides) |
| Unit suites | `npm run test:units` | fulfillment 15, subscription 8, ingest 235, ranking 52, ranking-v2 68, notifications 31, partners 38, event-planner 13, parks 81, offline 24, programs 34, place-stories 34 — all passed |
| Backend E2E | `npm run e2e` | 357 passed, 0 failed |
| Red team | `npm run redteam` | 63 attacks blocked, 0 vulnerable (positive controls pass) |
| Ingest write-path E2E | `npm run e2e:ingest` | 33 passed (real SDK writes metered per collection) |
| Sources registry E2E | `npm run e2e:sources` | 30 passed |
| iOS native suite | — | **not run** (no macOS/Xcode on this machine) |

Key proofs inside those suites:

- Minor protection: a 15-year-old account and a signed-out client cannot list `/events` without the `adultOnly == false` filter, cannot `get` an adult-only listing by id, receive no adult-only row from the ranked feed, and cannot RSVP to one; both still browse ordinary broadcast events (red team "MINOR PROTECTION (W2)" block; E2E W2 block).
- Client create: must carry `adultOnly` (bool), may not set `organizerId`, `broadcast`, `adultOnlyReason`, `topicTags` or `contentHash`; a client's own non-broadcast event is accepted and is unreadable by a minor.
- Write-only-on-change: on an unchanged run the real Firestore writes to `/events` and `/rejectedListings`, counted at the SDK boundary, are 0; a changed description is exactly one write; after 24 h one refresh write; a cancelled event still goes inactive on the third missed cycle.
- Migration: ingesting the recorded corpus through `/sources` documents and through the configuration seeds produces identical totals (8,430 active), identical per-source and per-feed counts; `fetchSource` issues identical requests (recorded offline with a stubbed `fetch`) for every feed of every type; a paused source is not requested; a deny-listed document marked active is never loaded; a denied seed is never written.
- Ranking v2: weights sum to 1.0; partner content never appears; deterministic ties; minors never receive adultOnly rows from either version; both versions callable for the same request (`baseline.mjs` records `warm_v1` and `warm_v2`).

## 4. Adversarial reviews

W1 was reviewed by a 41-agent workflow (four lenses, each finding re-verified by a fresh skeptic): 40 findings, 30 confirmed. All confirmed defects were fixed in `e892106` (postponed/rescheduled not cancelled; structured status wired; same-source merge flip-flop; primary refresh erasing merged flags; dead online branch; "Virtual Reality" and CJK venue cases; Unicode word boundaries; alcohol/age-limit coverage and family false positives; brands only as presenter; organizer/venue scan; rejected rows cleared when a listing becomes valid; forged `organizerId` on client creates; transaction read order in telemetry; test harness clock and real-write metering). Three were accepted as documented deviations: placeholder venues are not "the same place"; a listing that is cancelled while already stored ages out through staleness rather than being deactivated immediately; `fuzzyTokens` folds plurals (so "Toddlers"/"Toddler" merge), which John's verbatim rule would not do.

W2, W3 and W4.1 are under the same kind of review (six lenses) at the time of writing; its outcome and any fixes are recorded in section 6 of this file when it completes.

## 5. What slipped, deviations and known limits

- **iOS not compiled.** `EventsAPIService.swift` and `Models.swift` changed (adult-aware query duplication, `Event.adultOnly`, `createEvent` sends `adultOnly: false`). The native suite could not run here. First thing on a Mac: build, run the native suite, and `npm run e2e` is unaffected.
- **Older app builds.** The rules now require `adultOnly` on client creates. An installed build that predates this change gets permission-denied on event creation until it updates. Rules and app ship together.
- **Library programs flagged adult (36.5% of the corpus).** See section 2. Behaviour follows the spec; the share is reported so nobody is surprised.
- **Novelty needs telemetry.** `firstShown` is updated from impressions, which only arrive while product analytics is on. With it off, v2's novelty component stays at "new".
- **Per-type fetch failure (pre-existing).** One failing feed still aborts its adapter type for that run, exactly as before W4.1 (nothing is marked stale). W4.7 self-healing isolates failures per source using the `failureStreak` fields that already exist on `/sources`.
- **Composite indexes for `/sources`.** The inventory tool reports the two equality-only `/sources` queries as served by default indexes; the composites were added anyway and are harmless.
- **CI.** `ci.yml` gained the ingest write-path and sources E2E steps; CI was not run (no push in this sprint).
- **Baseline comparability.** Run #2's populating writes include 20 rejected rows that did not exist at the start; the unchanged-run figure is the one the target is about.
- **Nothing cut so far.** Part 2 starts with W4.2.

## 6. Review outcome for W2 / W3 / W4.1

Pending — filled in when the review workflow completes.
