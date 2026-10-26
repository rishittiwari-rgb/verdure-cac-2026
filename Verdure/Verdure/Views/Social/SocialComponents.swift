import SwiftUI

// MARK: - Going button
//
// The single most important social control in the product: "I'm going". Server-
// backed (rsvpToEvent), optimistic locally, and it tells the truth when the
// server refuses (blocked organizer, cancelled event, signed out).

struct GoingButton: View {
    let event: Event
    var compact = false
    @Environment(SocialService.self) private var social
    @Environment(EventsAPIService.self) private var eventsService
    @Environment(AuthService.self) private var authService
    @State private var isWorking = false
    @State private var error: String?

    private var going: Bool { social.isGoing(event.id) }

    @ViewBuilder var body: some View {
        if !event.isProgram { goingControl }
    }

    private var goingControl: some View {
        VStack(spacing: 6) {
            Button {
                guard !isWorking else { return }
                guard authService.isAuthenticated else { error = "Sign in to RSVP."; return }
                Haptics.tap()
                isWorking = true
                Task {
                    let ok = await social.setGoing(event.id, going: !going)
                    isWorking = false
                    if ok {
                        if going { await eventsService.recordFeedEvent(for: event.id, action: "rsvp") }
                        Haptics.success()
                        AccessibilityNotification.Announcement(going ? "You're going." : "RSVP removed.").post()
                    } else {
                        error = social.lastError ?? "Couldn't update your RSVP."
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: going ? "checkmark.circle.fill" : "person.crop.circle.badge.plus")
                        .font(.system(size: compact ? 13 : 16, weight: .bold))
                    Text(going ? "Going" : (compact ? "Going?" : "I'm going"))
                        .font(compact ? VType.body(13, .bold) : VType.body(16, .bold))
                    if isWorking { ProgressView().scaleEffect(0.7) }
                }
                .foregroundStyle(going ? Palette.teal.onColor : Palette.ink)
                .padding(.vertical, compact ? 8 : 14)
                .padding(.horizontal, compact ? 12 : 22)
                .frame(maxWidth: compact ? nil : .infinity)
            }
            .buttonStyle(ClayPressButtonStyle(style: going ? .accent(.teal) : .surface,
                                              radius: compact ? Radius.chip : Radius.md, elevation: going ? 0.9 : 0.6))
            .disabled(isWorking)
            .accessibilityLabel(going ? "Going to \(event.title). Tap to remove your RSVP." : "RSVP going to \(event.title)")
            .accessibilityAddTraits(going ? [.isSelected] : [])
            if let error, !compact {
                Text(error).font(VType.body(12, .medium)).foregroundStyle(Palette.danger)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

// MARK: - Friends going (avatar stack + count)

struct FriendsGoingStack: View {
    let eventId: String
    var compact = false
    @Environment(SocialService.self) private var social

    private var info: FriendsGoing { social.friendsGoing(for: eventId) }

    var body: some View {
        if info.count > 0 {
            HStack(spacing: compact ? 6 : 10) {
                HStack(spacing: -8) {
                    ForEach(Array(info.friends.prefix(compact ? 3 : 5).enumerated()), id: \.element.uid) { i, f in
                        AvatarCircle(initials: f.initials, size: compact ? 22 : 30,
                                     accent: Palette.spruce)
                            .overlay(Circle().stroke(Palette.surface, lineWidth: 2))
                    }
                }
                Text(label)
                    .font(compact ? VType.body(12, .semibold) : VType.body(13, .semibold))
                    .foregroundStyle(Palette.inkSoft)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .task(id: eventId) { await social.loadFriendsGoing(for: [eventId]) }
        } else {
            // Nothing to show yet, but still ask the server once (cached 2 min).
            Color.clear.frame(width: 0, height: 0)
                .task(id: eventId) { await social.loadFriendsGoing(for: [eventId]) }
        }
    }

    private var label: String {
        let names = info.friends.map(\.displayName)
        switch info.count {
        case 1: return "\(first(names[0])) is going"
        case 2: return "\(first(names[0])) and \(first(names[1])) are going"
        default:
            let others = info.count - 1
            return "\(first(names.first ?? "A friend")) and \(others) other \(others == 1 ? "friend" : "friends") are going"
        }
    }

    private func first(_ name: String) -> String { name.split(separator: " ").first.map(String.init) ?? name }
}

// MARK: - Invite friends sheet

struct InviteFriendsSheet: View {
    let event: Event
    @Environment(SocialService.self) private var social
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var message = ""
    @State private var isSending = false
    @State private var delivered: Int? = nil

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    VStack(alignment: .leading, spacing: 6) {
                        KickerLabel(text: "Invite friends", color: Palette.teal.base, dot: Palette.teal.base)
                        Text(event.title).font(VType.display(22, .semibold)).foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text("They'll get a notification and can RSVP from it.")
                            .font(VType.scaledBody(13, relativeTo: .footnote)).foregroundStyle(Palette.inkSoft)
                    }
                    if let delivered {
                        EmptyStateCard(icon: "paperplane.fill", title: delivered == 1 ? "Invite sent" : "\(delivered) invites sent",
                                       message: "Your friends will see it in their notifications.",
                                       actionTitle: "Done") { dismiss() }
                    } else if social.friends.isEmpty {
                        EmptyStateCard(icon: "person.2", title: "No friends yet",
                                       message: "Follow people from the Community tab to invite them. Invites only go to people you follow.")
                    } else {
                        friendList
                        TextField("Add a note (optional)", text: $message, axis: .vertical)
                            .font(VType.body(15)).foregroundStyle(Palette.ink)
                            .lineLimit(2...4).padding(14)
                            .background(ClayBackground(style: .inset, radius: Radius.sm))
                        ClayButton(isSending ? "Sending…" : "Send \(selected.count == 1 ? "invite" : "\(selected.count) invites")",
                                   systemImage: "paperplane.fill", kind: .spruce, fullWidth: true) { send() }
                            .disabled(selected.isEmpty || isSending)
                            .opacity(selected.isEmpty || isSending ? 0.55 : 1)
                        if let err = social.lastError, isSending == false, delivered == nil, !selected.isEmpty {
                            Text(err).font(VType.body(12, .medium)).foregroundStyle(Palette.danger)
                        }
                    }
                }
                .padding(Spacing.md).padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Invite").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }.foregroundStyle(Palette.inkSoft)
                }
            }
        }
        .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }

    private var friendList: some View {
        VStack(spacing: 0) {
            ForEach(Array(social.friends.enumerated()), id: \.element.uid) { i, friend in
                Button {
                    Haptics.soft()
                    if selected.contains(friend.uid) { selected.remove(friend.uid) } else { selected.insert(friend.uid) }
                } label: {
                    HStack(spacing: Spacing.md) {
                        AvatarCircle(initials: friend.initials, size: 38, accent: Palette.spruce)
                        Text(friend.displayName).font(VType.body(15, .medium)).foregroundStyle(Palette.ink).lineLimit(1)
                        Spacer()
                        Image(systemName: selected.contains(friend.uid) ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(selected.contains(friend.uid) ? Palette.spruce.base : Palette.inkFaint)
                    }
                    .padding(.horizontal, Spacing.md).padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected.contains(friend.uid) ? [.isSelected] : [])
                if i < social.friends.count - 1 { ClayHairline().padding(.leading, 66) }
            }
        }
        .padding(.vertical, 6)
        .claySurface(.surface, radius: Radius.md)
    }

    private func send() {
        guard !selected.isEmpty else { return }
        isSending = true
        Task {
            let sent = await social.invite(eventId: event.id, to: Array(selected), message: message)
            isSending = false
            if !sent.isEmpty {
                Haptics.success()
                withAnimation { delivered = sent.count }
            }
        }
    }
}

// MARK: - Follow organizer button

struct FollowOrganizerButton: View {
    let organizerId: String
    let organizerName: String
    @Environment(SocialService.self) private var social
    @Environment(AuthService.self) private var authService
    @State private var isWorking = false

    private var following: Bool { social.isFollowing(organizerId) }

    var body: some View {
        Button {
            guard !isWorking, authService.isAuthenticated else { return }
            Haptics.tap(); isWorking = true
            Task {
                _ = await social.setFollowing(organizerId, kind: "organizer", follow: !following, displayName: organizerName)
                isWorking = false
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: following ? "checkmark" : "plus").font(.system(size: 12, weight: .bold))
                Text(following ? "Following" : "Follow \(organizerName)").font(VType.body(13, .semibold)).lineLimit(1)
            }
            .foregroundStyle(following ? Palette.spruce.onColor : Palette.ink)
            .padding(.horizontal, 14).padding(.vertical, 9)
        }
        .buttonStyle(ClayPressButtonStyle(style: following ? .accent(.spruce) : .surface, radius: Radius.chip, elevation: 0.5))
        .disabled(isWorking || !authService.isAuthenticated)
        .accessibilityLabel(following ? "Following \(organizerName). Tap to unfollow." : "Follow \(organizerName)")
    }
}
