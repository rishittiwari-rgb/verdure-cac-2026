import Foundation

// MARK: - Gamification Engine
//
// Computes challenges and badges from REAL game state (earn history, collection
// sets, level) — nothing hardcoded. GameStateManager.refreshGamification() calls
// back into this after every earn to award challenge XP and persist badge
// unlock dates.

@MainActor
enum GamificationEngine {

    // MARK: - Challenges (monthly windows, progress from earn history)

    private struct ChallengeDef {
        let title: String
        let description: String
        let xpReward: Int
        let icon: String
        /// Counts qualifying earns within the current month.
        let progressCount: (_ monthRecords: [GameStateManager.EarnRecord]) -> Int
        let target: Int
    }

    private static let challengeDefs: [ChallengeDef] = [
        ChallengeDef(title: "Event Regular",
                     description: "Attend 3 events this month",
                     xpReward: 300, icon: "calendar.badge.checkmark",
                     progressCount: { $0.filter { $0.kind == .event }.count },
                     target: 3),
        ChallengeDef(title: "Community Hero",
                     description: "Attend 2 cleanup or volunteer events this month",
                     xpReward: 250, icon: "heart.fill",
                     progressCount: { $0.filter { $0.kind == .event && ($0.category == "Cleanup" || $0.category == "Volunteer") }.count },
                     target: 2),
        ChallengeDef(title: "Social Butterfly",
                     description: "Attend 3 social or meetup events this month",
                     xpReward: 400, icon: "person.2.fill",
                     progressCount: { $0.filter { $0.kind == .event && ($0.category == "Social" || $0.category == "Meetup") }.count },
                     target: 3),
        ChallengeDef(title: "Park Explorer",
                     description: "Collect 3 different parks this month",
                     xpReward: 150, icon: "leaf.fill",
                     progressCount: { records in
                         Set(records.filter { $0.kind == .place && $0.category == "Parks" }.map(\.id)).count
                     },
                     target: 3),
    ]

    /// Live challenges with real progress for the current month.
    static func challenges(for state: GameStateManager, now: Date = Date()) -> [Challenge] {
        let cal = Calendar.current
        let monthRecords = state.earnHistory.filter { cal.isDate($0.date, equalTo: now, toGranularity: .month) }
        let daysLeft = daysRemainingInMonth(now)

        return challengeDefs.map { def in
            let count = def.progressCount(monthRecords)
            return Challenge(
                title: def.title,
                description: def.description,
                xpReward: def.xpReward,
                progress: min(1.0, Double(count) / Double(def.target)),
                icon: def.icon,
                daysRemaining: daysLeft
            )
        }
    }

    private static func daysRemainingInMonth(_ now: Date) -> Int {
        let cal = Calendar.current
        guard let range = cal.range(of: .day, in: .month, for: now) else { return 0 }
        let today = cal.component(.day, from: now)
        return max(0, range.count - today)
    }

    // MARK: - Badges (all-time milestones from real state)

    private struct BadgeDef {
        let name: String
        let icon: String
        let detail: String
        let requirement: String
        let earned: (GameStateManager) -> Bool
    }

    private static let badgeDefs: [BadgeDef] = [
        BadgeDef(name: "First Steps", icon: "shoe.fill",
                 detail: "Your journey began — you collected your very first place.",
                 requirement: "Collect your first place",
                 earned: { $0.totalCollected >= 1 }),
        BadgeDef(name: "Explorer", icon: "binoculars.fill",
                 detail: "A true wanderer — you've collected places across five different categories.",
                 requirement: "Collect places in 5 categories",
                 earned: { state in
                     Set(state.earnHistory.filter { $0.kind == .place }.map(\.category)).count >= 5
                 }),
        BadgeDef(name: "Social Butterfly", icon: "person.2.fill",
                 detail: "You've become part of the community, attending events and meeting fellow explorers.",
                 requirement: "Attend 3 community events",
                 earned: { $0.totalEventsAttended >= 3 }),
        BadgeDef(name: "Trailblazer", icon: "map.fill",
                 detail: "You've hiked and collected three different trails.",
                 requirement: "Collect 3 trails",
                 earned: { state in
                     Set(state.earnHistory.filter { $0.kind == .place && $0.category == "Trails" }.map(\.id)).count >= 3
                 }),
        BadgeDef(name: "Event Regular", icon: "calendar.badge.checkmark",
                 detail: "Awarded to dedicated attendees who show up again and again.",
                 requirement: "Attend 10 events total",
                 earned: { $0.totalEventsAttended >= 10 }),
        BadgeDef(name: "Legend", icon: "crown.fill",
                 detail: "The highest honor in Verdure — reach level 10 and collect a Legendary place.",
                 requirement: "Reach level 10 + a Legendary find",
                 earned: { state in
                     state.level >= 10 &&
                     state.earnHistory.contains { $0.kind == .place && $0.rarity == PlaceRarity.legendary.rawValue }
                 }),
    ]

    private static let unlockDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMMM d, yyyy"
        return f
    }()

    /// All badges with live earned state; unlock dates come from the persisted
    /// record in GameStateManager (stable across launches).
    static func badges(for state: GameStateManager) -> [Badge] {
        badgeDefs.map { def in
            let isEarned = def.earned(state)
            let date = state.earnedBadges[def.name].map { unlockDateFormatter.string(from: $0) }
            return Badge(name: def.name, icon: def.icon, earned: isEarned,
                         detail: def.detail, requirement: def.requirement,
                         earnedDate: isEarned ? date : nil)
        }
    }
}
