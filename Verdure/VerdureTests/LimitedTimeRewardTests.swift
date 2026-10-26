import XCTest
@testable import Verdure

// MARK: - Limited-time drops + Verdure+ early access
//
// Pure date logic, so every state is asserted at a fixed instant rather than
// depending on when the suite happens to run. The server enforces the same
// window independently (see the emulator E2E) — this covers what the UI shows
// and what the client will let you attempt.

@MainActor
final class LimitedTimeRewardTests: XCTestCase {

    private let day: TimeInterval = 86_400
    private let now = Date(timeIntervalSince1970: 1_800_000_000)   // fixed reference

    /// Opens in 10 days, closes in 40, Plus gets in 7 days early (i.e. in 3 days).
    private func drop() -> Reward {
        Reward(id: "drop", name: "Drop", brand: "B", icon: "gift.fill",
               pointCost: 1000, tier: .silver,
               availableFrom: now.addingTimeInterval(10 * day),
               availableUntil: now.addingTimeInterval(40 * day),
               plusEarlyAccessDays: 7)
    }

    private func alwaysOn() -> Reward {
        Reward(id: "always", name: "Always", brand: "B", icon: "gift.fill",
               pointCost: 1000, tier: .bronze)
    }

    // MARK: Non-limited rewards are unaffected

    func testEvergreenRewardIsAlwaysOpen() {
        let r = alwaysOn()
        XCTAssertFalse(r.isLimitedTime)
        XCTAssertEqual(r.availability(now: now, isPlus: false), .open(endsAt: nil))
        XCTAssertTrue(r.isRedeemable(now: now, isPlus: false))
    }

    // MARK: Before anyone can redeem

    func testBeforeEarlyWindowNobodyCanRedeem() {
        let r = drop()
        let t = now   // 3 days before even Plus opens
        XCTAssertEqual(r.availability(now: t, isPlus: false), .upcoming(from: r.availableFrom!))
        XCTAssertEqual(r.availability(now: t, isPlus: true), .upcoming(from: r.availableFrom!),
                       "Plus does not get in before its own early window")
        XCTAssertFalse(r.isRedeemable(now: t, isPlus: true))
    }

    // MARK: The early window — the actual member benefit

    func testInsideEarlyWindowOnlyPlusCanRedeem() {
        let r = drop()
        let t = now.addingTimeInterval(5 * day)   // after Plus opens (day 3), before public (day 10)

        XCTAssertTrue(r.isRedeemable(now: t, isPlus: true), "Plus member redeems early")
        XCTAssertEqual(r.availability(now: t, isPlus: true), .open(endsAt: r.availableUntil))

        XCTAssertFalse(r.isRedeemable(now: t, isPlus: false), "free user must wait")
        XCTAssertEqual(r.availability(now: t, isPlus: false),
                       .plusEarlyAccess(publicFrom: r.availableFrom!))
    }

    func testEarlyWindowStartsExactlyOnBoundary() {
        let r = drop()
        let plusOpen = r.plusAvailableFrom!
        XCTAssertEqual(plusOpen, now.addingTimeInterval(3 * day))
        XCTAssertTrue(r.isRedeemable(now: plusOpen, isPlus: true), "inclusive at the boundary")
        XCTAssertFalse(r.isRedeemable(now: plusOpen.addingTimeInterval(-1), isPlus: true))
    }

    // MARK: Public window

    func testAfterPublicOpenEveryoneCanRedeem() {
        let r = drop()
        let t = now.addingTimeInterval(20 * day)
        XCTAssertTrue(r.isRedeemable(now: t, isPlus: false))
        XCTAssertTrue(r.isRedeemable(now: t, isPlus: true))
        XCTAssertEqual(r.availability(now: t, isPlus: false), .open(endsAt: r.availableUntil))
    }

    // MARK: Close

    func testAfterCloseNobodyCanRedeem() {
        let r = drop()
        let t = now.addingTimeInterval(50 * day)
        XCTAssertEqual(r.availability(now: t, isPlus: true), .ended(at: r.availableUntil!))
        XCTAssertFalse(r.isRedeemable(now: t, isPlus: true), "Plus cannot redeem a closed drop")
        XCTAssertFalse(r.isRedeemable(now: t, isPlus: false))
    }

    func testCloseBoundaryIsExclusive() {
        let r = drop()
        let end = r.availableUntil!
        XCTAssertFalse(r.isRedeemable(now: end, isPlus: false), "closed the instant it ends")
        XCTAssertTrue(r.isRedeemable(now: end.addingTimeInterval(-1), isPlus: false))
    }

    // MARK: Drop with no early access configured

    func testWithoutEarlyAccessPlusGetsNoHeadStart() {
        let r = Reward(id: "d2", name: "D2", brand: "B", icon: "gift.fill",
                       pointCost: 1000, tier: .silver,
                       availableFrom: now.addingTimeInterval(5 * day))
        let t = now.addingTimeInterval(1 * day)
        XCTAssertEqual(r.availability(now: t, isPlus: true), .upcoming(from: r.availableFrom!))
        XCTAssertFalse(r.isRedeemable(now: t, isPlus: true))
    }

    // MARK: The shipped catalog stays coherent

    /// The client no longer ships limited-time drops.
    ///
    /// `rei-15-trail-season` and `patagonia-30-earth` were both `active: false`
    /// on the server, so every redemption was refused — browsable rewards that
    /// could never be bought. They are deleted. Real limited-time behaviour now
    /// lives in partner perks, where `earlyAccessUntil` is enforced server-side.
    ///
    /// The `Reward.Availability` date logic these used to exercise is still
    /// fully covered by the constructed-fixture tests above.
    func testNoInactiveLimitedDropsAreShipped() {
        XCTAssertTrue(SampleData.rewards.filter(\.isLimitedTime).isEmpty,
                      "client must not ship limited-time drops the server refuses")
    }

}
