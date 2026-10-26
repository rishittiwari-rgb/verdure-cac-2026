import Foundation
import FirebaseAuth
import FirebaseFirestore

// MARK: - Analytics
//
// WHY THIS EXISTS AND WHY IT IS URGENT.
//
// Behavioural data cannot be backfilled. Every day this is not instrumented is
// a day whose answers are gone permanently — not delayed, gone. That is the
// entire argument for shipping it before features that feel more valuable.
//
// THE SCHEMA IS DESIGNED AROUND TWO QUESTIONS, and it is worth writing them
// down because a schema that cannot answer a specific question is decoration:
//
//   Q1. "Of people who saved an event, what share actually attended one within
//        14 days — and does that differ for people who got a notification?"
//        Needs: event_saved, event_rsvp, checkin_succeeded, push_opened, all
//        carrying a stable per-install id and a timestamp. The cohort is
//        defined by the first event_saved; the outcome by any later
//        checkin_succeeded within the window.
//
//   Q2. "Do people who use the Adventure Planner come back more than people who
//        don't?"
//        Needs: planner_opened, planner_completed, app_opened, same id. The
//        cohort is anyone with a planner_completed; the outcome is count of
//        distinct days with app_opened in the following 30.
//
// PRIVACY. There is no name, no email, no precise location, and no event
// content in any payload. The identifier is a per-INSTALL UUID in UserDefaults
// which is deliberately not the Firebase uid: it survives sign-out (so the
// funnel does not break when someone logs out mid-session) and it is discarded
// on uninstall. Signed-in records also carry the uid and are deleted during account deletion.
// The install id remains on the device until uninstall.

@MainActor
enum Analytics {

    // MARK: Event names
    //
    // A closed set, not free strings. A typo in a call site is otherwise a
    // silently-missing row that nobody notices until the question is asked and
    // the data isn't there.
    enum Event: String {
        case appOpened = "app_opened"
        case eventSaved = "event_saved"
        case eventRSVP = "event_rsvp"
        case checkinAttempted = "checkin_attempted"
        case checkinSucceeded = "checkin_succeeded"
        case checkinBlocked = "checkin_blocked"          // + reason: too_far / no_photo
        case plannerOpened = "planner_opened"
        case plannerCompleted = "planner_completed"
        case plannerQuotaHit = "planner_quota_hit"
        case paywallShown = "paywall_shown"              // + source
        case paywallPurchased = "paywall_purchased"
        case perkViewed = "perk_viewed"
        case perkRedeemed = "perk_redeemed"
        case perkDismissed = "perk_dismissed"
        case pushOpened = "push_opened"                  // + kind
        case pushPrimerShown = "push_primer_shown"
        case pushPrimerAccepted = "push_primer_accepted"
        case rewardRedeemed = "reward_redeemed"
        case searchPerformed = "search_performed"
        case inviteSent = "invite_sent"
        case inviteAccepted = "invite_accepted"
    }

    /// Per-install id. Not the uid — see the privacy note above.
    static var installID: String {
        let key = "analyticsInstallID"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: key)
        return fresh
    }

    /// Opt-out, honoured before anything is written.
    static var isEnabled: Bool {
        get { !UserDefaults.standard.bool(forKey: "analyticsOptOut") }
        set { UserDefaults.standard.set(!newValue, forKey: "analyticsOptOut") }
    }

    /// Log one event.
    ///
    /// Fire-and-forget and failure-tolerant on purpose: analytics must never
    /// block, slow, or break a user action. A dropped row is a worse dataset;
    /// a thrown error here would be a worse product.
    static func log(event: Event, params: [String: Any] = [:]) {
        guard isEnabled else { return }

        let day = Self.dayKey()
        let name = event.rawValue
        let payload: [String: Any] = [
            "event": event.rawValue,
            "installID": installID,
            // Present only so per-account questions are answerable at all; a
            // signed-out row is still a valid row.
            "uid": Auth.auth().currentUser?.uid ?? NSNull(),
            "ts": FieldValue.serverTimestamp(),
            "clientTs": Date().timeIntervalSince1970,
            "params": sanitize(params),
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?",
        ]

        // `[String: Any]` is not Sendable, so the write is issued right here
        // with the completion-handler API rather than handed to a Task (Swift 6
        // region checking rejects sending `payload` into one). `addDocument`
        // does not block on the network — Firestore queues it and retries — so
        // this is still fire-and-forget from the caller's point of view.
        let ref = Firestore.firestore().collection("analytics").document(day).collection("events")
        ref.addDocument(data: payload) { error in
            // Intentionally silent in release. A failed analytics write is
            // not something to tell a user about.
            #if DEBUG
            if let error { print("[Analytics] \(name) failed: \(error.localizedDescription)") }
            #endif
        }
    }

    /// yyyy-MM-dd in UTC, matching /analytics/{yyyy-mm-dd}/events.
    static func dayKey(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: date)
    }

    /// Params are ours, but they pass through user-influenced values (a search
    /// term, an error message). Bound them so one long string can't bloat a
    /// document, and drop anything that isn't a primitive.
    static func sanitize(_ params: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in params.prefix(12) {
            let key = String(k.prefix(40))
            switch v {
            case let s as String: out[key] = String(s.prefix(120))
            case let i as Int: out[key] = i
            case let d as Double: out[key] = d
            case let b as Bool: out[key] = b
            default: continue
            }
        }
        return out
    }
}
