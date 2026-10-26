import XCTest
@testable import Verdure

// MARK: - Advanced stats
//
// Every number here comes from real earn history, so the tests that matter most
// are the ones proving nothing is invented: empty history yields empty stats,
// and a corrupt future-dated record cannot manufacture a best day.

final class PersonalStatsTests: XCTestCase {

    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func ago(_ days: Double) -> Date { now.addingTimeInterval(-days * 86_400) }

    private func rec(_ kind: GameStateManager.EarnRecord.Kind, _ category: String,
                     _ points: Int, _ date: Date) -> GameStateManager.EarnRecord {
        .init(kind: kind, id: UUID().uuidString, category: category,
              rarity: nil, points: points, date: date)
    }

    func testEmptyHistoryProducesEmptyStats() {
        let s = PersonalStats.compute(from: [], now: now)
        XCTAssertTrue(s.isEmpty)
        XCTAssertEqual(s.totalPoints, 0)
        XCTAssertNil(s.bestDay, "no history means no best day, not a zero-point one")
        XCTAssertTrue(s.byCategory.isEmpty)
    }

    func testTotalsCountEventsAndPlacesSeparately() {
        let s = PersonalStats.compute(from: [
            rec(.event, "Cleanup", 100, ago(1)),
            rec(.event, "Market", 75, ago(2)),
            rec(.place, "Parks", 25, ago(3)),
        ], now: now)
        XCTAssertEqual(s.totalPoints, 200)
        XCTAssertEqual(s.totalEvents, 2)
        XCTAssertEqual(s.totalPlaces, 1)
        XCTAssertFalse(s.isEmpty)
    }

    func testWindowsAreExclusiveOfOlderRecords() {
        let s = PersonalStats.compute(from: [
            rec(.event, "Cleanup", 100, ago(1)),     // in 7 and 30
            rec(.event, "Cleanup", 50, ago(10)),     // in 30 only
            rec(.event, "Cleanup", 999, ago(90)),    // in neither
        ], now: now)
        XCTAssertEqual(s.last7Days, 100)
        XCTAssertEqual(s.last30Days, 150)
        XCTAssertEqual(s.totalPoints, 1149, "lifetime still counts everything")
    }

    func testCategoriesAreRankedByPointsNotCount() {
        let s = PersonalStats.compute(from: [
            rec(.place, "Parks", 10, ago(1)),
            rec(.place, "Parks", 10, ago(2)),
            rec(.place, "Parks", 10, ago(3)),
            rec(.event, "Festival", 250, ago(1)),
        ], now: now)
        XCTAssertEqual(s.byCategory.first?.category, "Festival",
                       "one big earn outranks three small ones")
        XCTAssertEqual(s.byCategory.first?.points, 250)
        XCTAssertEqual(s.byCategory.last?.count, 3)
    }

    func testActiveDaysCountsDistinctDaysNotRecords() {
        let day = ago(3)
        let s = PersonalStats.compute(from: [
            rec(.event, "Cleanup", 50, day),
            rec(.place, "Parks", 10, day.addingTimeInterval(3600)),
            rec(.place, "Parks", 10, ago(5)),
        ], now: now)
        XCTAssertEqual(s.activeDaysLast30, 2, "three earns across two days")
    }

    func testBestDaySumsThatDaysEarns() {
        let big = ago(4)
        let s = PersonalStats.compute(from: [
            rec(.event, "Festival", 100, big),
            rec(.event, "Market", 75, big.addingTimeInterval(7200)),
            rec(.event, "Cleanup", 120, ago(9)),
        ], now: now)
        XCTAssertEqual(s.bestDay?.points, 175, "the two-earn day beats the single 120")
    }

    func testAverageIsPerActiveDayNotPerCalendarDay() {
        let s = PersonalStats.compute(from: [
            rec(.event, "Cleanup", 100, ago(2)),
            rec(.event, "Cleanup", 200, ago(4)),
        ], now: now)
        // 300 over 2 active days = 150. Dividing by 30 would report 10 and make
        // an engaged user look inactive.
        XCTAssertEqual(s.averagePerActiveDay, 150)
    }

    // MARK: Corrupt input

    func testFutureDatedRecordsCannotManufactureABestDay() {
        // Arises from a clock change or a restored backup.
        let s = PersonalStats.compute(from: [
            rec(.event, "Festival", 5000, now.addingTimeInterval(86_400 * 5)),
            rec(.event, "Cleanup", 50, ago(2)),
        ], now: now)
        XCTAssertEqual(s.bestDay?.points, 50, "a future record is excluded from the windows")
        XCTAssertEqual(s.last30Days, 50)
        XCTAssertEqual(s.totalPoints, 5050, "but it is not silently erased from lifetime totals")
    }

    func testZeroPointRecordsDoNotCreatePhantomActiveDays() {
        let s = PersonalStats.compute(from: [rec(.place, "Parks", 0, ago(1))], now: now)
        XCTAssertEqual(s.activeDaysLast30, 1, "a zero-point earn is still an active day")
        XCTAssertEqual(s.averagePerActiveDay, 0, "and does not divide by zero")
    }
}
