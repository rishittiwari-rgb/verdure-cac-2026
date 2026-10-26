import XCTest
@testable import Verdure

// MARK: - Analytics
//
// The point of these is that the schema can answer the two questions it was
// designed for, and that nothing user-identifying rides along by accident.

@MainActor
final class AnalyticsTests: XCTestCase {

    override func tearDown() async throws {
        Analytics.isEnabled = true
    }

    // MARK: The two cohort questions must be answerable

    /// Q1: saved → attended within 14 days, split by whether a push arrived.
    func testQ1EventsExist() {
        let required: [Analytics.Event] = [.eventSaved, .eventRSVP, .checkinSucceeded, .pushOpened]
        let names = Set(required.map(\.rawValue))
        XCTAssertEqual(names.count, required.count, "each stage of the funnel is a distinct event")
        XCTAssertTrue(names.contains("event_saved"))
        XCTAssertTrue(names.contains("checkin_succeeded"))
    }

    /// Q2: do planner users return more?
    func testQ2EventsExist() {
        let names = Set([Analytics.Event.plannerOpened, .plannerCompleted, .appOpened].map(\.rawValue))
        XCTAssertTrue(names.contains("planner_completed"), "the Q2 cohort is defined by this event")
        XCTAssertTrue(names.contains("app_opened"), "the Q2 outcome is measured by this event")
    }

    func testEveryEventNameIsSnakeCaseAndStable() {
        // These strings become the keys everything downstream groups by; a
        // rename silently splits a metric in two.
        let all: [Analytics.Event] = [
            .appOpened, .eventSaved, .eventRSVP, .checkinAttempted, .checkinSucceeded,
            .checkinBlocked, .plannerOpened, .plannerCompleted, .plannerQuotaHit,
            .paywallShown, .paywallPurchased, .perkViewed, .perkRedeemed, .perkDismissed,
            .pushOpened, .pushPrimerShown, .pushPrimerAccepted, .rewardRedeemed, .searchPerformed,
        ]
        for e in all {
            XCTAssertEqual(e.rawValue, e.rawValue.lowercased(), "\(e.rawValue) must be lowercase")
            XCTAssertFalse(e.rawValue.contains(" "), "\(e.rawValue) must not contain spaces")
            XCTAssertFalse(e.rawValue.contains("-"), "\(e.rawValue) must use underscores")
        }
        XCTAssertEqual(Set(all.map(\.rawValue)).count, all.count, "no duplicate event names")
    }

    // MARK: Payload hygiene

    func testSanitizeDropsNonPrimitives() {
        let out = Analytics.sanitize([
            "ok": "value", "n": 3, "d": 1.5, "b": true,
            "bad": Date(), "worse": ["nested": 1],
        ])
        XCTAssertEqual(out.count, 4, "only primitives survive")
        XCTAssertNil(out["bad"])
        XCTAssertNil(out["worse"])
    }

    func testSanitizeBoundsLongStrings() {
        let long = String(repeating: "x", count: 5000)
        let out = Analytics.sanitize(["q": long])
        XCTAssertEqual((out["q"] as? String)?.count, 120,
                       "a user-typed search term must not be able to bloat a document")
    }

    func testSanitizeBoundsKeyCountAndLength() {
        var many: [String: Any] = [:]
        for i in 0..<50 { many["k\(i)"] = i }
        XCTAssertLessThanOrEqual(Analytics.sanitize(many).count, 12)

        let longKey = String(repeating: "k", count: 300)
        let out = Analytics.sanitize([longKey: 1])
        XCTAssertEqual(out.keys.first?.count, 40)
    }

    func testSanitizePreservesFalseAndZero() {
        // A dropped `false` would turn "the check-in had no photo" into "we
        // don't know", which is a different and much weaker dataset.
        let out = Analytics.sanitize(["b": false, "n": 0])
        XCTAssertEqual(out["b"] as? Bool, false)
        XCTAssertEqual(out["n"] as? Int, 0)
    }

    // MARK: Identity + opt-out

    func testInstallIDIsStableAcrossReads() {
        let a = Analytics.installID
        let b = Analytics.installID
        XCTAssertEqual(a, b)
        XCTAssertFalse(a.isEmpty)
    }

    func testOptOutRoundTrips() {
        Analytics.isEnabled = false
        XCTAssertFalse(Analytics.isEnabled)
        Analytics.isEnabled = true
        XCTAssertTrue(Analytics.isEnabled)
    }

    func testDayKeyIsUTCAndSortable() {
        // Matches /analytics/{yyyy-mm-dd}; must not shift with the device's zone
        // or the collection would split across two days at the boundary.
        let noon = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertTrue(Analytics.dayKey(noon).count == 10)
        XCTAssertTrue(Analytics.dayKey(noon).hasPrefix("2027-"), Analytics.dayKey(noon))
        let later = Analytics.dayKey(noon.addingTimeInterval(86_400))
        XCTAssertGreaterThan(later, Analytics.dayKey(noon), "keys sort lexicographically by date")
    }
}
