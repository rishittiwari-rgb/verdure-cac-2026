import Foundation
import SwiftUI
import CoreLocation

// MARK: - Place Rarity

enum PlaceRarity: String, CaseIterable, Identifiable, Codable {
    case common = "Common"
    case uncommon = "Uncommon"
    case rare = "Rare"
    case legendary = "Legendary"

    var id: String { rawValue }

    /// Place visit points — intentionally low; events are the main earner
    var pointValue: Int {
        switch self {
        case .common: return 5
        case .uncommon: return 10
        case .rare: return 25
        case .legendary: return 50
        }
    }

    var color: Color {
        switch self {
        case .common: return .verdureGreen
        case .uncommon: return .accentAmber
        case .rare: return .accentLavender
        case .legendary: return .accentCoral
        }
    }

    var icon: String {
        switch self {
        case .common: return "circle.fill"
        case .uncommon: return "diamond.fill"
        case .rare: return "star.fill"
        case .legendary: return "crown.fill"
        }
    }

    var glowOpacity: Double {
        switch self {
        case .common: return 0.0
        case .uncommon: return 0.15
        case .rare: return 0.25
        case .legendary: return 0.4
        }
    }
}

// MARK: - Collectible Place

struct CollectiblePlace: Identifiable, Hashable {
    let id: String               // stable ID based on place name
    let place: Place
    let rarity: PlaceRarity
    let coordinate: CLLocationCoordinate2D

    var pointValue: Int { rarity.pointValue }

    /// Distance in miles from a location to this place
    func distanceMiles(from location: CLLocation) -> Double {
        let placeLoc = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        return location.distance(from: placeLoc) / 1609.34
    }

    /// Whether the place is within collectible radius (500 ft ≈ 0.0947 mi)
    func isNearby(from location: CLLocation?, radius: Double = 0.0947) -> Bool {
        guard let loc = location else { return false }
        return distanceMiles(from: loc) < radius
    }

    /// Legacy fallback using Place's static distanceValue (used when no GPS)
    var isNearbyStatic: Bool { place.distanceValue < 0.1 }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: CollectiblePlace, rhs: CollectiblePlace) -> Bool { lhs.id == rhs.id }

    /// Assigns rarity based on place category
    static func rarityFor(_ category: PlaceCategory) -> PlaceRarity {
        switch category {
        case .parks, .playgrounds: return .common
        case .trails, .gardens, .community: return .uncommon
        case .waterfront, .sports: return .rare
        case .scenic: return .legendary
        }
    }
}

// MARK: - Reward Tier

enum RewardTier: String, CaseIterable, Identifiable, Codable {
    case bronze = "Bronze"
    case silver = "Silver"
    case gold = "Gold"
    case platinum = "Platinum"

    var id: String { rawValue }

    var minPoints: Int {
        switch self {
        case .bronze: return 1000
        case .silver: return 2500
        case .gold: return 7500
        case .platinum: return 20000
        }
    }

    var color: Color {
        switch self {
        case .bronze: return Color(red: 0.80, green: 0.50, blue: 0.20)
        case .silver: return Color(red: 0.75, green: 0.75, blue: 0.78)
        case .gold: return .accentAmber
        case .platinum: return .accentLavender
        }
    }

    var icon: String {
        switch self {
        case .bronze: return "gift.fill"
        case .silver: return "gift.fill"
        case .gold: return "star.circle.fill"
        case .platinum: return "crown.fill"
        }
    }
}

// MARK: - Reward

struct Reward: Identifiable {
    let id: String
    let name: String
    let brand: String
    let icon: String           // SF Symbol
    let pointCost: Int
    let tier: RewardTier

    // MARK: Limited-time drops (nil dates = always available)

    /// When everyone can redeem this reward.
    var availableFrom: Date? = nil
    /// When the drop closes for everyone.
    var availableUntil: Date? = nil
    /// Verdure+ members can redeem this many days before `availableFrom`.
    var plusEarlyAccessDays: Int = 0

    var isLimitedTime: Bool { availableFrom != nil || availableUntil != nil }

    /// The moment Verdure+ members can start redeeming.
    var plusAvailableFrom: Date? {
        guard let availableFrom, plusEarlyAccessDays > 0 else { return availableFrom }
        return Calendar.current.date(byAdding: .day, value: -plusEarlyAccessDays, to: availableFrom)
    }

    /// What a given user can do with this reward right now.
    enum Availability: Equatable {
        /// Redeemable now. `endsAt` is set for limited-time drops.
        case open(endsAt: Date?)
        /// In the Verdure+ early window — Plus members only until `publicFrom`.
        case plusEarlyAccess(publicFrom: Date)
        /// Not open to anyone yet.
        case upcoming(from: Date)
        /// The drop has closed.
        case ended(at: Date)
    }

    func availability(now: Date = Date(), isPlus: Bool) -> Availability {
        if let until = availableUntil, now >= until { return .ended(at: until) }

        guard let from = availableFrom else { return .open(endsAt: availableUntil) }
        if now >= from { return .open(endsAt: availableUntil) }

        // Before the public date: Plus members may already be inside the early window.
        if let plusFrom = plusAvailableFrom, now >= plusFrom {
            return isPlus ? .open(endsAt: availableUntil) : .plusEarlyAccess(publicFrom: from)
        }
        return .upcoming(from: from)
    }

    /// Convenience: can this user redeem right now?
    func isRedeemable(now: Date = Date(), isPlus: Bool) -> Bool {
        if case .open = availability(now: now, isPlus: isPlus) { return true }
        return false
    }
}
