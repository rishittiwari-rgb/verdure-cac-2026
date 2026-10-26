import Foundation
import CoreLocation
import Observation

// MARK: - Discovery filters (search · filter · sort)
//
// One persisted filter state shared by Explore, Events, Map and Collection.
// Everything here is LOCAL: filtering and sorting run over the lists the
// services already hold, so a search from a cold cache never touches the
// network. Radius, category, rarity, date-range, price and sort survive a
// relaunch (UserDefaults), and the last eight searches are kept on-device only.

enum DateRangeOption: String, CaseIterable, Identifiable, Codable {
    case any, today, thisWeek, thisWeekend, thisMonth
    var id: String { rawValue }
    var label: String {
        switch self {
        case .any: return "Any time"
        case .today: return "Today"
        case .thisWeek: return "This week"
        case .thisWeekend: return "This weekend"
        case .thisMonth: return "This month"
        }
    }

    /// Inclusive start / exclusive end in the user's calendar, nil = unbounded.
    func window(now: Date = Date(), calendar: Calendar = .current) -> (start: Date, end: Date)? {
        let startOfToday = calendar.startOfDay(for: now)
        switch self {
        case .any: return nil
        case .today:
            return (startOfToday, calendar.date(byAdding: .day, value: 1, to: startOfToday)!)
        case .thisWeek:
            return (startOfToday, calendar.date(byAdding: .day, value: 7, to: startOfToday)!)
        case .thisWeekend:
            // Next Saturday 00:00 through Monday 00:00 (or the current weekend if we're in it).
            let weekday = calendar.component(.weekday, from: startOfToday) // 1 = Sunday … 7 = Saturday
            let daysToSaturday = weekday == 7 ? 0 : weekday == 1 ? -1 : 7 - weekday
            let saturday = calendar.date(byAdding: .day, value: daysToSaturday, to: startOfToday)!
            let start = max(saturday, startOfToday)
            return (start, calendar.date(byAdding: .day, value: 2, to: saturday)!)
        case .thisMonth:
            return (startOfToday, calendar.date(byAdding: .month, value: 1, to: startOfToday)!)
        }
    }
}

enum PriceOption: String, CaseIterable, Identifiable, Codable {
    case any, free, paid
    var id: String { rawValue }
    var label: String {
        switch self {
        case .any: return "Free & paid"
        case .free: return "Free only"
        case .paid: return "Paid only"
        }
    }
}

enum SortOption: String, CaseIterable, Identifiable, Codable {
    case soonest, distance, points, rarity, recent
    var id: String { rawValue }
    var label: String {
        switch self {
        case .soonest: return "Soonest"
        case .distance: return "Closest"
        case .points: return "Most points"
        case .rarity: return "Rarest"
        case .recent: return "Recently added"
        }
    }
    var icon: String {
        switch self {
        case .soonest: return "calendar"
        case .distance: return "location"
        case .points: return "leaf.circle"
        case .rarity: return "crown"
        case .recent: return "sparkles"
        }
    }
    /// Which sorts make sense for events vs places.
    static let forEvents: [SortOption] = [.soonest, .distance, .points, .recent]
    static let forPlaces: [SortOption] = [.distance, .rarity, .points]
}

/// The persisted snapshot. Kept as a plain Codable struct so the `@Observable`
/// wrapper below can round-trip it in one UserDefaults key.
struct DiscoveryFilterState: Codable, Equatable {
    var radiusMiles: Double = 10
    var eventCategories: Set<EventCategory> = []
    var placeCategories: Set<PlaceCategory> = []
    var rarities: Set<PlaceRarity> = []
    var dateRange: DateRangeOption = .any
    var price: PriceOption = .any
    var eventSetting: String? = nil       // indoor | outdoor | virtual
    var eventAudience: String? = nil      // children | teens | adults
    var maxExpectedSize: Int? = nil
    var requiredAccessibility: String? = nil
    var publicVenueOnly = false
    var eventSort: SortOption = .soonest
    var placeSort: SortOption = .distance
    var recentSearches: [String] = []
    var toddlerPlayground = false
    var dogFriendly = false
    var parkRestrooms = false
    var drinkingWater = false
    var hasParkFilters: Bool { toddlerPlayground || dogFriendly || parkRestrooms || drinkingWater }

    static let radiusChoices: [Double] = [2, 5, 10, 25, 50]
    static let maxRecentSearches = 8

    init() {}

    // Existing users have a v1 snapshot without the organizer-detail filters.
    // Decode missing keys individually so a relaunch preserves their choices.
    private enum CodingKeys: String, CodingKey {
        case radiusMiles, eventCategories, placeCategories, rarities, dateRange, price
        case eventSetting, eventAudience, maxExpectedSize, requiredAccessibility, publicVenueOnly
        case eventSort, placeSort, recentSearches
        case toddlerPlayground, dogFriendly, parkRestrooms, drinkingWater
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        radiusMiles = try values.decodeIfPresent(Double.self, forKey: .radiusMiles) ?? 10
        eventCategories = try values.decodeIfPresent(Set<EventCategory>.self, forKey: .eventCategories) ?? []
        placeCategories = try values.decodeIfPresent(Set<PlaceCategory>.self, forKey: .placeCategories) ?? []
        rarities = try values.decodeIfPresent(Set<PlaceRarity>.self, forKey: .rarities) ?? []
        dateRange = try values.decodeIfPresent(DateRangeOption.self, forKey: .dateRange) ?? .any
        price = try values.decodeIfPresent(PriceOption.self, forKey: .price) ?? .any
        eventSetting = try values.decodeIfPresent(String.self, forKey: .eventSetting)
        eventAudience = try values.decodeIfPresent(String.self, forKey: .eventAudience)
        maxExpectedSize = try values.decodeIfPresent(Int.self, forKey: .maxExpectedSize)
        requiredAccessibility = try values.decodeIfPresent(String.self, forKey: .requiredAccessibility)
        publicVenueOnly = try values.decodeIfPresent(Bool.self, forKey: .publicVenueOnly) ?? false
        eventSort = try values.decodeIfPresent(SortOption.self, forKey: .eventSort) ?? .soonest
        placeSort = try values.decodeIfPresent(SortOption.self, forKey: .placeSort) ?? .distance
        recentSearches = try values.decodeIfPresent([String].self, forKey: .recentSearches) ?? []
        toddlerPlayground = try values.decodeIfPresent(Bool.self, forKey: .toddlerPlayground) ?? false
        dogFriendly = try values.decodeIfPresent(Bool.self, forKey: .dogFriendly) ?? false
        parkRestrooms = try values.decodeIfPresent(Bool.self, forKey: .parkRestrooms) ?? false
        drinkingWater = try values.decodeIfPresent(Bool.self, forKey: .drinkingWater) ?? false
    }

    var activeEventFilterCount: Int {
        (eventCategories.isEmpty ? 0 : 1) + (dateRange == .any ? 0 : 1) +
        (price == .any ? 0 : 1) + (radiusMiles == 10 ? 0 : 1) +
        (eventSetting == nil ? 0 : 1) + (eventAudience == nil ? 0 : 1) +
        (maxExpectedSize == nil ? 0 : 1) + (requiredAccessibility == nil ? 0 : 1) +
        (publicVenueOnly ? 1 : 0)
    }
    var activePlaceFilterCount: Int {
        (placeCategories.isEmpty ? 0 : 1) + (rarities.isEmpty ? 0 : 1) + (radiusMiles == 10 ? 0 : 1) +
        (toddlerPlayground ? 1 : 0) + (dogFriendly ? 1 : 0) + (parkRestrooms ? 1 : 0) + (drinkingWater ? 1 : 0)
    }
}

@MainActor @Observable
final class DiscoveryFilters {
    static let storageKey = "discovery.filters.v1"

    var state: DiscoveryFilterState {
        didSet { persist() }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        #if DEBUG
        if defaults.bool(forKey: "QAResetDiscoveryFilters") {
            state = DiscoveryFilterState()
            return
        }
        #endif
        if let data = defaults.data(forKey: Self.storageKey),
           let saved = try? JSONDecoder().decode(DiscoveryFilterState.self, from: data) {
            state = saved
        } else {
            state = DiscoveryFilterState()
        }
    }

    private let defaults: UserDefaults

    private func persist() {
        if let data = try? JSONEncoder().encode(state) { defaults.set(data, forKey: Self.storageKey) }
    }

    // MARK: Recent searches

    func recordSearch(_ raw: String) {
        let q = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { return }
        var list = state.recentSearches.filter { $0.caseInsensitiveCompare(q) != .orderedSame }
        list.insert(q, at: 0)
        state.recentSearches = Array(list.prefix(DiscoveryFilterState.maxRecentSearches))
    }

    func clearRecentSearches() { state.recentSearches = [] }

    func resetEventFilters() {
        state.eventCategories = []; state.dateRange = .any; state.price = .any; state.eventSort = .soonest
        state.eventSetting = nil; state.eventAudience = nil; state.maxExpectedSize = nil
        state.requiredAccessibility = nil; state.publicVenueOnly = false
    }
    func resetPlaceFilters() {
        state.placeCategories = []; state.rarities = []; state.placeSort = .distance
        state.toddlerPlayground = false; state.dogFriendly = false
        state.parkRestrooms = false; state.drinkingWater = false
    }

    // MARK: Events

    /// Filter + sort events. Pure over its inputs — no network, no side effects.
    func apply(to events: [Event], query: String, userLocation: CLLocation?, now: Date = Date()) -> [Event] {
        Self.filterEvents(events, state: state, query: query, userLocation: userLocation, now: now)
    }

    nonisolated static func opportunityCategories(_ events: [Event], origin: CLLocation?, radiusMiles: Double, now: Date = Date()) -> [EventCategory] {
        let nearby = events.filter { event in
            guard event.date > now, event.programIsCurrent(now: now), let origin, let point = event.coordinate else { return false }
            return CLLocation(latitude: point.latitude, longitude: point.longitude).distance(from: origin) <= radiusMiles * 1609.344
        }
        return EventCategory.allCases.filter { category in
            if category == .program { return Set(nearby.filter { $0.isProgram }.map(\.id)).count >= 10 }
            if category == .volunteer { return Set(nearby.filter { $0.category == .volunteer }.map(\.id)).count >= 30 }
            return true
        }
    }

    nonisolated static func filterEvents(_ events: [Event], state: DiscoveryFilterState, query: String,
                                         userLocation: CLLocation?, now: Date = Date()) -> [Event] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let window = state.dateRange.window(now: now)
        var out = events.filter { e in
            if !e.programIsCurrent(now: now) { return false }
            if !state.eventCategories.isEmpty && !state.eventCategories.contains(e.category) { return false }
            if let window, !(e.date >= window.start && e.date < window.end) { return false }
            switch state.price {
            case .any: break
            case .free: if e.isFree == false { return false }       // unknown price passes
            case .paid: if e.isFree != false { return false }
            }
            if let setting = state.eventSetting {
                switch setting {
                case "virtual": if e.virtual != true { return false }
                case "indoor", "outdoor":
                    if e.indoorOutdoor != setting && e.indoorOutdoor != "mixed" { return false }
                default: return false
                }
            }
            if let audience = state.eventAudience,
               e.ageSuitability != "all" && e.ageSuitability != audience { return false }
            if let maximum = state.maxExpectedSize {
                guard let size = e.expectedSize, size <= maximum else { return false }
            }
            if let feature = state.requiredAccessibility,
               !e.accessibilityFeatures.contains(feature) { return false }
            if state.publicVenueOnly && e.publicVenue != true { return false }
            if let userLocation, let coord = e.coordinate {
                let miles = userLocation.distance(from: CLLocation(latitude: coord.latitude, longitude: coord.longitude)) / 1609.344
                if miles > state.radiusMiles { return false }
            }
            if !q.isEmpty && !matches(e, q) { return false }
            return true
        }
        out.sort { a, b in
            switch state.eventSort {
            case .soonest, .rarity: return a.date < b.date
            case .points: return a.pointValue != b.pointValue ? a.pointValue > b.pointValue : a.date < b.date
            case .recent: return a.date > b.date
            case .distance:
                guard let userLocation else { return a.date < b.date }
                let da = a.coordinate.map { userLocation.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude)) } ?? .greatestFiniteMagnitude
                let db = b.coordinate.map { userLocation.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude)) } ?? .greatestFiniteMagnitude
                return da != db ? da < db : a.date < b.date
            }
        }
        return out
    }

    nonisolated static func matches(_ e: Event, _ q: String) -> Bool {
        e.title.localizedCaseInsensitiveContains(q) ||
        e.organizer.localizedCaseInsensitiveContains(q) ||
        e.locationName.localizedCaseInsensitiveContains(q) ||
        e.category.rawValue.localizedCaseInsensitiveContains(q) ||
        e.category.displayName.localizedCaseInsensitiveContains(q) ||
        e.tags.contains { $0.localizedCaseInsensitiveContains(q) } ||
        (e.description?.localizedCaseInsensitiveContains(q) ?? false)
    }

    // MARK: Places (collectibles)

    func apply(to places: [CollectiblePlace], query: String, userLocation: CLLocation?) -> [CollectiblePlace] {
        Self.filterCollectibles(places, state: state, query: query, userLocation: userLocation)
    }

    nonisolated static func filterCollectibles(_ places: [CollectiblePlace], state: DiscoveryFilterState, query: String,
                                               userLocation: CLLocation?) -> [CollectiblePlace] {
        let q = query.trimmingCharacters(in: .whitespaces)
        var out = places.filter { c in
            if !state.placeCategories.isEmpty && !state.placeCategories.contains(c.place.category) { return false }
            if !state.rarities.isEmpty && !state.rarities.contains(c.rarity) { return false }
            if let userLocation, c.distanceMiles(from: userLocation) > state.radiusMiles { return false }
            if !q.isEmpty && !(c.place.name.localizedCaseInsensitiveContains(q)
                               || c.place.category.rawValue.localizedCaseInsensitiveContains(q)
                               || c.place.shortDescription.localizedCaseInsensitiveContains(q)) { return false }
            return true
        }
        out.sort { a, b in
            switch state.placeSort {
            case .rarity:
                let ra = a.rarity.pointValue, rb = b.rarity.pointValue
                return ra != rb ? ra > rb : a.place.name < b.place.name
            case .points:
                return a.pointValue != b.pointValue ? a.pointValue > b.pointValue : a.place.name < b.place.name
            default:
                guard let userLocation else { return a.place.distanceValue < b.place.distanceValue }
                return a.distanceMiles(from: userLocation) < b.distanceMiles(from: userLocation)
            }
        }
        return out
    }

    /// Plain places (Explore cards) — category + radius + search, sorted by distance.
    func apply(to places: [Place], query: String, userLocation: CLLocation?) -> [Place] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return places.filter { p in
            if !state.placeCategories.isEmpty && !state.placeCategories.contains(p.category) { return false }
            if let userLocation, let coord = p.coordinate {
                let miles = userLocation.distance(from: CLLocation(latitude: coord.latitude, longitude: coord.longitude)) / 1609.344
                if miles > state.radiusMiles { return false }
            }
            if !q.isEmpty && !(p.name.localizedCaseInsensitiveContains(q) || p.category.rawValue.localizedCaseInsensitiveContains(q)) { return false }
            return true
        }
    }
}

// MARK: - Debounced search text

/// Holds the live text field value and a debounced copy the lists filter on,
/// so typing doesn't re-filter 600 events on every keystroke.
@MainActor @Observable
final class SearchDebouncer {
    var text = "" {
        didSet { schedule() }
    }
    private(set) var debounced = ""
    private var task: Task<Void, Never>?
    private let delay: Duration

    init(delay: Duration = .milliseconds(250)) { self.delay = delay }

    private func schedule() {
        task?.cancel()
        let value = text
        task = Task { [weak self] in
            try? await Task.sleep(for: self?.delay ?? .milliseconds(250))
            guard !Task.isCancelled else { return }
            self?.debounced = value
        }
    }

    /// Commit immediately (return key) and hand the query to the recents list.
    func commit(into filters: DiscoveryFilters) {
        task?.cancel()
        debounced = text
        filters.recordSearch(text)
    }
}
