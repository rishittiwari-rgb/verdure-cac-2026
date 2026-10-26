import SwiftUI
import FirebaseFunctions

// MARK: - Advanced stats (G3) + friends leaderboard (G4)
//
// Both read real data or say nothing. The stats come from the persisted earn
// history; the leaderboard comes from a callable, because point balances are
// server-owned and a client that could read friends' documents directly would
// see their email and subscription state alongside the score.

struct StatsAndLeaderboardView: View {

    @Environment(GameStateManager.self) private var gameState
    @Environment(StoreService.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var showPaywall = false

    @State private var tab = 0
    @State private var board: [LeaderRow] = []
    @State private var isSolo = false
    @State private var boardState: LoadState = .loading
    @State private var period = "allTime"

    enum LoadState { case loading, loaded, failed(String) }

    struct LeaderRow: Identifiable, Equatable {
        let uid: String
        let displayName: String
        let initials: String
        let points: Int
        let isMe: Bool
        let rank: Int?
        var id: String { uid }
    }

    private var stats: PersonalStats {
        PersonalStats.compute(from: gameState.earnHistory)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                VerdureBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        picker
                        if tab == 0 { statsContent } else { leaderboardContent }
                    }
                    .padding(Spacing.lg)
                    .padding(.bottom, Spacing.xxl)
                }
            }
            .navigationTitle(tab == 0 ? "Your Stats" : "Friends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.font(VType.scaledBody(16, .medium))
                }
            }
            .task(id: period) { await loadBoard() }
            .sheet(isPresented: $showPaywall) {
                PaywallView(source: "advanced_stats").environment(store)
            }
        }
    }

    private var picker: some View {
        Picker("View", selection: $tab) {
            Text("Stats").tag(0)
            Text("Friends").tag(1)
        }
        .pickerStyle(.segmented)
        .accessibilityLabel("Choose between your stats and the friends leaderboard")
    }

    // MARK: G3

    @ViewBuilder
    private var statsContent: some View {
        let s = stats
        if s.isEmpty {
            EmptyStateCard(
                icon: "chart.bar",
                title: "No stats yet",
                message: "Check in to an event or collect a place and your numbers start here. We don't estimate anything — this stays empty until you've actually earned something."
            )
        } else {
            // The four headline numbers stay FREE — they are already on the
            // player card, and paywalling something the user can see elsewhere
            // is the kind of gate that reads as petty rather than premium.
            grid(s)

            if store.isPlus {
                if !s.byCategory.isEmpty { categoryBreakdown(s) }
                rhythm(s)
            } else {
                // Locked, but honest about WHAT is behind it: the sections are
                // named and described, so the paywall is selling something the
                // user can evaluate rather than a mystery.
                advancedLocked
            }
        }
    }

    /// The Plus gate on the advanced sections.
    ///
    /// PaywallView advertises "Advanced Stats — where your points come from,
    /// and your last 30 days". Those two phrases name exactly the two sections
    /// hidden here, so the sale and the gate cannot drift apart.
    private var advancedLocked: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: 8) {
                Image(systemName: "lock.fill").foregroundStyle(Palette.gold.base)
                Text("Advanced stats").font(VType.scaledDisplay(17, .semibold))
                    .foregroundStyle(Palette.ink)
            }
            Text("Where your points come from, broken down by category, and your last 30 days — active days, your average, and your best day.")
                .font(VType.scaledBody(13))
                .foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            VerdureButton(title: "See with Verdure+", style: .primary) {
                Haptics.tap(); showPaywall = true
            }
            .padding(.top, 4)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ClayBackground(style: .inset, radius: Radius.md))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Advanced stats, a Verdure Plus feature")
        .accessibilityHint("Shows where your points come from and your last 30 days.")
    }

    private func grid(_ s: PersonalStats) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Spacing.sm) {
            statTile("Lifetime points", "\(s.totalPoints)", "star.fill", .gold)
            statTile("Events attended", "\(s.totalEvents)", "calendar", .spruce)
            statTile("Places collected", "\(s.totalPlaces)", "map.fill", .teal)
            statTile("Last 30 days", "\(s.last30Days)", "clock.arrow.circlepath", .terracotta)
        }
    }

    private func categoryBreakdown(_ s: PersonalStats) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ClaySectionHeader(kicker: "Where your points come from", title: "By category")
            let max = s.byCategory.first?.points ?? 1
            ForEach(s.byCategory.prefix(6)) { c in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(c.category).font(VType.scaledBody(14, .semibold)).foregroundStyle(Palette.ink)
                        Spacer()
                        Text("\(c.points)").font(VType.scaledNum(14, .bold)).foregroundStyle(Palette.inkSoft)
                    }
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Palette.spruce.base.opacity(0.75))
                            .frame(width: geo.size.width * CGFloat(c.points) / CGFloat(Swift.max(max, 1)))
                    }
                    .frame(height: 8)
                }
                .padding(.vertical, 2)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(c.category): \(c.points) points from \(c.count) \(c.count == 1 ? "earn" : "earns")")
            }
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: .surface, radius: Radius.md))
    }

    private func rhythm(_ s: PersonalStats) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ClaySectionHeader(kicker: "Last 30 days", title: "Your rhythm")
            row("Active days", "\(s.activeDaysLast30) of 30")
            row("Average on an active day", "\(s.averagePerActiveDay) pts")
            if let best = s.bestDay {
                row("Best day", "\(best.points) pts on \(best.day.formatted(.dateTime.month().day()))")
            }
            // Said explicitly: an average over 30 calendar days would make an
            // engaged weekend-only user look inactive.
            Text("Averages count only days you earned something, not every day on the calendar.")
                .font(VType.scaledBody(12))
                .foregroundStyle(Palette.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: .surface, radius: Radius.md))
    }

    // MARK: G4

    @ViewBuilder
    private var leaderboardContent: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Picker("Period", selection: $period) {
                Text("All time").tag("allTime")
                Text("This month").tag("month")
            }
            .pickerStyle(.segmented)

            switch boardState {
            case .loading:
                ProgressView().tint(Palette.spruce.base).frame(maxWidth: .infinity)
                    .accessibilityLabel("Loading leaderboard")
            case .failed(let msg):
                EmptyStateCard(icon: "wifi.slash", title: "Couldn't load the leaderboard", message: msg)
            case .loaded:
                if isSolo {
                    EmptyStateCard(
                        icon: "person.2",
                        title: "Follow someone to compare",
                        message: "A leaderboard needs other people on it. Follow friends from Community or an event's attendee list and they'll show up here."
                    )
                } else {
                    ForEach(board) { r in leaderRow(r) }
                    Text("Scores come from points the server issued. They can't be edited from a phone.")
                        .font(VType.scaledBody(12))
                        .foregroundStyle(Palette.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func leaderRow(_ r: LeaderRow) -> some View {
        HStack(spacing: Spacing.md) {
            Text(r.rank.map { "\($0)" } ?? "–")
                .font(VType.scaledNum(16, .bold))
                .foregroundStyle(r.isMe ? Palette.spruce.base : Palette.inkSoft)
                .frame(minWidth: 28, alignment: .trailing)
            AvatarCircle(initials: r.initials, size: 36)
            Text(r.displayName)
                .font(VType.scaledBody(15, r.isMe ? .semibold : .regular))
                .foregroundStyle(Palette.ink)
                .lineLimit(2)
            Spacer(minLength: Spacing.sm)
            Text("\(r.points)")
                .font(VType.scaledNum(15, .bold))
                .foregroundStyle(Palette.gold.base)
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: r.isMe ? .accent(.spruce) : .surface, radius: Radius.md))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(r.rank.map { "Rank \($0). " } ?? "Tied. ")\(r.isMe ? "You" : r.displayName), \(r.points) points")
    }

    private func statTile(_ label: String, _ value: String, _ icon: String,
                          _ kind: ClayStyle.ClayAccentKind) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ClayIconTile(systemImage: icon, kind: kind, size: 34, radius: Radius.chip)
            Text(value).font(VType.scaledNum(20, .bold)).foregroundStyle(Palette.ink)
            Text(label).font(VType.scaledBody(12)).foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(ClayBackground(style: .surface, radius: Radius.md))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(VType.scaledBody(14)).foregroundStyle(Palette.inkSoft)
            Spacer(minLength: Spacing.sm)
            Text(value).font(VType.scaledNum(14, .bold)).foregroundStyle(Palette.ink)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }

    private func loadBoard() async {
        boardState = .loading
        do {
            let result = try await Functions.functions()
                .httpsCallable("friendsLeaderboard").call(["period": period])
            let data = result.data as? [String: Any] ?? [:]
            isSolo = data["isSolo"] as? Bool ?? false
            board = (data["rows"] as? [[String: Any]] ?? []).map {
                LeaderRow(uid: $0["uid"] as? String ?? "",
                          displayName: $0["displayName"] as? String ?? "Member",
                          initials: $0["initials"] as? String ?? "?",
                          points: $0["points"] as? Int ?? 0,
                          isMe: $0["isMe"] as? Bool ?? false,
                          rank: $0["rank"] as? Int)
            }
            boardState = .loaded
        } catch {
            boardState = .failed("Check your connection and try again.")
        }
    }
}
