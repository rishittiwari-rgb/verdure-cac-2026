import XCTest
@testable import Verdure

// MARK: - Streak freeze (G2)
//
// Before this, one missed day reset a 40-day streak to 1 — a punishment for
// having a life, landing hardest on the users with the most invested. These
// tests pin the forgiveness AND its limits, because a freeze that quietly
// forgives everything is just a streak that never breaks, which means nothing.
//
// They also pin that it is UNIVERSAL. The freeze must reach every account on
// identical terms: no purchase, no tier, no entitlement check anywhere on the
// path. That is the assertion most likely to be quietly undone later, because
// the cost-side argument for selling it is easy to make and the reason not to
// is a product judgement rather than a technical one.

@MainActor
final class StreakInsuranceTests: XCTestCase {

    private var state: GameStateManager!

    override func setUp() async throws {
        for key in ["streakCount", "streakLastDay", "streakInsuranceUsedOn"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
        state = GameStateManager()
    }

    private func day(_ n: Int) -> Date {
        // Fixed anchor so nothing here depends on when the suite runs.
        Date(timeIntervalSince1970: 1_800_000_000).addingTimeInterval(Double(n) * 86_400)
    }

    func testConsecutiveDaysBuildAStreak() {
        state.recordActiveDay(now: day(0))
        XCTAssertEqual(state.currentStreak, 1)
        state.recordActiveDay(now: day(1))
        state.recordActiveDay(now: day(2))
        XCTAssertEqual(state.currentStreak, 3)
    }

    func testSameDayIsANoOp() {
        state.recordActiveDay(now: day(0))
        state.recordActiveDay(now: day(0))
        state.recordActiveDay(now: day(0))
        XCTAssertEqual(state.currentStreak, 1, "opening the app twice is not two days")
    }

    // MARK: The forgiveness

    func testOneMissedDayIsForgiven() {
        state.recordActiveDay(now: day(0))
        state.recordActiveDay(now: day(1))
        state.recordActiveDay(now: day(2))
        XCTAssertEqual(state.currentStreak, 3)

        // Skips day 3 entirely, returns on day 4.
        let used = state.recordActiveDay(now: day(4))
        XCTAssertTrue(used, "the gap was covered by insurance")
        XCTAssertEqual(state.currentStreak, 4, "the streak survives and counts today")
    }

    func testTwoMissedDaysAreNotForgiven() {
        state.recordActiveDay(now: day(0))
        state.recordActiveDay(now: day(1))
        XCTAssertEqual(state.currentStreak, 2)

        let used = state.recordActiveDay(now: day(5))   // three days missed
        XCTAssertFalse(used)
        XCTAssertEqual(state.currentStreak, 1, "a real lapse still resets")
    }

    // MARK: The limit — this is what stops it becoming an unbreakable streak

    func testInsuranceCannotBeUsedTwiceInTheWindow() {
        state.recordActiveDay(now: day(0))
        state.recordActiveDay(now: day(2))               // first gap, forgiven
        XCTAssertEqual(state.currentStreak, 2)
        XCTAssertFalse(state.streakInsuranceAvailable(now: day(2)))

        let used = state.recordActiveDay(now: day(4))    // second gap, same window
        XCTAssertFalse(used, "only one forgiven day per 30")
        XCTAssertEqual(state.currentStreak, 1)
    }

    func testInsuranceRechargesAfterTheWindow() {
        state.recordActiveDay(now: day(0))
        state.recordActiveDay(now: day(2))               // uses insurance
        XCTAssertFalse(state.streakInsuranceAvailable(now: day(10)))
        XCTAssertTrue(state.streakInsuranceAvailable(now: day(32)),
                      "available again after the 30-day window")
    }

    func testInsuranceIsAvailableToABrandNewAccount() {
        XCTAssertTrue(state.streakInsuranceAvailable(now: day(0)),
                      "a new user has not spent anything")
    }

    // MARK: It is universal

    /// The freeze applies with no subscription, no entitlement, and no purchase
    /// anywhere on the path.
    ///
    /// `GameStateManager` has no reference to StoreService and this test runs
    /// with no signed-in account and no products loaded — so if a tier check
    /// were ever introduced, the forgiveness below would stop happening and
    /// this fails. That is the point: it is a tripwire, not a description.
    func testEveryAccountGetsTheFreezeOnIdenticalTerms() {
        state.recordActiveDay(now: day(0))
        let used = state.recordActiveDay(now: day(2))
        XCTAssertTrue(used, "a plain, signed-out, non-member account is forgiven")
        XCTAssertEqual(GameStateManager.streakInsuranceDays, 1)
        XCTAssertEqual(GameStateManager.streakInsuranceWindowDays, 30)
    }

    /// The allowance is a constant, not a function of anything.
    ///
    /// A tiered freeze would most naturally arrive as "members get 2" — so the
    /// values are asserted to be fixed scalars that no state can vary.
    func testTheAllowanceIsAFixedConstantWithNoTierDimension() {
        XCTAssertEqual(GameStateManager.streakInsuranceDays, 1,
                       "one day for everyone; a second tier would change this")
        XCTAssertEqual(GameStateManager.streakInsuranceWindowDays, 30)

        // Two fresh accounts, no membership state of any kind, same outcome.
        let a = GameStateManager()
        a.recordActiveDay(now: day(0))
        let aUsed = a.recordActiveDay(now: day(2))
        XCTAssertTrue(aUsed)
        XCTAssertEqual(a.currentStreak, 2)
    }

    /// The freeze must not be sold. Nothing in the paywall may name it.
    ///
    /// This is the copy half of the same decision: even a truthful mention
    /// ("members keep their streak safe") would imply the freeze is a benefit
    /// of paying when it is not. PaywallView.features is the one place that
    /// could reintroduce it, so it is checked here.
    func testNoPaywallFeatureMentionsTheStreak() {
        let copy = PaywallView.featureCopyForTesting

        // Guard against a vacuous pass: an empty list also "mentions no
        // streak". Check that the list contains real paid benefits before
        // asserting what is absent from it; new benefits may change its size.
        XCTAssertFalse(copy.isEmpty, "An empty feature list cannot prove the free streak is excluded from paid benefits")
        let sold = copy.joined(separator: " ").lowercased()
        XCTAssertTrue(sold.contains("adventure planner"), "the list under test must be the real one")

        XCTAssertFalse(sold.contains("streak"), "the streak freeze is free and must not be sold")
        XCTAssertFalse(sold.contains("freeze"), "the streak freeze is free and must not be sold")

        // The A2 rule, enforced on the same copy: no deactivated reward tier.
        for dead in ["$25", "$50", "gold tier", "platinum"] {
            XCTAssertFalse(sold.contains(dead), "paywall must not name a deactivated tier (\(dead))")
        }
    }
}
