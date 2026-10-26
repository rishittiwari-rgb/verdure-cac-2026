# National event API evaluation — 2026-09-26

The sprint suggested SeatGeek, Bandsintown and Songkick as free supply. Current
first-party access rules do not support treating them as three ready-to-ingest
feeds. None has been added to the frozen source list or queried with an
unapproved credential.

**Rishit's 2026-09-27 decision:** drop Bandsintown and Songkick from the active
work and budget request. The findings below remain as the reason for that
decision; they are not tasks to pursue this sprint.

| API | Current access finding | Decision |
| --- | --- | --- |
| SeatGeek | [Developer portal](https://portal.seatgeek.com/) offers an access request. No project key is present in this workspace. | Evaluate overlap after approved access; only event metadata, no competing ticket listings. |
| Bandsintown | [Artist API help](https://help.artists.bandsintown.com/en/articles/7053475-what-is-the-bandsintown-api) says a key is tied to one artist unless otherwise authorized; platform use requires a partnership. | Dropped from this sprint by Rishit. |
| Songkick | [Developer page](https://www.songkick.com/developer) now states a partnership agreement and license fee, and says it is not approving student or hobby projects. [Key application](https://www.songkick.com/api_key_requests/new) says new requests are paused. | Exclude from this sprint. |

**Marginal contribution method if access is granted:** fetch a 30-day South Bay
sample; normalize title, time and venue with the existing dedupe matcher; report
total, overlap with Ticketmaster, and genuinely new in-area records. Do not add
a scheduled adapter if overlap is near 90% or if the terms conflict with a
commercial discovery app.
