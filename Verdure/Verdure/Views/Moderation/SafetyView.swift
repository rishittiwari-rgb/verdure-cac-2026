import SwiftUI

// MARK: - Safety & blocking (Profile › Settings)
//
// The published home of the moderation policy inside the binary: how reporting
// works, the review window, the contact address, and the list of accounts this
// user has blocked (with unblock). App Review 1.2 asks for all four.

struct SafetyView: View {
    @Environment(ModerationService.self) private var moderation
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private var blocked: [(uid: String, name: String)] {
        moderation.blockedUserIDs
            .map { (uid: $0, name: moderation.blockedNames[$0] ?? "Blocked member") }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    header
                    policyCard
                    contactCard
                    blockedSection
                }
                .padding(Spacing.md)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Safety").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                    .accessibilityLabel("Close")
                }
            }
            .task { await moderation.refreshBlocks() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            KickerLabel(text: "Community safety", color: Palette.teal.base, dot: Palette.teal.base)
            Text("Report, block, breathe")
                .font(VType.display(28, .semibold)).foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var policyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            policyRow("flag.fill", "Report anything",
                      "Every post, event and profile has a Report option under its ••• menu. Reports are anonymous to the person reported.")
            policyRow("clock.badge.checkmark.fill", "Reviewed within 24 hours",
                      "A person looks at every report. Anything not reviewed by then is taken down automatically.")
            policyRow("eye.slash.fill", "Hidden fast",
                      "Content reported by \(ModerationService.autoHideThreshold) or more people disappears from feeds immediately while we review it.")
            policyRow("hand.raised.fill", "Blocking is mutual",
                      "Block someone and neither of you sees the other's posts, events or RSVPs. Enforced on our servers, not just on your phone.")
        }
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
    }

    private func policyRow(_ icon: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            ClayIconTile(systemImage: icon, kind: .teal, size: 36, radius: 10)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(VType.scaledDisplay(15, .semibold, relativeTo: .subheadline)).foregroundStyle(Palette.ink)
                Text(body).font(VType.scaledBody(12, relativeTo: .caption)).foregroundStyle(Palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var contactCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Need a human?").font(VType.display(17, .semibold)).foregroundStyle(Palette.ink)
            Text("Questions about a report, an appeal, or something we should know about right away.")
                .font(VType.scaledBody(13, relativeTo: .footnote)).foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            ClayButton(ModerationService.contactEmail, systemImage: "envelope.fill", kind: .teal, fullWidth: true) {
                if let url = URL(string: "mailto:\(ModerationService.contactEmail)?subject=Verdure%20safety%20concern") {
                    openURL(url)
                }
            }
            .accessibilityLabel("Email \(ModerationService.contactEmail)")
        }
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
    }

    private var blockedSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionHeader(title: "Blocked")
            if blocked.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle").foregroundStyle(Palette.inkFaint)
                    Text("You haven't blocked anyone.")
                        .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                    Spacer()
                }
                .padding(Spacing.md)
                .background(ClayBackground(style: .inset, radius: Radius.md))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(blocked.enumerated()), id: \.element.uid) { i, entry in
                        HStack(spacing: Spacing.md) {
                            AvatarCircle(initials: String(entry.name.prefix(2)).uppercased(), size: 36,
                                         accent: Palette.spruce)
                            Text(entry.name).font(VType.body(15, .medium)).foregroundStyle(Palette.ink)
                                .lineLimit(1)
                            Spacer()
                            Button {
                                Haptics.tap()
                                Task { _ = await moderation.unblock(uid: entry.uid) }
                            } label: {
                                Text("Unblock").font(VType.body(13, .bold)).foregroundStyle(Palette.spruce.base)
                                    .frame(minHeight: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Unblock \(entry.name)")
                        }
                        .padding(.horizontal, Spacing.md).padding(.vertical, 8)
                        if i < blocked.count - 1 { ClayHairline().padding(.leading, 64) }
                    }
                }
                .padding(.vertical, 6)
                .claySurface(.surface, radius: Radius.md)
            }
        }
    }
}

#Preview {
    SafetyView().environment(ModerationService())
}
