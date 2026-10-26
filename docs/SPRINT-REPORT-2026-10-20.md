# Final sprint — Part 2 report (code-complete, with gaps listed)

Date: 2026-10-20 (the live discovery recording finished 2026-10-21 UTC, so its fixture label carries that date).
Branch: `codex/rishit-handoff-2026-09-27`. Part 1 is in `7172974`, `a8ccca3`, `e892106`; the W4 backend and halfway report are in `a92da73`; this report accompanies the Part 2 commit.
Everything was built on Windows against the local Firebase emulator. Nothing was deployed, purchased or flipped. There is no macOS/Xcode here, so every Swift change is **not compiled** and the native suite is **not run**. There is no local LLM endpoint, so the blind judge ran against a mock and the ranking switch **stays at v1**.

This commit was made at the user's request before the final verification pass finished. Section 4 lists exactly what was not run or not green.

## 1. What landed in Part 2

| Item | Status | Where |
| --- | --- | --- |
| W4.2–W4.7 backend (inspect, decide, discover from five origins, removal, self-healing, three adapters) | done in `a92da73`; two bug fixes here | `functions/src/discovery/*`, `functions/src/ingest/*` |
| W4 live recording: one full discovery cycle on the emulator, every HTTP response saved | done (40 MB, 2,289 files) | `functions/test-fixtures/discovery/live-2026-10-21/`, `MANIFEST.json` |
| W4 discovery E2E (record / replay) | written; live run 43 ✅ / 4 ❌; offline replay 52 ✅ / 5 ❌ (section 2) | `functions/scripts/discovery-e2e.mjs`, `npm run e2e:discovery` |
| W4 unit suite (robots, terms, decide, inspect, http limits, adapters) | 154 passed, 6 failed: the six terms-page fixtures were not yet extracted from the live recording into `test-fixtures/discovery/terms/` | `functions/scripts/discovery-unit.mjs`, `npm run test:discovery` |
| W4 red-team block (client writes to server-owned collections, token guard, rate limit, deny-list via intake, staff-only trigger) | appended; `npm run redteam` not re-run after the append | `functions/scripts/redteam.mjs` |
| W4.6 `/remove` page on the website (built locally, not deployed) | done; `next build` passes; host-normalisation test passes | `Verdure-website--main/src/app/remove/`, `src/lib/removal/`, `remove-host.test.mjs`, `docs/WEBSITE-REMOVE-2026-10-20.md` |
| W5 reasons line on the card, "Why you're seeing this", Show less, Hide, "Repeats — N more dates", VoiceOver and Dynamic Type handling, unit + accessibility tests | written, **not compiled** | `Verdure/Verdure/Models/Models.swift`, `EventsAPIService.swift`, `Views/Events/EventsView.swift`, `VerdureTests/RankedFeedReasonsTests.swift`, `VerdureUITests/AccessibilityAuditTests.swift`, `docs/W5-APP-EXPERIENCE-2026-10-20.md` |
| W6.1 blind judge: both versions ranked, pooled, shuffled, blinded; OpenAI-compatible endpoint by URL, no key; cache; decision rule writes `functions/seed/ranking-config.json` | done; 42/42 unit checks against a local mock judge | `functions/scripts/rank-eval.mjs`, `rank-judge-mock.mjs`, `rank-eval-unit.mjs`, `docs/RANKING-EVAL.md`, `docs/RANKING-RESULT-2026-10-20.md` |
| W7 acceptance script (discover → decide → ingest → dedupe → rank v2 → reasons → minor safety) | written, syntax-checked and dry-run loaded; **not executed** on the emulator | `functions/scripts/sprint-acceptance.mjs`, `npm run acceptance`, `docs/ACCEPTANCE.md` |
| W7 go-live checklist (cost, owner, verify command per step) | done | `docs/GO-LIVE-CHECKLIST.md` |
| W7 PROJECT-NOTES.md / README / BACKEND.md / QA.md currency pass (five tabs, SampleData gated, new modules, collections, commands); DEPLOY STATUS untouched; OpenStreetMap credit | done | `PROJECT-NOTES.md`, `README.md`, `BACKEND.md`, `QA.md`, `docs/FEED-SURVEY-SAN-JOSE.md` |
| W6.2 live self-tuning interleaving | **cut** (first on the cut list; needs real users) | — |
| Baseline run #3 | **not run** before this commit (see section 4) | `npm run baseline` |

## 2. Evidence from the one live discovery run

Command: `npm run e2e:discovery:record` (functions/). Seeded by the recorded corpus and one Overpass query; the model URL list is reported as its own origin.

| Measure | Value |
| --- | --- |
| Candidate hosts queued | 1,123 (corpus links 11, OpenStreetMap 1,117, organizer 0, model list 1) |
| Inspected (budget 300/day, run capped at 120) | 110 |
| Activated with no human action | 5 |
| Rejected, each with failed rules and evidence stored | 105 |
| Sources before → after | 14 → 19 |
| Active events before → after | 8,151 → 8,312 (+161 from new sources) |

Activated hosts: careercenter.sjsu.edu (RSS + per-event iCal, 24 events; the expected example), allcove.org (WordPress Events Calendar, 133), bayvp.org (2), bpapaloalto.org (2), abilitypath.org (iCal, 0 upcoming after checks). The audit query found no active source failing any rule. The weekly re-check paused nothing.

Rule evidence on real pages: ACTIVE Network rejected (deny-list and 24-hour-storage clause); SJSU Localist and SJPL BiblioCommons pass; openspace.org passes; careercenter.sjsu.edu passes; the >100-event host is not removed without its published token and is removed once the token is at `/.well-known/verdure-remove.txt`; three consecutive failures pause a source and keep its events; a sudden drop to zero pauses it.

Live-run failures (4 of 47), all still open:

1. Children's Discovery Museum: the terms page was not found by link text or the common paths, so the "commercial use barred" rejection was not reproduced. The deny rule needs the real terms URL added to the candidate paths.
2. sccgov.org: robots.txt answered 403 and the source was rejected, but the stored evidence names `machineReadable` and `realEvents` rather than the robots rule as the reason.
3. After removing abilitypath.org, "events hidden on the next cycle" reported 0 hidden (the host had 0 stored events at that point, so the assertion needs a host with events).
4. "A removed host is never rediscovered" returned an empty list; same root cause as 3.

Offline replay (`npm run e2e:discovery`, no network): 52 passed, 5 failed. The five: the CDM terms page (1 above); "removed host never rediscovered" (4 above); the two self-healing "other feed still ingested" checks expect 1 record and see 2 (the replay fixture carries both synthetic feeds, so the assertion is too strict, not the code); and the 304 conditional-request check, which passed live but fails on replay because the replay fetch does not reproduce the 304 status. Evidence table: `docs/evidence/discovery-cycle-2026-10-21.md`.

## 3. Ranking: blind judge result

`docs/RANKING-RESULT-2026-10-20.md`. Judge: `mock-keyword` (a local keyword mock, because no Ollama or other model endpoint exists on this machine). Mean precision at 10: v1 0.48, v2 0.455. By the rule, v2 is not promoted; `config/ranking.version` stays `v1`. The mock is not a relevance judge, so this is a dry run of the pipeline, not a ranking verdict. To obtain the real verdict on a developer machine with Ollama:

```
cd functions && npm run build
node scripts/rank-eval.mjs ../docs/audits/rank-corpus-preview-2026-09-27.json ../docs/audits/rank-golden-template-2026-09-27.json --judge-url http://127.0.0.1:11434/v1 --judge-model llama3.1
```

## 4. Not done, not run, or not green at this commit

- **Baseline run #3 not run.** The before/after table for Part 2 therefore has no end column. Run `npm run baseline` (label `end`) and compare with `docs/BASELINE-2026-10-19-halfway.json`.
- **Full suites not re-run after Part 2 edits.** Passed at this commit: `npm run check:classifier` (frozen files intact, `d4b71507`), `npm run check:indexes` (49 checks), `tsc` clean, `rank-eval-unit` 42/42, `discovery-unit` 154/160. Not re-run: `npm run test:units`, `npm run e2e`, `npm run redteam`, `npm run e2e:ingest`, `npm run e2e:sources`, `npm run acceptance`, iOS native suite.
- **Six discovery unit cases** need the terms-page fixtures copied from the live recording into `functions/test-fixtures/discovery/terms/` (cdm.org, developer.active.com, events.sjsu.edu, sjpl.bibliocommons.com, openspace.org) plus the careercenter fixture.
- **Four live-run and five replay assertions** listed in section 2.
- **Adversarial review of Part 2** (planned five-lens review with skeptic verification) did not run; Part 1's review is in the halfway report.
- **Swift not compiled.** First thing on a Mac: `xcodegen generate`, build, run the native suite; `docs/W5-APP-EXPERIENCE-2026-10-20.md` lists what to look at.
- **W6.2** cut as planned.
- **Documented deviation carried from `a92da73`:** public institutions (.edu/.gov/.us, library platforms) pass the terms rule with the matched platform clause recorded, because the literal rule would reject SJSU, SJPL and careercenter.sjsu.edu, which the spec names as must-pass.

### 4a. Final pass results (2026-10-22/23, macOS, local emulators; nothing deployed)

| Suite | Result | Notes |
| --- | --- | --- |
| `npm run build` / `tsc` | clean | |
| `check:classifier` | frozen-file hashes match the manifest (6/6) | the second half (`git show d4b71507`) cannot run: this copy has no git history |
| `check:indexes` | 49 checks | `docs/FIRESTORE-INDEXES.md` regenerated (line numbers only) |
| `test:units` (all suites) | all green except discovery-unit **159/160** | fulfillment 15, subscription 8, ingest 235, ranking 67, ranking-v2 68, notifications 31, partners 38, event-planner 13, parks 81, offline 24, programs 34, place-stories 34, rank-eval 42 |
| `test:discovery` | **159/160** | terms + careercenter fixtures copied byte-for-byte from `live-2026-10-21`; the SJPL case was corrected to the recorded evidence ("no restrictive clause"). **cdm.org: not in the recording** (every terms path answered 403), so its fixture cannot be extracted without a live run |
| `e2e` | **357/357** | |
| `redteam` | **96 blocked, 0 vulnerable** | was 95 / **1 vulnerable**: `sourceIntake` accepted a `google.com/maps/...` URL (deny-list checked the host only). Fixed |
| `e2e:ingest` | 33/33 | |
| `e2e:sources` | 30/30 | |
| `e2e:discovery` (replay) | **55/57** | fixed: self-healing over-strict count (×2), 304 erased `lastEventCount` (real bug, fixed), rediscovery check. Remaining: CDM (above) and the audit flags `events.stanford.edu` realEvents = 0 because the recording holds no Stanford feed response — both need the one live record run |
| `acceptance` | **60/62** | the two failures are the same Stanford replay gap |
| `baseline` (label `end`) | `docs/BASELINE-2026-10-23-end.json` | same 2026-10-18 corpus replayed with a later clock: more listings are already past, so `rejectedListings` 20 → 903 and active counts fall accordingly; unchanged-run writes stay minimal |
| iOS build + unit (`VerdureTests`) | build clean; **150 run, 0 failed, 1 skipped** (local website not running) | two live-emulator tests (`RewardsLiveCatalogTests`, `PartnerDiscoveryTests`) fail intermittently on some full-suite runs and pass on rerun; cause not established |
| iOS UI (one class at a time) | AccessibilityAudit 15/15, ExploreBeta 1/1, LivePartnerConsent 1/1, PlaceStory 1/1, TextSizeMatrix 10/10, OnboardingRegression 2/2, DemoWalkthrough 2 + 1 skipped (planner: no model key), PartnerSurface 4/4, Journey __JOURNEY__ | details and flake history in `../FINAL-REPORT.md` |
| Ranking judge | **not run** | no local model endpoint at `127.0.0.1:11434`; `config/ranking` stays **v1** (`functions/seed/ranking-config.json` is not present in this copy; the code defaults to v1) |

## 5. Next sprint, first items

1. Extract the terms fixtures, make `discovery-unit` 160/160 and the discovery replay green; fix the four live-run assertions.
2. Run baseline #3, the full backend suites, and the acceptance script; record the results here.
3. On a Mac: compile W5, run the native suite, take the screenshots.
4. Run the blind judge with a real local model and let the rule set `config/ranking`.
5. W6.2 interleaving once real users exist.
