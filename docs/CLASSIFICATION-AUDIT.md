# Classification audit — San José, 2026-09-27

## Completing-product sprint D1 — 2026-10-03

The current review sample is
[`classification-sample-2026-10-03.csv`](audits/classification-sample-2026-10-03.csv).
It contains **200 rows, 37 below 0.65**, and all human-review columns remain
blank. The earlier September sample is retained as historical evidence.
Confidence is not a human accuracy score; John's review remains pending.

The original classifier at `b682fd9` was measured before editing. Public source
responses were captured once, then replayed through the updated adapters and
classifier. Both passes have the identical **12,165 upcoming source identities**
and response SHA-256
`1e7e4fe27c90068ee280fafeaee73cef467f92c5aadd6a161769f3666243ac2b`.
This is a new, pre-cross-source-deduplication snapshot, not the previous
9,813-event emulator corpus. No production documents were read or written.
Ticketmaster and SerpApi are absent because their private keys/quota were not
used. The source adapters' existing windows and coordinate coverage differ;
these counts do not claim all events are within the user's radius.

| Source | Fixed inputs | Below 0.65 before | Below 0.65 after | Before share | After share |
| --- | ---: | ---: | ---: | ---: | ---: |
| BiblioCommons | 11,451 | 3,626 | 1,226 | 31.67% | 10.71% |
| LibCal | 64 | 24 | 23 | 37.50% | 35.94% |
| Localist | 185 | 68 | 20 | 36.76% | 10.81% |
| LiveWhale | 398 | 268 | 152 | 67.34% | 38.19% |
| Midpen | 53 | 0 | 0 | 0% | 0% |
| Legistar | 14 | 0 | 0 | 0% | 0% |
| **Overall** | **12,165** | **3,986** | **1,421** | **32.77%** | **11.68%** |

Remaining uncertainty is deliberately retained. The diagnostic reasons group
unmatched activity metadata separately from absent metadata; they are rule
coverage diagnostics, not independently adjudicated causes. Before:
3,936 unmatched / 50 absent; after: 1,378 unmatched / 43 absent. The JSON reports
contain per-source, per-feed and per-reason counts, frequent unmapped types and
example titles. Broad Health & Fitness, audience labels, academic dates and
ambiguous event names have not been given high-confidence activity categories
merely to lower the number.

Changes grounded in those examples:

- Internship/apprenticeship/fellowship is Program, separate from Volunteer.
  Program's app decoding/icon/point-ceiling groundwork lands now so D3 does
  not require changing the classifier after the freeze.
- BiblioCommons activity types and audience bands are retained separately.
  Localist event types survive the eight-search-tag cap even when twelve
  audience values precede them. LiveWhale activity types are retained.
- Crafts & Hobbies, Learn English, STEAM, plural Workshops, Exhibits and
  Governance meeting map directly. Activity-specific title/description rules
  cover recurring misses such as reading buddies and resume refresh.
- A volunteer teaching a class remains distinct from a volunteering invitation;
  gaming and broad library health tags remain distinct from sport. Mixed
  audience bands do not imply all-age or adult-only eligibility.

Reproduce from `functions/` (the committed compressed snapshot permits offline
replay; rerunning capture would measure a different moving corpus):

```sh
npm run build
node scripts/classification-snapshot.mjs replay ../docs/audits/classification-source-snapshot-2026-10-03.json.gz ../docs/audits/classification-after-2026-10-03.json
node scripts/verify-classification-audit.mjs
node scripts/list-low-confidence.mjs --snapshot ../docs/audits/classification-before-2026-10-03-records.json.gz
node scripts/list-low-confidence.mjs --snapshot ../docs/audits/classification-after-2026-10-03-records.json.gz
node scripts/make-classification-sample.mjs --snapshot ../docs/audits/classification-after-2026-10-03-records.json.gz --date 2026-10-03
npm run test:units
```

`npm run test:units` passed all seven suites: fulfillment 15, subscription 8,
ingestion 136, ranking 52, notification 28, partner 22, planner 13 (274 total,
zero failures). The focused ingestion suite includes internship non-volunteer,
structured-type mapping, audience truncation, gaming/fitness and audience
eligibility regressions. Ranking code and its tuning inputs are untouched.
**Finishing classifier commit: `d4b7150`. Frozen for the rest of this sprint.**
The [hash manifest](audits/classifier-freeze-2026-10-03.json) records the full
commit and six classifier/source-mapping hashes. `npm run check:classifier`
checks both the current files and the committed bytes; Functions unit runs
execute this guard first. The ranking reviewer can use this exact post-D1
snapshot. D3 curation and new volunteer supply must use this frozen classifier.

Fresh iOS build and `VerdureTests`: **103 passed, zero failures** using
`xcodebuild -project Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,name=iPhone 16 Plus' -only-testing:VerdureTests test`
from `Verdure/`. The test host attempted first-party analytics writes to the
configured Firebase project, which were refused with permission-denied. This
is a test-isolation defect to fix before subsequent app tests; it does not
establish a successful backend connection or any device proof. No deployment
or successful production write is evidenced by that run.

## Historical September audit

## Status

**Review pending; John is assigned.** The 200-event stratified sample exists at
[`audits/classification-sample-2026-09-27.csv`](audits/classification-sample-2026-09-27.csv).
The `reviewerCategory`, `reviewerLabels`, `labelCorrect`, and `reviewerNotes`
columns are intentionally blank. No accuracy percentage or 85% pass is claimed
until John checks every row. The sample was generated from public
source feeds after the source-list freeze commit `462c0a1`; it is not a sample
from a populated production `/events` collection, which currently has zero
documents.

## Reproduce

From `functions/` run `npm run build && node scripts/make-classification-sample.mjs`.
The script fetches read-only public feeds, removes duplicate source IDs, sorts
each feed by a date-seeded SHA-256 of the source ID, and takes round-robin rows
until 200 are selected. This prevents the largest library from monopolizing
the sample. The date in the file name is the sampling seed; a rerun on another
day produces a different sample. Ticketmaster and SerpApi were unavailable
without keys and are not represented; their absence must be stated in any
accuracy report.

| Feed | Rows |
| --- | ---: |
| San José Public Library | 19 |
| Santa Clara County Library District | 19 |
| Palo Alto City Library | 19 |
| Alameda County Library | 19 |
| San Mateo County Libraries | 19 |
| Mountain View Public Library | 19 |
| San José State University | 18 |
| Stanford University | 18 |
| Santa Clara University | 18 |
| Midpeninsula Regional Open Space District | 18 |
| City of San José | 14 |

The current sample has **56/200 predictions below 0.65 confidence**. That is a
review queue, not an error rate. Regenerate the sample with the final build
before hand review if the classifier changes; do not edit predicted columns
manually. The CSV includes each official source URL, date, venue, full
normalized description, and structured tags so the reviewer can resolve
ambiguous cases at the source.

### Preliminary code audit, not the human review

The source-linked sample exposed broad source-category errors. In the local
classifier, library "Health & Fitness" no longer makes a snack pickup a sport;
"race" in a civil-rights notice and "long running game" in a tabletop event
no longer imply athletics. An event led by a volunteer is not classified as a
volunteer opportunity unless the attendee is invited to serve. Homework help,
computer help and volleyball now have activity-specific title rules. The
sample was regenerated after these changes. Its reviewer fields remain blank;
the named reviewer must still judge every row and calculate category accuracy.

## Reviewer rubric

### How John fills the CSV

Work on a copy of the committed CSV, preserving all 200 rows, column names,
source IDs, predictions and source URLs. Only fill the four `reviewer*` and
`labelCorrect` columns. Open the `sourceURL` when the title and description are
ambiguous. For each row:

1. Set `reviewerCategory` to the primary activity category a user would expect.
2. Set `reviewerLabels` to the primary category plus any supported secondary
   labels, separated by ` | ` like `Workshop | Family | Indoor | Free`. Do not
   infer a free price, age eligibility or accessibility from missing data.
3. Set `labelCorrect` to `TRUE` only when `predictedCategory` and all material
   `predictedLabels` agree with John's judgment; otherwise set `FALSE`.
4. In `reviewerNotes`, explain every `FALSE` and any source ambiguity. The
   `confidence` column is the model's confidence, not John's score.

Return the completed CSV to Rishit. The audit result must report reviewed
count, overall accuracy and per-predicted-category accuracy with denominators;
low-confidence count alone cannot establish accuracy. [John's full handoff](JOHN-REVIEW-HANDOFF.md)
lists the next ranking task and frozen files.

Choose the primary category by the activity the attendee would do. Use
`Workshop` for teaching, storytime and hands-on practice; `Volunteer` for work
performed for a community cause; `Sports` for physical recreation including
hikes; `Festival` for performances, exhibitions and festivals; `Meetup` for
clubs and gatherings; `Cleanup` for trash removal. Use source programme type
and audience fields before incidental words in the description. A volunteer
*teaching* a class does not turn that class into a volunteer opportunity.
Check secondary labels for Family, Youth, Outdoors, Indoor, Opportunity and
Free only when supported by the source details. Mark `labelCorrect` false if
either the primary category or a material secondary label is wrong. Explain
ambiguous cases in `reviewerNotes`.

After review, compute overall and per-primary-category accuracy with a
denominator for each. Categories with small sample counts need an additional
targeted sample before claiming the 85% gate. Fix categories below 85%,
regenerate predictions, and have the owner review affected rows again.

## Corpus migration gate

A populated local Firestore emulator pass on 2026-09-27 processed 9,832
documents in dry-run mode and proposed **zero** changes to freshly enriched
records. An earlier pass exposed 485 unintended changes, primarily confidence
drift from recomputing complete records using the stored primary category;
the backfill now targets legacy records missing enrichment fields and retains
complete merged-source metadata. A two-record emulator regression check
confirmed legacy migration, merged-label preservation and zero second-pass
changes. The local corpus had 3,349 records below 0.65 confidence; that is
not an accuracy score. See [the populated local gate](LOCAL-CORPUS-AND-PUBLIC-READ-2026-09-27.md).

`functions/scripts/backfill-classify.mjs` is idempotent, cursor-based, and
defaults to dry-run. Dry-run and `--write` were exercised only against an empty
Firestore emulator and reported 0 processed / 0 changed. The live index is
empty, so there was no corpus to migrate. Once it is populated, run the live
dry-run, review category movement and low-confidence distribution, then run
`--write` and commit the actual before/after report. This gate remains open.
