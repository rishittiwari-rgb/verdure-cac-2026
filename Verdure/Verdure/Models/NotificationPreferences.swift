import SwiftUI
import Observation
import FirebaseFunctions

// MARK: - Notification preferences (server-owned)
//
// These live on the SERVER, at users/{uid}.notificationPrefs, and the fan-out
// in functions/src/notifications.ts reads them there.
//
// That is the whole point. A toggle stored only in UserDefaults is not a
// setting — the scheduled digest runs on a server that has never seen the
// device, so a local-only "off" switch turns off the row in Settings and
// nothing else. The user keeps getting push, concludes the toggle is a lie, and
// disables notifications at the OS level, which cannot be undone from in here.

@MainActor
@Observable
final class NotificationPreferences {

    struct Prefs: Equatable, Sendable {
        var eventSuggestions = true
        var friendActivity = true
        var rsvpPartnerOffers = false
        /// Local hour (0–23). Start may be greater than end — the window wraps.
        var quietStart = 21
        var quietEnd = 8
        var timeZone = TimeZone.current.identifier
    }

    private(set) var prefs = Prefs()
    private(set) var isLoading = false
    private(set) var lastError: String?
    /// True once the server's copy has been read, so the UI can avoid showing
    /// defaults as though they were the user's choices.
    private(set) var hasLoaded = false

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await Functions.functions().httpsCallable("getNotificationPrefs").call()
            if let d = result.data as? [String: Any] { prefs = Self.parse(d) }
            hasLoaded = true
            lastError = nil
        } catch {
            // Not fatal: the screen still renders and the user can still change
            // things. Saying so is better than silently showing defaults.
            lastError = "Couldn't load your notification settings."
        }
    }

    /// Save and adopt whatever the server echoes back — it is the authority on
    /// what was actually stored, including any clamping it applied.
    @discardableResult
    func save(_ next: Prefs) async -> Bool {
        let previous = prefs
        prefs = next                     // optimistic, so the toggle feels instant
        do {
            let result = try await Functions.functions().httpsCallable("setNotificationPrefs").call([
                "eventSuggestions": next.eventSuggestions,
                "friendActivity": next.friendActivity,
                "rsvpPartnerOffers": next.rsvpPartnerOffers,
                "quietStart": next.quietStart,
                "quietEnd": next.quietEnd,
                "timeZone": next.timeZone,
            ])
            if let d = result.data as? [String: Any] { prefs = Self.parse(d) }
            lastError = nil
            return true
        } catch {
            prefs = previous             // roll back rather than lie about state
            lastError = "Couldn't save that. Check your connection."
            return false
        }
    }

    static func parse(_ d: [String: Any]) -> Prefs {
        var p = Prefs()
        if let v = d["eventSuggestions"] as? Bool { p.eventSuggestions = v }
        if let v = d["friendActivity"] as? Bool { p.friendActivity = v }
        if let v = d["rsvpPartnerOffers"] as? Bool { p.rsvpPartnerOffers = v }
        if let v = d["quietStart"] as? Int, (0...23).contains(v) { p.quietStart = v }
        if let v = d["quietEnd"] as? Int, (0...23).contains(v) { p.quietEnd = v }
        if let v = d["timeZone"] as? String, !v.isEmpty { p.timeZone = v }
        return p
    }

    /// "9:00 PM – 8:00 AM", in the user's locale.
    static func describeQuietHours(start: Int, end: Int) -> String {
        guard start != end else { return "Off" }
        return "\(hourLabel(start)) – \(hourLabel(end))"
    }

    static func hourLabel(_ hour: Int) -> String {
        var c = DateComponents(); c.hour = hour; c.minute = 0
        let date = Calendar.current.date(from: c) ?? Date()
        let f = DateFormatter()
        f.locale = .current
        f.setLocalizedDateFormatFromTemplate("j:mm")
        return f.string(from: date)
    }
}
