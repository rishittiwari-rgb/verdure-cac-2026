# W5 — the app experience: reasons, hide, series (iOS, SwiftUI)

Date: 2026-10-20. Written on Windows with no macOS/Xcode: **nothing in this
workstream was compiled or run**. Every Swift change below was self-reviewed
twice against the types that exist in the tree, and the native suites are
reported as **not run**, not as passing.

## Server contract consumed

- `recommendedEvents` → `{ rankingVersion, feedSessionId, events: [{ id, score, parts, reasons: [String] (≤ 3), moreDates: [ISO-8601 String], notify }] }`
  (`functions/src/ranking-v2.ts` `rankEventsV2` / `collapseSeries`; v1 fills `reasons` from `reasonsForV1`, `moreDates: []`).
- `recordEventFeedback({ eventId, kind })` with `kind ∈ FEEDBACK_KINDS` (`functions/src/ranking.ts`):
  "Show less like this" sends `kind: "less"`, "Hide this event" sends `kind: "hide"`, which the server adds to
  `users/{uid}.hiddenEventIDs` so no later feed ranks it.
- `recordFeedEvent({ sessionId, eventId, action })` is unchanged; a hide also records `action: "dismiss"` for the
  slate the event came from.

## What changed

| File | Change |
| --- | --- |
| `Verdure/Verdure/Models/Models.swift` | `Event.feedReasons: [String]` and `Event.moreDates: [Date]` (defaults empty, memberwise call sites untouched); `Event.whyLine` (top two reasons joined with " · ") and `Event.seriesLabel` ("Repeats — N more dates"). New `RankedFeedEvent` (tolerant decoder for one callable row: blank/non-string reasons dropped, cap of three, ISO dates with or without fractional seconds plus `{ startMs }`, sorted soonest first; `decode(_:)` for the `events` array; `topReasonsLine`). `[Event].annotated(with:)` merges a ranked row onto the matching `/events` document and clears reasons on unranked events; `[Event].excluding(hiddenIDs:)`. |
| `Verdure/Verdure/Models/EventsAPIService.swift` | `rankedFeed: [String: RankedFeedEvent]` and `hiddenEventIDs: Set<String>` (both `private(set)`); the `events` setter annotates every list that is stored, so reasons survive the `/events` merge and the by-id fetch of missing cards; `events` and `everythingEvents` getters drop hidden ids. `fetchPersonalized` decodes through `RankedFeedEvent`, filters hidden ids out of the session, re-annotates stored events, and clears everything on failure. `markHidden(_:)` (synchronous local removal: feed, ranked order, Everything, session) and `hideEvent(_:)` (markHidden, then `recordEventFeedback kind: "hide"`, `dismiss` telemetry, feed refresh). `recordFeedEvent` now checks the server slate (`sessionEventIDs`) rather than the display order, so a hidden card's dismiss is still accepted. DEBUG-only `-QAFeedReasons YES` seeds `SampleData.feedReasons` in the offline harness. |
| `Verdure/Verdure/Views/Events/EventsView.swift` | **ForYouEventCard**: one reasons line (`lineLimit(1)`, `minimumScaleFactor(0.75)`, `allowsTightening`, no fixed height; the card's pinned 190 pt height became a 190 pt floor, the QA.md card pattern); the combined VoiceOver label now ends with `, Why: <reason> · <reason>` and the series label; an in-card "Repeats — N more dates" button and a matching accessibility custom action open `SeriesDatesSheet`. **EventDetailSheet**: "Why you're seeing this" section listing every server reason verbatim (hidden when empty, identifier `whySeeingThis`); "Repeats — N more dates" row (identifier `seriesMoreDates`) opening the dates sheet; feedback controls are now "More like this" / "Show less like this" (`feedbackMore` / `feedbackLess`) plus "Hide this event" (`hideEvent`), which calls `hideEvent`, dismisses the sheet, and the card is gone before the network round trip. New private `SeriesDatesSheet` (dates only; title, venue and organizer are the card's). |
| `Verdure/Verdure/Models/SampleData.swift` | `feedReasons` fixture: server-shaped rows for four sample events (one with two series dates). Used only under DEBUG + `-QAOfflineData YES -QAFeedReasons YES`. |
| `Verdure/VerdureTests/RankedFeedReasonsTests.swift` (new) | Decoding (order, cap, blanks, bad dates, `{startMs}`, missing id); every reason an `Event` can show and every segment of the card line is a non-empty server reason; unranked events carry none; a failed feed clears stale reasons; top-two line; series label plural; `markHidden` removes the card synchronously from `events`, `rankedEventIDs`, `rankedFeed`, `everythingEvents` and keeps it out after a later `events =`; `excluding(hiddenIDs:)`. |
| `Verdure/VerdureUITests/AccessibilityAuditTests.swift` | Two new audits under `-QAFeedReasons YES`: the For You card's combined label contains `Why: Matches your interest in tech · Close by (0.8 mi)` and `Repeats — 2 more dates` (screen `events-for-you-reasons`); the detail's `whySeeingThis` text lists all three reasons, the three feedback buttons exist (`event-detail-why`), the series row opens the "More dates" sheet (`series-dates`), and Hide removes the hackathon card from the feed at once while the next ranked card keeps its reasons. |
| `QA.md` | One launch-argument row for `-QAFeedReasons YES`. |

Not changed: `DiscoveryFilters.swift` (no new filter screen), friend-name display (the detail reuses the existing
`FriendsGoingStack`, which already follows the privacy rules; no new name surface was added), blocked users (the server
strips them from `friendsGoing` and the ranked slate; the client never re-derives them from local caches — reasons
are only ever the server strings).

## Verify first on a Mac

```bash
cd Verdure && xcodegen generate            # the new test file must be picked up
xcodebuild -project Verdure.xcodeproj -scheme Verdure \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
xcodebuild ... test -only-testing:VerdureTests/RankedFeedReasonsTests
xcodebuild ... test -only-testing:VerdureUITests/AccessibilityAuditTests
xcodebuild ... test                          # the full native suite (unit + journeys + audits)
```

Things most likely to need a touch when it first compiles, in order:

1. `RankedFeedEvent.init?(row:)` delegates to the designated `init(id:score:reasons:moreDates:notify:)`; the
   `[String: Any]` literals in the unit test carry explicit `as [Any]` / `as [String: Any]` casts where mixed.
2. `ForYouEventCard` now has `@State` and `.accessibilityActions { if let … }` (iOS 16+; target is 17).
3. The For You card's height floor instead of a pinned height: check the horizontal row at default and AX-XL text
   (the `TextSizeMatrixTests` screenshots) — the footer no longer hugs the bottom of short cards.
4. `EventDetailSheet` gained `@Environment(\.dismiss)`; `CreateEventSheet` and `SeriesDatesSheet` have their own.
5. The UI test taps the card at normalized (0.5, 0.3) to stay clear of the in-card series button; if the audit
   engine reports the card's child button under the combined element, drop the in-card button and keep the custom
   action (the detail's `seriesMoreDates` row covers the affordance).

## Screenshots not taken

- Events tab, For You row with a reasons line, default and AX-XL text, light and dark.
- Event detail with "Why you're seeing this", the series row, and the three feedback buttons.
- "More dates" sheet.
- For You row immediately after "Hide this event".
