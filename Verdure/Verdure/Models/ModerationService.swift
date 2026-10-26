import Foundation
import Observation
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseAuth

// MARK: - Moderation Service (reports + blocks)
//
// App Review guideline 1.2 for user-generated content: users must be able to
// report objectionable content, block abusive accounts, and reach us about a
// concern. This service is the client end of that contract:
//
//   • Reports go to the `reportContent` callable. The SERVER queues them,
//     auto-hides content at the reporter threshold, and removes anything staff
//     have not reviewed within 24 hours. The client only files the report.
//   • Blocks live at users/{uid}/blocks/{targetUid} (owner-writable). The server
//     enforces them symmetrically on every social surface; this class keeps a
//     local copy so feeds can hide blocked authors instantly, even offline.
//
// Nothing here decides what stays up. That decision is server-side, always.

/// Mirrors REPORT_REASONS in functions/src/moderation.ts — the server rejects
/// anything not on this list.
enum ReportReason: String, CaseIterable, Identifiable {
    case spam, harassment, hate, sexual, violence, dangerous, misinformation, impersonation, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .spam: return "Spam or advertising"
        case .harassment: return "Harassment or bullying"
        case .hate: return "Hate speech"
        case .sexual: return "Sexual content"
        case .violence: return "Violence or threats"
        case .dangerous: return "Dangerous or unsafe activity"
        case .misinformation: return "False information"
        case .impersonation: return "Impersonation"
        case .other: return "Something else"
        }
    }

    var icon: String {
        switch self {
        case .spam: return "megaphone.fill"
        case .harassment: return "person.crop.circle.badge.exclamationmark"
        case .hate: return "hand.raised.fill"
        case .sexual: return "eye.slash.fill"
        case .violence: return "exclamationmark.triangle.fill"
        case .dangerous: return "bolt.trianglebadge.exclamationmark.fill"
        case .misinformation: return "questionmark.bubble.fill"
        case .impersonation: return "theatermasks.fill"
        case .other: return "ellipsis.bubble.fill"
        }
    }
}

/// What kind of thing is being reported. Mirrors TargetType on the server.
enum ReportTarget: String {
    case post, event, user, organizer
    case placeStory = "place_story"
}

@MainActor @Observable
final class ModerationService {

    /// Published contact for content concerns — the same address is in
    /// AppStore/LISTING.md and functions/src/moderation.ts. Keep all three equal.
    /// Mirrors `Legal.contactEmail` — one literal, declared there.
    static let contactEmail = Legal.contactEmail

    /// Distinct reporters that hide content automatically (server constant, shown in copy).
    static let autoHideThreshold = 3

    // MARK: - State

    /// Accounts this user has blocked. Loaded from Firestore on sign-in and
    /// cached locally so feeds can hide blocked authors before the network answers.
    private(set) var blockedUserIDs: Set<String> = []
    /// Display names captured at block time, for the Blocked Users list.
    private(set) var blockedNames: [String: String] = [:]
    var lastError: String?

    private var db: Firestore { Firestore.firestore() }
    private let functions = FunctionsService()
    private static let cacheKey = "moderation.blockedUsers.v1"

    init() { loadCache() }

    // MARK: - Blocks

    func isBlocked(_ uid: String?) -> Bool {
        guard let uid else { return false }
        return blockedUserIDs.contains(uid)
    }

    /// Pull the authoritative block list for the signed-in user.
    func refreshBlocks() async {
        guard let uid = Auth.auth().currentUser?.uid else { return }
        do {
            let snap = try await db.collection("users").document(uid).collection("blocks").getDocuments()
            var ids = Set<String>()
            var names: [String: String] = [:]
            for doc in snap.documents {
                ids.insert(doc.documentID)
                if let name = doc.data()["displayName"] as? String {
                    names[doc.documentID] = Sanitize.text(name, max: 100)
                }
            }
            blockedUserIDs = ids
            blockedNames = names
            saveCache()
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Block another account. Optimistic: the local set updates immediately so
    /// the author disappears from every feed on this device at once.
    func block(uid target: String, displayName: String?) async -> Bool {
        guard let uid = Auth.auth().currentUser?.uid, target != uid, !target.isEmpty else { return false }
        blockedUserIDs.insert(target)
        if let displayName { blockedNames[target] = displayName }
        saveCache()
        var data: [String: Any] = ["uid": target, "createdAt": FieldValue.serverTimestamp()]
        if let displayName, !displayName.isEmpty { data["displayName"] = String(displayName.prefix(100)) }
        do {
            try await db.collection("users").document(uid).collection("blocks").document(target).setData(data)
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func unblock(uid target: String) async -> Bool {
        guard let uid = Auth.auth().currentUser?.uid else { return false }
        blockedUserIDs.remove(target)
        blockedNames.removeValue(forKey: target)
        saveCache()
        do {
            try await db.collection("users").document(uid).collection("blocks").document(target).delete()
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    /// Forget the cached list on sign-out so the next account starts clean.
    func clearLocal() {
        blockedUserIDs = []
        blockedNames = [:]
        UserDefaults.standard.removeObject(forKey: Self.cacheKey)
    }

    // MARK: - Reports

    /// File a report. Returns a user-facing outcome; never throws to the UI.
    func report(_ target: ReportTarget, id: String, reason: ReportReason, details: String) async -> ReportOutcome {
        guard Auth.auth().currentUser != nil else { return .failed("Sign in to report content.") }
        do {
            let reported = try await functions.reportContent(
                targetType: target.rawValue, targetId: id, reason: reason.rawValue,
                details: String(details.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000)))
            return reported ? .filed : .failed("The report couldn't be filed. Please try again.")
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    enum ReportOutcome: Equatable {
        case filed
        case failed(String)
    }

    // MARK: - Cache

    private struct Cache: Codable { let ids: [String]; let names: [String: String] }

    private func loadCache() {
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey),
              let cache = try? JSONDecoder().decode(Cache.self, from: data) else { return }
        blockedUserIDs = Set(cache.ids)
        blockedNames = cache.names
    }

    private func saveCache() {
        let cache = Cache(ids: Array(blockedUserIDs), names: blockedNames)
        if let data = try? JSONEncoder().encode(cache) {
            UserDefaults.standard.set(data, forKey: Self.cacheKey)
        }
    }
}
