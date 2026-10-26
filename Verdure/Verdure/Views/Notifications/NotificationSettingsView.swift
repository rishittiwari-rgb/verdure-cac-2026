import SwiftUI

// MARK: - Notification settings
//
// Every control here writes to the SERVER (users/{uid}.notificationPrefs),
// because that is where the fan-out reads them. See NotificationPreferences for
// why a local-only toggle is worse than no toggle at all.

struct NotificationSettingsView: View {

    @State private var prefs = NotificationPreferences()
    @State private var liveAlerts = LivePartnerAlerts.shared
    @State private var showLiveConsent = false
    @State private var systemAuthorized = NotificationManager.shared.permissionGranted
    @Environment(\.dismiss) private var dismiss

    private let hours = Array(0...23)

    var body: some View {
        NavigationStack {
            ZStack {
                VerdureBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        if !systemAuthorized { systemOffBanner }
                        whatWeSend
                        if liveAlerts.eligible { liveLocationConsent }
                        quietHours
                        promise
                        if let err = prefs.lastError { errorNote(err) }
                    }
                    .padding(Spacing.lg)
                    .padding(.bottom, Spacing.xxl)
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.font(VType.scaledBody(16, .medium))
                }
            }
            .task {
                await prefs.load()
                await liveAlerts.load()
                NotificationManager.shared.refreshPermissionStatus()
                systemAuthorized = NotificationManager.shared.permissionGranted
            }
        }
        .sheet(isPresented: $showLiveConsent) {
            NavigationStack {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text("Deals as you walk nearby").font(VType.display(25, .semibold))
                    Text("Allow Verdure to send promotional notifications when you walk near a participating partner. This optional feature needs Always location so iOS can notice nearby regions while the app is closed. It monitors up to 20 nearby partners using region monitoring and significant location changes, without continuous GPS. A recent location is sent to Verdure to check proximity; it isn't saved or shared with partners. Alerts count toward the same two-per-week limit and respect quiet hours. You can switch them off here at any time.")
                        .font(VType.scaledBody(16, relativeTo: .body))
                    ClayButton("I agree — enable nearby deals", systemImage: "location", kind: .spruce, fullWidth: true) {
                        showLiveConsent = false; Task { await liveAlerts.optIn() }
                    }.accessibilityIdentifier("confirmLivePartnerConsent")
                    Button("Not now") { showLiveConsent = false }.frame(minHeight: 44)
                    Spacer()
                }.padding(Spacing.lg).navigationTitle("Nearby deals")
            }
        }
    }

    private var liveLocationConsent: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Toggle("Tell me about deals near me", isOn: Binding(get: { liveAlerts.enabled }, set: { on in
                if on { showLiveConsent = true } else { Task { await liveAlerts.optOut() } }
            })).tint(Palette.spruce.base).accessibilityIdentifier("livePartnerAlertsToggle")
            Text("Optional promotional alerts as you walk near a partner. Off by default; uses Always location. Counts toward the same two-per-week limit.")
                .font(VType.scaledBody(13)).foregroundStyle(Palette.inkSoft)
            if liveAlerts.enabled, liveAlerts.authorization != .authorizedAlways {
                Text("Alerts are paused until Always location is allowed. All other features work with your usual location permission.")
                    .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                Button("Finish location permission setup") { showLiveConsent = true }.frame(minHeight: 44)
                Button("Open iOS Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }.frame(minHeight: 44)
            }
            if let error = liveAlerts.error { Text(error).font(VType.body(13)).foregroundStyle(Palette.danger) }
        }.padding(Spacing.md).claySurface(.surface, radius: Radius.md)
    }

    /// If iOS permission is off, every switch below is inert. Saying so is the
    /// difference between a settings screen and a decorative one.
    private var systemOffBanner: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Label("Notifications are off for Verdure", systemImage: "bell.slash.fill")
                .font(VType.scaledBody(15, .semibold))
                .foregroundStyle(Palette.ink)
            Text("These settings are saved, but nothing can be delivered until you turn notifications on for Verdure in iOS Settings.")
                .font(VType.scaledBody(13))
                .foregroundStyle(Palette.inkSoft)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .font(VType.scaledBody(14, .medium))
            .foregroundStyle(Palette.spruce.base)
            .frame(minHeight: 44)
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: .inset, radius: Radius.md))
        .accessibilityElement(children: .combine)
    }

    private var whatWeSend: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ClaySectionHeader(kicker: "Notifications", title: "What we send")
            toggleRow(
                title: "Event suggestions",
                detail: "A short ranked list of things near you, at most twice a week.",
                isOn: prefs.prefs.eventSuggestions
            ) { on in
                var next = prefs.prefs; next.eventSuggestions = on
                Task { await prefs.save(next) }
            }
            toggleRow(
                title: "Friend activity",
                detail: "When someone you follow RSVPs to an event you saved.",
                isOn: prefs.prefs.friendActivity
            ) { on in
                var next = prefs.prefs; next.friendActivity = on
                Task { await prefs.save(next) }
            }
            toggleRow(
                title: "Offers near events I'm going to",
                detail: "Send a partner offer before an event I RSVP to, using its venue location. No background location. Counts toward the same two-per-week limit.",
                isOn: prefs.prefs.rsvpPartnerOffers
            ) { on in
                var next = prefs.prefs; next.rsvpPartnerOffers = on
                Task { await prefs.save(next) }
            }
        }
    }

    private var quietHours: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ClaySectionHeader(kicker: "Timing", title: "Quiet hours")
            Text("Nothing is delivered during this window, in your local time.")
                .font(VType.scaledBody(13))
                .foregroundStyle(Palette.inkSoft)
            HStack(spacing: Spacing.md) {
                hourPicker("From", value: prefs.prefs.quietStart) { h in
                    var next = prefs.prefs; next.quietStart = h
                    Task { await prefs.save(next) }
                }
                hourPicker("Until", value: prefs.prefs.quietEnd) { h in
                    var next = prefs.prefs; next.quietEnd = h
                    Task { await prefs.save(next) }
                }
            }
            Text(NotificationPreferences.describeQuietHours(
                    start: prefs.prefs.quietStart, end: prefs.prefs.quietEnd))
                .font(VType.scaledNum(15, .bold))
                .foregroundStyle(Palette.ink)
                .accessibilityLabel("Quiet from \(NotificationPreferences.hourLabel(prefs.prefs.quietStart)) until \(NotificationPreferences.hourLabel(prefs.prefs.quietEnd))")
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: .surface, radius: Radius.md))
    }

    private var promise: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.spruce.base)
            Text("Verdure will never send more than two notifications a week, whatever is switched on above. That limit is enforced on our servers, not in this app.")
                .font(VType.scaledBody(13))
                .foregroundStyle(Palette.inkSoft)
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: .inset, radius: Radius.md))
        .accessibilityElement(children: .combine)
    }

    private func errorNote(_ message: String) -> some View {
        Text(message)
            .font(VType.scaledBody(13, .medium))
            .foregroundStyle(Palette.terracotta.base)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func toggleRow(title: String, detail: String, isOn: Bool,
                           set: @escaping (Bool) -> Void) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(VType.scaledBody(15, .semibold)).foregroundStyle(Palette.ink)
                Text(detail).font(VType.scaledBody(13)).foregroundStyle(Palette.inkSoft)
            }
            Spacer(minLength: Spacing.sm)
            Toggle("", isOn: Binding(get: { isOn }, set: set))
                .labelsHidden()
                .tint(Palette.spruce.base)
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: .surface, radius: Radius.md))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityValue(isOn ? "On" : "Off")
        .accessibilityHint(detail)
    }

    private func hourPicker(_ label: String, value: Int,
                            set: @escaping (Int) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(VType.scaledBody(12, .medium)).foregroundStyle(Palette.inkSoft)
            Picker(label, selection: Binding(get: { value }, set: set)) {
                ForEach(hours, id: \.self) { h in
                    Text(NotificationPreferences.hourLabel(h)).tag(h)
                }
            }
            .pickerStyle(.menu)
            .tint(Palette.ink)
            .frame(minHeight: 44)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
