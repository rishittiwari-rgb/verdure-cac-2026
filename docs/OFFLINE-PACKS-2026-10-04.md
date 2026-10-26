# Offline park and place packs — local implementation and evidence

C4/C5 are implemented locally. Physical airplane-mode, outdoor GPS and two-phone
validation remain required under G. No production deployment, billing change,
App Store purchase or physical-device pass is claimed. Ranking and the frozen
D1 classifier/source mappings are untouched.

## Working behavior

The member can select a park, up to 50 parks, or an area with a 1–20 mile radius.
Area selection uses actual park boundaries, including polygon holes, rather
than park names or centroid-only membership. An area containing more than 50
parks must be narrowed; facts are not silently truncated.

`functions/src/offline/packs.ts` assembles complete guides with source geometry,
amenities, status, attribution, trails, eligible upcoming public events, the
member's authorized saves and selected event/group/place plans, existing public
provider place results, and currently eligible view-only partner perks. Private
events require ownership or following their organizer. Blocked/hidden/expired
content and other members' votes, pending invitations and account identities
are excluded. Partner contact details and redemption codes are excluded.

Successful place itineraries are now retained under the member's account for
pack inclusion; existing account-tree deletion removes these records. Existing
place-provider results keep their attribution and known hours. A Wi-Fi refresh
retains an unexpired pack's cached places if the provider fetch returns no
replacement. It does not invent open status, ratings or new place facts.

`offlinePack` authenticates every request and reads the canonical server-owned
Plus expiry when generating and downloading. Free accounts are refused by the
server. Staging lives under the requesting UID with at most three unexpired
reservations. Direct client Firestore reads/writes to staging are denied, even
for its owner. Cancellation may remove one's own staging after Plus expires.

Preparation returns the exact encoded-response body download size, stored size,
part count, checksum, collection counts and expiry before the device downloads
payload parts. Both stored JSON and the total encoded response bodies are
capped at 50,000,000 bytes; transport headers are not part of the preview. Chunk
serialization preserves Unicode and every source vertex. Failed generation
removes its staging. Transfers recheck entitlement; the device installs only a
complete, correctly sized, SHA-256-verified pack.

Images come only from published event image URLs on a fixed public HTTPS CDN
allowlist. There are no redirects, caller-URL fetches or local-network targets.
Input bytes, pixel count and request time are bounded. Sharp stores a small
JPEG, at most 320 × 240 and 40 KB, without original metadata such as EXIF/GPS.
Four workers have a 180-second preparation budget. Missing/unapproved images
produce an explicit unavailable-image count while keeping event details.
References: [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/)
and [output behavior](https://sharp.pixelplumbing.com/api-output/).

Packs expire seven days after the server creates them. Server staging expires
after one hour and an hourly job deletes expired roots and chunks in bounded
pages, making progress even through a large backlog. Its collection-group
`stageExpiresAt` index is declared in `firestore.indexes.json`. This is a local
configuration change, not live index proof. The full H1 inventory remains
pending. [Firebase index scopes](https://firebase.google.com/docs/firestore/query-data/index-overview)
explain why the collection-group index must be explicitly enabled.

## Native flow and attendance

`OfflinePackService.swift` keeps complete packs in per-account Application
Support directories, excluded from device backups and protected until first
unlock. Reopening checks size, checksum, owner, format, expiry and the explicit
no-base-imagery/no-check-in flags without calling Firebase. Sign-out/account
switch removes other-account directories, including after a restart. Firebase
must finish resolving the initial auth state before that cleanup runs.

The Profile and park-directory entries expose selection, size confirmation,
download progress, stored size, downloaded age, expiry, browsing and deletion.
Packs refresh on unconstrained, non-expensive Wi-Fi when the app opens, bounded
to once an hour. Replacement keeps the existing complete file until a fresh
download is verified. Stored guides, events and trail maps retain their account
and expiry guards. Stored events expose details and an online-action explanation.

The trail map uses source lines/boundaries with `UserAnnotation` and existing
location permission. It provides no route guidance. MapKit's own imagery may
remain visible from the system cache; Verdure does not download/cache imagery.
The source safety notice, attribution and official closure link remain visible.

RSVP, redemption and new/refined plans refuse an offline preflight and explain
availability when back online. Attendance is a direct online request with a
fresh, accurate CLLocation and proof upload; points/history/success UI change
only after the server confirms. Legacy attendance queue entries, unconfirmed
attendance credits/history and locally spooled proof files are removed. Queue
replay handles place collection only. This does not attest GPS cryptographically
or replace required real-venue device testing.

The paywall, App Store listing and website pricing source add **Offline park
and place packs** in this same feature change. They explain seven days and
excluded background imagery. The app/website privacy sections are identical
and disclose private staging, local retention, backup exclusion, selected area
requests, saved itineraries and deletion. App Privacy notes use existing
account/location/content categories; no new tracking claim is introduced.

## Evidence and reruns

Owned working emulators: Firestore 8899, Auth 9099, Functions 5002, Storage 9199,
all loopback and project `connectify-19dd8`. The permission-checked real catalog
contains 651 parks and 5,507 usable features. Test accounts, the park event,
plans and partners are explicitly fictional and removed afterward. The tests
do not alter the park catalog or create real business agreements.

| Check | Local result |
| --- | --- |
| Fresh broad backend regression snapshot | 390 units, 337 end-to-end, 49 attacks blocked; 0 failures |
| Offline serialization, cap, image/URL units | 24 checks, included in the 390 |
| Offline callable/rules/ownership/content/cleanup | 32 checks after the final bounded-cleanup change |
| Public park-guide callable regression | 29 checks after the shared-event refactor |
| Fresh native units plus download/relaunch/trail journey | 122 passed, 0 failed, 0 skipped |
| Expanded stored-event/storage/deletion UI and structural audits | Passed in Simulator; final result and screenshots under docs/evidence |
| Website fresh production build and lint | Passed |
| Actual production-build privacy/pricing pages and exact copy parity | 18 checks passed |

Native full run: `Test-Verdure-2026.10.04_06-05-29--0700.xcresult`.
Final expanded UI/audit run: `Test-Verdure-2026.10.04_06-17-09--0700.xcresult`,
1 passed, 0 failed, 0 skipped; its summary is
`docs/evidence/offline-native-storage-audit-2026-10-04.json`. That run includes
the periodic storage freshness/expiry rendering and fictional stored-event
flow. Screenshots are `offline-pack-preview-2026-10-04.png` and
`offline-stored-trail-2026-10-04.png` under `docs/evidence`; reviewed without
editing. A subsequent singular/plural correction only changes unavailable-image
copy, not its underlying behavior.
The result summary is saved in `docs/evidence/offline-native-units-and-journey-2026-10-04.json`.
The broad backend run preceded the small bounded-cleanup improvement; the final
32-check pack run separately executes cleanup and verifies roots/chunks disappear
while unexpired previews remain. Final sprint-wide gates are still required
after the remaining sections are implemented.

An earlier native run exposed a fixed five-feature assertion, now changed to
assert the real paid list is nonempty and excludes the free streak benefit.
Its Terms-link check skipped while the local website was unavailable. The fresh
122-check run above passed both with the production-build local site running.
The first UI run exposed a real blank-space hit-target defect in Profile rows;
their full padded rows are now tappable. A subsequent stored-guide lookup lacked
an accessibility identifier; that was added before the passing UI runs.

```sh
# Root: local backend build and isolated broad regression suite.
node functions/scripts/sprint-regressions.mjs

# Working catalog/emulators must already be populated; these fixtures clean up.
npm --prefix functions run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/offline-e2e.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 node functions/scripts/park-guides-e2e.mjs

# Seed only disposable native fixtures; Plus is an Admin-set local stand-in.
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/offline-native-fixture.mjs
```

Build the website from `Verdure-website--main` with `npm run build`, then start
`npm run start -- --hostname 127.0.0.1 --port 3105` in a separate terminal.
Run `node scripts/legal-pages-e2e.mjs` there. It blocks external browser requests.
The local site is also required for the native Terms-link check.

```sh
xcodebuild -quiet -project '/Users/<developer>/Desktop/Connectify App-iOS/Verdure/Verdure.xcodeproj' -scheme Verdure -destination 'platform=iOS Simulator,id=D55D802A-6C43-4FD0-8E2F-65952BF28EB7' -parallel-testing-enabled NO -only-testing:VerdureTests -only-testing:VerdureUITests/JourneyTests/testOfflinePackSignInSizeDownloadRelaunchAndStoredTrailView test

# After native tests and inspection:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/offline-native-fixture.mjs --clean
```

`QAResetAuth` performs real SDK sign-out only inside DEBUG emulator setup.
`QAForceOffline` and the unit-only Wi-Fi override are deterministic preflight
seams. Their results prove saved-data rendering and action refusal, not a lack
of cellular service. The Simulator screenshots include system-provided imagery
and cannot prove what a fresh physical device caches. G still requires a real
download on Wi-Fi, physical airplane mode and moving outdoors along a trail.
