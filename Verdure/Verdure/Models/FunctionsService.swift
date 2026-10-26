import Foundation
@preconcurrency import FirebaseFunctions

// MARK: - Functions Service (server-authoritative game actions)
//
// Thin wrapper around the Cloud Functions callables that own ALL point math.
// The client never writes points / check-ins / redemptions to Firestore directly
// (the security rules deny it) — it asks the server and adopts the returned truth.
// See functions/src/index.ts for the matching server code.
//
// Stateless + Sendable: the non-Sendable Firebase payload/result dictionaries are
// created and consumed entirely inside each call, so only Sendable value types
// cross actor boundaries (Swift 6 friendly).

/// Outcome of checkInToEvent / collectPlace.
struct ServerAwardResult: Sendable {
    let alreadyDone: Bool     // idempotent no-op (double check-in / double collect)
    let awarded: Int
    let newBalance: Int?
    let newLifetime: Int?
}

/// Outcome of redeemReward.
struct ServerRedeemResult: Sendable {
    let redeemed: Bool
    let remaining: Int
    /// "cash" or "perk". The server decides which branch ran; the client must
    /// not infer it from the id, because only the server knows the catalog.
    let kind: String
    /// Perk redemptions return the claimed code. Dropping it (as this type used
    /// to) makes the perk flow impossible to complete — the user spends points
    /// and is never shown what they bought.
    let code: String?
    let title: String?
    let partner: String?
}

enum ServerCallError: LocalizedError, Sendable {
    case notSignedIn
    case offline
    case alreadyRedeemed
    case notEnoughPoints
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Sign in to continue."
        case .offline: return "Available when you're back online."
        case .alreadyRedeemed: return "You've already redeemed this reward."
        case .notEnoughPoints: return "Not enough points yet."
        case .server(let message): return message
        }
    }
}

final class FunctionsService: Sendable {

    init() {}

    // MARK: - Callables

    func checkInToEvent(eventId: String, category: String, claimedPoints: Int,
                        proofPath: String?, lat: Double?, lon: Double?) async throws -> ServerAwardResult {
        var payload: [String: any Sendable] = [
            "eventId": eventId,
            "category": category,
            "claimedPoints": claimedPoints,
        ]
        // Attendance evidence — the server rejects check-ins without these.
        if let proofPath { payload["proofPath"] = proofPath }
        if let lat { payload["lat"] = lat }
        if let lon { payload["lng"] = lon }
        let data = try await Self.call("checkInToEvent", payload)
        return ServerAwardResult(
            alreadyDone: data["alreadyCheckedIn"] as? Bool ?? false,
            awarded: data["awarded"] as? Int ?? 0,
            newBalance: data["newBalance"] as? Int,
            newLifetime: data["newLifetime"] as? Int
        )
    }

    func collectPlace(placeId: String, claimedPoints: Int,
                      lat: Double? = nil, lon: Double? = nil) async throws -> ServerAwardResult {
        var payload: [String: any Sendable] = [
            "placeId": placeId,
            "claimedPoints": claimedPoints,
        ]
        if let lat { payload["lat"] = lat }
        if let lon { payload["lng"] = lon }
        let data = try await Self.call("collectPlace", payload)
        return ServerAwardResult(
            alreadyDone: data["alreadyCollected"] as? Bool ?? false,
            awarded: data["awarded"] as? Int ?? 0,
            newBalance: data["newBalance"] as? Int,
            newLifetime: data["newLifetime"] as? Int
        )
    }

    func redeemReward(rewardId: String) async throws -> ServerRedeemResult {
        // Preserve server messages: the refusals here are user-facing and
        // specific ("Verdure+ early access…", "out of codes for now").
        let data = try await Self.callPreservingMessages("redeemReward", ["rewardId": rewardId])
        return ServerRedeemResult(
            redeemed: data["redeemed"] as? Bool ?? false,
            remaining: data["remaining"] as? Int ?? 0,
            kind: data["kind"] as? String ?? "cash",
            code: data["code"] as? String,
            title: data["title"] as? String,
            partner: data["partner"] as? String
        )
    }

    // MARK: - Verdure+ (server-verified entitlement)

    /// The UUID to attach to a StoreKit purchase so Apple records which Verdure
    /// account made it. Derived server-side from the uid — see subscriptions.ts.
    func appAccountToken() async throws -> String {
        let data = try await Self.call("getAppAccountToken", [:])
        guard let token = data["appAccountToken"] as? String else {
            throw ServerCallError.server("No account token returned.")
        }
        return token
    }

    /// Ask the server to verify a purchase with Apple and record the entitlement.
    /// Returns whether the server considers Verdure+ currently active.
    @discardableResult
    func linkSubscription(transactionId: String) async throws -> Bool {
        let data = try await Self.call("linkSubscription", ["transactionId": transactionId])
        return data["plus"] as? Bool ?? false
    }

    /// Re-check the entitlement the server already has for this account, with no
    /// local StoreKit transaction involved. Used as the Restore fallback when
    /// StoreKit returns nothing but the server holds a verified subscription.
    func refreshMySubscription() async throws -> Bool {
        let data = try await Self.call("refreshMySubscription", [:])
        return data["plus"] as? Bool ?? false
    }

    // MARK: - Moderation (App Review 1.2)

    /// File a report against a post, event, organizer or user. The server queues
    /// it, auto-hides the content at the reporter threshold, and guarantees a
    /// decision within 24 hours (see functions/src/moderation.ts).
    func reportContent(targetType: String, targetId: String, reason: String, details: String) async throws -> Bool {
        let data = try await Self.callPreservingMessages("reportContent", [
            "targetType": targetType, "targetId": targetId, "reason": reason, "details": details,
        ])
        return data["reported"] as? Bool ?? false
    }

    // MARK: - Account lifecycle

    /// Permanently delete the signed-in account and everything it owns. The
    /// server does the deletion (Firestore, Storage, Auth) so nothing can be
    /// left behind by a client that crashes halfway through.
    func deleteAccount() async throws {
        _ = try await Self.callPreservingMessages("deleteAccount", [:])
    }

    // MARK: - Plumbing

    /// Like `call`, but keeps the server's own message for the business-rule
    /// failures (`failed-precondition`, `permission-denied`, `not-found`) instead
    /// of translating them into the points-specific wording `mapError` uses.
    private static func callPreservingMessages(_ name: String, _ payload: [String: any Sendable]) async throws -> [String: Any] {
        do {
            let result = try await Functions.functions().httpsCallable(name).call(payload)
            return result.data as? [String: Any] ?? [:]
        } catch let error as NSError {
            if error.domain == FunctionsErrorDomain {
                switch FunctionsErrorCode(rawValue: error.code) {
                case .failedPrecondition, .permissionDenied, .notFound, .invalidArgument, .resourceExhausted:
                    throw ServerCallError.server(error.localizedDescription)
                default: break
                }
            }
            throw mapError(error)
        }
    }

    /// Runs a callable and returns its result dictionary. Both the payload and the
    /// result dictionary live entirely inside this nonisolated function's region.
    private static func call(_ name: String, _ payload: [String: any Sendable]) async throws -> [String: Any] {
        do {
            let result = try await Functions.functions().httpsCallable(name).call(payload)
            return result.data as? [String: Any] ?? [:]
        } catch let error as NSError {
            throw mapError(error)
        }
    }

    /// Map raw NSErrors from the Functions SDK / URL loading into typed errors.
    private static func mapError(_ error: NSError) -> ServerCallError {
        if error.domain == NSURLErrorDomain { return .offline }
        if error.domain == FunctionsErrorDomain {
            switch FunctionsErrorCode(rawValue: error.code) {
            case .unavailable, .deadlineExceeded, .internal, .notFound:
                // Network-ish / transient — safe to retry later (callables are
                // idempotent). .notFound covers the window where the Functions
                // aren't deployed yet: keep ops queued instead of dropping them.
                return .offline
            case .alreadyExists: return .alreadyRedeemed
            case .failedPrecondition: return .notEnoughPoints
            case .unauthenticated: return .notSignedIn
            default: break
            }
        }
        return .server(error.localizedDescription)
    }
}
