import Foundation
import UIKit
import UserNotifications
import FirebaseMessaging
import FirebaseAuth
import FirebaseFirestore

// MARK: - Remote push (APNs via FCM)
//
// The app already had LOCAL notifications (event reminders scheduled on-device).
// This is the other half: notifications the SERVER sends — a reply on your post,
// an event you saved starting tomorrow — which local scheduling can't do because
// the device doesn't know they happened.
//
// WHAT THIS NEEDS THAT CODE CAN'T PROVIDE:
//   1. An APNs Auth Key (.p8) from the Apple Developer portal, uploaded to
//      Firebase → Project Settings → Cloud Messaging. Without it FCM has no way
//      to reach APNs and every send silently no-ops.
//   2. The Push Notifications capability on the App ID, which needs a
//      provisioning profile that includes it.
//   3. A real device. Push does not work in the simulator.
//
// Until 1–3 are done this class is inert but harmless: it asks for permission,
// gets no APNs token, and stores nothing.
//
// TOKEN HYGIENE. Tokens are stored per user at users/{uid}.fcmTokens and are
// REMOVED on sign-out. Skipping that is how people end up getting push for an
// account they logged out of on a shared phone.

@MainActor
final class PushService: NSObject {

    static let shared = PushService()

    private var currentToken: String?

    /// Wire up delegates. Call once, at launch, after FirebaseApp.configure().
    func start() {
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self
    }

    /// Ask for permission and register with APNs if granted.
    ///
    /// Deliberately NOT called at first launch: a permission prompt before the
    /// user knows what the app is gets denied, and a denial is close to
    /// permanent. Call it after a moment that earns it — saving an event,
    /// finishing a first check-in.
    func requestAuthorizationAndRegister() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        NotificationManager.shared.permissionGranted = granted
        guard granted else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Persist the FCM token against the signed-in user.
    ///
    /// `arrayUnion` rather than a plain set: one account can legitimately have
    /// several devices, and overwriting would silently disable push everywhere
    /// but the phone that logged in last.
    private func store(token: String) async {
        guard let uid = Auth.auth().currentUser?.uid else { return }
        currentToken = token
        do {
            try await Firestore.firestore().collection("users").document(uid)
                .setData(["fcmTokens": FieldValue.arrayUnion([token])], merge: true)
        } catch {
            // Not fatal — push is an enhancement, and the token is re-offered by
            // FCM on every launch, so a failed write self-heals.
            print("[PushService] couldn't store FCM token: \(error.localizedDescription)")
        }
    }

    /// Drop this device's token from the account being signed out of.
    ///
    /// MUST be called before `Auth.signOut()`, and captures the uid SYNCHRONOUSLY
    /// for that reason: sign-out is not async, so the Firestore write necessarily
    /// outlives it. Reading `Auth.auth().currentUser` inside the task would find
    /// nil (or worse, the next account) and either skip the cleanup or write to
    /// the wrong document. Capturing first makes the write independent of auth
    /// state by the time it runs.
    ///
    /// Skipping this is how a shared phone keeps receiving push for an account
    /// that logged out.
    nonisolated func unregisterCurrentDeviceOnSignOut() {
        Task { @MainActor in
            guard let uid = Auth.auth().currentUser?.uid, let token = currentToken else { return }
            currentToken = nil
            try? await Firestore.firestore().collection("users").document(uid)
                .setData(["fcmTokens": FieldValue.arrayRemove([token])], merge: true)
        }
    }

    /// Re-register after a sign-in, so the new account gets this device's token.
    func registerCurrentTokenForSignedInUser() async {
        if let token = try? await Messaging.messaging().token() {
            await store(token: token)
        }
    }
}

// MARK: - FCM token delivery

extension PushService: MessagingDelegate {
    nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { @MainActor in await self.store(token: fcmToken) }
    }
}

// MARK: - Foreground presentation + taps

extension PushService: UNUserNotificationCenterDelegate {

    /// Show banners while the app is open. Without this, a push that arrives
    /// during use is delivered silently and the user never learns it happened.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    /// Mirror a tapped push into the in-app inbox so history survives the banner.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let content = response.notification.request.content
        let title = content.title
        let body = content.body
        // Pull the two Strings we need OUT of userInfo here, on the delegate's
        // own isolation. `[AnyHashable: Any]` is not Sendable, so passing the
        // dictionary across to the main actor is a data race the compiler will
        // (correctly) refuse.
        let deepLink = content.userInfo["deepLink"] as? String
        let eventId = content.userInfo["eventId"] as? String
        await MainActor.run {
            NotificationManager.shared.push(
                AppNotification(kind: .community, title: title, message: body, timeAgo: "now")
            )
            // Route to what the push advertised.
            //
            // This fires on COLD LAUNCH too — iOS delivers the tap before
            // SwiftUI has built a view — so the router holds the destination
            // rather than broadcasting it, and MainTabView claims it when it
            // appears. Broadcasting here would drop precisely the taps that
            // launched the app, silently, and only on device.
            if let destination = DeepLinkRouter.destination(deepLink: deepLink, eventId: eventId) {
                DeepLinkRouter.shared.handle(destination)
            }
        }
    }
}

// MARK: - App delegate (APNs token hand-off)
//
// SwiftUI has no hook for `didRegisterForRemoteNotificationsWithDeviceToken`, and
// FCM cannot map an APNs token it never receives — so this bridge is required,
// not ceremonial.

final class VerdureAppDelegate: NSObject, UIApplicationDelegate {

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Expected in the simulator and on a build whose profile lacks the push
        // entitlement. Logged, not surfaced — the user can't act on it.
        print("[PushService] APNs registration failed: \(error.localizedDescription)")
    }
}
