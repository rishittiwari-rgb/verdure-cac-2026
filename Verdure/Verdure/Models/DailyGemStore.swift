import Foundation

// MARK: - Daily Gem Store
//
// Owns WHICH fact shows and WHEN the once-a-day splash appears:
//  • One fact per calendar day, chosen once and stable for that whole day
//    (re-opening the gem from Explore shows the same fact, never a second one).
//  • The auto-splash fires only on the FIRST open of the app each day.
//  • A fact never repeats across days until every fact in the pool has been
//    seen — then the pool recycles.

@MainActor
enum DailyGemStore {

    private static let splashDayKey = "dailyGem.splashDay"   // last day the splash auto-showed
    private static let indexDayKey  = "dailyGem.indexDay"    // day the current fact was chosen
    private static let indexKey     = "dailyGem.todayIndex"  // index of today's fact
    private static let seenKey      = "dailyGem.seenIndices" // indices shown since last recycle

    static func dayString(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = Calendar.current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// Today's fact — picked once per day from the not-yet-seen pool.
    static var todaysFact: GemFact {
        let facts = SampleData.gemFacts
        guard !facts.isEmpty else {
            return GemFact(kind: "Did you know", icon: "leaf.fill",
                           text: "Step outside today — your neighborhood is waiting.",
                           accent: .spruce)
        }

        let defaults = UserDefaults.standard
        let today = dayString()

        // Already chosen today → return the same fact (stable for the day).
        if defaults.string(forKey: indexDayKey) == today {
            let i = defaults.integer(forKey: indexKey)
            if facts.indices.contains(i) { return facts[i] }
        }

        // New day → pick an unseen fact; recycle the pool once exhausted.
        var seen = Set(defaults.array(forKey: seenKey) as? [Int] ?? [])
        seen.formIntersection(Set(facts.indices))            // drop stale indices if the pool shrank
        var unseen = facts.indices.filter { !seen.contains($0) }
        if unseen.isEmpty {
            seen = []
            unseen = Array(facts.indices)
        }

        let choice = unseen.randomElement() ?? 0
        seen.insert(choice)
        defaults.set(Array(seen), forKey: seenKey)
        defaults.set(choice, forKey: indexKey)
        defaults.set(today, forKey: indexDayKey)
        return facts[choice]
    }

    /// True when the once-a-day splash hasn't been shown yet today.
    static var shouldShowSplash: Bool {
        UserDefaults.standard.string(forKey: splashDayKey) != dayString()
    }

    static func markSplashShown() {
        UserDefaults.standard.set(dayString(), forKey: splashDayKey)
    }
}
