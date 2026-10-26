# San José source list freeze — 2026-09-26

This is the P1 boundary before classifier lexicon tuning. No further source
config or adapter change should enter the current sprint corpus without rerunning
the 200-event classification audit.

## Configured sources

| Platform | Feed |
| --- | --- |
| Ticketmaster | Discovery API, South Bay |
| BiblioCommons | San José Public Library; Santa Clara County Library District; Palo Alto City Library; Alameda County Library (in-radius coordinates only); San Mateo County Libraries (in-radius coordinates only) |
| LibCal | Mountain View Public Library calendar 8800 |
| Localist | San José State University; Stanford University |
| LiveWhale | Santa Clara University |
| Midpen HTML | Midpeninsula Regional Open Space District |
| Legistar | City of San José public meetings |
| SerpApi | Quota-capped Google Events gap filler |

The **six new feeds** relative to the delivered tree are SCU, Palo Alto,
Alameda County Library, San Mateo County Libraries, Mountain View Library and
San José Legistar. The adapter for NPS remains available but has no unit in the
radius. ICS remains available but has no configured feed here.

## Deferred after the freeze

The City's open-data and ArcGIS hosts did not expose an established event
calendar in this audit. County Parks' WAF prevents direct inspection; its
Samaritan volunteer platform needs a separate terms and schema review.
SeatGeek, Bandsintown and Songkick lack project access or terms suitable for
unapproved bulk ingestion; see `NATIONAL-API-EVALUATION.md`. Sunnyvale's
BiblioCommons gateway returned 403, so the public site alone is insufficient
for that adapter.
On 2026-09-27 Rishit explicitly dropped Bandsintown and Songkick from this
sprint; no adapters or access requests for them are planned.

## Measurement limits

Read-only source smoke checks returned events for all six additions. The live
Firestore `events` collection was empty at the A1 baseline. Thus the source
addition, remaining-duplicate rate, and absent-from-Google delta are not yet
measurable on the live index. `ingestRuns` now records a heuristic suspected
duplicate rate per run and `/treasury` stores the latest source rate and merge
counters. The under-5% target needs a populated corpus to evaluate; a 0/0
empty-index result is not a pass.
