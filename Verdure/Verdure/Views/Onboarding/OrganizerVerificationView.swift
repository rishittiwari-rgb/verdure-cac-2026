import SwiftUI

/// Organizer application. Presented from sign-up (when the user chooses
/// Organizer) and from Profile → Settings → "Become an Organizer".
///
/// HONEST FLOW. This used to fake a 1.8-second "Verifying…" spinner and then
/// grant organizer status on the device. Now it creates a real organizer
/// profile on the server (`createOrganizer`), which starts PENDING: the
/// organizer can publish immediately, but until a person on the Verdure team
/// approves them their events reach only people who follow them. Approval is a
/// staff action enforced server-side — nothing here can grant it.
struct OrganizerVerificationView: View {
    @AppStorage("accountType") private var accountTypeRaw = AccountType.visitor.rawValue
    @Environment(SocialService.self) private var social
    @Environment(AuthService.self) private var authService
    @Environment(\.dismiss) private var dismiss

    enum Phase { case form, submitting, done }
    @State private var phase: Phase = .form
    @State private var org = ""
    @State private var category = "community-org"
    @State private var about = ""
    @State private var website = ""
    @State private var agreed = false
    @State private var appear = false
    @State private var error: String?

    static let categories: [(id: String, label: String, icon: String)] = [
        ("nonprofit", "Nonprofit", "heart.fill"), ("library", "Library", "books.vertical.fill"),
        ("parks", "Parks & rec", "leaf.fill"), ("rec-league", "Rec league", "figure.run"),
        ("community-org", "Community org", "person.3.fill"), ("school", "School", "graduationcap.fill"),
        ("faith", "Faith community", "sparkles"), ("arts", "Arts & culture", "paintpalette.fill"),
        ("business", "Local business", "storefront.fill"), ("other", "Something else", "ellipsis.circle.fill"),
    ]

    private var isValid: Bool {
        org.trimmingCharacters(in: .whitespaces).count >= 2 && agreed && authService.isAuthenticated
    }

    var body: some View {
        NavigationStack {
            ZStack {
                VerdureBackground()
                if let existing = social.organizer, phase == .form {
                    statusView(existing)
                } else {
                    switch phase {
                    case .form: formView
                    case .submitting: submittingView
                    case .done: doneView
                    }
                }
            }
            .navigationTitle("Organizer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(phase == .done ? "Done" : "Cancel") { dismiss() }.foregroundStyle(Palette.inkSoft)
                }
            }
        }
        .task { await social.refreshOrganizer() }
        .onAppear { withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) { appear = true } }
    }

    // MARK: - Existing profile

    private func statusView(_ o: OrganizerProfile) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                HStack(spacing: Spacing.md) {
                    ClayIconTile(systemImage: o.isApproved ? "checkmark.seal.fill" : "clock.badge.checkmark.fill",
                                 kind: o.isApproved ? .spruce : .gold, size: 56, radius: Radius.md)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(o.displayName).font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
                        Text(o.statusLabel).font(VType.body(13, .semibold))
                            .foregroundStyle(o.isApproved ? Palette.spruce.base : Palette.gold.base)
                    }
                }
                Text(o.isApproved
                     ? "Your events are public. Everyone in the launch area can find them, RSVP and invite friends."
                     : o.status == "pending"
                        ? "A person on the Verdure team reviews every organizer by hand. You can publish now — until you're approved, your events reach only people who follow you. We'll notify you."
                        : "This organizer account can't publish right now. Questions: \(ModerationService.contactEmail).")
                    .font(VType.scaledBody(14, relativeTo: .subheadline)).foregroundStyle(Palette.inkSoft).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: Spacing.md) {
                    statChip("\(o.eventCount)", o.eventCount == 1 ? "event" : "events")
                    statChip("\(o.followerCount)", o.followerCount == 1 ? "follower" : "followers")
                }
                if !o.description.isEmpty {
                    Text(o.description).font(VType.body(14)).foregroundStyle(Palette.ink).lineSpacing(3)
                        .padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
                        .claySurface(.surface, radius: Radius.md)
                }
                if o.isApproved {
                    NavigationLink { MyPlaceStoriesView() } label: {
                        Label("My place stories", systemImage: "text.book.closed").frame(minHeight: 44)
                    }.accessibilityIdentifier("myPlaceStories")
                }
                ClayButton("Publish an event", systemImage: "plus.circle.fill", kind: .spruce, fullWidth: true) { dismiss() }
                    .disabled(!o.canPublish).opacity(o.canPublish ? 1 : 0.5)
            }
            .padding(Spacing.lg).padding(.bottom, 40)
        }
    }

    private func statChip(_ value: String, _ label: String) -> some View {
        HStack(spacing: 6) {
            Text(value).font(VType.num(16, .bold)).foregroundStyle(Palette.ink)
            Text(label).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
        .accessibilityElement(children: .combine)
    }

    // MARK: - Form

    private var formView: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                header
                labeled("ORGANIZATION NAME") {
                    ClayField(placeholder: "e.g. Lakefront Rec League", text: $org)
                }
                labeled("WHAT KIND OF ORGANIZATION") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 9) {
                            ForEach(Self.categories, id: \.id) { c in
                                Button { Haptics.soft(); category = c.id } label: {
                                    ClayChip(text: c.label, systemImage: c.icon, selected: category == c.id, accent: Palette.spruce)
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(category == c.id ? [.isSelected] : [])
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                labeled("ABOUT (SHOWN ON YOUR EVENTS)") {
                    TextField("What you do and who it's for", text: $about, axis: .vertical)
                        .font(VType.body(15)).foregroundStyle(Palette.ink)
                        .lineLimit(3...6).padding(14)
                        .background(ClayBackground(style: .inset, radius: Radius.sm))
                }
                labeled("WEBSITE (OPTIONAL)") {
                    ClayField(placeholder: "https://…", text: $website, keyboard: .URL, autocap: false)
                }

                Button { Haptics.soft(); withAnimation(.spring(response: 0.4)) { agreed.toggle() } } label: {
                    HStack(spacing: 12) {
                        Image(systemName: agreed ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(agreed ? Palette.spruce.base : Palette.inkFaint)
                        Text("I'm authorized to publish events for this organization, and I'll follow the community guidelines.")
                            .font(VType.body(13, .medium)).foregroundStyle(Palette.ink)
                            .multilineTextAlignment(.leading)
                        Spacer()
                    }
                    .padding(Spacing.md)
                    .background(ClayBackground(style: .inset, radius: Radius.sm))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(agreed ? [.isSelected] : [])

                if !authService.isAuthenticated {
                    Text("Sign in to apply — organizer profiles belong to an account.")
                        .font(VType.body(12, .medium)).foregroundStyle(Palette.danger)
                }
                if let error {
                    Text(error).font(VType.body(12, .medium)).foregroundStyle(Palette.danger)
                }

                ClayButton("Apply", systemImage: "megaphone.fill", kind: .spruce, fullWidth: true) { submit() }
                    .disabled(!isValid).opacity(isValid ? 1 : 0.5)

                Text("A person on the Verdure team reviews every organizer. You can publish right away; until approval your events reach only people who follow you.")
                    .font(VType.body(12)).foregroundStyle(Palette.inkFaint)
                    .frame(maxWidth: .infinity, alignment: .center).padding(.top, 2)
                    .multilineTextAlignment(.center)
            }
            .padding(Spacing.lg)
            .padding(.bottom, 40)
            .opacity(appear ? 1 : 0).offset(y: appear ? 0 : 20)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ClayIconTile(systemImage: "megaphone.fill", kind: .spruce, size: 64, radius: Radius.md)
                .breathing(scale: 1.05, duration: 2.6)
            Text("Post your own events")
                .font(VType.display(24, .semibold)).foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("Libraries, rec leagues, nonprofits and community groups publish directly to the people nearby. Nothing you post is scraped from anywhere else — it exists because you put it here.")
                .font(VType.body(14)).foregroundStyle(Palette.inkSoft).lineSpacing(3)
        }
    }

    private func labeled<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(VType.body(10, .bold)).tracking(0.8).foregroundStyle(Palette.inkSoft)
            content()
        }
    }

    // MARK: - Submitting / done

    private var submittingView: some View {
        VStack(spacing: Spacing.lg) {
            ClayIconTile(systemImage: "paperplane.fill", kind: .spruce, size: 80, radius: Radius.md)
                .breathing(scale: 1.08, duration: 1.4)
            Text("Creating your profile…").font(VType.display(22, .semibold)).foregroundStyle(Palette.ink)
            ProgressView().tint(Palette.spruce.base)
        }
    }

    private var doneView: some View {
        VStack(spacing: Spacing.lg) {
            ZStack {
                PulseHalo(color: Palette.gold.base.opacity(0.6), size: 150, lineWidth: 2)
                ClayIconTile(systemImage: "clock.badge.checkmark.fill", kind: .gold, size: 96, radius: Radius.md)
                    .breathing(scale: 1.06, duration: 2.4)
            }
            VStack(spacing: 8) {
                Text("Application received").font(VType.display(26, .bold)).foregroundStyle(Palette.ink)
                Text("You can publish events now. Until the Verdure team approves your organization, they'll reach only people who follow you — we'll let you know when that changes.")
                    .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                    .multilineTextAlignment(.center).padding(.horizontal, Spacing.lg).lineSpacing(3)
            }
            ClayButton("Got it", systemImage: "arrow.right", kind: .spruce, fullWidth: true) { dismiss() }
                .padding(.horizontal, Spacing.xl)
        }
        .padding(Spacing.lg)
    }

    private func submit() {
        Haptics.tap()
        error = nil
        withAnimation(.spring(response: 0.4)) { phase = .submitting }
        Task {
            let status = await social.createOrganizer(displayName: org.trimmingCharacters(in: .whitespaces),
                                                      category: category,
                                                      description: about.trimmingCharacters(in: .whitespacesAndNewlines),
                                                      website: website.trimmingCharacters(in: .whitespaces))
            if status != nil {
                accountTypeRaw = AccountType.organizer.rawValue
                Haptics.success()
                withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) { phase = .done }
            } else {
                error = social.lastError ?? "Couldn't create the profile. Try again."
                withAnimation { phase = .form }
            }
        }
    }
}

#Preview {
    OrganizerVerificationView()
        .environment(SocialService())
        .environment(AuthService())
}
