import XCTest
import CoreLocation
@testable import Verdure

// MARK: - Gamification smoke tests: streaks, challenges, badges
//
// Simulated confirmed server replies populate earn history. These units verify
// derived challenges and badges, not network attendance or physical GPS.

@MainActor
final class GamificationTests: XCTestCase {

    private let keys = [
        "collectedPlaceIDs", "checkedInEventIDs", "pointsBalance", "lifetimePoints",
        "redeemedRewardIDs", "savedEventIDs", "savedPlaceIDs", "pendingServerOps",
        "earnHistory", "streakCount", "streakLastDay", "challengeBonusXP",
        "completedChallengeKeys", "earnedBadges", "notificationInbox",
    ]

    override func setUp() async throws { wipe() }
    override func tearDown() async throws { wipe() }

    private func wipe() {
        for key in keys { UserDefaults.standard.removeObject(forKey: key) }
        UserDefaults.standard.set(true, forKey: "gameStateSeeded_v2")
    }

    private func freshManager() -> GameStateManager { GameStateManager() }

    private func event(_ id: String, _ category: EventCategory) -> Event {
        Event(id: id, title: id, organizer: "t", date: Date(), time: "9",
              locationName: "t", attendeeCount: 0, maxAttendees: nil,
              category: category, imagePlaceholder: "x", pointValue: category.defaultPoints)
    }

    private func place(_ id: String, _ category: PlaceCategory, rarity: PlaceRarity = .common) -> CollectiblePlace {
        CollectiblePlace(
            id: id,
            place: Place(id: id, name: id, category: category, shortDescription: "",
                         distance: "0", distanceValue: 0, rating: nil, reviewCount: nil,
                         imagePlaceholder: "x", accentColor: .green, isFeatured: false),
            rarity: rarity,
            coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0))
    }

    // MARK: Streak

    func testStreakCountsConsecutiveDaysAndResetsAfterGap() {
        let state = freshManager()
        let cal = Calendar.current
        let day1 = cal.date(byAdding: .day, value: -5, to: Date())!
        let day2 = cal.date(byAdding: .day, value: -4, to: Date())!

        state.recordActiveDay(now: day1)
        XCTAssertEqual(state.currentStreak, 1, "first open starts the streak")
        state.recordActiveDay(now: day1)
        XCTAssertEqual(state.currentStreak, 1, "same-day opens don't double-count")
        state.recordActiveDay(now: day2)
        XCTAssertEqual(state.currentStreak, 2, "consecutive day increments")
        state.recordActiveDay(now: Date())   // 4-day gap
        XCTAssertEqual(state.currentStreak, 1, "a gap resets the streak")
    }

    // MARK: Challenges

    func testEventRegularChallengeTracksMonthlyEvents() {
        let state = freshManager()
        _ = state.acceptAttendanceForTesting(event("e1", .social))
        _ = state.acceptAttendanceForTesting(event("e2", .workshop))

        let challenge = GamificationEngine.challenges(for: state)
            .first { $0.title == "Event Regular" }!

        XCTAssertEqual(challenge.progress, 2.0 / 3.0, accuracy: 0.001,
                       "two events of three this month")
    }

    func testCommunityHeroCompletionAwardsBonusXPOnce() {
        let state = freshManager()
        let base = state.totalXP
        _ = state.acceptAttendanceForTesting(event("c1", .cleanup))
        _ = state.acceptAttendanceForTesting(event("c2", .volunteer))

        let hero = GamificationEngine.challenges(for: state).first { $0.title == "Community Hero" }!
        XCTAssertEqual(hero.progress, 1.0, "2 cleanup/volunteer events completes it")
        // 2 events × 200 pts = 400 pts → 800 XP, plus the one-time 250 XP bonus.
        XCTAssertEqual(state.totalXP, base + 800 + 250, "completion bonus granted exactly once")

        // Third event ALSO completes "Event Regular" (3 events/month) → +300 more.
        _ = state.acceptAttendanceForTesting(event("c3", .cleanup))
        var bonus = state.totalXP - (base + 1200)   // 3 events × 400 XP from points
        XCTAssertEqual(bonus, 250 + 300, "Event Regular completion adds its own one-time bonus")

        // A fourth event completes nothing new — no bonus re-award this month.
        _ = state.acceptAttendanceForTesting(event("c4", .cleanup))
        bonus = state.totalXP - (base + 1600)
        XCTAssertEqual(bonus, 550, "no double bonuses within the same month")
    }

    // MARK: Badges

    func testBadgesUnlockFromRealActivity() {
        let state = freshManager()
        XCTAssertFalse(GamificationEngine.badges(for: state).first { $0.name == "First Steps" }!.earned)

        _ = state.collectPlace(place("p1", .parks))
        XCTAssertTrue(GamificationEngine.badges(for: state).first { $0.name == "First Steps" }!.earned,
                      "first collect unlocks First Steps")

        _ = state.acceptAttendanceForTesting(event("s1", .social))
        _ = state.acceptAttendanceForTesting(event("s2", .social))
        XCTAssertFalse(GamificationEngine.badges(for: state).first { $0.name == "Social Butterfly" }!.earned)
        _ = state.acceptAttendanceForTesting(event("s3", .social))
        XCTAssertTrue(GamificationEngine.badges(for: state).first { $0.name == "Social Butterfly" }!.earned,
                      "third event unlocks Social Butterfly")
    }

    func testExplorerBadgeNeedsFiveCategories() {
        let state = freshManager()
        _ = state.collectPlace(place("a", .parks))
        _ = state.collectPlace(place("b", .trails))
        _ = state.collectPlace(place("c", .gardens))
        _ = state.collectPlace(place("d", .waterfront))
        XCTAssertFalse(GamificationEngine.badges(for: state).first { $0.name == "Explorer" }!.earned)
        _ = state.collectPlace(place("e", .scenic))
        XCTAssertTrue(GamificationEngine.badges(for: state).first { $0.name == "Explorer" }!.earned)
    }

    func testBadgeUnlockDatePersistsAcrossManagers() {
        let first = freshManager()
        _ = first.collectPlace(place("p1", .parks))
        XCTAssertNotNil(first.earnedBadges["First Steps"], "unlock date recorded")

        let second = GameStateManager()
        XCTAssertNotNil(second.earnedBadges["First Steps"], "unlock date survives relaunch")
    }
}
