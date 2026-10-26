# Verdure QA Report — updated 2026-08-09

> **What is and isn't proven here.** Everything below runs on the simulator and
> the Firebase Local Emulator Suite. It proves the code is correct; it does NOT
> prove the product works, because **Cloud Functions and Storage are still not
> deployed** (billing is Spark — see the DEPLOY STATUS table in `PROJECT-NOTES.md`).
> The three things only real hardware and a live backend can settle are scripted
> in `DEVICE-QA.md`, which is **written but unrun**.

## 2026-08-09 run

| Suite | Result |
|---|---|
| Unit (`VerdureTests`) | **38/38** |
| UI journeys + a11y audits (`VerdureUITests`) | **24/24** — includes an audit for the Adventure Planner sheet and a new **text-size matrix** |

### Dynamic Type is checked by the matrix, NOT by the audits

`QA.audit` deliberately excludes the visual audit types (dynamic type, contrast,
clipping) — they blow the audit engine's time budget on these dense clay
screens. So **a green audit run is not evidence that a layout survives
accessibility text sizes.** `TextSizeMatrixTests` is the actual check: it
captures each changed screen at `UICTContentSizeCategoryAccessibilityXL`, light
and dark, stepping down one swipe at a time (two swipes at once skipped a whole
section of Explore the first time it ran). Screenshots are XCTAttachments:

```bash
xcrun xcresulttool export attachments --path <result>.xcresult --output-path shots/
```

**Found and fixed by looking at the output:** the hero stat tile truncated
"day streak" → "day str…" at XL. The value scaled, the unit didn't. VoiceOver
was unaffected (the tile is one combined element), so nothing automated would
ever have caught it.

**Also fixed:** quest cards truncated at XL — "Event Reg…", "Attend 3 events
this…". They were pinned at 196x184, so the text had nowhere to go. The card is
now content-hugging with a 184pt floor, its width scales (capped at 320pt so a
second card stays visible and the row still reads as scrollable), and the row
equalises heights via `.fixedSize(vertical:)` + `maxHeight: .infinity` rather
than anyone hardcoding how tall the tallest card is.

Scaling the HEIGHT was tried first and rejected: the box grew by the text ratio
while the text needed less, leaving a large empty gap. Content-hugging with a
floor gives the same uniformity with none of the dead space.

The matrix now also captures **default text size**, because otherwise a fix that
rescues XL by wrecking the normal layout looks like a clean pass.
| Backend E2E (emulators) | **48/48** — up from 37; adds Verdure+ entitlement (multiplier on/off/expired, early-access gating), the rules that stop a client granting itself Plus or re-pointing its Apple subscription, and the fulfilment queue's shape + lockdown |
| Backend units (`npm run test:units`) | **23/23** — no emulator or vendor account needed. Fulfilment: which HTTP outcomes refund vs. retry (stubs `fetch`). Verdure+: `appAccountToken` determinism, with a **golden vector** so a change to the derivation fails here instead of silently de-entitling every existing subscriber. |
| Red team (`npm run redteam`) | see below |

Run them all:

```bash
cd Verdure && xcodebuild -project Verdure.xcodeproj -scheme Verdure \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test
cd functions && npm run test:units && npm run e2e && npm run redteam
```

---

# Previous report — 2026-07-22

Full no-cost QA pass: everything below runs on the simulator + Firebase Local
Emulator Suite. No Blaze plan, no devices, no paid services required.

## Results at a glance

| Suite | Result |
|---|---|
| Unit tests (`VerdureTests`) | **24/24** — game-state transactions, gamification (streak/challenges/badges), Daily Gem rotation, sanitizer, personalization mapping |
| UI journeys (`VerdureUITests/JourneyTests`) | **8/8** — all tabs render, event detail + proof gate, rewards Verdure+ locks → paywall (incl. honest-copy assertion), interest tuning, Daily Gem reveal + once-per-day auto-show, community compose, onboarding walkthrough |
| Accessibility audits (`VerdureUITests/AccessibilityAuditTests`) | **8/8 screens** — events, explore, collect, community, profile, rewards store, paywall, onboarding (Apple audit engine: labels, hit regions, traits) |
| Backend E2E (emulators) | **25/25** — storage rules (ownership + image-type), check-in validation (proof required, GPS required, foreign-proof rejected, haversine too-far rejected, clamps, idempotency), attendance audit trail, Firestore rules lockdown, redeem lifecycle, post-like rule |
| Visual matrix | 36 screenshots — 6 tabs × {light, dark} × {default, accessibility-XL text}; sampled and reviewed: no clipping/overlap; headers wrap, tab labels truncate gracefully |

## How to run everything

```bash
# Unit + UI + audits (simulator)
cd Verdure && xcodebuild -project Verdure.xcodeproj -scheme Verdure \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test

# Backend E2E (local emulators; needs Java 17+)
cd functions && npm run e2e
```

## QA harness (DEBUG builds only)

Launch arguments (NSArgumentDomain → UserDefaults) make every state reachable
without scripted taps:

| Argument | Effect |
|---|---|
| `-QATab <events\|explore\|map\|collect\|community\|profile>` | Open a specific tab at launch |
| `-QADisableMotion YES` | Freeze ambient repeat-forever animations (audits need quiescence) |
| `-QAOfflineData YES` | Skip live fetches — cached/sample content, deterministic screens |
| `-hasCompletedOnboarding YES/NO` | Skip or force onboarding |
| `-prefersDarkMode YES` | App-level dark mode (the app overrides the system toggle) |
| `-dailyGem.splashDay <yyyy-MM-dd>` | Suppress (today) or force (past date) the gem splash |
| `-interestCategories "Parks,Trails"` | Pre-seed interests |
| `-QAFeedReasons YES` | With `-QAOfflineData YES`: seed a deterministic ranked feed (`SampleData.feedReasons`) so the W5 reasons line, "Why you're seeing this", Hide and series-dates controls exist without a deployed callable |

## Accessibility fixes landed during this pass

- Onboarding **Back/Skip** buttons: 44 pt hit targets (audit finding)
- Page dots: decorative (`accessibilityHidden`); step info moved to the CTA hint
- Decorative SF-symbol glyphs (stat tiles, hero card, collection tiles): hidden;
  tiles combined into single labeled elements
- **SectionHeader "See All"**: 44 pt hit target
- Community **story rings**: combined into single ≥44 pt elements; **like button**: 44 pt target
- **Search fields**: whole clay well now focuses the field (FocusState) — real
  ≥44 pt target; the audit's text-rect measurement for `TextField` is a known
  SwiftUI limitation, noted (not failed) in the audit handler with rationale
- Event posters/timeline rows: combined elements with full labels + button traits

## CI

`.github/workflows/ci.yml` runs on every push and PR:

| Job | Gate | Covers |
|---|---|---|
| iOS tests | **blocking** | unit tests + UI journey tests |
| iOS tests → a11y step | *non-blocking* | accessibility audits (see below) |
| Functions build + emulator E2E | **blocking** | TypeScript build + full backend contract |
| Firestore rules compile | **blocking** | rules must parse and load |
| Website build | **blocking** | protects the `/privacy` + `/support` submission URLs |

**Why the accessibility audits are a separate, currently non-blocking step.**
On a headless CI simulator the audit service first refused to attach, failing
with `com.apple.accessibilityAudit` **-902 ("Invalid target app")** on the same
5 screens every run while the app was healthy and all journey tests passed.
Retrying didn't help — the log showed an identical pid across attempts, so the
process was alive and the service simply wouldn't inspect it.

**Root cause: the audit service only inspects the frontmost app**, and CI never
reliably activated it. Calling `app.activate()` before auditing fixed it, and
**all 8 audits now pass on CI.** The step is kept `continue-on-error` for one
more shakedown period; promote it to blocking once it's been green across
several runs (delete the `continue-on-error` line in `ci.yml`).

Either way the local full run (`xcodebuild test` with no `-only-testing`)
remains the release gate and must be green.

## Known notes (accepted, with rationale)

1. **Machine audit scope** = labels/hit-regions/traits. Contrast/dynamic-type/
   clipping types blow the audit engine's time budget on these dense clay
   screens (error −56); they're covered by the reviewed visual matrix instead.
2. **Poster deck under XCUITest**: the paged deck's scroll-transition churns
   element identity (exists at query-time, gone at tap-time). Journey test uses
   the stable timeline rows; human taps are unaffected.
3. **Emulator environment (this machine)**: Firestore emulator must run on
   port **8899** (8080 is wedged locally), Firestore traffic must be gRPC, and
   `firebase-tools@13` is pinned for the emulator run.

## Still requires hardware / money (unchanged)

- Blaze upgrade → `npx firebase-tools deploy --only functions,storage`
  (backend is emulator-proven; deploy risk is low)
- App Store Connect subscription products (`com.verdure-app.verdure.plus.monthly/.yearly`)
- Real-device GPS accuracy outdoors, cellular photo upload, airplane-mode replay
  (queue logic is unit-tested; needs field confirmation)
