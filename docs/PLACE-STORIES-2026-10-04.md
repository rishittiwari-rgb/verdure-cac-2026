# Place stories — local implementation and evidence

F1 is implemented in Functions, the staff console and the native app. These
results are local emulator/Simulator evidence; physical-device acceptance is
tracked separately in DEVICE-QA.md. No real organization was assigned a place.

## Ownership, publishing and moderation

Staff assigns a supported official place ID to an approved organizer after
recording written ownership confirmation and a reason. The claim-gated callable
records immutable before/after audits. Transferring ownership allocates a new
story target and does not transfer the old publisher's draft. Revocation hides
the story and disables editing. The console provides paged ownership controls.

Only the canonical owner of an approved, active organizer can save. Text is
plain organizer prose, limited to 400 Unicode code points, without generation.
Every save requires the expected version; concurrent/stale edits are refused.
Blank text removes the public story. The native organizer screen pages owned
places, edits and saves drafts, reloads a conflict explicitly, and previews the
canonical public story. Signing out clears account-specific state.

Place detail and free park guides display the same story component. Public
prose is callable-only: ownership, approval, suspension, moderation and viewer
blocks are rechecked. Minimal non-enumerable SDK metadata invalidates an open
story on revision or publisher changes. SDK cache-only updates cannot authorize
prose. Foreground refresh rechecks a story, including a cold hidden story whose
publisher identity was not disclosed. Private offline packs retain historical
story snapshots with an explicit connect-for-current-ownership/moderation notice.

Stories use the existing report queue and reason-required remove/restore/warn/
suspend workflow. Three reports hide the target pending review. Moderated text
cannot be republished by editing. Account deletion removes authored prose and
queue excerpts while preserving a successor's ownership.

## Engagement semantics

Shown means the story heading entered the viewport; expanded means the user
opened it; read-through means the expanded text's end entered the viewport.
Read-through is not a claim about attention. Product analytics opt-out applies;
offline reading sends no engagement. The callable validates consent, UUIDs,
canonical story ID/version and current visibility. Per-exposure stage keys
deduplicate retries transactionally, including a midnight retry, and expire
after 30 days. Account deletion removes associated keys. Usage rows may contain
account UID; app and website privacy now state that accurately. They contain
no story prose, GPS or stored IP.

An initial native UI run exposed two shown events for one exposure during
SwiftUI initialization. Exposure allocation now happens inside the first record
operation and is keyed to story ID/version. The original receipt is retained
as an attempt; corrected native read-back passed: exactly one shown, one expanded and one
end-visible record for the current UI story/version, in the separately saved
final engagement receipt.

## Recorded evidence and reruns

- 34 policy checks: `docs/evidence/place-stories-units-2026-10-04.log`.
- 61 connected checks, including guest telemetry, retry deduplication,
  ownership transfer/deletion, moderation, public guide and actual reconstructed
  offline-pack content: `place-stories-engagement-offline-e2e-2026-10-04.log`.
- 19 existing moderation regressions and seven actual staff-browser checks:
  `place-stories-moderation-regression-2026-10-04.log` and
  `place-stories-console-2026-10-04.log`.
- Actual native SDK test passed: 400-code-point editing, stale saves, live
  org/ownership withdrawal/reinstatement, guest/account isolation and pack decode.
  Receipt: `place-stories-native-sdk-2026-10-04.json`.
- Actual native owner editor/save/reload/public-preview/expand UI passed in the
  focused r3 result. A full-suite test-order issue required the UI test to prepare a blank draft
  through the real owner callable before launch. That corrected native UI passed
  in the fresh full r2 run, as did its SDK test and exact engagement read-back.
  Earlier failures are not represented as passing full-suite results.

With the loopback working emulators running, from the repository root:

```sh
npm --prefix functions run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/place-stories-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/seed-stories-native.mjs
xcodebuild -project Verdure/Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,id=D55D802A-6C43-4FD0-8E2F-65952BF28EB7' -only-testing:VerdureTests/PlaceStoryTests -only-testing:VerdureUITests/PlaceStoryUITests test
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/place-stories-native-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/seed-stories-native.mjs --clean
```

The seed refuses non-loopback hosts and unrelated ownership/accounts. Its
fictional written confirmation is local test data; immutable staff audits stay.


Native telemetry read-back uses a read-only Admin SDK query against
`127.0.0.1:8899`: find the reserved fictional owner's current place assignment,
read that story/version, then inspect `analytics/*/events` with that owner UID
and current story ID/version. Expect exactly one `story_shown`, one
`story_expanded` and one `story_read_through` after the UI journey. The assertion
receipt is `place-stories-native-engagement-2026-10-04.json`; the earlier
four-event duplicate is retained as `place-stories-native-engagement-attempt`.
Do not erase unrelated analytics or accept aggregate counts without matching
this exact current UI exposure/version.

Final source review replaced the two new dead-end email instructions with
links to the actual support form for guest concerns and written ownership
confirmation. The change uses the same DEBUG local website override as Terms;
website publication is not implied. Final native SDK/UI and telemetry proofs
remain local. A fresh final build includes those support links.

## Final recovery-source verification

Fresh broad native r4 passed 181/181 with zero failures/skips, including story SDK/UI checks. The subsequent actual emulator telemetry read-back again confirmed exactly one shown, one expanded and one end-visible event for the current native story/version. Receipts: `docs/evidence/sprint-native-final-r4-2026-10-04.json` and `docs/evidence/place-stories-native-engagement-2026-10-04.json`.
