# Local populated-corpus and live public-read gate — 2026-09-27

## Result

The public-feed ingest path was exercised against a **disposable local Firestore
emulator** using `cd functions && npm run corpus:local`. The script refuses a
non-local `FIRESTORE_EMULATOR_HOST`; no production writes or deployment occurred.
All six configured public source families returned data and completed ingest.
The San José configuration deliberately has no iCal feed, so that empty adapter
was not treated as a failing source.

| Local emulator measure | Result |
| --- | ---: |
| Upcoming active event documents, up to the ingest horizon | 9,813 |
| With coordinates | 9,143 |
| Suspected duplicate rate after ingest | 0.12% (12 suspected) |
| Candidate documents returned on first shared-cache refresh | 359 |
| Distinct candidates stored in the five-minute area cache | 285 |
| Candidate-cache refreshes across four sample profiles | 1 |
| Classifier backfill dry-run: processed / would change | 9,832 / 0 |
| Existing event predictions below 0.65 confidence | 3,349 |

The 9,813 documents are dominated by `Workshop` (7,311), then `Social`
(1,371), `Meetup` (397), `Festival` (273), `Sports` (232), and `Volunteer`
(171). These are classifications awaiting the named human audit. The duplicate
number is a **heuristic warning rate**, not a hand-checked false-duplicate or
missed-duplicate accuracy score. Four local profiles (cold, outdoors, family,
student) each received ten ranked IDs; their top tens were different. This
proves the populated code path runs, not that its relevance is good.

The final `bibliocommons` run fetched 11,532 raw records, created 9,113
documents, merged 141, and skipped 2,278 outside the ingest constraints.
The remaining configured families were LibCal, Localist, LiveWhale, Legistar,
and Midpen. The full machine-readable result is in
`/tmp/verdure-local-corpus-gate-20260927.log` on this machine. Rerunning fetches
current public feeds, so counts can change.

The first full-size backfill dry run found 485 proposed changes to records that
had just been enriched by ingest, mostly confidence drift. The migration was
repaired to enrich **legacy records missing classification fields** and preserve
complete ingested records, including labels contributed by secondary sources.
The final full-size dry run proposed zero changes. A separate
`npm run backfill:emulator-test` verified a legacy record is migrated, a
complete merged record keeps its labels, and a second pass proposes zero
changes. Future classifier revisions need an explicit versioned migration;
this legacy backfill intentionally does not overwrite already enriched records.
The 3,349 low-confidence predictions are a review queue, not an error rate.

## Live client read failure

`cd functions && npm run public-feed:check` runs the **same signed-out query**
as `EventsAPIService.fetchFirestoreEvents()` against the configured Firebase
project `connectify-19dd8`. On 2026-09-27 it returned:

```json
{"projectId":"connectify-19dd8","readable":false,"code":"permission-denied","message":"Missing or insufficient permissions."}
```

The fresh iPhone 16 Plus Simulator launch likewise displayed “Couldn't reach
the event store.” This is a read-authorization failure, independent of the
known zero-document live `/events` corpus. A subsequent **read-only** Firebase
Rules API check identified the cause: the active Cloud Firestore ruleset is
`43d80b64-be7e-4428-951d-65a35699c04b` (SHA-256
`42ce5db1e3b561d07de8c4e13aeff706fdecd3782c1eee43cb911aa6eeb006a7`).
Its `/events/{eventId}` rule is `allow read: if request.auth != null;`, so it
denies the signed-out feed by design. The local rule instead grants a
visibility-constrained public read for broadcast events, and the emulator
guest-feed check passes. The local rules SHA-256 is
`b89a95c4f07bd9051f4f0f9bd24ef74c2806e4f2b6ab50d6f96446c537cf40d3`.
The live source was saved locally at
`/tmp/verdure-live-firestore-rules-20260927.rules` for comparison. No rules
were deployed because the owner explicitly requested no deployment.
Read-only Firebase CLI checks also returned **zero deployed Cloud Functions**
and **zero composite Firestore indexes** for `connectify-19dd8` on this date.
The live environment therefore lacks the local server behavior and query
indexes as well as the updated rules. A rules-only change would not complete
the app's production path.

## Populated iOS Simulator review

For UI review, a persistent local Firestore emulator was seeded with the same
public ingest path. The iPhone 16 Plus Debug build used the opt-in simulator
launch argument `-QAUseFirestoreEmulator YES`, which routes Firestore to
`127.0.0.1:8899` with plaintext transport and an in-memory SDK cache. Normal
launches and Release builds keep their configured Firebase connection. The
final Debug build showed 48 events in For You; Everything loaded 40 records,
and an event detail sheet opened. The saved [screen captures](DESIGN-REFRESH.md)
are explicitly local-emulator evidence. The emulator was stopped after QA.

The iOS feed, Everything and followed-organizer fetches now request a server
result. This prevents Firestore's empty disk cache from being interpreted as a
successful refresh when the actual server read fails; the app's separately
saved event cache can then remain visible with an error. It does not bypass
the live Firestore rules failure.

## What this does and does not close

The local pass gives an actual populated-corpus exercise of ingestion,
deduplication, candidate retrieval, cache reuse, and profile-dependent ranking.
It does not measure live Firestore index-entry reads, billed reads, real client
performance, 30-day volunteer eligibility, ranking precision, classification
accuracy, or the live coverage delta. Those remain release gates. The live
public-read failure is an additional concrete gate. A future authorized rules
release must include the matching backend, rules, and indexes, then be followed by
`npm run public-feed:check` and a fresh Simulator read. The script can distinguish
a successful empty result from a permission failure.
