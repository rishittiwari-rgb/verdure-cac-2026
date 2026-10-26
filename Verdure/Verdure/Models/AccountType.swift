import Foundation

/// Whether the user attends events (visitor) or can also host them (organizer).
/// Persisted via @AppStorage("accountType"). Visitors cannot create events but
/// can use every other feature (Community, Collection, Map, etc.).
enum AccountType: String, CaseIterable, Identifiable, Codable {
    case visitor
    case organizer

    var id: String { rawValue }

    var title: String {
        switch self {
        case .visitor: return "Visitor"
        case .organizer: return "Organizer"
        }
    }

    var blurb: String {
        switch self {
        case .visitor: return "Discover events, collect places, and connect with your community."
        case .organizer: return "Everything a visitor can do — plus create and host local events."
        }
    }

    var icon: String {
        switch self {
        case .visitor: return "binoculars.fill"
        case .organizer: return "megaphone.fill"
        }
    }

    var canCreateEvents: Bool { self == .organizer }
}
