import Foundation
import SwiftUI
import Observation
import UserNotifications

// MARK: - In-app notification model

struct AppNotification: Identifiable, Codable {
    enum Kind: String, Codable {
        case event, badge, points, community, gem, system
        var icon: String {
            switch self {
            case .event: return "calendar.badge.clock"
            case .badge: return "rosette"
            case .points: return "sparkles"
            case .community: return "bubble.left.and.bubble.right.fill"
            case .gem: return "diamond.fill"
            case .system: return "leaf.fill"
            }
        }
        var kind: ClayStyle.ClayAccentKind {
            switch self {
            case .event: return .spruce
            case .badge: return .gold
            case .points: return .gold
            case .community: return .teal
            case .gem: return .terracotta
            case .system: return .spruce
            }
        }
    }
    var id = UUID()
    let kind: Kind
    let title: String
    let message: String
    let timeAgo: String
    var isRead: Bool = false
}

// MARK: - Notification manager (local notifications + in-app inbox)

@MainActor @Observable
final class NotificationManager {
    static let shared = NotificationManager()

    var inbox: [AppNotification] = []
    var permissionGranted = false
    /// User-facing on/off (in Settings). Local reminders are only scheduled when enabled.
    var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: "notificationsEnabled") }
    }

    var unreadCount: Int { inbox.filter { !$0.isRead }.count }

    private init() {
        self.enabled = UserDefaults.standard.object(forKey: "notificationsEnabled") as? Bool ?? true
        // Real inbox: persisted entries only — no fake seeded notifications.
        if let data = UserDefaults.standard.data(forKey: "notificationInbox"),
           let saved = try? JSONDecoder().decode([AppNotification].self, from: data) {
            self.inbox = saved
        }
        refreshPermissionStatus()
    }

    private func persistInbox() {
        if let data = try? JSONEncoder().encode(Array(inbox.prefix(50))) {
            UserDefaults.standard.set(data, forKey: "notificationInbox")
        }
    }

    // MARK: Permission

    /// Ask for notification permission.
    ///
    /// Routed through `PushService` so the ONE user-facing toggle enables both
    /// halves. Asking for authorization without also calling
    /// `registerForRemoteNotifications()` grants the prompt but never obtains an
    /// APNs token — local reminders would work, remote push would silently never
    /// arrive, and nothing in the UI would indicate why.
    func requestPermission() async {
        await PushService.shared.requestAuthorizationAndRegister()
    }

    /// Has iOS already been asked? Distinct from `permissionGranted`: a user
    /// who DENIED is "determined" but not granted, and re-prompting them shows
    /// nothing at all — so the primer must not appear for either answer.
    nonisolated static func authorizationDetermined() async -> Bool {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                cont.resume(returning: settings.authorizationStatus != .notDetermined)
            }
        }
    }

    func refreshPermissionStatus() {
        // Read the status off-actor (UNNotificationSettings isn't Sendable, and the
        // completion fires on a background queue), then hop back with just a Bool.
        Task.detached {
            let granted = await Self.currentAuthorization()
            await MainActor.run { Self.shared.permissionGranted = granted }
        }
    }

    nonisolated private static func currentAuthorization() async -> Bool {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                cont.resume(returning: settings.authorizationStatus == .authorized
                    || settings.authorizationStatus == .provisional)
            }
        }
    }

    // MARK: Inbox

    func markAllRead() {
        inbox = inbox.map { var n = $0; n.isRead = true; return n }
        persistInbox()
    }

    func push(_ notification: AppNotification) {
        inbox.insert(notification, at: 0)
        persistInbox()
    }

    // MARK: Local notifications

    /// Schedule a reminder the day before an event (or shortly out if it's near),
    /// and drop an entry into the in-app inbox.
    func scheduleEventReminder(for event: Event) {
        push(AppNotification(kind: .event, title: "Reminder set",
                             message: "We'll remind you before “\(event.title)”.", timeAgo: "now"))
        guard enabled, permissionGranted else { return }

        let content = UNMutableNotificationContent()
        content.title = "Upcoming: \(event.title)"
        content.body = "\(event.displayTime) · \(event.locationName)"
        content.sound = .default

        let cal = Calendar.current
        let dayBefore = cal.date(byAdding: .day, value: -1, to: event.date) ?? event.date
        let trigger: UNNotificationTrigger
        if dayBefore > Date() {
            var comps = cal.dateComponents([.year, .month, .day], from: dayBefore)
            comps.hour = 9
            trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        } else {
            // Event is imminent/past — fire a short confirmation instead.
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)
        }
        let request = UNNotificationRequest(identifier: "event-\(event.id)", content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    func cancelEventReminder(for event: Event) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["event-\(event.id)"])
    }

}
