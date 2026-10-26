import XCTest
@testable import Verdure

// MARK: - Deep link parsing + the cold-launch handoff
//
// The parser must be TOTAL: every one of these inputs arrives from a server
// payload or an inbox row written by an older build, and none of them may crash
// or navigate somewhere arbitrary. A malformed link has exactly one correct
// behaviour — return nil and let the app open normally.

@MainActor
final class DeepLinkRouterTests: XCTestCase {

    // MARK: Parsing

    func testParsesEventLink() {
        XCTAssertEqual(DeepLinkRouter.parse("verdure://events/abc123"), .event(id: "abc123"))
    }

    func testParsesPerkAndStaticDestinations() {
        XCTAssertEqual(DeepLinkRouter.parse("verdure://perks/rei-day"), .perk(id: "rei-day"))
        XCTAssertEqual(DeepLinkRouter.parse("verdure://rewards"), .rewards)
        XCTAssertEqual(DeepLinkRouter.parse("verdure://notifications"), .notifications)
    }

    func testRejectsForeignSchemes() {
        // An attacker-supplied or mis-templated link must not route.
        XCTAssertNil(DeepLinkRouter.parse("https://verdure.app/events/abc"))
        XCTAssertNil(DeepLinkRouter.parse("javascript:alert(1)"))
        XCTAssertNil(DeepLinkRouter.parse("verdur://events/abc"))
    }

    func testRejectsMalformedAndEmptyInput() {
        XCTAssertNil(DeepLinkRouter.parse(nil))
        XCTAssertNil(DeepLinkRouter.parse(""))
        XCTAssertNil(DeepLinkRouter.parse("verdure://"))
        XCTAssertNil(DeepLinkRouter.parse("verdure://events"))       // no id
        XCTAssertNil(DeepLinkRouter.parse("verdure://events/"))      // empty id
        XCTAssertNil(DeepLinkRouter.parse("verdure://unknown/thing"))
    }

    // MARK: Payload extraction

    func testPrefersExplicitDeepLinkOverEventId() {
        let d = DeepLinkRouter.destination(deepLink: "verdure://rewards", eventId: "e1")
        XCTAssertEqual(d, .rewards, "an explicit deepLink is what the server meant")
    }

    func testFallsBackToEventIdForOlderNotifications() {
        // Rows written before deep links existed are still in people's inboxes
        // and must still open something.
        XCTAssertEqual(DeepLinkRouter.destination(deepLink: nil, eventId: "e9"), .event(id: "e9"))
    }

    func testFallsBackWhenDeepLinkIsUnparseable() {
        XCTAssertEqual(DeepLinkRouter.destination(deepLink: "garbage", eventId: "e9"), .event(id: "e9"))
    }

    func testEmptyPayloadRoutesNowhere() {
        XCTAssertNil(DeepLinkRouter.destination(deepLink: nil, eventId: nil))
        XCTAssertNil(DeepLinkRouter.destination(deepLink: nil, eventId: ""))
    }

    // MARK: The cold-launch handoff — the whole reason this class holds state

    func testDestinationIsHeldUntilClaimed() {
        let router = DeepLinkRouter.shared
        _ = router.claim()                       // clear anything left by another test
        router.handle(.event(id: "cold"))
        // Simulates the gap between iOS delivering the tap and SwiftUI building
        // a view: nothing has claimed yet, and the destination must survive.
        XCTAssertEqual(router.pending, .event(id: "cold"))
        XCTAssertEqual(router.claim(), .event(id: "cold"))
    }

    func testClaimIsIdempotentSoTwoListenersCannotBothNavigate() {
        let router = DeepLinkRouter.shared
        _ = router.claim()
        router.handle(.rewards)
        XCTAssertEqual(router.claim(), .rewards)
        XCTAssertNil(router.claim(), "a second claim must get nothing")
        XCTAssertNil(router.pending)
    }

    func testLaterTapReplacesAnUnclaimedOne() {
        let router = DeepLinkRouter.shared
        _ = router.claim()
        router.handle(.event(id: "first"))
        router.handle(.event(id: "second"))
        XCTAssertEqual(router.claim(), .event(id: "second"),
                       "the tap the user just made wins over a stale one")
    }
}
