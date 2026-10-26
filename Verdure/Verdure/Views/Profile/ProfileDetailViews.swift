import SwiftUI

// Detail / "see all" screens reached from the Profile tab:
// badges, challenges, and the About Verdure page.

// MARK: - Badge accent helper

private func badgeKind(_ index: Int) -> ClayStyle.ClayAccentKind {
    .spruce
}

// MARK: - All Badges

struct AllBadgesView: View {
    let badges: [Badge]
    @Environment(\.dismiss) private var dismiss
    @State private var selectedBadge: Badge?

    private var earnedCount: Int { badges.filter(\.earned).count }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    KickerLabel(text: "\(earnedCount) of \(badges.count) earned", color: Palette.gold.base, dot: Palette.gold.base)
                    Text("Collect them all by exploring, attending events, and climbing the ranks.")
                        .font(VType.body(14)).foregroundStyle(Palette.inkSoft).lineSpacing(3)

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                              spacing: 24) {
                        ForEach(Array(badges.enumerated()), id: \.element.id) { i, badge in
                            Button { Haptics.soft(); selectedBadge = badge } label: {
                                badgeCell(badge, index: i)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(Spacing.lg)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Badges")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                }
            }
        }
        .sheet(item: $selectedBadge) { BadgeDetailSheet(badge: $0) }
    }

    private func badgeCell(_ badge: Badge, index: Int) -> some View {
        VStack(spacing: 9) {
            ZStack {
                if badge.earned {
                    let bk = badgeKind(index)
                    PulseHalo(color: bk.accent.base.opacity(0.55), size: 66, lineWidth: 1.5)
                    ClayIconTile(systemImage: badge.icon, kind: bk, size: 60, radius: Radius.chip)
                } else {
                    ZStack(alignment: .bottomTrailing) {
                        Image(systemName: badge.icon)
                            .font(.system(size: 23, weight: .semibold))
                            .foregroundStyle(Palette.inkFaint)
                            .frame(width: 60, height: 60)
                            .background(ClayBackground(style: .inset, radius: Radius.chip))
                        Image(systemName: "lock.fill").font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Palette.inkFaint)
                            .padding(4).background(Circle().fill(Palette.surface)).offset(x: 3, y: 3)
                    }
                }
            }
            .frame(height: 66)
            Text(badge.name).font(VType.body(11, .semibold))
                .foregroundStyle(badge.earned ? Palette.ink : Palette.inkFaint)
                .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8)
        }
        .opacity(badge.earned ? 1 : 0.6)
    }
}

// MARK: - Badge detail

struct BadgeDetailSheet: View {
    let badge: Badge
    @Environment(\.dismiss) private var dismiss
    private var kind: ClayStyle.ClayAccentKind { badge.earned ? .gold : .spruce }

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Capsule().fill(Palette.inkFaint.opacity(0.4)).frame(width: 40, height: 5).padding(.top, 10)

            ZStack {
                if badge.earned {
                    PulseHalo(color: kind.accent.base.opacity(0.6), size: 120, lineWidth: 2)
                    ClayIconTile(systemImage: badge.icon, kind: kind, size: 104, radius: Radius.lg)
                        .idleFloat(distance: 5, duration: 3)
                } else {
                    Image(systemName: badge.icon).font(.system(size: 40, weight: .semibold))
                        .foregroundStyle(Palette.inkFaint)
                        .frame(width: 104, height: 104)
                        .background(ClayBackground(style: .inset, radius: Radius.lg))
                }
            }
            .frame(height: 124)
            .padding(.top, Spacing.sm)

            VStack(spacing: 6) {
                Text(badge.name).font(VType.display(26, .bold)).foregroundStyle(Palette.ink)
                if badge.earned {
                    HStack(spacing: 5) {
                        Image(systemName: "checkmark.seal.fill").font(.system(size: 12, weight: .bold))
                        Text("Earned").font(VType.body(13, .bold))
                    }
                    .foregroundStyle(Palette.teal.base)
                } else {
                    HStack(spacing: 5) {
                        Image(systemName: "lock.fill").font(.system(size: 11, weight: .bold))
                        Text("Locked").font(VType.body(13, .bold))
                    }
                    .foregroundStyle(Palette.inkFaint)
                }
            }

            Text(badge.detail)
                .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                .multilineTextAlignment(.center).lineSpacing(4)
                .padding(.horizontal, Spacing.sm)

            VStack(spacing: 0) {
                infoRow(icon: "target", label: "How to unlock", value: badge.requirement)
                if let date = badge.earnedDate {
                    Divider().background(Palette.surfaceShadow.opacity(0.4)).padding(.horizontal, Spacing.md)
                    infoRow(icon: "calendar", label: "Achieved on", value: date)
                }
            }
            .padding(.vertical, 6)
            .claySurface(.surface, radius: Radius.md)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(VerdureBackground())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
    }

    private func infoRow(icon: String, label: String, value: String) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon).font(.system(size: 14, weight: .bold))
                .foregroundStyle(kind.accent.base).frame(width: 24)
            Text(label).font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
            Spacer()
            Text(value).font(VType.body(13, .semibold)).foregroundStyle(Palette.ink)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, Spacing.md).padding(.vertical, 12)
    }
}

// MARK: - All Challenges

struct AllChallengesView: View {
    let challenges: [Challenge]
    @Environment(\.dismiss) private var dismiss
    @State private var selectedChallenge: Challenge?

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    KickerLabel(text: "\(challenges.count) active", color: Palette.teal.base, dot: Palette.teal.base)
                    Text("Complete challenges to earn XP and climb levels.")
                        .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        .padding(.bottom, Spacing.xs)

                    ForEach(Array(challenges.enumerated()), id: \.element.id) { i, c in
                        Button { Haptics.soft(); selectedChallenge = c } label: {
                            challengeRow(c, kind: badgeKind(i))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(Spacing.lg)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Challenges")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                }
            }
        }
        .sheet(item: $selectedChallenge) { ChallengeDetailSheet(challenge: $0) }
    }

    private func challengeRow(_ c: Challenge, kind: ClayStyle.ClayAccentKind) -> some View {
        HStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: c.icon, kind: kind, size: 52, radius: Radius.chip)
            VStack(alignment: .leading, spacing: 3) {
                Text(c.title).font(VType.display(16, .semibold)).foregroundStyle(Palette.ink)
                Text(c.description).font(VType.body(12.5)).foregroundStyle(Palette.inkSoft)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    XPBadge(xp: c.xpReward)
                    Text("\(c.daysRemaining)d left").font(VType.body(11, .semibold))
                        .foregroundStyle(Palette.inkFaint)
                }
                .padding(.top, 2)
            }
            Spacer(minLength: Spacing.sm)
            NeonProgressRing(progress: c.progress, size: 46, lineWidth: 4.5, color: kind.accent.base)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity)
        .claySurface(.surface, radius: Radius.md, elevation: 0.85)
    }
}

// MARK: - Challenge detail

struct ChallengeDetailSheet: View {
    let challenge: Challenge
    @Environment(\.dismiss) private var dismiss
    private let kind: ClayStyle.ClayAccentKind = .teal

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Capsule().fill(Palette.inkFaint.opacity(0.4)).frame(width: 40, height: 5).padding(.top, 10)

            ZStack {
                PulseHalo(color: kind.accent.base.opacity(0.5), size: 116, lineWidth: 2)
                ClayIconTile(systemImage: challenge.icon, kind: kind, size: 96, radius: Radius.lg)
                    .idleFloat(distance: 5, duration: 3)
            }
            .frame(height: 120).padding(.top, Spacing.sm)

            VStack(spacing: 8) {
                Text(challenge.title).font(VType.display(26, .bold)).foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.center)
                Text(challenge.description).font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                    .multilineTextAlignment(.center).lineSpacing(3)
            }

            VStack(spacing: Spacing.sm) {
                HStack {
                    Text("Progress").font(VType.body(13, .semibold)).foregroundStyle(Palette.inkSoft)
                    Spacer()
                    Text("\(Int(challenge.progress * 100))%").font(VType.num(14, .bold))
                        .foregroundStyle(kind.accent.base)
                }
                ClayProgressBar(value: challenge.progress,
                                gradient: [kind.accent.depth, kind.accent.base], height: 14)
            }
            .padding(Spacing.md)
            .claySurface(.surface, radius: Radius.md)

            HStack(spacing: Spacing.md) {
                statTile(icon: "bolt.fill", value: "+\(challenge.xpReward)", label: "XP reward", kind: .gold)
                statTile(icon: "clock.fill", value: "\(challenge.daysRemaining)d", label: "Remaining", kind: .terracotta)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(VerdureBackground())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
    }

    private func statTile(icon: String, value: String, label: String, kind: ClayStyle.ClayAccentKind) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundStyle(kind.accent.base)
            Text(value).font(VType.num(20, .bold)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(VType.body(11, .medium)).foregroundStyle(Palette.inkSoft)
        }
        .frame(maxWidth: .infinity).padding(.vertical, Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.7)
    }
}

// MARK: - About Verdure

struct AboutVerdureView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ClayIconTile(systemImage: "leaf.fill", kind: .spruce, size: 76, radius: Radius.lg)
                            .idleFloat(distance: 4, duration: 3)
                        Text("Verdure").font(VType.display(34, .bold)).foregroundStyle(Palette.ink)
                        Text("Step Outside. Connect Within.")
                            .font(VType.display(16, .medium)).foregroundStyle(Palette.spruce.base)
                    }

                    aboutCard(title: "Our story", icon: "book.fill", accent: .terracotta,
                              body: "Verdure began with a simple idea: the best parts of our communities are the green spaces and gatherings right outside our doors. We wanted to make rediscovering them feel like play — so we turned exploring into a game where every park, trail, and event is worth collecting.")

                    aboutCard(title: "What we do", icon: "sparkles", accent: .teal,
                              body: "Collect real-world places, attend local events, and grow your points into gift cards. Every outing earns rewards, builds streaks, and reconnects you with the people and places nearby.")

                    aboutCard(title: "The mission", icon: "globe.americas.fill", accent: .spruce,
                              body: "Revive outdoor spaces and strengthen local connections — one step outside at a time.")

                    VStack(spacing: 6) {
                        Text("Made with care for your community.")
                            .font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
                        Text("Version 1.0").font(VType.body(12)).foregroundStyle(Palette.inkFaint)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, Spacing.sm)
                }
                .padding(Spacing.lg)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                }
            }
        }
    }

    private func aboutCard(title: String, icon: String, accent: ClayStyle.ClayAccentKind, body: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: 10) {
                ClayIconTile(systemImage: icon, kind: accent, size: 38, radius: Radius.chip)
                Text(title).font(VType.display(18, .semibold)).foregroundStyle(Palette.ink)
            }
            Text(body).font(VType.body(15)).foregroundStyle(Palette.inkSoft).lineSpacing(4)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .claySurface(.surface, radius: Radius.md)
    }
}
