import Foundation

// MARK: - Advanced stats (G3)
//
// Computed from the REAL persisted earn history (GameStateManager.earnHistory),
// which records every point actually earned with its category, kind and date.
// Nothing here is estimated, extrapolated or seeded — if the history is empty
// the stats are empty, and the UI says so rather than inventing a trend.
//
// Pure and value-typed on purpose: every number below is asserted in
// PersonalStatsTests without a simulator, a network, or a signed-in account.

struct PersonalStats: Equatable {

    struct CategoryCount: Equatable, Identifiable {
        let category: String
        let count: Int
        let points: Int
        var id: String { category }
    }

    var totalPoints: Int = 0
    var totalEvents: Int = 0
    var totalPlaces: Int = 0

    /// Descending by points. Ties broken by name so the order is stable.
    var byCategory: [CategoryCount] = []

    /// Points earned in the trailing 7 and 30 days.
    var last7Days: Int = 0
    var last30Days: Int = 0

    /// Calendar days with at least one earn, in the last 30.
    var activeDaysLast30: Int = 0

    /// The single best day, as (day, points). Nil when there is no history.
    var bestDay: (day: Date, points: Int)?

    /// Mean points per active day, last 30. Zero when there were none.
    var averagePerActiveDay: Int = 0

    var isEmpty: Bool { totalEvents == 0 && totalPlaces == 0 }

    static func == (a: PersonalStats, b: PersonalStats) -> Bool {
        a.totalPoints == b.totalPoints && a.totalEvents == b.totalEvents
            && a.totalPlaces == b.totalPlaces && a.byCategory == b.byCategory
            && a.last7Days == b.last7Days && a.last30Days == b.last30Days
            && a.activeDaysLast30 == b.activeDaysLast30
            && a.averagePerActiveDay == b.averagePerActiveDay
            && a.bestDay?.points == b.bestDay?.points
    }

    /// Build stats from history.
    ///
    /// `now` is injected so the windows are testable at a fixed instant instead
    /// of depending on when the suite happens to run.
    static func compute(from history: [GameStateManager.EarnRecord],
                        now: Date = Date(),
                        calendar: Calendar = .current) -> PersonalStats {
        var stats = PersonalStats()
        guard !history.isEmpty else { return stats }

        let day7 = now.addingTimeInterval(-7 * 86_400)
        let day30 = now.addingTimeInterval(-30 * 86_400)

        var catPoints: [String: Int] = [:]
        var catCounts: [String: Int] = [:]
        var pointsByDay: [Date: Int] = [:]

        for r in history {
            // A record dated in the future is corrupt (clock change, bad
            // restore). Counted in totals but excluded from the windows, so it
            // cannot manufacture a streak or a "best day" that never happened.
            stats.totalPoints += r.points
            switch r.kind {
            case .event: stats.totalEvents += 1
            case .place: stats.totalPlaces += 1
            }
            catPoints[r.category, default: 0] += r.points
            catCounts[r.category, default: 0] += 1

            guard r.date <= now else { continue }
            if r.date >= day7 { stats.last7Days += r.points }
            if r.date >= day30 {
                stats.last30Days += r.points
                let d = calendar.startOfDay(for: r.date)
                pointsByDay[d, default: 0] += r.points
            }
        }

        stats.byCategory = catPoints.keys.map {
            CategoryCount(category: $0, count: catCounts[$0] ?? 0, points: catPoints[$0] ?? 0)
        }.sorted { ($0.points, $1.category) > ($1.points, $0.category) }

        stats.activeDaysLast30 = pointsByDay.count
        if let best = pointsByDay.max(by: { ($0.value, $1.key) < ($1.value, $0.key) }) {
            stats.bestDay = (best.key, best.value)
        }
        stats.averagePerActiveDay = pointsByDay.isEmpty
            ? 0 : stats.last30Days / pointsByDay.count

        return stats
    }
}
