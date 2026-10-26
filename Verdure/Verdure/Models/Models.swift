import Foundation
import SwiftUI
import CoreLocation

// MARK: - Place

struct Place: Identifiable, Hashable {
    let id: String              // Stable string ID (OSM node ID or sample slug)
    let name: String
    let category: PlaceCategory
    let shortDescription: String
    let distance: String        // e.g. "0.4 mi"
    let distanceValue: Double   // numeric miles for proximity checks
    let rating: Double?         // nil when the source has no real rating (never fabricated)
    let reviewCount: Int?
    let imagePlaceholder: String // SF Symbol name
    let accentColor: Color
    let isFeatured: Bool
    var latitude: Double? = nil   // REAL venue coordinates from the source —
    var longitude: Double? = nil  //   drives map pins + collection proximity
    var photoURL: String? = nil   // real photo when the source provides one (NPS, RecGov, OSM image tag)
    var openHoursReal: String? = nil // real opening hours (OSM opening_hours tag) — nil hides the row

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: Place, rhs: Place) -> Bool { lhs.id == rhs.id }
}

enum PlaceCategory: String, CaseIterable, Identifiable, Codable {
    case parks = "Parks"
    case trails = "Trails"
    case gardens = "Gardens"
    case playgrounds = "Playgrounds"
    case waterfront = "Waterfront"
    case sports = "Sports"
    case scenic = "Scenic"
    case community = "Community"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .parks: return "leaf.fill"
        case .trails: return "figure.hiking"
        case .gardens: return "camera.macro"
        case .playgrounds: return "figure.play"
        case .waterfront: return "water.waves"
        case .sports: return "sportscourt.fill"
        case .scenic: return "mountain.2.fill"
        case .community: return "person.3.fill"
        }
    }

    var tint: Color {
        switch self {
        case .parks: return .verdureGreen
        case .trails: return .accentAmber
        case .gardens: return .accentCoral
        case .playgrounds: return .accentSky
        case .waterfront: return .accentSky
        case .sports: return .accentCoral
        case .scenic: return .accentLavender
        case .community: return .accentMint
        }
    }
}

// MARK: - Event

struct Event: Identifiable, Hashable {
    let id: String               // stable ID for persistence
    let title: String
    let organizer: String
    let date: Date
    let time: String
    let locationName: String
    let attendeeCount: Int
    let maxAttendees: Int?
    let category: EventCategory
    let imagePlaceholder: String
    let pointValue: Int          // points earned for attending
    var description: String?     // optional event description
    var creatorID: String?       // Firebase UID of the event creator
    var website: String?         // optional organizer / event info URL
    var latitude: Double? = nil  // venue coordinates when the source provides them —
    var longitude: Double? = nil //   used for the GPS proximity gate at check-in

    // Provenance + listing facts from the normalized /events store (ingest-and-own).
    var source: String = "community"   // ticketmaster | libcal | localist | nps | ics | serpapi | organizer | community
    var sourceCount: Int = 1           // how many feeds listed this same event (dedupe merged them)
    var isFree: Bool? = nil            // nil = the source didn't say
    var priceMin: Double? = nil        // lowest listed price in USD when known
    var imageURL: String? = nil        // real image from the source, never a placeholder
    var tags: [String] = []            // feed-provided tags / audiences
    var areaId: String? = nil          // launch area the event was ingested for
    var organizerId: String? = nil     // organizer profile that published it (organizer accounts)
    var isBroadcast: Bool = true       // false = visible only to the organizer's followers (unverified)
    var expectedSize: Int? = nil
    var indoorOutdoor: String? = nil
    var ageSuitability: String? = nil
    var endDate: Date? = nil
    var minimumAge: Int? = nil
    var maximumAge: Int? = nil
    var accessibilityFeatures: [String] = []
    var publicVenue: Bool? = nil
    var recurring: Bool? = nil
    var virtual: Bool? = nil
    var applicationDeadline: Date? = nil
    var opportunitySubtype: String? = nil
    /// Server-annotated: alcohol service, an age limit or an alcohol-brand presenter.
    /// Served only to signed-in adults; carried so detail copy can say why.
    var adultOnly: Bool = false
    /// W5: the server's "why you're seeing this" reasons from `recommendedEvents`
    /// (at most three). Empty unless the ranked feed sent them — the client never
    /// invents a reason.
    var feedReasons: [String] = []
    /// W5: later occurrences of a recurring series the server collapsed into this
    /// card (`moreDates`), soonest first. Empty for a one-off listing.
    var moreDates: [Date] = []

    var isProgram: Bool { category == .program || opportunitySubtype == "program" }
    /// A listing that runs the whole local day. BiblioCommons sends these as a midnight
    /// start labelled "12:00 AM" with a 23:59:59 end; showing that time is false.
    var isAllDay: Bool {
        if time.trimmingCharacters(in: .whitespaces).caseInsensitiveCompare("All day") == .orderedSame { return true }
        let calendar = Calendar.current
        guard calendar.component(.hour, from: date) == 0, calendar.component(.minute, from: date) == 0,
              let endDate else { return false }
        return endDate.timeIntervalSince(date) >= 20 * 3600
    }
    /// The time line for display: "All day" for a day-long listing, otherwise the listed time.
    var displayTime: String { isAllDay ? "All day" : time }
    /// Date and time for display, e.g. "Oct 24, 2026 at 3:00 PM" or "Oct 24, 2026 · All day".
    var whenText: String {
        isAllDay ? "\(date.formatted(date: .abbreviated, time: .omitted)) · All day"
            : date.formatted(date: .abbreviated, time: .shortened)
    }

    /// The card's one-line summary of the top two server reasons, or nil.
    var whyLine: String? { RankedFeedEvent.topReasonsLine(feedReasons) }
    /// "Repeats — N more dates" when the server collapsed a series into this card.
    var seriesLabel: String? {
        guard !moreDates.isEmpty else { return nil }
        return "Repeats — \(moreDates.count) more date\(moreDates.count == 1 ? "" : "s")"
    }
    func programIsCurrent(now: Date = Date()) -> Bool {
        guard isProgram else { return true }
        guard let deadline = applicationDeadline, let minimumAge, let maximumAge,
              minimumAge >= 13, maximumAge <= 110, minimumAge <= maximumAge else { return false }
        return deadline > now
    }

    /// Venue coordinate when both components are known.
    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// Human label for where the listing came from — shown on cards so users can
    /// see that a library workshop and a stadium concert are different kinds of thing.
    var sourceLabel: String {
        switch source {
        case "ticketmaster": return "Ticketed"
        case "libcal": return "Library"
        case "localist": return "Campus & civic"
        case "nps": return "National Park Service"
        case "ics": return "Community calendar"
        case "serpapi": return "Web listing"
        case "organizer": return "Verdure organizer"
        case "staff-program": return "Staff curated"
        default: return "Community"
        }
    }

    /// "Free", "$12+", or nil when the source gave no price information.
    var priceLabel: String? {
        if isFree == true { return "Free" }
        if let priceMin, priceMin > 0 {
            let amount = priceMin == priceMin.rounded() ? "$\(Int(priceMin))" : String(format: "$%.2f", priceMin)
            return isProgram ? amount : amount + "+"
        }
        if isFree == false { return "Paid" }
        return nil
    }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: Event, rhs: Event) -> Bool { lhs.id == rhs.id }
}

// MARK: - Ranked feed row (W5)

/// One row of the `recommendedEvents` callable:
/// `{ id, score, parts, reasons: [String] (≤ 3), moreDates: [ISO-8601 String], notify }`.
/// Decoding is tolerant — a malformed reason or date is dropped, never guessed.
struct RankedFeedEvent: Hashable {
    let id: String
    let score: Double
    let reasons: [String]
    let moreDates: [Date]
    let notify: Bool

    /// The server sends at most three; the client never shows more.
    static let maxReasons = 3

    init(id: String, score: Double = 0, reasons: [String] = [], moreDates: [Date] = [], notify: Bool = false) {
        self.id = id
        self.score = score
        self.reasons = Self.cleanReasons(reasons)
        self.moreDates = moreDates.sorted()
        self.notify = notify
    }

    /// Decodes one server row. Nil when the row has no usable id.
    init?(row: [String: Any]) {
        guard let id = row["id"] as? String, !id.isEmpty, !id.contains("/") else { return nil }
        self.init(id: id,
                  score: (row["score"] as? Double) ?? 0,
                  reasons: Self.cleanReasons(row["reasons"]),
                  moreDates: Self.parseDates(row["moreDates"]),
                  notify: (row["notify"] as? Bool) ?? false)
    }

    /// Decodes the callable's `events` array in server order.
    static func decode(_ data: [String: Any]) -> [RankedFeedEvent] {
        let rows = data["events"] as? [[String: Any]] ?? []
        return rows.compactMap { RankedFeedEvent(row: $0) }
    }

    /// Keeps only non-empty strings, trimmed and bounded, at most `maxReasons`.
    static func cleanReasons(_ raw: Any?) -> [String] {
        guard let list = raw as? [Any] else { return [] }
        var out: [String] = []
        for item in list {
            guard let text = item as? String else { continue }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            out.append(String(trimmed.prefix(80)))
            if out.count == maxReasons { break }
        }
        return out
    }

    /// `moreDates` arrives as ISO-8601 strings (`Date.toISOString()`); a
    /// `{ startMs }` object is accepted too. Unparseable entries are dropped.
    static func parseDates(_ raw: Any?) -> [Date] {
        guard let list = raw as? [Any] else { return [] }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        var out: [Date] = []
        for item in list {
            if let text = item as? String {
                if let date = fractional.date(from: text) ?? plain.date(from: text) { out.append(date) }
            } else if let dict = item as? [String: Any], let ms = dict["startMs"] as? Double, ms > 0 {
                out.append(Date(timeIntervalSince1970: ms / 1000))
            }
        }
        return out.sorted()
    }

    /// The first two reasons joined with " · " for the card's single line.
    static func topReasonsLine(_ reasons: [String]) -> String? {
        let top = cleanReasons(reasons).prefix(2)
        return top.isEmpty ? nil : top.joined(separator: " · ")
    }
}

extension Array where Element == Event {
    /// Attaches the ranked feed's reasons and series dates to the matching
    /// `/events` documents. An event the feed did not rank carries none.
    func annotated(with feed: [String: RankedFeedEvent]) -> [Event] {
        map { event in
            var copy = event
            let row = feed[event.id]
            copy.feedReasons = row?.reasons ?? []
            copy.moreDates = row?.moreDates ?? []
            return copy
        }
    }

    /// Drops events the user hid ("Hide this event") from any local list.
    func excluding(hiddenIDs: Set<String>) -> [Event] {
        hiddenIDs.isEmpty ? self : filter { !hiddenIDs.contains($0.id) }
    }
}

enum EventCategory: String, CaseIterable, Identifiable, Codable {
    case cleanup = "Cleanup"
    case sports = "Sports"
    case social = "Social"
    case workshop = "Workshop"
    case market = "Market"
    case festival = "Festival"
    case hackathon = "Hackathon"
    case meetup = "Meetup"
    case volunteer = "Volunteer"
    case program = "Program"

    var id: String { rawValue }

    /// User-facing name. Keep the raw value stable for existing events and saved filters.
    var displayName: String { self == .sports ? "Sports & Outdoors" : rawValue }

    var icon: String {
        switch self {
        case .cleanup: return "sparkles"
        case .sports: return "figure.run"
        case .social: return "cup.and.saucer.fill"
        case .workshop: return "hammer.fill"
        case .market: return "bag.fill"
        case .festival: return "party.popper.fill"
        case .hackathon: return "laptopcomputer"
        case .meetup: return "person.3.fill"
        case .volunteer: return "heart.fill"
        case .program: return "graduationcap.fill"
        }
    }

    /// Points earned for attending events of this category
    var defaultPoints: Int {
        switch self {
        case .cleanup: return 200
        case .sports: return 150
        case .social: return 100
        case .workshop: return 150
        case .market: return 75
        case .festival: return 250
        case .hackathon: return 200
        case .meetup: return 100
        case .volunteer: return 200
        case .program: return 0
        }
    }
}

// MARK: - Interest → event affinity

extension PlaceCategory {
    /// Event categories that align with this place interest — powers the
    /// "For You" event recommendations on the Events tab.
    /// OFFLINE FALLBACK ONLY. The server ranks "For You" (functions/src/interests.ts
    /// normalises these labels and matches listings by phrase and specific
    /// category); this map is used solely when the ranking callable is
    /// unreachable. CAC 2026: the catch-all categories (Meetup, Social,
    /// Workshop, Hackathon) are gone from it — "Trails → Sports + Meetup" and
    /// "Community → Hackathon" were how career and developer events reached
    /// a Parks + Trails user with the backend down.
    var relatedEventCategories: [EventCategory] {
        switch self {
        case .parks: return [.cleanup, .volunteer, .festival]
        case .trails: return [.cleanup, .volunteer]
        case .gardens: return [.volunteer, .market]
        case .playgrounds: return [.festival]
        case .waterfront: return [.cleanup, .festival]
        case .sports: return [.sports]
        case .scenic: return [.cleanup, .festival]
        case .community: return [.volunteer, .cleanup, .market, .festival]
        }
    }
}

// MARK: - Challenge

struct Challenge: Identifiable {
    let id = UUID()
    let title: String
    let description: String
    let xpReward: Int
    let progress: Double   // 0.0 – 1.0
    let icon: String
    let daysRemaining: Int
}

// MARK: - Community Post

struct CommunityPost: Identifiable {
    let id = UUID()
    let authorName: String
    let authorInitials: String
    let placeName: String
    let content: String
    let timeAgo: String
    let likeCount: Int
    let commentCount: Int
    let imagePlaceholder: String?
    var docID: String? = nil   // Firestore document ID — nil for local/sample posts (likes need it)
    var authorID: String? = nil // Firebase uid of the author — drives Block/Report (nil for samples)
}

// MARK: - User Profile

struct UserProfile {
    let name: String
    let initials: String
    let joinDate: String
    let placesVisited: Int
    let totalXP: Int
    let currentStreak: Int
    let badges: [Badge]
}

struct Badge: Identifiable {
    let id = UUID()
    let name: String
    let icon: String
    let earned: Bool
    var detail: String = ""
    var requirement: String = ""       // how it's unlocked
    var earnedDate: String? = nil      // e.g. "June 12, 2026" — nil if locked
}

// MARK: - Daily Gem fact

/// A bite-sized daily fun fact about nature, community, events, or the environment,
/// revealed when the user taps the daily gem.
struct GemFact: Identifiable {
    let kind: String     // kicker label, e.g. "DID YOU KNOW", "NATURE FACT", "COMMUNITY"
    let icon: String
    let text: String
    let accent: ClayStyle.ClayAccentKind

    var id: String { text }   // facts are unique by text; stable across launches
}
