# Verdure design refresh

## Direction and baseline

Verdure should feel like a field guide for real local experiences: calm,
editorial and useful to students, families and young adults. The existing
palette is distinctive enough to keep. The largest visual problems in the
simulator baseline are the rounded display face, broad pill corners, heavy
double shadows and alternating accent colors on adjacent cards. The six-tab
bar also compresses labels. Baseline screenshots were taken on an iPhone 16
Plus simulator before D1-D4.

| Surface | Before | After |
| --- | --- | --- |
| Events / Discover | [before](design-refresh/before/events.png) | [current](design-refresh/after/discover.jpg) · [filters](design-refresh/after/filters.jpg) |
| Explore / Places | [before](design-refresh/before/explore.png) | [current](design-refresh/after/places.jpg) · [accessibility XL](design-refresh/after/places-xl.jpg) |
| Map | [before](design-refresh/before/map.png) | [current](design-refresh/after/map.jpg) |
| Collect | [before](design-refresh/before/collect.png) | [current](design-refresh/after/collection.jpg) |
| Community | [before](design-refresh/before/community.png) | [current](design-refresh/after/community.jpg) · [accessibility XL](design-refresh/after/community-xl.jpg) |
| Profile | [before](design-refresh/before/profile.png) | [current](design-refresh/after/profile.jpg) · [accessibility XL](design-refresh/after/profile-xl.jpg) |
| Plan (new) | — | [current](design-refresh/after/plan-current.jpg) · [date picker](design-refresh/after/plan-date.jpg) · [populated QA card](design-refresh/after/plan-populated-qa.jpg) · [accessibility XL](design-refresh/after/plan-xl.jpg) |
| Friends (new) | — | [current](design-refresh/after/friends.jpg) · [accessibility XL](design-refresh/after/friends-xl.jpg) |
| Rewards (new) | — | [current](design-refresh/after/rewards.jpg) |
| Populated local feed | — | [For You](design-refresh/after/discover-for-you-populated-emulator.png) · [Everything](design-refresh/after/discover-everything-populated-emulator.png) · [event detail](design-refresh/after/event-detail-populated-emulator.png) |

## Token contract

| Role | Decision |
| --- | --- |
| Display | iOS system serif (New York), dynamically scaled. Rubik remains body and numerals. |
| Surfaces | Keep sage cream, graphite forest and evergreen ink. |
| Screen accent | One contextual accent per surface; category colors only where they encode a category. |
| Shape | chip 10, sm 12, md 16, lg 20, xl 24, xxl 28, pill 999. |
| Depth | One soft outer shadow at offset 3 and blur 10; inner shading only inside inset fields and wells. |
| Motion | Keep purposeful transitions and pressed feedback; reduce ornamental movement when Reduce Motion is enabled. |

## Layout review questions for D5

- At larger Dynamic Type, are titles, card actions and the tab bar readable?
- Does the calmer depth preserve clear tap targets and hierarchy in light and dark mode?
- Are empty states honest when the live event index is empty?
- After the five-tab restructure, can every existing surface still be found?

Computer inspected and captured the five-tab shell and its reachable surfaces
on the iPhone 16 Plus Simulator. The live event index is empty, so Discover
shows an honest no-listings state, and Plan cannot display populated cards in
this capture. Friends and Rewards likewise show signed-out or empty states.
Places loaded nearby results from the launch-area center without GPS. Map now
opens over San Jose instead of a continent-wide view. The corrected Places
capture shows one place within 10 miles and a 6.3-mile card; previously it
showed a 35-mile card under the same label. A separate DEBUG offline QA fixture
renders the populated Plan card and its Details, Going? and Refine actions in
the linked screenshot. That fixture is explicitly labeled QA, is excluded from
rewards, and is not evidence of a live indexed event. These are visual checks
of displayed states, not a physical-device accessibility pass.

A later iPhone 16 Plus Simulator run connected the DEBUG build to a locally
seeded Firestore emulator. Computer inspection confirmed 48 events on For You,
the first 40 indexed records on Everything, and a working detail sheet for a
San José Public Library event. The three screenshots above are from that local
emulator, not the live Firebase project. The For You card rail extends toward
the screen edge and the floating tab bar covers the lower portion of the next
card at the captured scroll position; these are visual review items for the
owner's later design decision. Live event imagery and real RSVP states remain
untested.

The Profile and Collection summaries were compressed in code. Explore starts
with nearby places; level, points and challenges stay in Profile. Arbitrary
accent rotation in badges, challenges and community posts was removed in favor
of a consistent spruce accent. Simulator structural audits pass 13/13. The
accessibility XL screenshot matrix was inspected across Explore (light and
dark), Community, Profile, Friends, Rewards, Plan, paywall and the legacy
Adventure Planner. XL exposed truncated tab and Discover mode labels, clipped
Plan option rails, and crowded Profile stats; the final Friends, Places, Plan
and Profile captures show the corrected layouts. Full
VoiceOver reading order, contrast in varied outdoor light and physical-device
review remain open.

## Five-tab follow-up

The new navigation has Discover, Plan, Friends, Rewards, and Profile. Events,
Places, and Map are modes inside Discover; Community is under Friends;
Collection opens from Profile. The old `QATab` surface names remain routable.
Plan uses options first and displays only indexed events in normal operation.
The current capture shows the date picker, group-plan entry and honest empty
state. The DEBUG offline capture exercises a populated Plan card. The later
local Firestore capture exercises populated Discover cards and detail. Live
event-card imagery, RSVP and friend-going states still need a production-index
review.
The model path also needs its configured secret and a populated-index review.
