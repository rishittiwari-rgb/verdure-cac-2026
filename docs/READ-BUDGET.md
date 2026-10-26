# Discovery read budget — 2026-09-27

## Live measurement and gate

A populated **local emulator** run on 2026-09-27 returned 359 candidate
documents for one shared-cache refresh and stored 285 distinct ranked
candidates; four profiles reused that one refresh. It ingested 9,813 upcoming
active records. See [the local corpus and public-read check](LOCAL-CORPUS-AND-PUBLIC-READ-2026-09-27.md).
This is useful scale evidence but not a production bill or index-entry meter.

The read-only A1 query found **zero documents** in the live `events`
collection. This is not a usable load benchmark. C1 cannot be declared
cost-validated until a real area corpus exists. No live ingest or production
feed rollout was performed here.

The implementation reads at most 80 public events on a normal client feed
load, plus up to ten ranked events absent from that first page. A shared
server candidate snapshot has 180 near-and-soon, 70 quality and 10 × 15
category-sweep query slots, cached per area for five minutes. Returned
documents are merged, so the actual count can be far below 400. Each signed-in
ranking request also reads its profile, accepted friends, blocks and up to 60
direct friend-event documents. An Everything page reads at most 40 public
events by date cursor.

Feedback is kept as a bounded map of at most 100 events on the user profile
already read by ranking. A feedback action reads its event and profile and
writes the profile; opening an event records a weak view signal. These reads
and writes are not included in the scenario table below and must be measured
before release. Up to 30 attended event documents may also be fetched per
ranking request to build the behavioral context.

Each signed-in For You request now writes one server-owned `feedSessions`
document containing at most 100 scored IDs, positions and contributing terms.
Only cards the client presents write a `feedImpressions` document; later taps,
saves, RSVPs and dismissals update that row, with untouched rows marked
`ignored`. This adds one write per ranked load and up to one write per visible
card plus action updates. These writes are **not** included in the read-only
scenario below; measure them with the populated corpus before rollout. The
Product Analytics switch prevents new feed-session and impression writes.
Server cleanup removes rows after 30 days in bounded daily batches.

The table is a **scenario, not a measured production result**: 80 feed reads
plus one 40-document Everything page, three times per user per day. It excludes
server ranking context, candidate refreshes, other screens, minimum query
charges, index-entry reads and writes.

| Users | Reads/day at 120 × 3 | Reads/30 days | Gross document-read charge |
| ---: | ---: | ---: | ---: |
| 100 | 36,000 | 1.08 million | $0.32 |
| 1,000 | 360,000 | 10.8 million | $3.24 |
| 10,000 | 3.6 million | 108 million | $32.40 |

The [Firestore Standard price in us-central1](https://cloud.google.com/firestore/pricing)
was checked on 2026-09-27: $0.03 per 100,000 document reads beyond the daily
50,000-read free quota. Gross figures ignore that quota, index-entry reads,
writes, storage, network, other app reads and functions. They are a floor for
this scenario, not a project invoice. Verify the actual region and edition.

## Architecture and meter

The five-minute `feedCaches/{area}` document avoids re-reading the shared
candidate set for every person. `treasury/{month}.readTelemetry` counts returned
candidate documents and refreshes. It does **not yet count all** user-context,
friend, client or index-entry reads, so it is not an invoice-grade counter.
Before the live gate passes, broaden it or reconcile it against Firestore
usage metrics. A per-user feed document could cut client reads further, but
generating one still reads candidates; measure total backend reads first.

Everything uses a cursor and a 40-document page. It never returns the whole
radius set in one query. Before enabling the feed on a populated live index,
rerun this report with actual document and index-entry reads, user-context
reads, a measured cache hit rate and typical session frequency. Keep the C1
launch gate closed until then.

## CAC 2026 addendum — interest-based retrieval (2026-10-25)

`recommendFor` now merges a second, interest-keyed candidate pool into the
shared area snapshot before ranking (`functions/src/ranking.ts`,
`interestCandidates`). Per DISTINCT interest set it reads at most 150 events
whose `topicTags` speak to the user's picks plus at most 100 events in the
picks' specific categories, both over the next 14 days, ordered by date. The
result is cached five minutes in `feedCaches/{areaId}__topics__…` and shared by
every user with the same picks; a user with no interests reads nothing extra.
Measured on the populated local emulator (2,048 events in the next 14 days):
the shared pool held 270–272 candidates and 11–96 matches per pick; with
retrieval, 340–420 candidates and 24–154 matches (see
`docs/PERSONALIZATION-REVIEW-2026-10-25.md`). The new composite index is
`events: areaId, active, topicTags (CONTAINS), date`.
