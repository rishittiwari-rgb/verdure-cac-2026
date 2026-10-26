# Ranking evaluation result — 2026-10-20

Judge model: `mock-keyword` at `http://127.0.0.1:48913/v1` (blind: pooled top-10 of both versions, deduplicated, shuffled with seed 20261020; the judge saw profile and listing text only, never the version or position). 0 judge calls, 328 cache hits (`docs/audits/rank-judge-cache-mock-keyword.json`).

Corpus: `docs/audits/rank-corpus-preview-2026-09-27.json` (233 events, hash `9f7abe3e872a…`, snapshot 2026-09-27T18:05:07.722Z); topicTags derived offline for 233 events with `inferTopicTags`.
Profiles: `docs/audits/rank-golden-template-2026-09-27.json` (20).

**A model judge is a stand-in until real users exist.** Its verdicts measure agreement with one model's reading of the listing text, not what San José residents will actually attend. Interleaving telemetry (W3.2) and John's human golden set replace it as soon as either exists.

## Means

| Metric | v1 | v2 |
|---|---|---|
| Mean precision at 10 | 0.48 | 0.455 |
| Mean position of first relevant | 2.25 | 1.9 |
| Profiles with no relevant result | 0 | 0 |
| Mean distinct categories in top 10 | 5.8 | 4.2 |
| Empty feeds | 0 | 0 |

## Per profile

| Profile | Relevant | P@10 v1 | P@10 v2 | First v1 | First v2 | Categories v1 | Categories v2 | Empty v1 | Empty v2 |
|---|---|---|---|---|---|---|---|---|---|
| cold-start-san-jose | 10 | 0.5 | 0.7 | 1 | 1 | 7 | 4 | no | no |
| outdoors-san-jose | 4 | 0.2 | 0.2 | 5 | 2 | 6 | 3 | no | no |
| volunteering-san-jose | 10 | 0.7 | 0.5 | 1 | 2 | 6 | 6 | no | no |
| fitness-san-jose | 11 | 0.6 | 0.9 | 1 | 1 | 7 | 3 | no | no |
| arts-san-jose | 9 | 0.4 | 0.6 | 2 | 2 | 5 | 5 | no | no |
| music-san-jose | 4 | 0.3 | 0.4 | 1 | 1 | 5 | 3 | no | no |
| food-san-jose | 5 | 0.4 | 0.2 | 2 | 1 | 5 | 4 | no | no |
| tech-san-jose | 3 | 0.2 | 0.1 | 3 | 4 | 5 | 3 | no | no |
| learning-san-jose | 12 | 0.9 | 0.7 | 1 | 1 | 5 | 6 | no | no |
| community-san-jose | 11 | 0.5 | 0.8 | 2 | 1 | 6 | 6 | no | no |
| family-five-year-old | 9 | 0.7 | 0.4 | 1 | 1 | 6 | 2 | no | no |
| family-ten-year-old | 8 | 0.6 | 0.3 | 1 | 1 | 7 | 4 | no | no |
| student-sjsu | 2 | 0.1 | 0.1 | 8 | 4 | 6 | 3 | no | no |
| student-scu | 13 | 0.9 | 0.7 | 1 | 1 | 6 | 6 | no | no |
| close-to-home | 2 | 0.1 | 0.1 | 6 | 8 | 5 | 5 | no | no |
| worth-the-drive | 5 | 0.3 | 0.3 | 4 | 2 | 5 | 4 | no | no |
| walkable-only | 8 | 0.5 | 0.6 | 1 | 1 | 7 | 4 | no | no |
| palo-alto-arts | 8 | 0.5 | 0.5 | 2 | 1 | 5 | 4 | no | no |
| palo-alto-family | 6 | 0.5 | 0.3 | 1 | 2 | 7 | 4 | no | no |
| mountain-view-learning | 11 | 0.7 | 0.7 | 1 | 1 | 5 | 5 | no | no |

## Decision

Rule: choose v2 when v2 mean P@10 >= v1 mean P@10. Outcome: **v1**.
Applied: **no** (run with --no-apply, or golden mode). config/ranking is unchanged.

## What this run is, and is not — read before quoting any number above

- **No real model judged this run.** The Windows build machine has no Ollama
  and no other LLM endpoint, and the ground rules forbid network spend. The
  judge recorded above, `mock-keyword`, is `functions/scripts/rank-judge-mock.mjs`:
  a deterministic keyword matcher (interest word lists, "Free" for cold-start
  profiles) that exists to test the harness. Its verdicts say nothing about
  which engine San José residents would prefer. The P@10 columns are a
  **plumbing check**, not a result.
- **The decision was NOT applied.** The run used `--no-apply`; no
  `functions/seed/ranking-config.json` was written, no emulator or production
  `config/ranking` was touched, and the live switch stays at its default
  **v1** (`DEFAULT_RANKING_CONFIG` in `functions/src/ranking-v2.ts`).
- What the run does establish: both engines rank the frozen 233-event corpus
  for all 20 profiles with no empty feed; the pooled, deduplicated, seeded
  shuffle and the blind prompt work end to end; the cache makes re-runs free;
  and `node scripts/rank-eval-unit.mjs` (42 checks) covers blinding, seed
  determinism, both decision directions, batching, retries, the emulator
  guard and the human-golden mode.
- One observation that is independent of the judge: v2 surfaces fewer
  distinct categories in its top 10 (mean 4.2 vs 5.8) because it ports John's
  series collapse and flat −0.12 category penalty instead of v1's exploration
  slot. Whether that is a loss is exactly what a real judge or real users must
  answer.

## How to produce the real run (developer machine, free, local)

```sh
# 1. Local judge (one-time download; ~5 GB; no API key, no spend)
ollama pull llama3.1
ollama serve            # Ollama exposes an OpenAI-compatible API on 127.0.0.1:11434

# 2. From functions/, after npm run build
node scripts/rank-eval.mjs ../docs/audits/rank-corpus-preview-2026-09-27.json \
  --judge-url http://127.0.0.1:11434/v1 --judge-model llama3.1 \
  --seed 20261020 --batch 1 --date YYYY-MM-DD
```

That command writes `docs/RANKING-RESULT-YYYY-MM-DD.md`, caches every verdict
in `docs/audits/rank-judge-cache-llama3.1.json` (commit it; re-runs are then
free and reproducible), and — because `--no-apply` is absent — writes
`functions/seed/ranking-config.json` with the winner. Add `--emulator` with
`FIRESTORE_EMULATOR_HOST` set to also seed `config/ranking` in the local
emulator. The script never writes production; promoting the seed to the live
project is a separate, human, deploy step. Expect roughly 330 judge calls
(20 profiles × ~16 pooled listings); on a laptop with llama3.1 8B that is
about 10–20 minutes. A 70B model or a second model as a cross-check is
preferable if the hardware allows; name every model used in the result file.

Even then: **a model judge is a stand-in until real users exist.** Once
interleaving telemetry (W3.2) or John's human golden set
(`--golden docs/audits/rank-golden-template-2026-09-27.json`, filled) is
available, those supersede any model verdict.
