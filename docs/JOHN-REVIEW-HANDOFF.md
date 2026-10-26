# John’s Verdure review packet — 2026-09-27

Rishit can forward this packet to John. Please do the tasks **in this order**.
These are human judgments; the predicted labels and ranking outputs are not
the answer key. Neither task has a pass result yet.

## 1. Classification: 200 events

Open `audits/classification-sample-2026-09-27.csv` in a spreadsheet. Keep all 200
rows and the existing identifiers and predictions. For each row, inspect the
title, description, source tags and `sourceURL`. Fill only
`reviewerCategory`, `reviewerLabels`, `labelCorrect` and `reviewerNotes`.
Use `TRUE` or `FALSE` in `labelCorrect`; explain every `FALSE`. The detailed
category and secondary-label rubric is in `CLASSIFICATION-AUDIT.md`.

Send the completed CSV to Rishit. Please include any sources whose pages were
unavailable, ambiguous categories, and changes you would make to the rubric.
The engineering team will calculate accuracy by category and rerun affected
predictions. The sample is from public source feeds, not the empty live event
collection; it excludes key-gated Ticketmaster and SerpApi.

## 2. Ranking: 20 profiles

After classification, open `audits/rank-golden-template-2026-09-27.json`
alongside `audits/rank-corpus-preview-2026-09-27.json`. The corpus has 233
source-linked events.
For each of the 20 profiles, identify event IDs that are genuinely relevant to
that profile's interests, location and constraints. Open the source URL for
uncertain time, age or accessibility claims. Put those IDs in
`relevantEventIDs`, add `reviewerNotes` where useful, and set `reviewedAt` to
the completion date. Keep `corpusHash`, profile IDs and contexts unchanged.
Every profile needs at least one relevant event ID from the corpus. If none is
defensible, flag the profile to Rishit rather than inventing a match.

Send the completed JSON to Rishit. Engineering will use `rank-eval.mjs` to
calculate precision at 10 and first relevant position. This is a preview
based on a frozen public-source snapshot; a later evaluation against the
populated production index is still required.

## Files in this packet

| File | Purpose |
| --- | --- |
| `CLASSIFICATION-AUDIT.md` | Category rubric and scoring gate |
| `audits/classification-sample-2026-09-27.csv` | 200 rows to label first |
| `RANKING-EVAL.md` | Ranking rubric and evaluation procedure |
| `audits/rank-corpus-preview-2026-09-27.json` | Frozen 233-event source corpus |
| `audits/rank-golden-template-2026-09-27.json` | 20 profile contexts to label second |

Return both edited files to Rishit, keeping their filenames or adding
`-john-reviewed` before the extension. No production access or paid account is
needed for this review.
