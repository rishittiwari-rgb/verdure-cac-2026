# Ranking evaluation handoff

`functions/scripts/rank-eval.mjs` ranks the frozen corpus with **both** engines —
v1 (`lib/ranking.js` `rankEvents`) and v2 (`lib/ranking-v2.js` `rankEventsV2`) —
for exactly 20 profiles and reports, per profile and as a mean for each version:
precision at 10, position of the first relevant result, distinct categories in
the top 10, and empty feeds. It takes relevance labels from one of two sources:

| Mode | Flag | Labels | Decision applied? |
|---|---|---|---|
| Human golden (original) | `--golden <file>` | John's filled template: named reviewer, review date, `relevantEventIDs` per profile | never |
| Blind automated judge (W6.1) | `--judge-url`, `--judge-model` | a local model behind an OpenAI-compatible endpoint | yes unless `--no-apply` |

No ranking precision is claimed yet: the live `/events` collection is empty,
and the only run recorded so far used a mock judge — see
[RANKING-RESULT-2026-10-20.md](RANKING-RESULT-2026-10-20.md), which states that
plainly and leaves `config/ranking` at v1.

## Prepared public-source preview

`functions/scripts/make-rank-review-corpus.mjs` fetched the existing 11 public
feeds read-only and froze [233 source-linked candidate events](audits/rank-corpus-preview-2026-09-27.json)
from the following 30 days, all with coordinates inside 25 miles of downtown
San José. Its source-ID and occurrence checks reduced 3,223 in-radius records
to 3,211 provisional unique occurrences before category sampling. The export
has an event-array SHA-256 and is paired with a [20-profile context template](audits/rank-golden-template-2026-09-27.json).
The template identifies John as the assigned reviewer; its review date and
relevance IDs are intentionally blank. In golden mode `rank-eval.mjs` rejects
the template until John fills them, and rejects a golden file whose corpus hash
no longer matches. The live-index golden set must be refreshed once actual
production events exist.

The preview predates `topicTags` (the W1 annotation v2's interest term reads),
so `rank-eval.mjs` derives them offline for every event with the same pure
`inferTopicTags` ingest uses (title + the source's own labels, description,
per-source default) and records the count in its output. The corpus file is
never modified.

Reproduce the preview from `functions/`:

```sh
npm run build
node scripts/make-rank-review-corpus.mjs
node scripts/make-rank-golden-template.mjs ../docs/audits/rank-corpus-preview-2026-09-27.json
```

The source feeds change over time, so a reproduction is a **new snapshot**;
use that day's filename for the second command and do not silently relabel the
committed snapshot when the hash changes.

## Mode 1 — human golden set (John)

For each profile, record a stable ID, a `context` of interests, location,
household constraints or history, and `relevantEventIDs` chosen by a person
from that export. Include users with no declared interests, outdoors interests,
students, families, accessibility needs, and accepted friends going to events.
For every relevant choice, verify time, eligibility and location from the
source URL. John should set `reviewedAt` to the date he finishes. Keep the
provided `corpusHash` unchanged and choose IDs that occur in the frozen export.
The [handoff guide](JOHN-REVIEW-HANDOFF.md) gives the file order and return path.

Run after `npm run build`:

```sh
node scripts/rank-eval.mjs ../docs/audits/rank-corpus-preview-2026-09-27.json --golden ../docs/audits/rank-golden-template-2026-09-27.json
```

(The older positional form `rank-eval.mjs <corpus> <golden>` still works.)
It fails by design while `reviewedAt` and relevance IDs are blank. Re-run it on
every ranking change. Comparing precision at 10 per profile is as important as
the mean; a gain for one profile can hide a severe regression for another. A
known-interest false negative rate above 20% is the trigger to evaluate
embeddings against the curated synonym map. Golden mode never writes the
ranking switch: a human reads the table and decides.

## Mode 2 — blind automated judge (W6.1)

A stand-in for the human set until John fills it or real users exist. Needs a
local model behind an OpenAI-compatible `/v1/chat/completions` endpoint — no
API key, no spend. Ollama is the default (`http://127.0.0.1:11434/v1`).

```sh
ollama pull llama3.1 && ollama serve
cd functions && npm run build
node scripts/rank-eval.mjs ../docs/audits/rank-corpus-preview-2026-09-27.json \
  --judge-url http://127.0.0.1:11434/v1 --judge-model llama3.1 --seed 20261020
```

What the script does, in order:

1. Ranks all 233 events with v1 and v2 for each of the 20 profiles in the
   template (contexts only; the blank `relevantEventIDs` are ignored). v2 gets
   constraints mapped the way `loadContext` maps them: household youngest age
   → `childAges`; `distancePreset` close/drive and `transportMode` walk →
   3 / 25 / 2 mile radius.
2. **Pools** both top-10s, deduplicates, and **shuffles** with a seeded RNG
   (`--seed`, mixed per profile id), so the judge order carries no signal.
3. Asks the judge one question per (profile, event) — or `--batch N` listings
   per call — with a strict-JSON answer. The prompt contains **only** the
   profile text (home area, interests, household, student status, travel
   preference) and the listing text (title, description, category, venue, date,
   price, distance). It never contains the version, score, position, event id
   or source. Up to 4 HTTP retries and 3 parse retries per question.
4. Caches every verdict in `docs/audits/rank-judge-cache-<model>.json`
   (`--cache` to override) keyed by model + prompt text, so a re-run makes
   zero calls. Commit the cache with the result.
5. Reports the metrics above, writes `docs/RANKING-RESULT-<date>.md`
   (`--result-doc`, or `none`) and, with `--out`, the full JSON including each
   profile's pooled order and verdicts.
6. **Decision rule:** if v2 mean P@10 ≥ v1 mean P@10 the version is v2, else
   v1. Unless `--no-apply`, the chosen version is written to
   `functions/seed/ranking-config.json` (`--seed-file` to override). With
   `--emulator` and `FIRESTORE_EMULATOR_HOST` set it also writes
   `config/ranking` in the local emulator; without the env var it refuses.
   **Production is never written.**

Every result file must name the judge model and say that a model judge is a
stand-in until real users exist; the script writes that sentence itself.

### Tests

`node scripts/rank-eval-unit.mjs` (part of `npm run test:units`) starts
`scripts/rank-judge-mock.mjs` — a tiny local OpenAI-compatible server with
deterministic keyword relevance — on a free port and drives the real script
against it: both versions ranked; request bodies contain no `v1`/`v2`/version/
position/rank/score strings, ids or sources; same seed → identical pooled
order, different seed → different order with the same membership; cache makes
the second run zero calls; batched mode gives identical metrics with fewer
calls; injected HTTP 500s are retried; a mock that only likes v2-exclusive
titles yields the v2 decision and seed file, one that only likes v1-exclusive
titles yields v1, a tie yields v2; `--no-apply` writes nothing; `--emulator`
without the env var refuses; golden mode, the legacy positional form, the
blank-template rejection and the hash mismatch rejection all still work.
42 checks. The mock is a test fixture, not a judge: do not quote its numbers.
