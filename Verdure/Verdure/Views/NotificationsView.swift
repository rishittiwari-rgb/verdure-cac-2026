import SwiftUI

// MARK: - Notifications inbox

struct NotificationsInboxView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SocialService.self) private var social
    private var manager: NotificationManager { .shared }

    private var hasAnything: Bool { !manager.inbox.isEmpty || !social.notifications.isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                if !hasAnything {
                    emptyState
                } else {
                    LazyVStack(spacing: 10) {
                        // Server notifications first: invites, friends going, RSVP replies.
                        // These are what make the inbox social rather than a log.
                        ForEach(social.notifications) { note in serverRow(note) }
                        ForEach(manager.inbox) { note in row(note) }
                    }
                    .padding(Spacing.lg)
                    .padding(.bottom, Spacing.xl)
                }
            }
            .background(VerdureBackground())
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .task { await social.refreshAll() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if manager.unreadCount + social.unreadNotificationCount > 0 {
                        Button("Mark all read") {
                            withAnimation { manager.markAllRead() }
                            Task { await social.markAllNotificationsRead() }
                        }
                        .font(VType.body(13, .semibold)).tint(Palette.spruce.base)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                }
            }
            .onAppear { manager.refreshPermissionStatus() }
        }
    }

    private func row(_ note: AppNotification) -> some View {
        HStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: note.kind.icon, kind: note.kind.kind, size: 46, radius: Radius.chip)
            VStack(alignment: .leading, spacing: 3) {
                Text(note.title).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(note.message).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Spacing.sm)
            VStack(alignment: .trailing, spacing: 6) {
                Text(note.timeAgo).font(VType.body(11, .medium)).foregroundStyle(Palette.inkFaint)
                if !note.isRead { Circle().fill(Palette.teal.base).frame(width: 8, height: 8) }
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity)
        .claySurface(.surface, radius: Radius.md, elevation: note.isRead ? 0.5 : 0.9)
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            .strokeBorder(note.isRead ? Color.clear : note.kind.kind.accent.base.opacity(0.35), lineWidth: 1.5))
        .opacity(note.isRead ? 0.85 : 1)
    }

    // MARK: Server notifications (invites / friends going / RSVP replies)

    private func serverRow(_ note: ServerNotification) -> some View {
        let (icon, kind): (String, ClayStyle.ClayAccentKind) = {
            switch note.kind {
            case "invite": return ("paperplane.fill", .teal)
            case "friend-rsvp": return ("person.2.fill", .spruce)
            case "invite-accepted": return ("checkmark.circle.fill", .gold)
            default: return ("leaf.fill", .spruce)
            }
        }()
        let isGoing = note.eventId.map { social.isGoing($0) } ?? false
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                ClayIconTile(systemImage: icon, kind: kind, size: 46, radius: Radius.chip)
                VStack(alignment: .leading, spacing: 3) {
                    Text(note.title).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(note.body).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                        .lineLimit(3).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Spacing.sm)
                VStack(alignment: .trailing, spacing: 6) {
                    Text(relative(note.createdAt)).font(VType.body(11, .medium)).foregroundStyle(Palette.inkFaint)
                    if !note.read { Circle().fill(Palette.teal.base).frame(width: 8, height: 8) }
                }
            }
            // RSVP straight from the invite — the round-trip the sender is waiting on.
            if note.kind == "invite", let eventId = note.eventId {
                HStack(spacing: 10) {
                    Button {
                        Haptics.tap()
                        Task {
                            if await social.setGoing(eventId, going: true) { Haptics.success() }
                            await social.markNotificationRead(note.id)
                        }
                    } label: {
                        Label(isGoing ? "Going" : "I'm going", systemImage: isGoing ? "checkmark.circle.fill" : "person.crop.circle.badge.plus")
                            .font(VType.body(13, .bold))
                            .foregroundStyle(isGoing ? Palette.teal.onColor : Palette.ink)
                            .padding(.horizontal, 14).padding(.vertical, 9)
                    }
                    .buttonStyle(ClayPressButtonStyle(style: isGoing ? .accent(.teal) : .surface, radius: Radius.chip, elevation: 0.5))
                    .disabled(isGoing)
                    if !isGoing, let inviteId = note.inviteId {
                        Button {
                            Haptics.soft()
                            Task { await social.declineInvite(inviteId); await social.markNotificationRead(note.id) }
                        } label: {
                            Text("Can't make it").font(VType.body(13, .semibold)).foregroundStyle(Palette.inkSoft)
                                .padding(.horizontal, 12).padding(.vertical, 9)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 46 + Spacing.md)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity)
        .claySurface(.surface, radius: Radius.md, elevation: note.read ? 0.5 : 0.9)
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            .strokeBorder(note.read ? Color.clear : kind.accent.base.opacity(0.35), lineWidth: 1.5))
        .opacity(note.read ? 0.85 : 1)
        .onTapGesture { if !note.read { Task { await social.markNotificationRead(note.id) } } }
        .accessibilityElement(children: .contain)
    }

    private func relative(_ date: Date?) -> String {
        guard let date else { return "now" }
        if Date().timeIntervalSince(date) < 60 { return "now" }
        let f = RelativeDateTimeFormatter(); f.unitsStyle = .abbreviated
        return f.localizedString(for: date, relativeTo: Date())
    }

    private var emptyState: some View {
        VStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: "bell.slash", kind: .spruce, size: 66, radius: Radius.md)
            Text("You're all caught up")
                .font(VType.scaledDisplay(19, .semibold, relativeTo: .headline))
                .foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text("Reminders, badges, and community activity will show up here.")
                .font(VType.scaledBody(14, relativeTo: .subheadline))
                .foregroundStyle(Palette.inkSoft)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity).padding(.top, 90).padding(.horizontal, Spacing.xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Notification settings (from Profile → Settings)

// NotificationSettingsView moved to Views/Notifications/NotificationSettingsView.swift.
//
// The version that lived here had a master toggle that called
// requestPermission() straight from the switch — spending the one system prompt
// iOS ever gives us with no explanation first — and four category rows
// ("Event reminders", "Badges & milestones", "Daily Gem", "Community activity")
// rendered by a `typeRow` helper that took no binding and wrote nothing. They
// looked like settings and were decoration. The replacement has two real
// switches and a quiet-hours window, all persisted server-side where the
// fan-out actually reads them.

