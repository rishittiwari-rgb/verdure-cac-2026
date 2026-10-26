# Sprint acceptance (W7)

One script, one emulator, no network. It runs the sprint's pipeline in order on recorded
fixtures and fails loudly on the first thing that is not true.

```bash
cd functions && npm run acceptance
# = npm run build && cd .. && npx firebase-tools@13 emulators:exec --only firestore --project connectify-19dd8 \
#     "node functions/scripts/sprint-acceptance.mjs"
node functions/scripts/sprint-acceptance.mjs --dry-run   # loads every module and exits 0; no Firestore
```

Inputs (both recorded once, replayed always):

- `functions/test-fixtures/corpus/<area>-<date>.json.gz` — the ingest corpus (`record-corpus.mjs`).
- `functions/test-fixtures/discovery/MANIFEST.json` + `<label>/` — every HTTP response of one live
  discovery run (`discovery-e2e.mjs --record`). If the manifest is missing the script stops with a
  message saying so; it never reaches the internet.

What each step proves (assertions use the real `lib/` code, the same functions the callables call):

| Step | Proves |
|---|---|
| seed | the `/sources` registry is seeded and the recorded corpus ingests through `runSource` with no adapter errors |
| discover | one `runDiscovery` cycle seeded by corpus links + the OpenStreetMap fixture activates ≥ 1 new host within the 300/day budget, with no unrecorded request |
| decide | after the weekly re-check, every active source passes all six rules (`auditActiveSources` is empty); rejected candidates are printed as a table with failed rules and evidence |
| ingest | replaying the identical corpus creates nothing; each newly activated host fetches through its adapter from the replay fixtures and adds events |
| dedupe | `auditFuzzyDuplicates` (John's `dedupe.py` rule) reports a duplicate rate below 5 % |
| rank | `recommendEligibleFor` (the program-feed path) for a synthetic adult and a synthetic 15-year-old, v1 and v2: non-empty, deterministic across two calls, and a perk-shaped `/events` row is never returned |
| reasons | every ranked row has 1–3 reasons; each reason maps to a component at or above its threshold (v2: the check from `ranking-v2-unit.mjs`; v1: `V1_REASON_RULES`, plus exact equality with `reasonsForV1`) |
| minors | the minor's v1 and v2 feeds contain zero `adultOnly` events and only explicitly flagged documents; the adult's contains ≥ 1 when the corpus has any; the planner's candidate rule and the notification digest's eligibility rule (`decideDigest`) hide them too |

Output: a per-step pass/fail table, exit code 1 on any failure, and
`docs/evidence/acceptance-<date>.json` with every step's counts, failures and detail (origins,
activated/rejected sources, duplicate rate, top-five per feed, reason samples, digest decision).

Not covered here: Firestore rules as read by a minor client (covered by `npm run e2e`), the iOS
surfaces (need a Mac), and anything live — the deploy status in `PROJECT-NOTES.md` is unchanged by this
script.
