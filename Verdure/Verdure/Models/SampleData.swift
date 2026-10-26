import Foundation
import SwiftUI
import CoreLocation

// MARK: - Sample Data (QA fixtures ONLY — never shown in a shipping build)
//
// HONEST-DATA POLICY. A fabricated park or event that a user can collect or
// check in to is the same failure as a fabricated rating: it awards points for
// something that does not exist. So:
//
//   1. Sample places/events/posts are injected ONLY when `isEnabled` is true,
//      which requires a DEBUG build *and* the `-QAOfflineData YES` launch
//      argument the UI-test harness passes (see QAData). In a Release build the
//      branch is compiled out — there is no code path that shows them.
//   2. Even under the QA harness, `GameStateManager` refuses to check in to or
//      collect anything whose id is a sample id (`isSample(id:)`), so no
//      fabricated place or event is collectible under any code path.
//   3. Live screens show honest empty states instead (see EmptyStateCard).
//
// `gemFacts` is curated copy, not fabricated content, and is unaffected by
// `isEnabled`.
//
// `rewards` is a DEBUG-ONLY OFFLINE FALLBACK. It is deliberately no longer
// described as "mirrored by the server": that claim was false, nothing enforced
// it, and it is precisely why a 35x pricing drift survived review. The server
// catalog is authoritative and a parity test now enforces the arithmetic.

enum SampleData {

    /// True only for the DEBUG UI-test/screenshot harness. Release: always false.
    ///
    /// Reads the launch flag directly rather than via `QAData.offline`: QAData is
    /// @MainActor, and this is a nonisolated static used from nonisolated
    /// contexts, so going through it does not compile. Same flag, same value.
    static var isEnabled: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: "QAOfflineData")
        #else
        return false
        #endif
    }

    /// Every id that belongs to fixture content. Checked at the earn boundary.
    static let sampleIDs: Set<String> = {
        var ids = Set<String>()
        for p in places { ids.insert(p.id) }
        for e in events { ids.insert(e.id) }
        for c in collectiblePlaces { ids.insert(c.id) }
        return ids
    }()

    static func isSample(id: String) -> Bool { sampleIDs.contains(id) }

    // MARK: Places

    static let places: [Place] = [
        Place(id: "riverside-park", name: "Riverside Park", category: .parks, shortDescription: "A sprawling green space along the river with walking paths and picnic areas.", distance: "0.3 mi", distanceValue: 0.3, rating: 4.8, reviewCount: 124, imagePlaceholder: "leaf.fill", accentColor: .verdureGreen, isFeatured: true, latitude: 44.9808, longitude: -93.261),
        Place(id: "hawk-ridge-trail", name: "Hawk Ridge Trail", category: .trails, shortDescription: "Moderate 2.4-mile loop with panoramic views of the valley.", distance: "1.2 mi", distanceValue: 1.2, rating: 4.6, reviewCount: 89, imagePlaceholder: "figure.hiking", accentColor: .accentAmber, isFeatured: false, latitude: 44.9928, longitude: -93.273),
        Place(id: "botanica-gardens", name: "Botanica Gardens", category: .gardens, shortDescription: "Community-maintained botanical garden with 200+ plant species.", distance: "0.8 mi", distanceValue: 0.8, rating: 4.9, reviewCount: 201, imagePlaceholder: "camera.macro", accentColor: .accentCoral, isFeatured: true, latitude: 44.9718, longitude: -93.255),
        Place(id: "lakeshore-playground", name: "Lakeshore Playground", category: .playgrounds, shortDescription: "Modern playground with climbing structures and splash pad.", distance: "0.5 mi", distanceValue: 0.5, rating: 4.4, reviewCount: 67, imagePlaceholder: "figure.play", accentColor: .accentSky, isFeatured: false, latitude: 44.9828, longitude: -93.27),
        Place(id: "marina-point", name: "Marina Point", category: .waterfront, shortDescription: "Scenic waterfront with kayak rentals and sunset viewing deck.", distance: "2.1 mi", distanceValue: 2.1, rating: 4.7, reviewCount: 156, imagePlaceholder: "water.waves", accentColor: .accentSky, isFeatured: true, latitude: 44.9578, longitude: -93.247),
        Place(id: "cedar-court-complex", name: "Cedar Court Complex", category: .sports, shortDescription: "Public courts for basketball, tennis, and pickleball.", distance: "0.6 mi", distanceValue: 0.6, rating: 4.3, reviewCount: 45, imagePlaceholder: "sportscourt.fill", accentColor: .accentCoral, isFeatured: false, latitude: 44.9858, longitude: -93.263),
        Place(id: "overlook-bluff", name: "Overlook Bluff", category: .scenic, shortDescription: "The highest point in the county with 360° views.", distance: "3.4 mi", distanceValue: 3.4, rating: 4.9, reviewCount: 312, imagePlaceholder: "mountain.2.fill", accentColor: .accentLavender, isFeatured: true, latitude: 45.0028, longitude: -93.287),
        Place(id: "the-commons", name: "The Commons", category: .community, shortDescription: "Outdoor gathering space hosting weekly farmers markets.", distance: "0.2 mi", distanceValue: 0.2, rating: 4.5, reviewCount: 98, imagePlaceholder: "person.3.fill", accentColor: .accentMint, isFeatured: false, latitude: 44.9758, longitude: -93.268),
    ]

    // MARK: Events (primary points source)

    /// One clearly labeled, free fixture in the current weekend lets the
    /// offline UI harness exercise a populated Plan card on any weekday.
    private static var weekendFixtureDate: Date {
        let now = Date()
        let weekend = DateRangeOption.thisWeekend.window(now: now)!
        let saturdayMorning = Calendar.current.date(byAdding: .hour, value: 11,
                                                     to: Calendar.current.startOfDay(for: weekend.start))!
        return max(saturdayMorning, now.addingTimeInterval(2 * 3600))
    }

    static let events: [Event] = [
        Event(id: "qa-weekend-garden-walk", title: "QA Weekend Garden Walk",
              organizer: "QA Fixture — Not a real listing", date: weekendFixtureDate,
              time: weekendFixtureDate.formatted(date: .omitted, time: .shortened),
              locationName: "Sample Garden (QA only)", attendeeCount: 0, maxAttendees: 20,
              category: .workshop, imagePlaceholder: "leaf.fill", pointValue: 0,
              description: "Offline interface fixture. No public event or check-in exists.",
              latitude: 44.9808, longitude: -93.261, isFree: true),
        Event(id: "spring-hackathon", title: "Spring Community Hackathon", organizer: "Local Dev Collective", date: Calendar.current.date(byAdding: .day, value: 2, to: .now)!, time: "9:00 AM – 9:00 PM", locationName: "Downtown Library", attendeeCount: 42, maxAttendees: 80, category: .hackathon, imagePlaceholder: "laptopcomputer", pointValue: 200, description: "Build something that helps our community in 12 hours. All skill levels welcome — designers, developers, and idea people.", latitude: 44.979, longitude: -93.268),
        Event(id: "river-cleanup-day", title: "River Cleanup Day", organizer: "Green Community Alliance", date: Calendar.current.date(byAdding: .day, value: 3, to: .now)!, time: "9:00 AM – 12:00 PM", locationName: "Riverside Park", attendeeCount: 34, maxAttendees: 50, category: .volunteer, imagePlaceholder: "heart.fill", pointValue: 200, description: "Help us clean up the riverbank! Gloves and bags provided.", latitude: 44.9808, longitude: -93.261),
        Event(id: "tech-meetup", title: "iOS Developers Meetup", organizer: "Swift User Group", date: Calendar.current.date(byAdding: .day, value: 4, to: .now)!, time: "6:30 PM – 8:30 PM", locationName: "The Commons", attendeeCount: 28, maxAttendees: 40, category: .meetup, imagePlaceholder: "person.3.fill", pointValue: 100, description: "Monthly meetup for iOS developers. This month: SwiftUI animations deep dive.", latitude: 44.9758, longitude: -93.268),
        Event(id: "weekend-farmers-market", title: "Weekend Farmers Market", organizer: "Local Growers Collective", date: Calendar.current.date(byAdding: .day, value: 5, to: .now)!, time: "8:00 AM – 1:00 PM", locationName: "The Commons", attendeeCount: 120, maxAttendees: nil, category: .market, imagePlaceholder: "bag.fill", pointValue: 75, description: "Fresh produce, baked goods, and handmade crafts from local vendors.", latitude: 44.9758, longitude: -93.268),
        Event(id: "nature-photo-walk", title: "Nature Photography Walk", organizer: "Shutter Club", date: Calendar.current.date(byAdding: .day, value: 6, to: .now)!, time: "7:00 AM – 9:00 AM", locationName: "Hawk Ridge Trail", attendeeCount: 12, maxAttendees: 20, category: .workshop, imagePlaceholder: "camera.fill", pointValue: 150, description: "Learn landscape photography basics on a guided trail walk. Bring your own camera or phone.", latitude: 44.9928, longitude: -93.273),
        Event(id: "neighborhood-social", title: "Neighborhood Block Party", organizer: "Maplewood Neighbors", date: Calendar.current.date(byAdding: .day, value: 7, to: .now)!, time: "4:00 PM – 8:00 PM", locationName: "Cedar Court Complex", attendeeCount: 65, maxAttendees: nil, category: .social, imagePlaceholder: "cup.and.saucer.fill", pointValue: 100, description: "Food, games, and live music. Meet your neighbors!", latitude: 44.9858, longitude: -93.263),
        Event(id: "food-drive", title: "Community Food Drive", organizer: "Helping Hands Foundation", date: Calendar.current.date(byAdding: .day, value: 8, to: .now)!, time: "10:00 AM – 3:00 PM", locationName: "Riverside Park", attendeeCount: 22, maxAttendees: nil, category: .volunteer, imagePlaceholder: "heart.fill", pointValue: 200, description: "Collecting non-perishable food items for local families in need.", latitude: 44.9808, longitude: -93.261),
        Event(id: "spring-festival", title: "Spring Community Festival", organizer: "City of Maplewood", date: Calendar.current.date(byAdding: .day, value: 10, to: .now)!, time: "11:00 AM – 8:00 PM", locationName: "Riverside Park", attendeeCount: 230, maxAttendees: nil, category: .festival, imagePlaceholder: "party.popper.fill", pointValue: 250, description: "Annual spring celebration with live performances, food trucks, and activities for all ages.", latitude: 44.9808, longitude: -93.261),
    ]

    // MARK: Challenges

    /// W5 fixture for `-QAFeedReasons YES`: server-shaped ranked rows (reasons
    /// ≤ 3, ISO dates already parsed) keyed by sample event id. The strings
    /// mirror what `functions/src/ranking-v2.ts` writes; nothing here is shown
    /// outside the DEBUG QA harness.
    static let feedReasons: [String: RankedFeedEvent] = {
        let day: TimeInterval = 86_400
        let rows = [
            RankedFeedEvent(id: "spring-hackathon", score: 0.91,
                            reasons: ["Matches your interest in tech", "Close by (0.8 mi)", "Repeats — 2 more dates"],
                            moreDates: [Date().addingTimeInterval(9 * day), Date().addingTimeInterval(16 * day)]),
            RankedFeedEvent(id: "river-cleanup-day", score: 0.84,
                            reasons: ["A friend is going", "This weekend", "Free"]),
            RankedFeedEvent(id: "tech-meetup", score: 0.77,
                            reasons: ["Similar to events you've saved"]),
            RankedFeedEvent(id: "weekend-farmers-market", score: 0.65),
        ]
        return Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }()

    static let challenges: [Challenge] = [
        Challenge(title: "Event Regular", description: "Attend 3 events this month", xpReward: 300, progress: 0.33, icon: "calendar.badge.checkmark", daysRemaining: 12),
        Challenge(title: "Community Hero", description: "Attend 2 cleanup events", xpReward: 250, progress: 0.5, icon: "heart.fill", daysRemaining: 18),
        Challenge(title: "Social Butterfly", description: "Attend 5 social events", xpReward: 400, progress: 0.2, icon: "person.2.fill", daysRemaining: 25),
        Challenge(title: "Park Explorer", description: "Visit 5 different parks", xpReward: 150, progress: 0.6, icon: "leaf.fill", daysRemaining: 9),
    ]

    // MARK: Community Posts

    static let communityPosts: [CommunityPost] = [
        CommunityPost(authorName: "Maya Chen", authorInitials: "MC", placeName: "Botanica Gardens", content: "The new butterfly pavilion is incredible! Spent two hours just watching them. Highly recommend visiting in the morning when it's quieter.", timeAgo: "2h ago", likeCount: 24, commentCount: 6, imagePlaceholder: "photo.fill"),
        CommunityPost(authorName: "Jordan Ellis", authorInitials: "JE", placeName: "Hawk Ridge Trail", content: "Finally completed the full loop! The summit view is worth every step. Pro tip: bring extra water, the last section is steep.", timeAgo: "5h ago", likeCount: 41, commentCount: 12, imagePlaceholder: "photo.fill"),
        CommunityPost(authorName: "Priya Sharma", authorInitials: "PS", placeName: "The Commons", content: "Farmers market haul was amazing today. Fresh strawberries, homemade bread, and the best lavender honey I've ever tasted.", timeAgo: "8h ago", likeCount: 33, commentCount: 8, imagePlaceholder: nil),
        CommunityPost(authorName: "Alex Rivera", authorInitials: "AR", placeName: "Marina Point", content: "Sunset kayaking session was absolutely magical tonight. The water was like glass. This is what Verdure is all about!", timeAgo: "1d ago", likeCount: 56, commentCount: 15, imagePlaceholder: "photo.fill"),
    ]

    // MARK: User Profile

    static let currentUser = UserProfile(
        name: "You",
        initials: "ME",
        joinDate: "March 2026",
        placesVisited: 12,
        totalXP: 1_850,
        currentStreak: 7,
        badges: [
            Badge(name: "First Steps", icon: "shoe.fill", earned: true,
                  detail: "Your journey began. You collected your very first place and stepped into the outdoors.",
                  requirement: "Collect your first place", earnedDate: "March 14, 2026"),
            Badge(name: "Explorer", icon: "binoculars.fill", earned: true,
                  detail: "A true wanderer — you've discovered places across five different categories.",
                  requirement: "Discover 5 place categories", earnedDate: "April 2, 2026"),
            Badge(name: "Social Butterfly", icon: "person.2.fill", earned: true,
                  detail: "You've become part of the community, attending events and meeting fellow explorers.",
                  requirement: "Attend 3 community events", earnedDate: "May 19, 2026"),
            Badge(name: "Trailblazer", icon: "map.fill", earned: false,
                  detail: "Reserved for those who've hiked every trail nearby. Keep exploring to unlock it.",
                  requirement: "Collect all 5 nearby trails"),
            Badge(name: "Event Regular", icon: "calendar.badge.checkmark", earned: false,
                  detail: "Awarded to dedicated attendees who show up month after month.",
                  requirement: "Attend 10 events total"),
            Badge(name: "Legend", icon: "crown.fill", earned: false,
                  detail: "The highest honor in Verdure — reach level 10 and collect a Legendary place.",
                  requirement: "Reach level 10 + a Legendary find"),
        ]
    )

    // MARK: - Daily Gem facts
    //
    // Generic, true fun facts about nature, community, events, and the environment.
    // Selection/rotation lives in DailyGemStore (once per day, no repeats until the
    // pool is exhausted). Keep these place-agnostic — they must hold anywhere.

    static let gemFacts: [GemFact] = [
        GemFact(kind: "Nature fact", icon: "leaf.fill",
                text: "A single mature oak can host over 500 caterpillar species — the food that raises almost every songbird chick nearby.",
                accent: .spruce),
        GemFact(kind: "Did you know", icon: "sun.max.fill",
                text: "Tree-shaded streets can stay up to 10°F cooler on summer days than bare pavement.",
                accent: .gold),
        GemFact(kind: "Environment", icon: "drop.fill",
                text: "Urban wetlands work like natural filters, cleaning rainwater before it ever reaches rivers and bays.",
                accent: .sky),
        GemFact(kind: "Community", icon: "person.3.fill",
                text: "People who regularly show up to local events report feeling far more connected to their neighbors.",
                accent: .terracotta),
        GemFact(kind: "Nature fact", icon: "bird.fill",
                text: "The dawn chorus is real — birds sing loudest at first light, when still air carries their songs farthest.",
                accent: .teal),
        GemFact(kind: "Did you know", icon: "figure.walk",
                text: "Just two hours a week outside in green space is linked to noticeably better health and well-being.",
                accent: .spruce),
        GemFact(kind: "Community", icon: "basket.fill",
                text: "Money spent at a farmers market keeps roughly twice as much value circulating in the local economy.",
                accent: .gold),
        GemFact(kind: "Nature fact", icon: "ant.fill",
                text: "Honeybees will fly up to 3 miles from their hive to reach the flowers they love.",
                accent: .gold),
        GemFact(kind: "Environment", icon: "arrow.3.trianglepath",
                text: "City parks quietly absorb tons of CO₂ every year — green space is working infrastructure.",
                accent: .spruce),
        GemFact(kind: "Community", icon: "hands.sparkles.fill",
                text: "Volunteering isn't just generous — studies link it to lower stress and even longer lives.",
                accent: .teal),
        GemFact(kind: "Nature fact", icon: "moon.stars.fill",
                text: "On a truly dark night you can see around 2,500 stars — light pollution hides most of them from city streets.",
                accent: .sky),
        GemFact(kind: "Did you know", icon: "brain.head.profile",
                text: "Walking can boost creative thinking by around 60% compared to sitting — take your next idea outside.",
                accent: .terracotta),
        GemFact(kind: "Nature fact", icon: "sparkles",
                text: "Fireflies aren't flashing at random — each species blinks its own light pattern, like a signature in the dark.",
                accent: .gold),
        GemFact(kind: "Community", icon: "house.fill",
                text: "Sociologists call parks, markets, and cafés 'third places' — the spots where communities actually form.",
                accent: .spruce),
        GemFact(kind: "Environment", icon: "tree.fill",
                text: "Two mature trees produce roughly the oxygen a family of four breathes in a year.",
                accent: .teal),
        GemFact(kind: "Fun event", icon: "party.popper.fill",
                text: "Neighborhoods that throw regular block parties consistently report higher trust between neighbors.",
                accent: .terracotta),
        GemFact(kind: "Nature fact", icon: "ladybug.fill",
                text: "Monarch butterflies navigate up to 3,000 miles to forests they've never seen — guided by the sun.",
                accent: .gold),
        GemFact(kind: "Did you know", icon: "figure.mind.and.body",
                text: "'Forest bathing' — simply spending quiet time among trees — measurably lowers stress hormones and blood pressure.",
                accent: .spruce),
    ]

    // MARK: - Collectible Places

    /// Fixture coordinates are deliberately separate from the real launch area.
    /// DEBUG offline QA uses this center so radius filters exercise sample cards.
    static let defaultCenter = CLLocationCoordinate2D(latitude: 44.98, longitude: -93.265)

    /// Generates collectible places around a center coordinate.
    static func collectiblePlaces(around center: CLLocationCoordinate2D) -> [CollectiblePlace] {
        let offsets: [(Double, Double)] = [
            ( 0.003,  0.004),   // Riverside Park — very close
            ( 0.015, -0.008),   // Hawk Ridge Trail — moderate
            (-0.006,  0.010),   // Botanica Gardens — close
            ( 0.005, -0.005),   // Lakeshore Playground — close
            (-0.020,  0.018),   // Marina Point — far
            ( 0.008,  0.002),   // Cedar Court Complex — close
            ( 0.025, -0.022),   // Overlook Bluff — far (legendary!)
            (-0.002, -0.003),   // The Commons — very close
        ]

        return zip(places, offsets).map { place, offset in
            CollectiblePlace(
                id: place.name.lowercased().replacingOccurrences(of: " ", with: "-"),
                place: place,
                rarity: CollectiblePlace.rarityFor(place.category),
                coordinate: CLLocationCoordinate2D(
                    latitude: center.latitude + offset.0,
                    longitude: center.longitude + offset.1
                )
            )
        }
    }

    /// Convenience: places around the default center (fallback before GPS)
    static let collectiblePlaces: [CollectiblePlace] = collectiblePlaces(around: defaultCenter)

    /// Find the CollectiblePlace wrapper for a given Place
    static func collectible(for place: Place, in list: [CollectiblePlace]? = nil) -> CollectiblePlace? {
        let source = list ?? collectiblePlaces
        return source.first { $0.place.id == place.id }
    }

    // MARK: - Rewards — DEBUG OFFLINE FALLBACK ONLY
    //
    // NOT the catalog. `listRewardsCatalog` on the server is authoritative and
    // EconomyService renders from it; this array exists so a debug build with no
    // network still has something to draw.
    //
    // It previously WAS treated as the catalog, and drifted badly: it priced a
    // $5 card at 1,000 points while the server charged 35,000 (POINTS_PER_DOLLAR
    // = 7,000), so every price on screen was 35x low, and it browsed four tiers
    // the server had set `active: false`. `RewardCatalogParityTests` now fails if
    // these costs stop equalling usd x POINTS_PER_DOLLAR, so the two cannot
    // silently diverge again.
    //
    // Only cards that are ACTIVE server-side appear here. An inactive reward must
    // not be browsable at any balance — advertising something the server refuses
    // is exactly how the paywall came to sell deactivated tiers.

    /// Mirror of `POINTS_PER_DOLLAR` in functions/src/economy.ts. Pinned by test.
    static let pointsPerDollar = 7000

    static let rewards: [Reward] = [
        // $5 cards — 5 x 7,000
        Reward(id: "starbucks-5", name: "$5 Starbucks", brand: "Starbucks", icon: "cup.and.saucer.fill", pointCost: 5 * pointsPerDollar, tier: .bronze),
        Reward(id: "dunkin-5", name: "$5 Dunkin'", brand: "Dunkin'", icon: "mug.fill", pointCost: 5 * pointsPerDollar, tier: .bronze),
        // $10 cards — 10 x 7,000
        Reward(id: "amazon-10", name: "$10 Amazon", brand: "Amazon", icon: "shippingbox.fill", pointCost: 10 * pointsPerDollar, tier: .silver),
        Reward(id: "target-10", name: "$10 Target", brand: "Target", icon: "cart.fill", pointCost: 10 * pointsPerDollar, tier: .silver),
        Reward(id: "chipotle-10", name: "$10 Chipotle", brand: "Chipotle", icon: "fork.knife", pointCost: 10 * pointsPerDollar, tier: .silver),
    ]

    /// The USD face value backing each fallback reward, so the parity test can
    /// assert cost == usd x pointsPerDollar without re-parsing the name.
    static let rewardUSD: [String: Int] = [
        "starbucks-5": 5, "dunkin-5": 5,
        "amazon-10": 10, "target-10": 10, "chipotle-10": 10,
    ]

    // MARK: - Limited-time drops — REMOVED
    //
    // `rei-15-trail-season` and `patagonia-30-earth` were both `active: false`
    // server-side, so every redemption attempt was refused. Real limited-time
    // behaviour now lives in partner perks, where `earlyAccessUntil` is enforced
    // by the server and surfaced through `listRewardsCatalog`.
}
