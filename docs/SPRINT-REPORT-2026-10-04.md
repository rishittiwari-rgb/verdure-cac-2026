# Verdure — Completing the Product sprint report

Date: October 4, 2026. Branch: `codex/rishit-handoff-2026-09-27`.

**Local implementation and software verification are complete. Full sprint acceptance is incomplete because physical-device QA is unavailable.** The owner confirmed that neither required iPhone is available. G1–G3 and the physical Crashlytics portion of H2 remain untested; they have not been waived or represented as passing.

The report covers [the supplied sprint](SPRINT-SCOPE-2026-10-03.txt), including A6, F1 and F2. No optional feature was cut. The [requirement ledger](SPRINT-PROGRESS-2026-10-03.md) retains item-level evidence, commands and historical failures.

## Delivered engineering

| Area | Result and evidence |
| --- | --- |
| D1 — classification, completed first | Internship maps to Program. Structured source metadata and confirmed lexical misses were addressed. On 12,165 fixed inputs, low-confidence share fell from 32.77% to 11.68%; this is confidence, not a measured human accuracy score. The 200-row sample was regenerated with blank human labels. Classifier/source mappings were frozen at `d4b7150` and guarded against later changes. [Classification audit](CLASSIFICATION-AUDIT.md). |
| A1–A5 — partner discovery | Partners are excluded from organic feeds. Separate map pins have an account-persisted toggle and offer details/dismissal. One time-appropriate nearby card uses existing location permission, with no distant fallback. Rewards sorts by distance when location exists. RSVP alerts are once-only, preference/quiet-hour gated and share the weekly cap. Canonical withdrawal, stock, expiry and account changes invalidate cached/open offers. [Partner surfaces](PARTNER-SURFACES-2026-10-04.md). |
| A6 — live promotional alerts | Default off, adult only, dedicated consent and opt-out. Always permission is requested inside the opt-in flow. Nearest-20 regions use significant-location changes rather than continuous GPS. Cold Auth restoration preserves only the same owner's OS regions; bounded in-memory entries require current consent, eligibility and a fresh catalog before evaluation. Physical region/wake delivery is untested. [Optional exploration](OPTIONAL-EXPLORATION-2026-10-04.md). |
| B0–B5 — staff console | Authenticated `/admin` console with server authorization, CLI-only admin grants and immutable audits. Moderation includes contextual reports, age highlighting, history and reason-required actions. Organizer approvals show the cap. Partner activation requires an agreement record; staff can geocode businesses, create bounded-cost perks, import validated CSV codes, see stock and withdraw offers. Submissions and source failures are visible, with queue/supply/spend summaries. [Staff console](STAFF-CONSOLE-2026-10-04.md), [submissions](WEBSITE-SUBMISSIONS-2026-10-04.md). |
| C1–C3 — parks and trails | Separate weekly pipeline with recorded dataset permissions, atomic catalog updates and console-visible failures. Read-back verified 5,507 usable official features and geometry checksums. Free guides connect amenities, playground ages, status, attribution, trails and current park events using geometry. Trail overlays include location, official closure links and the required notice; no navigation was introduced. [Pipeline](PARK-PIPELINE-2026-10-04.md), [guide](PARK-GUIDE-2026-10-04.md). |
| C4–C5 — offline packs | Server-gated Verdure+ park/set/area packs include stored guides, geometry, events, compressed thumbnails, places, saves/plans and view-only perks. Exact size preview, 50 MB cap, account isolation, storage/deletion, Wi-Fi refresh and seven-day expiry are implemented. Offline attendance is refused; online actions explain availability. App/listing/website copy says “offline park and place packs” and explains that base imagery is not included. Outdoor airplane-mode GPS remains untested. [Offline packs](OFFLINE-PACKS-2026-10-04.md). |
| D2–D3 — opportunities | All nine requested volunteer hosts were surveyed with permission/feed/venue exclusions documented. Final deduplicated radius evidence contains 137 classified listings, 80 reviewed direct-service invitations and 36 within 30 days. Programs have staff curation, required age eligibility, official links, deadline expiry and the ten-listing threshold. [Volunteer supply](VOLUNTEER-SUPPLY-2026-09-27.md), [Programs](PROGRAM-CURATION-2026-10-04.md). |
| E1–E3 — signup and website | Neutral age gate ends under-13 signup before personal-account fields. Local Terms/support and organizer/merchant forms work, with submissions in the authorized console. Legal copy matches collected data and built features. [Website and submissions](WEBSITE-SUBMISSIONS-2026-10-04.md). |
| F1–F2 — stories and Explore | Approved place owners can write bounded, moderated stories. Shown/expanded/end-visible telemetry was read back from the actual native flow. Optional free “Explore view (beta)” uses GPS/compass labels and requests camera access only on opening; frames are not stored/transmitted. List/map alternatives remain available. Physical camera/heading behavior is untested. [Stories](PLACE-STORIES-2026-10-04.md), [Explore](OPTIONAL-EXPLORATION-2026-10-04.md). |
| H1 — query indexes | Inventory covers 114 source variants, 38 compound mappings and 97 query shapes, with 32 composite definitions and 13 field overrides. Source/configuration guard and 49 positive/negative cases prevent undocumented or mismatched compound queries. [Index inventory](FIRESTORE-INDEXES.md). |
| H2 — crash integration | Crashlytics SDK, gated symbol-upload phase, dSYM settings and matching privacy disclosures are implemented. Fresh unsigned ARM64 iPhone compilation and matching binary/dSYM UUIDs passed. Read-only Firebase registration confirms the bundled Verdure app identity. Physical symbol upload and a readable crash receipt remain untested. [Crashlytics](CRASHLYTICS-2026-10-04.md). |

## Verification and limits

| Check | Recorded result | Evidence |
| --- | --- | --- |
| Fresh broad native run, recovery source `706e1ee` | 181 passed; zero failed/skipped | [r4 receipt](evidence/sprint-native-final-r4-2026-10-04.json) |
| Separate freshly built simulated-GPS map withdrawal | 1 passed; zero failed/skipped | [Map receipt](evidence/native-map-recovery-final-2026-10-04.json); inspected [before](evidence/partner-detail-recovery-before-withdrawal-2026-10-04.png) and [after](evidence/partner-detail-recovery-after-withdrawal-2026-10-04.png) screenshots |
| Backend unit suites | 465 passed | [Backend summary](evidence/sprint-final-backend-summary-2026-10-04.log) |
| Backend emulator E2E | 337 passed | [Final rules/E2E summary](evidence/sprint-final-rules-summary-2026-10-04.log) |
| Adversarial suite | 49 attacks blocked; zero vulnerable | Same final rules/E2E summary |
| Query guard and classifier freeze | Inventory passed; 49 guard cases passed; six frozen files unchanged | `cd functions && npm run check:classifier && npm run check:indexes` |
| Website | Production build and 18 legal/copy-parity checks passed locally | Requirement ledger and feature evidence |
| Native story engagement | Exactly one shown, one expanded and one end-visible event for the current story/version | [Actual telemetry receipt](evidence/place-stories-native-engagement-2026-10-04.json) |
| Unsigned iPhone-target build | ARM64 build passed; binary/dSYM UUIDs match | [Device-target receipt](evidence/live-partner-wake-device-build-2026-10-04.json) |

The 181-test broad run and one-test map run are separate runs, totaling 182 passing native tests. This is not one 182-test invocation. Failed earlier runs remain recorded; the fresh final results supersede them. No production or physical-device result is inferred from local tests. The report's commit changes documentation only after the verified production source.

Known fictional Program/offline/story/Rewards fixtures were cleaned after the runs, preserving the public corpus, official park catalog and immutable staff audits.

## Remaining acceptance requirements

- G1: free Personal Team installation on two physical iPhones and verified connection to the populated local backend over Wi-Fi.
- G2–G3: all 73 dated device checklist items, including outdoor real-venue check-in, airplane-mode trail/GPS movement, full accessibility/conditions checks and two-phone social flows. Fix and regress any device-only defects found.
- H2: physical test crash, symbol upload and a dashboard receipt with readable matching-build frames.

[DEVICE-QA.md](../DEVICE-QA.md) contains the procedure; [dated results](DEVICE-QA-RESULTS-2026-10-04.md) explicitly mark each physical item untested. Remote push, real App Store purchases, universal links and cellular-only access to the local backend remain outside the sprint's permitted testing environment.

## Why this took longer than expected

The scope was substantial: coordinated SwiftUI/Firebase features, an authorized staff website with Supabase submissions, licensed geometry ingestion, private offline content and privacy changes. Integration uncovered genuine defects, including duplicate event IDs crashing the client, stale partner offers, and cold location-wake/account restoration losing monitored regions or entry callbacks.

There was also avoidable execution overhead. Several broad native runs failed late because of fixture independence and fragile UI/accessibility gestures. The Program test needed measured visible bounds and separately invoked structural audits; consent/offline/story fixtures needed correction. Repeated broad sweeps and audit/documentation churn extended the work. The final broad native run alone took approximately 16.6 minutes from its recorded start to finish, and earlier failed attempts added runtime and repairs.

**The assistant owns the poor estimates and avoidable inefficiency.** Repeated “time remaining” estimates were not supported by a stable, verified task list. The evidence does not support an exact per-feature time breakdown or a claim that all elapsed time was necessary. Hardware unavailability is the current acceptance blocker; it does not explain or excuse the earlier software delays.

## Most complex features

1. **Official parks plus offline packs:** permissions and source normalization, geometry/hole joins, park/event matching, atomic snapshots, entitlement checks, compressed content, size/expiry/account boundaries and offline overlays all had to agree across server and app.
2. **Staff console and immediate partner invalidation:** server-only authorization and immutable audit records across many workflows, plus live cache/sheet updates when staff changes stock, eligibility, agreement or activation. Website submissions also bridge Firebase authorization and Supabase persistence.
3. **A6 background location recovery:** the OS region limit, permission/consent timing, Auth restoration, sign-out races, stale callbacks, current offer eligibility and shared weekly cap intersect. Unit/SDK evidence proves the implemented contracts; hardware wake behavior remains unproven.
4. **Firestore index enforcement:** the emulator hides missing-index failures. The guard must inventory Swift and TypeScript query variants, preserve query shape/order/scope and reject undocumented or mismatched additions.

## Delivery boundaries

All work remains on the named branch. `functions/src/ranking.ts` and `PROJECT-NOTES.md` are unchanged across this sprint; the D1 classifier remains frozen. No production deploy, production data write, billing change, environment flip or key rotation was performed. GitHub delivery stores the branch and report; it is not a product deployment or physical acceptance result. The owner's untracked root `AGENTS.md` is excluded.
