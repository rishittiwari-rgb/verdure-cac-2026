import Foundation
@preconcurrency import FirebaseFunctions

// MARK: - Adventure Planner (client)
//
// Sends the nearby places the app ALREADY fetched from its providers, plus the
// user's interests and how long they have, and gets back an itinerary built
// only from those places. The server plans with its rules engine; a language
// model is used only when the project has configured a key for it.
//
// The candidate list travels client → server on purpose: the app has already
// paid for those provider calls this session, and re-fetching them inside the
// Cloud Function would double the spend for identical data. The server treats
// the list strictly as an allowlist — it never trusts it as *truth*, it only
// uses it to constrain what the model is allowed to pick.

struct AdventureStop: Identifiable, Sendable, Hashable {
    let placeId: String
    let name: String
    let category: String?
    let latitude: Double?
    let longitude: Double?
    let order: Int
    let minutes: Int
    let why: String

    var id: String { placeId }
}

struct AdventurePlan: Sendable, Hashable {
    let title: String
    let intro: String
    let stops: [AdventureStop]
    let weatherSummary: String?
    let temperatureF: Int?
    /// One-line notes from the planner (sunset time, heat, rain, unposted hours).
    /// Empty when the server predates them.
    var notes: [String] = []

    var totalMinutes: Int { stops.reduce(0) { $0 + $1.minutes } }

    /// Free-tier plans left this month. `nil` for members (unlimited) and for
    /// a server that predates the quota.
    var plansRemaining: Int? = nil
    var isPlus: Bool = false
}

enum AdventurePlannerError: LocalizedError, Sendable {
    case notSignedIn
    case notEnoughPlaces
    case notConfigured
    case rateLimited(String)
    /// The free monthly quota is spent. Deliberately its OWN case rather than a
    /// flavour of `rateLimited`: this one is a sales moment, and the view routes
    /// it to the paywall instead of showing an error. Keyed off the server's
    /// `reason` detail, never off message text, so copy edits can't break it.
    case quotaExhausted(limit: Int, resetsOn: Date?)
    case offline
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Sign in to plan an adventure."
        case .notEnoughPlaces: return "Not enough nearby places to plan an outing yet. Try again once Explore has loaded."
        case .notConfigured: return "The planner isn't switched on yet."
        case .rateLimited(let m): return m
        case .quotaExhausted(let limit, _):
            return "You've used all \(limit) free plans this month."
        case .offline: return "Plan generation is available when you're back online."
        case .failed(let m): return m
        }
    }
}

final class AdventurePlannerService: Sendable {

    init() {}

    func plan(places: [Place],
              interests: [String],
              timeOfDay: String,
              durationMinutes: Int,
              latitude: Double,
              longitude: Double) async throws -> AdventurePlan {

        guard await NetworkStatus.shared.isOnline else { throw AdventurePlannerError.offline }

        // Only places with real coordinates are worth planning around — a stop
        // we can't navigate to isn't a stop. This mirrors the app's rule that
        // coordinates are never fabricated.
        let candidates: [[String: any Sendable]] = places
            .filter { $0.latitude != nil && $0.longitude != nil }
            .prefix(40)
            .map { p in
                var dict: [String: any Sendable] = [
                    "id": p.id,
                    "name": p.name,
                    "category": p.category.rawValue,
                ]
                if let lat = p.latitude { dict["latitude"] = lat }
                if let lon = p.longitude { dict["longitude"] = lon }
                if let hours = p.openHoursReal { dict["hours"] = hours }
                if p.photoURL != nil { dict["hasPhoto"] = true }
                return dict
            }

        guard candidates.count >= 2 else { throw AdventurePlannerError.notEnoughPlaces }

        let payload: [String: any Sendable] = [
            "lat": latitude,
            "lng": longitude,
            "interests": interests,
            "timeOfDay": timeOfDay,
            "durationMinutes": durationMinutes,
            "candidates": candidates,
        ]

        do {
            let result = try await Functions.functions().httpsCallable("planAdventure").call(payload)
            guard let data = result.data as? [String: Any] else {
                throw AdventurePlannerError.failed("The planner returned nothing.")
            }
            return Self.decode(data)
        } catch let error as NSError {
            throw Self.mapError(error)
        }
    }

    private static func decode(_ data: [String: Any]) -> AdventurePlan {
        let rawStops = data["stops"] as? [[String: Any]] ?? []
        let stops = rawStops.enumerated().map { index, s in
            AdventureStop(
                placeId: s["placeId"] as? String ?? "",
                name: s["name"] as? String ?? "",
                category: s["category"] as? String,
                latitude: s["latitude"] as? Double,
                longitude: s["longitude"] as? Double,
                order: s["order"] as? Int ?? index + 1,
                minutes: s["minutes"] as? Int ?? 30,
                why: s["why"] as? String ?? ""
            )
        }
        let weather = data["weather"] as? [String: Any]
        return AdventurePlan(
            title: data["title"] as? String ?? "Your outing",
            intro: data["intro"] as? String ?? "",
            stops: stops,
            weatherSummary: weather?["summary"] as? String,
            temperatureF: weather?["temperatureF"] as? Int,
            notes: (data["notes"] as? [String] ?? []).map { Sanitize.text($0, max: 200) }.filter { !$0.isEmpty },
            plansRemaining: data["plansRemaining"] as? Int,
            isPlus: data["isPlus"] as? Bool ?? false
        )
    }

    private static func mapError(_ error: NSError) -> AdventurePlannerError {
        if error.domain == NSURLErrorDomain { return .offline }
        if error.domain == FunctionsErrorDomain {
            switch FunctionsErrorCode(rawValue: error.code) {
            case .unauthenticated: return .notSignedIn
            case .permissionDenied:
                // Read the structured details, not the sentence. The server
                // sends { reason: "planner_quota_exhausted", limit, resetsOn }.
                let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
                if details?["reason"] as? String == "planner_quota_exhausted" {
                    let limit = details?["limit"] as? Int ?? 5
                    let resets = (details?["resetsOn"] as? String).flatMap {
                        ISO8601DateFormatter().date(from: $0)
                    }
                    return .quotaExhausted(limit: limit, resetsOn: resets)
                }
                return .failed(error.localizedDescription)
            case .resourceExhausted: return .rateLimited(error.localizedDescription)
            case .failedPrecondition:
                // The server explains itself ("Everything nearby is closed at this
                // hour", "Not enough nearby places…"): show its sentence rather than
                // a fixed one that may be wrong for the situation.
                return error.localizedDescription.localizedCaseInsensitiveContains("configured")
                    ? .notConfigured : .failed(error.localizedDescription)
            case .unavailable, .deadlineExceeded: return .offline
            // .notFound is the pre-deploy state: the callable doesn't exist yet.
            case .notFound: return .notConfigured
            default: break
            }
        }
        return .failed(error.localizedDescription)
    }
}

// MARK: - Time of day

extension AdventurePlannerService {
    /// Plain-English slot used in the prompt, from the user's own clock.
    static func currentTimeOfDay(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        switch calendar.component(.hour, from: date) {
        case 5..<11:  return "morning"
        case 11..<14: return "midday"
        case 14..<17: return "afternoon"
        case 17..<20: return "evening"
        default:      return "night"
        }
    }
}
