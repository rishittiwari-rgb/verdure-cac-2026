# Live nearby alerts and Explore view — local evidence

Both optional features were implemented; neither was cut. Physical region
delivery, compass/camera projection and moving outdoor GPS remain untested.
App/website privacy, native usage descriptions and AppStore/LISTING.md changed
with the features. No pricing claim was added for Explore view.

## A6: adult-only promotional proximity alerts

Notifications settings has a dedicated default-off “Tell me about deals near
me” toggle. Its separate plain promotional consent sheet explains background
location, notification content and opt-out. Cancel does not enable anything.
Unknown/minor/suspended profiles fail closed in both UI and server authorization.
Always location is requested only during the explicit consent/setup flow, never
on launch. A stored opt-in with incomplete OS permission pauses with instructions.

A dedicated CLLocationManager monitors up to 20 nearest eligible unique
partners, allowing for any other monitored regions. Significant-location-change
updates replace regions; one-shot fixes initialize/evaluate entry. It never
starts continuous GPS. Entry requires a fresh accurate location and rechecks
agreement, stock, expiry, dismissal, current revisions and walking distance.
Offer hours use the launch area's venue clock, independent of the account's
quiet-hours timezone. GPS samples are evaluated without being persisted.

Each accepted entry atomically spends the existing shared weekly notification
budget and records a once-per-partner/week key plus an inbox item. The native
app schedules a local notification from that authorized payload, so paid APNs
membership is not required for A6. This is distinct from the RSVP remote push
path, whose device delivery remains out of scope. Opt-out immediately stops
regions/location updates and removes pending alerts; a UID-specific local off
marker prevents offline opt-out from being undone before its server retry.
Account/profile changes stop obsolete monitoring and late response delivery.

Actual connected backend coverage includes default-off, guest/minor/unknown
refusal, explicit consent, nearest-20 selection from 23 partners, freshness,
accuracy, distance, withdrawal, deduplication, shared-budget concurrency,
quiet hours and opt-out/no-GPS persistence. The original run passed 24 checks;
the final follow-up passed 27 checks including venue-clock independence,
ordinary client profile edits with server-added consent, and refusal of direct
SDK consent changes. Receipt: live-partner-alerts-final-2026-10-04.log.
The actual native consent UI passed cancel before any OS permission request
in the first full native attempt. Its screenshot was exported and visually
inspected: live-partner-promotional-consent-2026-10-04.png. The full attempt
had unrelated failures, which remain explicit in its summary.

```sh
npm --prefix functions run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/live-partner-alerts-e2e.mjs
```

## F2: optional free Explore view (beta)

Map opens the camera view through a labelled optional button; ordinary map,
nearby list and details remain available. Camera permission is requested only
on opening this view. AVCaptureSession contains a back-camera input and preview
layer, with no photo/video/audio outputs, file writing or frame transmission.
Background/disappearance stops the camera and heading stream.

Labels use fresh GPS plus compass bearing, an approximate field of view and a
maximum of six nearest labels within two kilometres. Existing place filters,
event age eligibility and blocks apply. No synthetic launch-area position is
presented as live GPS. Permission denial, no camera, no heading or unavailable
location preserve a nearby-list fallback. There is no ARKit geo-anchor or route
guidance, and disclosure explains drift.

Fresh Simulator evidence passed two bearing/wrap/antimeridian tests and one
actual Map → beta → nearby-list → Map UI journey, with zero failures/skips:
`/tmp/verdure-explore-native-20261004-r2.xcresult`. This does not establish
physical camera access, compass accuracy or outdoor label tracking.

```sh
xcodebuild -project Verdure/Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,id=D55D802A-6C43-4FD0-8E2F-65952BF28EB7' -only-testing:VerdureTests/ExploreProjectionTests -only-testing:VerdureUITests/ExploreBetaUITests test
```

Evidence log copies normalize line-end whitespace only; outcomes and error messages are retained.

The focused follow-up exposed a UI-test tap ambiguity: the labelled SwiftUI
switch wrapper includes text, so a centre tap did not reliably toggle its native
knob. The test now targets the actual child switch. Its earlier failure remains
in native-followup-attempt-2026-10-04.json; a new pass is required before the
follow-up gate closes. The same follow-up compiled the account/opt-out guard
added across suspended permission awaits. Physical background delivery,
including an OS location wake/account restoration, remains an explicit device
case rather than being inferred from consent UI or server payloads.


### Cold process restoration correction

Apple documents that monitored regions persist across process launches and that location handling must be configured again after relaunch. The first A6 implementation cleared those regions on initial Auth connection and discarded the initial entry before online consent arrived. The correction starts Auth observation after Firebase/emulator setup independently of RootView; a foreground phase cannot treat unresolved Auth as sign-out. Only a first restore to the same locally recorded monitor-owner UID preserves OS registrations. Explicit opt-out, sign-out and account changes clear monitoring and buffered entries.

An in-memory buffer keeps at most 20 registered `verdure-live:` identifiers for at most 60 seconds. After current server consent/age eligibility and Always authorization are confirmed, a fresh location/catalog resolves the still-current perk before the existing cap/quiet-hour/consent callable is used. There is no persisted GPS sample, prose or region catalog; the owner UID alone is stored locally to prevent cross-account restoration. Async consent and notification-settings completion recheck the account before further action. Permission requests remain inside the explicit flow.

Five fresh regressions passed, including actual Firebase SDK Auth restoration and sign-out without a foreground view. The same focused attempt passed stationary partner invalidation, promotional consent and optional Explore (8 passes, 1 Program gesture failure); that independent Program gesture then passed its fresh one-test rerun. Receipts: `live-partner-wake-focused-attempt-2026-10-04.json` and `native-program-visible-chip-2026-10-04.json`. Physical OS wake/delivery remains UNTESTED; the subsequent fresh broad r4 passed 181/181 with zero failures/skips, including these five regressions.

References: [Apple monitored regions](https://developer.apple.com/documentation/corelocation/cllocationmanager/monitoredregions) and [significant-change restoration](https://developer.apple.com/documentation/corelocation/cllocationmanager/startmonitoringsignificantlocationchanges()).


The committed recovery source `706e1ee` subsequently passed a fresh unsigned ARM64 iPhone build with matching binary/device-dSYM UUID `7D3F243B-CFA3-355D-A25D-790F5A1A3100`; receipt: `live-partner-wake-device-build-2026-10-04.json`. Signing, symbol upload, installation and physical wake/crash delivery remain untested. Broad r4 of that committed source passed 181/181 with zero failures/skips at `/tmp/verdure-sprint-native-final-20261004-r4.xcresult`, using freshly recreated reserved native fixtures. The separate simulated-GPS map withdrawal also passed 1/1 on the same source. Receipts: `sprint-native-final-r4-2026-10-04.json` and `native-map-recovery-final-2026-10-04.json`. No other build ran concurrently with its integration checks.
