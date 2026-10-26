import XCTest
import CoreLocation
@testable import Verdure

/// Search / filter / sort are pure over the lists the services already hold —
/// no network, no Firestore. These pin the behaviour the four browse surfaces
/// share and prove the state survives a relaunch.
@MainActor
final class DiscoveryFiltersTests: XCTestCase {

    private let sanJose = CLLocation(latitude: 37.3382, longitude: -121.8863)
    private var suite: UserDefaults!

    // `override func setUp()` is nonisolated, so it cannot touch this
    // @MainActor class's stored properties (that is why the test target stopped
    // compiling). The async form inherits the class's isolation.
    override func setUp() async throws {
        // NOTE: no `super.setUp()` call — forwarding to the nonisolated
        // superclass method from this @MainActor context sends a non-Sendable
        // XCTestCase across isolation. XCTest runs the superclass setup itself.
        suite = UserDefaults(suiteName: "DiscoveryFiltersTests")!
        suite.removePersistentDomain(forName: "DiscoveryFiltersTests")
    }

    private func event(_ id: String, title: String, category: EventCategory = .social, daysAhead: Double = 1,
                       lat: Double? = nil, lng: Double? = nil, isFree: Bool? = nil, points: Int? = nil) -> Event {
        Event(id: id, title: title, organizer: "Org", date: Date().addingTimeInterval(daysAhead * 86_400),
              time: "7:00 PM", locationName: "Venue", attendeeCount: 0, maxAttendees: nil, category: category,
              imagePlaceholder: category.icon, pointValue: points ?? category.defaultPoints, description: nil,
              creatorID: nil, website: nil, latitude: lat, longitude: lng, isFree: isFree)
    }

    // MARK: Events

    func testRadiusFilterKeepsUnlocatedEventsAndDropsFarOnes() {
        var state = DiscoveryFilterState(); state.radiusMiles = 5
        let near = event("near", title: "Near", lat: 37.34, lng: -121.89)        // downtown
        let far = event("far", title: "Far", lat: 37.25, lng: -122.03)        // Los Gatos, ~11 mi
        let unknown = event("unknown", title: "No coords")
        let out = DiscoveryFilters.filterEvents([near, far, unknown], state: state, query: "", userLocation: sanJose)
        XCTAssertEqual(Set(out.map(\.id)), ["near", "unknown"])
    }

    func testCategoryDateAndPriceFilters() {
        var state = DiscoveryFilterState()
        state.eventCategories = [.volunteer]
        state.dateRange = .thisWeek
        state.price = .free
        let events = [
            event("a", title: "Cleanup", category: .volunteer, daysAhead: 2, isFree: true),
            event("b", title: "Paid volunteer gala", category: .volunteer, daysAhead: 2, isFree: false),
            event("c", title: "Later", category: .volunteer, daysAhead: 20, isFree: true),
            event("d", title: "Concert", category: .festival, daysAhead: 2, isFree: true),
            event("e", title: "Unknown price", category: .volunteer, daysAhead: 3),   // unknown passes "free"
        ]
        let out = DiscoveryFilters.filterEvents(events, state: state, query: "", userLocation: nil)
        XCTAssertEqual(Set(out.map(\.id)), ["a", "e"])
    }

    func testOrganizerDetailFiltersUseConfirmedMetadata() {
        var suitable = event("suitable", title: "Garden workshop")
        suitable.indoorOutdoor = "outdoor"
        suitable.ageSuitability = "all"
        suitable.expectedSize = 18
        suitable.accessibilityFeatures = ["stepFree"]
        suitable.publicVenue = true
        var tooLarge = event("large", title: "Large garden workshop")
        tooLarge.indoorOutdoor = "outdoor"
        tooLarge.ageSuitability = "all"
        tooLarge.expectedSize = 80
        tooLarge.accessibilityFeatures = ["stepFree"]
        tooLarge.publicVenue = true
        let unknown = event("unknown", title: "Unspecified listing")
        var state = DiscoveryFilterState()
        state.eventSetting = "outdoor"
        state.eventAudience = "children"
        state.maxExpectedSize = 20
        state.requiredAccessibility = "stepFree"
        state.publicVenueOnly = true
        let result = DiscoveryFilters.filterEvents([suitable, tooLarge, unknown], state: state,
                                                   query: "", userLocation: nil)
        XCTAssertEqual(result.map(\.id), ["suitable"])
        XCTAssertEqual(state.activeEventFilterCount, 5)
        state.eventSetting = "virtual"
        XCTAssertTrue(DiscoveryFilters.filterEvents([suitable], state: state, query: "", userLocation: nil).isEmpty)
    }

    func testSearchMatchesTitleOrganizerLocationCategoryAndTags() {
        var tagged = event("t", title: "Storytime")
        tagged.tags = ["library", "Children Ages 0-5"]
        let events = [tagged, event("x", title: "Pickup Soccer", category: .sports)]
        let state = DiscoveryFilterState()
        XCTAssertEqual(DiscoveryFilters.filterEvents(events, state: state, query: "library", userLocation: nil).map(\.id), ["t"])
        XCTAssertEqual(DiscoveryFilters.filterEvents(events, state: state, query: "sports", userLocation: nil).map(\.id), ["x"])
        XCTAssertEqual(DiscoveryFilters.filterEvents(events, state: state, query: "venue", userLocation: nil).count, 2)
        XCTAssertEqual(DiscoveryFilters.filterEvents(events, state: state, query: "zzz", userLocation: nil).count, 0)
    }

    func testSortByPointsDistanceAndRecent() {
        var state = DiscoveryFilterState()
        let a = event("a", title: "A", category: .market, daysAhead: 1, lat: 37.34, lng: -121.89)   // 75 pts, close
        let b = event("b", title: "B", category: .festival, daysAhead: 3, lat: 37.42, lng: -121.75)  // 250 pts, farther
        let c = event("c", title: "C", category: .social, daysAhead: 2)                             // 100 pts, no coords
        state.eventSort = .points
        XCTAssertEqual(DiscoveryFilters.filterEvents([a, b, c], state: state, query: "", userLocation: nil).map(\.id), ["b", "c", "a"])
        state.eventSort = .distance
        XCTAssertEqual(DiscoveryFilters.filterEvents([a, b, c], state: state, query: "", userLocation: sanJose).map(\.id), ["a", "b", "c"],
                       "unlocated events sort last when sorting by distance")
        state.eventSort = .recent
        XCTAssertEqual(DiscoveryFilters.filterEvents([a, b, c], state: state, query: "", userLocation: nil).map(\.id), ["b", "c", "a"])
        state.eventSort = .soonest
        XCTAssertEqual(DiscoveryFilters.filterEvents([a, b, c], state: state, query: "", userLocation: nil).map(\.id), ["a", "c", "b"])
    }

    func testDateWindows() {
        let cal = Calendar.current
        let now = cal.date(from: DateComponents(year: 2026, month: 9, day: 9, hour: 12))!   // a Wednesday
        let weekend = DateRangeOption.thisWeekend.window(now: now, calendar: cal)!
        XCTAssertEqual(cal.component(.weekday, from: weekend.start), 7, "weekend starts Saturday")
        XCTAssertEqual(cal.dateComponents([.day], from: weekend.start, to: weekend.end).day, 2)
        let today = DateRangeOption.today.window(now: now, calendar: cal)!
        XCTAssertEqual(cal.dateComponents([.day], from: today.start, to: today.end).day, 1)
        XCTAssertNil(DateRangeOption.any.window(now: now, calendar: cal))
    }

    // MARK: Places

    func testBrowseRadiusUsesLaunchAreaWhenGPSIsUnavailable() {
        var state = DiscoveryFilterState()
        state.radiusMiles = 10
        let close = Place(id: "close", name: "Close park", category: .parks, shortDescription: "",
                          distance: "1 mi", distanceValue: 1, rating: nil, reviewCount: nil,
                          imagePlaceholder: "leaf.fill", accentColor: .verdureGreen,
                          isFeatured: false, latitude: 37.34, longitude: -121.89)
        let far = Place(id: "far", name: "Far park", category: .parks, shortDescription: "",
                        distance: "35 mi", distanceValue: 35, rating: nil, reviewCount: nil,
                        imagePlaceholder: "leaf.fill", accentColor: .verdureGreen,
                        isFeatured: false, latitude: 37.05, longitude: -122.10)
        let filters = DiscoveryFilters(defaults: suite)
        filters.state = state
        XCTAssertEqual(filters.apply(to: [close, far], query: "", userLocation: sanJose).map(\.id), ["close"])
    }

    func testCollectiblesFilterByRarityCategoryRadiusAndSortByRarity() {
        var state = DiscoveryFilterState()
        state.rarities = [.legendary, .rare]
        state.radiusMiles = 10
        state.placeSort = .rarity
        let mk: (String, PlaceCategory, PlaceRarity, Double, Double) -> CollectiblePlace = { id, cat, rarity, lat, lng in
            let place = Place(id: id, name: id, category: cat, shortDescription: "", distance: "", distanceValue: 0,
                              rating: nil, reviewCount: nil, imagePlaceholder: cat.icon, accentColor: .verdureGreen,
                              isFeatured: false, latitude: lat, longitude: lng)
            return CollectiblePlace(id: id, place: place, rarity: rarity, coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }
        let items = [
            mk("bluff", .scenic, .legendary, 37.34, -121.89),
            mk("marina", .waterfront, .rare, 37.33, -121.91),
            mk("park", .parks, .common, 37.34, -121.89),
            mk("far-overlook", .scenic, .legendary, 37.05, -122.10),  // ~28 mi
        ]
        let out = DiscoveryFilters.filterCollectibles(items, state: state, query: "", userLocation: sanJose)
        XCTAssertEqual(out.map(\.id), ["bluff", "marina"])
        XCTAssertEqual(DiscoveryFilters.filterCollectibles(items, state: state, query: "mar", userLocation: sanJose).map(\.id), ["marina"])
    }

    // MARK: Persistence + recents

    func testFiltersSurviveRelaunch() {
        let first = DiscoveryFilters(defaults: suite)
        first.state.radiusMiles = 25
        first.state.eventCategories = [.sports, .market]
        first.state.dateRange = .thisWeekend
        first.state.price = .free
        first.state.eventSort = .points
        first.state.eventSetting = "outdoor"
        first.state.requiredAccessibility = "stepFree"
        first.recordSearch("soccer")

        let relaunched = DiscoveryFilters(defaults: suite)
        XCTAssertEqual(relaunched.state.radiusMiles, 25)
        XCTAssertEqual(relaunched.state.eventCategories, [.sports, .market])
        XCTAssertEqual(relaunched.state.dateRange, .thisWeekend)
        XCTAssertEqual(relaunched.state.price, .free)
        XCTAssertEqual(relaunched.state.eventSort, .points)
        XCTAssertEqual(relaunched.state.eventSetting, "outdoor")
        XCTAssertEqual(relaunched.state.requiredAccessibility, "stepFree")
        XCTAssertEqual(relaunched.state.recentSearches, ["soccer"])
    }

    func testLegacyFilterSnapshotKeepsExistingChoices() throws {
        var old = DiscoveryFilterState()
        old.radiusMiles = 25
        old.eventCategories = [.workshop]
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(old)) as? [String: Any])
        for key in ["eventSetting", "eventAudience", "maxExpectedSize", "requiredAccessibility", "publicVenueOnly"] {
            object.removeValue(forKey: key)
        }
        suite.set(try JSONSerialization.data(withJSONObject: object), forKey: DiscoveryFilters.storageKey)
        let restored = DiscoveryFilters(defaults: suite)
        XCTAssertEqual(restored.state.radiusMiles, 25)
        XCTAssertEqual(restored.state.eventCategories, [.workshop])
        XCTAssertNil(restored.state.eventSetting)
        XCTAssertFalse(restored.state.publicVenueOnly)
    }

    func testRecentSearchesDedupeAndCapAtEight() {
        let filters = DiscoveryFilters(defaults: suite)
        for i in 1...10 { filters.recordSearch("query \(i)") }
        filters.recordSearch("Query 10")          // same query, different case → moves to front, no duplicate
        filters.recordSearch(" a ")               // too short → ignored
        XCTAssertEqual(filters.state.recentSearches.count, 8)
        XCTAssertEqual(filters.state.recentSearches.first, "Query 10")
        XCTAssertEqual(filters.state.recentSearches.filter { $0.lowercased() == "query 10" }.count, 1)
        filters.clearRecentSearches()
        XCTAssertTrue(filters.state.recentSearches.isEmpty)
    }

    func testActiveFilterCounts() {
        var state = DiscoveryFilterState()
        XCTAssertEqual(state.activeEventFilterCount, 0)
        state.radiusMiles = 2; state.price = .paid; state.eventCategories = [.social]; state.dateRange = .today
        XCTAssertEqual(state.activeEventFilterCount, 4)
        XCTAssertEqual(state.activePlaceFilterCount, 1)
    }
}
