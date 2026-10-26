# AI usage and third-party disclosure — Verdure, Congressional App Challenge 2026 (CA-10)

The 2026 CAC Rules (§3) require that all AI usage be fully disclosed in the submission materials,
that AI support only specific aspects of the project, and that any open-source libraries,
frameworks and external tools be clearly documented. This file is that disclosure. The facts in
§1 and §3 are taken from the repository itself and can be re-checked with the commands shown; the
parts marked `TODO(team)` are statements only the team can make and must be completed before
submission.

Team: Lalith, Rishit, John, Vishvak.

## 1. AI assistance in development — the verifiable facts

- **Tool:** Claude Code (Anthropic's command-line coding assistant), used interactively by team
  members on their own machines. Models recorded in commit trailers: Claude Opus 4.6, 4.8, 5 and
  5.5, Claude Sonnet 4.6, Claude Fable 5 and 5.1.
- **Extent, by the history:** in the submitted history every commit carries a
  `Co-Authored-By: Claude …` trailer (30 of 30 as of 2026-10-25); in the original development
  repository 88 of 130 commits do (`git log --format=%B | grep -c Co-Authored-By`).
  The remaining 42 commits there (March–August 2026) were made without the assistant.
- **What the assistant was used for:** writing and refactoring Swift and TypeScript code from the
  team's specifications; writing unit, UI and emulator end-to-end tests; the Firestore rules and
  the red-team suite; diagnosing failing builds and tests; and writing project documentation
  (`CLAUDE.md`, the sprint reports, `FINAL-REPORT.md`, the verification documents). `CLAUDE.md`
  is the standing instruction file the assistant reads at the start of every session and is kept
  in the repository deliberately so that the process is visible.
- **What the assistant did not do:** choose the product, its rules or its architecture. The
  decisions that define Verdure — server-authoritative points, proof-of-attendance by GPS plus
  photo, "nothing fabricated", the civic-feed sourcing rule and the absolute deny-list, minor
  protection on adult-only events, the deterministic planner — were set by the team and are
  recorded as instructions to the assistant in `CLAUDE.md` and the sprint briefs.
- **AI inside the product (separate from development):** the Adventure Planner can call
  Anthropic's API **only if** an operator configures a key (`ANTHROPIC_API_KEY`). No key is
  configured in this submission; the planner runs on `functions/src/adventure-engine.ts`, a
  deterministic engine written for this purpose. The privacy policy says the same.

## 2. Individual contributions and technical understanding — `TODO(team)`

Rules §3: "Participants are expected to demonstrate significant individual contributions and
technical understanding of their app." Complete one block per person, truthfully and specifically
(files, features, decisions). Judges may ask any of you about any of it.

| Member | GitHub account(s) | Owns and can explain | Written mostly by hand / mostly with the assistant |
|---|---|---|---|
| Lalith | `lalubalu` | TODO(team) | TODO(team) |
| Rishit | `rishittiwari-rgb` (commits as "Verdure CAC") | TODO(team) — e.g. the Mac verification pass, `run-all.command`, the UI-test determinism work | TODO(team) |
| John | TODO(team) | The Python discovery/ranking reference engine in `reference/verdure-discovery/` (`validate.py`, `dedupe.py`, the ranking rules later ported to `ranking-v2.ts`) — per the project docs | TODO(team) |
| Vishvak | TODO(team) — **if Vishvak is the `vaiybhav` account that authored the first 92 commits (March–August 2026, "Connectify"), state it here** | TODO(team) | TODO(team) |

> If the `vaiybhav` account is **not** a team member, this table must instead say who that
> person is, exactly which code of theirs remains, and that they have assigned all rights in it to
> the team (Rules §3: "No other party should have any rights or interest in the app").

## 3. Open-source libraries, frameworks, data and tools

| Component | Use | Licence |
|---|---|---|
| Firebase iOS SDK (Auth, Firestore, Functions, Storage, Messaging, Crashlytics) | app backend client | Apache-2.0 |
| `firebase-admin`, `firebase-functions` | Cloud Functions (Node 20) | Apache-2.0 |
| `@apple/app-store-server-library` | Verdure+ entitlement verification | MIT |
| `sharp` | proof-photo processing | Apache-2.0 |
| `firebase` (Local Emulator Suite), `typescript` | development/testing | Apache-2.0 |
| Python: `requests`, `PyYAML`, `python-dateutil`, `icalendar`, `recurring-ical-events`, `tzdata`, `pytest` | reference discovery engine | Apache-2.0 / MIT / Apache-2.0 / BSD / MIT / Apache-2.0 / MIT |
| Fredoka, Rubik fonts | app typography | SIL Open Font License 1.1 |
| Apple frameworks: SwiftUI, SceneKit, MapKit, CoreLocation, CoreMotion, PhotosUI, StoreKit 2 | app | Apple SDK |
| XcodeGen, Xcode, Node.js/npm | build tools | MIT / Apple / MIT |
| **Data:** OpenStreetMap via Overpass | places | ODbL — credited in-app ("© OpenStreetMap contributors") |
| Open-Meteo | weather for the planner | CC BY 4.0 — credited in-app ("Weather data by Open-Meteo.com") |
| National Park Service API, Recreation.gov RIDB API | places (key-gated; self-disable without a key) | US Government data; attributed in-app under Terms → Data and acknowledgements |
| Public library, university, city and open-space calendars (BiblioCommons, Localist, LiveWhale, LibCal, Midpen, Legistar, WordPress/The Events Calendar, schema.org/JSON-LD, RSS/ICS) | events | public feeds only; the sourcing rule in `functions/src/ingest/areas.ts` and the deny-list in `sources-registry.ts` refuse any source whose terms prohibit automated access |

No code was copied from another app or template. Re-check at any time:

```bash
git log --format=%B | grep -c "Co-Authored-By: Claude"     # AI co-authored commits
node functions/scripts/check-no-secrets.mjs --history       # no key material in history
```
