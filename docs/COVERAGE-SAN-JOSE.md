# San José event coverage baseline

Measured 2026-09-26 23:04 PDT (2026-09-27 06:04 UTC), before the next-sprint source additions.

## Result

| Measure | Result |
| --- | ---: |
| Event documents in the live `events` collection | 0 |
| Upcoming active events for `san-jose-ca` | 0 |
| Events checked against SerpApi provenance | 0 |
| Matched / unmatched | Not measurable |
| Share absent from Google Events | Not measurable |
| Breakdown by source | No rows |

The live corpus is empty. Do not report an absent-from-Google percentage or use
this baseline to choose a supply strategy. The 1,057-event figure in `CLAUDE.md`
is from `scripts/ingest-smoke.mjs`, which fetches upstream sources without
writing the live `events` collection.

## Reproduction

The repository's `node scripts/coverage-check.mjs san-jose-ca` requires Google
Application Default Credentials. This machine had a Firebase CLI login but no
ADC, so the script stopped before querying. I reproduced its two Firestore
filters (`areaId == san-jose-ca`, `active == true`, limit 8,000) with a read-only
Firestore REST `runQuery` using the existing CLI login. It returned zero
documents. A second read-only query against the entire `events` collection
with limit 1 also returned zero documents.

To rerun the repository script in an environment with ADC:

```bash
cd functions
node scripts/coverage-check.mjs san-jose-ca
```

## Measurement caveat when the corpus exists

The script calls an event “not found via Google” when its `sources[]` lacks
`serpapi`. SerpApi is a quota-capped gap-filler, so that is a **provenance
proxy**, not a search match test for every event. It likely overstates the
share absent from Google Events. Report the proxy as such. A product claim
about Google coverage needs a separately sampled search audit with the search
date, query, and matching rubric preserved.

Rerun at the end of the sprint after an event corpus is available; report the
event count and source breakdown alongside any percentage so the comparison
has a denominator.
