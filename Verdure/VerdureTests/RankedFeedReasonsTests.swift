import XCTest
@testable import Verdure

/// W5: the ranked feed's `reasons` / `moreDates` on the phone. Pure over the
/// callable's row shape — no network, no Firestore. Pins that every reason the
/// UI can show came from the server, that the card line is the top two, and
/// that "Hide this event" removes the card locally at once.
@MainActor
final class RankedFeedReasonsTests: XCTestCase {

    private func event(_ id: String) -> Event {
        Event(id: id, title: "Event \(id)", organizer: "Org", date: Date().addingTimeInterval(86_400),
              time: "7:00 PM", locationName: "Venue", attendeeCount: 0, maxAttendees: nil, category: .social,
              imagePlaceholder: "cup.and.saucer.fill", pointValue: 100)
    }

    /// The exact shape `recommendedEvents` returns (functions/src/ranking-v2.ts).
    private let serverResponse: [String: Any] = [
        "rankingVersion": "v2",
        "feedSessionId": "abc123",
        "events": [
            ["id": "a", "score": 0.91, "parts": ["interest": 0.4],
             "reasons": ["Matches your interest in tech", "Close by (0.8 mi)", "Repeats — 2 more dates"],
             "moreDates": ["2026-11-02T18:00:00.000Z", "2026-10-26T18:00:00.000Z"], "notify": true],
            ["id": "b", "score": 0.5, "parts": [:] as [String: Any], "reasons": [] as [String], "moreDates": [] as [String], "notify": false],
            ["id": "c", "score": 0.4, "parts": [:] as [String: Any],
             "reasons": ["  ", "Free", 7, "", "This weekend", "New for you", "A fifth reason"] as [Any],
             "moreDates": ["not a date", ["startMs": 1_793_000_000_000.0] as [String: Any], "2026-12-01T10:00:00Z"] as [Any]],
            ["score": 0.3, "reasons": ["No id — dropped"]],
        ] as [[String: Any]],
    ]

    // MARK: Decoding

    func testDecodesReasonsAndMoreDatesInServerOrder() {
        let rows = RankedFeedEvent.decode(serverResponse)
        XCTAssertEqual(rows.map(\.id), ["a", "b", "c"], "a row without an id is dropped, order is the server's")

        let a = rows[0]
        XCTAssertEqual(a.reasons, ["Matches your interest in tech", "Close by (0.8 mi)", "Repeats — 2 more dates"])
        XCTAssertEqual(a.moreDates.count, 2)
        XCTAssertTrue(a.notify)
        XCTAssertEqual(a.score, 0.91, accuracy: 0.0001)
        let iso = ISO8601DateFormatter()
        XCTAssertEqual(a.moreDates, [iso.date(from: "2026-10-26T18:00:00Z")!, iso.date(from: "2026-11-02T18:00:00Z")!],
                       "fractional-second ISO strings parse and are sorted soonest first")

        let b = rows[1]
        XCTAssertTrue(b.reasons.isEmpty)
        XCTAssertTrue(b.moreDates.isEmpty)
        XCTAssertFalse(b.notify)
    }

    func testMalformedReasonsAndDatesAreDroppedNeverInvented() {
        let c = RankedFeedEvent.decode(serverResponse)[2]
        XCTAssertEqual(c.reasons, ["Free", "This weekend", "New for you"],
                       "blank and non-string entries are dropped and the server cap of three is enforced")
        XCTAssertEqual(c.moreDates.count, 2, "an unparseable date is dropped; a {startMs} object and a plain ISO string are kept")
        XCTAssertEqual(c.moreDates[0], Date(timeIntervalSince1970: 1_793_000_000))
        XCTAssertNil(RankedFeedEvent(row: ["id": "", "reasons": ["x"]]))
        XCTAssertNil(RankedFeedEvent(row: ["id": "has/slash"]))
        XCTAssertTrue(RankedFeedEvent(row: ["id": "ok"])!.reasons.isEmpty)
    }

    // MARK: Merging with /events documents

    func testAnnotatedKeepsOnlyServerReasonsOnMatchingEvents() {
        let rows = RankedFeedEvent.decode(serverResponse)
        let feed = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let merged = [event("a"), event("c"), event("unranked")].annotated(with: feed)

        for ev in merged {
            // Every reason the UI can show corresponds to a non-empty server reason — nothing client-invented.
            let serverReasons = (serverResponse["events"] as! [[String: Any]])
                .first { ($0["id"] as? String) == ev.id }?["reasons"] as? [Any] ?? []
            let serverStrings = Set(serverReasons.compactMap { $0 as? String }.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
            for reason in ev.feedReasons {
                XCTAssertFalse(reason.isEmpty)
                XCTAssertTrue(serverStrings.contains(reason), "\(ev.id) shows '\(reason)' which the server did not send")
            }
            if let why = ev.whyLine {
                for part in why.components(separatedBy: " · ") {
                    XCTAssertTrue(serverStrings.contains(part), "card line part '\(part)' is not a server reason")
                }
            }
        }
        XCTAssertEqual(merged[0].feedReasons.count, 3)
        XCTAssertEqual(merged[0].moreDates.count, 2)
        XCTAssertEqual(merged[0].seriesLabel, "Repeats — 2 more dates")
        XCTAssertTrue(merged[2].feedReasons.isEmpty, "an event the feed did not rank carries no reasons")
        XCTAssertNil(merged[2].whyLine)
        XCTAssertNil(merged[2].seriesLabel)

        // Re-annotating with an empty feed (callable failed) clears stale reasons.
        let cleared = merged.annotated(with: [:])
        XCTAssertTrue(cleared.allSatisfy { $0.feedReasons.isEmpty && $0.moreDates.isEmpty })
    }

    func testServiceMergesReasonsWhenEventsAreSet() {
        let service = EventsAPIService()
        service.events = [event("a"), event("b")]
        // No ranked feed yet: nothing shown.
        XCTAssertTrue(service.events.allSatisfy { $0.feedReasons.isEmpty })
    }

    // MARK: Card line

    func testTopTwoReasonsLine() {
        XCTAssertNil(RankedFeedEvent.topReasonsLine([]))
        XCTAssertNil(RankedFeedEvent.topReasonsLine(["", "   "]))
        XCTAssertEqual(RankedFeedEvent.topReasonsLine(["Free"]), "Free")
        XCTAssertEqual(RankedFeedEvent.topReasonsLine(["Free", "This weekend"]), "Free · This weekend")
        XCTAssertEqual(RankedFeedEvent.topReasonsLine(["Free", "This weekend", "New for you"]), "Free · This weekend",
                       "only the first two reasons make the card line")
        XCTAssertEqual(RankedFeedEvent.topReasonsLine(["", "Free", "This weekend"]), "Free · This weekend",
                       "a blank entry never produces an empty segment")
        var ev = event("x")
        ev.feedReasons = ["A friend is going", "Close by (1.2 mi)", "Free"]
        XCTAssertEqual(ev.whyLine, "A friend is going · Close by (1.2 mi)")
    }

    func testSeriesLabelPluralises() {
        var ev = event("s")
        XCTAssertNil(ev.seriesLabel)
        ev.moreDates = [Date()]
        XCTAssertEqual(ev.seriesLabel, "Repeats — 1 more date")
        ev.moreDates = [Date(), Date().addingTimeInterval(86_400), Date().addingTimeInterval(172_800)]
        XCTAssertEqual(ev.seriesLabel, "Repeats — 3 more dates")
    }

    // MARK: Hide

    func testHideRemovesTheEventLocallyAtOnce() {
        let service = EventsAPIService()
        service.events = [event("keep"), event("gone"), event("other")]
        XCTAssertEqual(service.events.map(\.id), ["keep", "gone", "other"])

        service.markHidden("gone")

        XCTAssertEqual(service.events.map(\.id), ["keep", "other"], "the hidden card leaves the feed synchronously")
        XCTAssertFalse(service.rankedEventIDs.contains("gone"))
        XCTAssertNil(service.rankedFeed["gone"])
        XCTAssertTrue(service.hiddenEventIDs.contains("gone"))
        XCTAssertFalse(service.everythingEvents.contains { $0.id == "gone" })

        // A later local list refresh does not resurrect it in this session.
        service.events = [event("gone"), event("keep")]
        XCTAssertEqual(service.events.map(\.id), ["keep"])
    }

    func testExcludingHiddenIDsIsPure() {
        let list = [event("1"), event("2"), event("3")]
        XCTAssertEqual(list.excluding(hiddenIDs: []).map(\.id), ["1", "2", "3"])
        XCTAssertEqual(list.excluding(hiddenIDs: ["2", "9"]).map(\.id), ["1", "3"])
    }
}
