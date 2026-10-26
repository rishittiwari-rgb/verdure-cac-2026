import SwiftUI
import CoreLocation

// MARK: - Rewards
//
// ORDER IS THE PRODUCT DECISION. Partner perks come first and cash gift cards
// sit in a clearly secondary section below.
//
// At a sustainable earn rate a $5 card is four to five months away; a 500–2,000
// point perk is a week or two. The first thing someone sees on opening Rewards
// has to be something they can actually reach this month, or the screen reads as
// a wall rather than a goal. Cash cards remain the aspirational tier.
//
// EVERY PRICE HERE COMES FROM THE SERVER (`listRewardsCatalog` via
// EconomyService). The screen used to render a hardcoded local array that had
// drifted 35x from what the server charged, and browsed tiers the server had
// deactivated. The local catalog is now a DEBUG-only offline fallback.

struct RewardsStoreView: View {
    private enum PerkSort: String, CaseIterable { case nearby = "Nearby", original = "Default" }
    @State private var perkSort: PerkSort?
    var showsDoneButton = true
    @Environment(GameStateManager.self) private var gameState
    @Environment(StoreService.self) private var store
    @Environment(EconomyService.self) private var economy
    @Environment(LocationManager.self) private var locationManager
    @Environment(\.dismiss) private var dismiss

    @State private var confirmingPerk: PartnerPerk?
    @State private var confirmingCash: CashReward?
    @State private var redeemedCode: RedeemedCodeSheet?
    @State private var redeemError: String?
    @State private var isRedeeming = false
    @State private var showPaywall = false
    @State private var showMyCodes = false

    /// A just-redeemed perk, shown as the confirmation + code sheet.
    struct RedeemedCodeSheet: Identifiable {
        let id = UUID()
        let title: String
        let partner: String
        let code: String
    }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: Spacing.xl) {
                    balanceHeader
                    perksSection          // primary — reachable this month
                    cashSection           // secondary — the aspirational tier
                }
                .padding(.top, Spacing.sm)
                .padding(.bottom, Spacing.xxl)
            }
            .background(VerdureBackground())
            .navigationTitle("Rewards").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { Haptics.tap(); showMyCodes = true } label: {
                        Label("My Codes", systemImage: "ticket.fill")
                            .font(VType.scaledBody(14, .semibold))
                    }
                    .tint(Palette.spruce.base)
                    // The label must CONTAIN the visible text. Voice Control
                    // users say what they see ("tap My Codes"), so an override
                    // that replaces the on-screen words with a synonym makes the
                    // control unreachable by voice. The extra detail belongs in
                    // the hint, which Voice Control does not match against.
                    .accessibilityLabel("My Codes")
                    .accessibilityHint("Partner codes you've already redeemed")
                }
                if showsDoneButton {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                            .font(VType.scaledBody(15, .semibold)).foregroundStyle(Palette.spruce.base)
                    }
                }
            }
            .task { await economy.refresh(); await economy.loadMyCodes() }
            .refreshable { await economy.refresh(); await economy.loadMyCodes() }
            .onChange(of: economy.catalog.perks) { _, perks in
                if let pending = confirmingPerk, !perks.contains(pending) { confirmingPerk = nil }
            }
            .alert("Redeem this perk?", isPresented: Binding(
                get: { confirmingPerk != nil }, set: { if !$0 { confirmingPerk = nil } }
            )) {
                Button("Cancel", role: .cancel) { confirmingPerk = nil }
                Button("Redeem") {
                    if let perk = confirmingPerk { confirmingPerk = nil; redeemPerk(perk) }
                }
            } message: {
                if let p = confirmingPerk {
                    Text("Spend \(p.pointCost.formatted()) points on \(p.title) at \(p.partner)?")
                }
            }
            .alert("Redeem this gift card?", isPresented: Binding(
                get: { confirmingCash != nil }, set: { if !$0 { confirmingCash = nil } }
            )) {
                Button("Cancel", role: .cancel) { confirmingCash = nil }
                Button("Redeem") {
                    if let c = confirmingCash { confirmingCash = nil; redeemCash(c) }
                }
            } message: {
                if let c = confirmingCash {
                    Text("Spend \(c.cost.formatted()) points on \(c.name)? The code is emailed to your account address.")
                }
            }
            .alert("Couldn't Redeem", isPresented: Binding(
                get: { redeemError != nil }, set: { if !$0 { redeemError = nil } }
            )) {
                Button("OK") { redeemError = nil }
            } message: { if let m = redeemError { Text(m) } }
            .sheet(item: $redeemedCode) { PerkCodeSheet(sheet: $0) }
            .sheet(isPresented: $showMyCodes) { MyCodesView().environment(economy) }
            .sheet(isPresented: $showPaywall) {
                PaywallView(source: "rewards").presentationDetents([.large]).presentationDragIndicator(.visible)
            }
        }
    }

    // MARK: - Redemption

    private func redeemPerk(_ perk: PartnerPerk) {
        guard !isRedeeming else { return }
        guard economy.catalog.perks.contains(perk), perk.redeemable, (perk.expiresAt ?? .distantFuture) > Date() else {
            redeemError = "This offer changed. Review the current offer in Rewards."
            return
        }
        isRedeeming = true
        Task {
            defer { isRedeeming = false }
            let outcome = await gameState.redeem(rewardId: perk.id, pointCost: perk.pointCost)
            switch outcome.result {
            case .success:
                Haptics.success()
                AccessibilityNotification.Announcement("Redeemed \(perk.title).").post()
                if let code = outcome.code {
                    redeemedCode = RedeemedCodeSheet(title: outcome.title ?? perk.title,
                                                     partner: outcome.partner ?? perk.partner,
                                                     code: code)
                }
                await economy.refresh()
                await economy.loadMyCodes()
            default:
                redeemError = message(for: outcome.result)
            }
        }
    }

    private func redeemCash(_ cash: CashReward) {
        guard !isRedeeming else { return }
        isRedeeming = true
        Task {
            defer { isRedeeming = false }
            let outcome = await gameState.redeem(rewardId: cash.id, pointCost: cash.cost)
            switch outcome.result {
            case .success:
                Haptics.success()
                AccessibilityNotification.Announcement("Redeemed \(cash.name).").post()
                redeemError = nil
                await economy.refresh()
            default:
                redeemError = message(for: outcome.result)
            }
        }
    }

    private func message(for result: GameStateManager.RedeemResult) -> String {
        switch result {
        case .alreadyRedeemed: return "You've already redeemed this."
        case .notEnoughPoints: return "Not enough points yet — keep exploring."
        case .offline:         return "You're offline. Connect to the internet to redeem."
        case .signInRequired:  return "Sign in to redeem rewards."
        case .failed(let m):   return m       // server refusals are user-facing
        case .success:         return ""
        }
    }

    // MARK: - Balance

    private var balanceHeader: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("AVAILABLE POINTS").font(VType.scaledBody(10, .bold)).tracking(1.6)
                        .foregroundStyle(Palette.gold.base.opacity(0.9))
                    Text(gameState.pointsBalance.formatted())
                        .font(VType.scaledNum(40, .bold)).monospacedDigit()
                        .foregroundStyle(Palette.evergreen.onColor)
                        .contentTransition(.numericText())
                        .lineLimit(1).minimumScaleFactor(0.6)
                }
                Spacer()
                Image(systemName: "gift.fill").font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Palette.gold.base)
                    .frame(width: 64, height: 64)
                    .background(Circle().fill(.white.opacity(0.08)))
                    .accessibilityHidden(true)
            }
            if economy.catalog.treasuryPaused {
                Label("Gift cards are paused right now. Perks are unaffected.",
                      systemImage: "pause.circle.fill")
                    .font(VType.scaledBody(12, .medium))
                    .foregroundStyle(Palette.gold.base)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.lg)
        .background(ClayBackground(style: .accent(.evergreen), radius: Radius.lg, elevation: 1.1))
        .padding(.horizontal, Spacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Available points: \(gameState.pointsBalance)")
    }

    // MARK: - Perks (primary)

    private var effectivePerkSort: PerkSort { perkSort ?? (locationManager.userLocation == nil ? .original : .nearby) }
    private var sortedPerks: [PartnerPerk] {
        guard effectivePerkSort == .nearby else { return economy.catalog.perks }
        return PartnerPerk.sortedNearby(economy.catalog.perks, origin: locationManager.userLocation)
    }

    @ViewBuilder
    private var perksSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            sectionHeader(icon: "sparkles", kind: .teal, title: "Partner Perks",
                          subtitle: "Local offers — reachable in a week or two")
            Picker("Sort partner perks", selection: Binding(get: { effectivePerkSort }, set: { perkSort = $0 })) {
                ForEach(PerkSort.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }.pickerStyle(.segmented).padding(.horizontal, Spacing.md)
            if effectivePerkSort == .nearby && locationManager.userLocation == nil {
                Text("Location unavailable · using the default order")
                    .font(VType.scaledBody(12)).foregroundStyle(Palette.inkSoft).padding(.horizontal, Spacing.md)
            }

            if economy.isLoading && economy.catalog.perks.isEmpty {
                loadingRow
            } else if economy.catalog.perks.isEmpty {
                // HONEST EMPTY STATE. There genuinely will be zero perks at
                // launch. That must look deliberate and explain itself — a blank
                // screen or an endless spinner reads as broken.
                EmptyPerksCard()
            } else {
                VStack(spacing: 12) {
                    ForEach(sortedPerks) { perk in perkCard(perk) }
                }
                .padding(.horizontal, Spacing.md)
            }
        }
    }

    private func perkCard(_ perk: PartnerPerk) -> some View {
        // Early-access perks stay VISIBLE and locked for free users, showing the
        // unlock date. Seeing what you're about to get is the conversion
        // mechanic; hiding it throws that away.
        let locked = perk.plusOnlyUntilOpens
        let redeemed = gameState.isRedeemed(perk.id)
        let affordable = gameState.pointsBalance >= perk.pointCost

        return VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                ClayIconTile(systemImage: locked ? "lock.fill" : "tag.fill",
                             kind: locked ? .gold : .teal, size: 46, radius: Radius.chip)
                VStack(alignment: .leading, spacing: 3) {
                    Text(perk.partner.uppercased())
                        .font(VType.scaledBody(10, .bold)).tracking(1.1)
                        .foregroundStyle(Palette.teal.base).lineLimit(1)
                    Text(perk.title)
                        .font(VType.scaledDisplay(16, .semibold)).foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Spacing.sm)
                perkTrailing(perk, locked: locked, redeemed: redeemed, affordable: affordable)
            }

            if let description = perk.description {
                Text(description).font(VType.scaledBody(13)).foregroundStyle(Palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if locked, let opens = perk.earlyAccessUntil {
                lockedRow(opens: opens)
            } else if perk.isSoldOut {
                inlineNote(icon: "clock.badge.xmark", text: "Out of codes — more coming soon", tint: Palette.inkFaint)
            }
            if let terms = perk.terms {
                Text(terms).font(VType.scaledBody(11)).foregroundStyle(Palette.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: redeemed ? 0.5 : 0.9)
        .opacity(redeemed ? 0.7 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(perkAccessibilityLabel(perk, locked: locked, redeemed: redeemed, affordable: affordable))
        .accessibilityHint(locked ? "Opens the Verdure Plus subscription page."
                                  : (redeemed || !affordable ? "" : "Double tap to redeem."))
        .accessibilityIdentifier("reward-perk:\(perk.id)")
    }

    @ViewBuilder
    private func perkTrailing(_ perk: PartnerPerk, locked: Bool, redeemed: Bool, affordable: Bool) -> some View {
        if redeemed {
            HStack(spacing: 4) {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 13, weight: .bold))
                Text("Redeemed").font(VType.scaledBody(11, .bold))
            }
            .foregroundStyle(Palette.teal.base)
        } else if locked {
            Button { Haptics.tap(); showPaywall = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "bolt.fill").font(.system(size: 11, weight: .bold))
                    Text("Early").font(VType.scaledBody(12, .bold))
                }
                .foregroundStyle(Palette.gold.onColor)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(ClayBackground(style: .accent(.gold), radius: Radius.chip, elevation: 0.4))
            }
            .buttonStyle(.plain)
        } else {
            Button { Haptics.tap(); confirmingPerk = perk } label: {
                Text("\(perk.pointCost.formatted()) pts")
                    .font(VType.scaledNum(13, .bold))
                    .foregroundStyle(affordable && perk.redeemable ? Palette.spruce.onColor : Palette.inkFaint)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(ClayBackground(style: affordable && perk.redeemable ? .accent(.spruce) : .inset,
                                               radius: Radius.chip, elevation: 0.4))
            }
            .buttonStyle(.plain)
            .disabled(!affordable || !perk.redeemable || isRedeeming)
            .accessibilityIdentifier("redeem-perk:\(perk.id)")
        }
    }

    private func lockedRow(opens: Date) -> some View {
        inlineNote(icon: "bolt.fill",
                   text: "Verdure+ early access · opens to everyone \(Self.relative(opens))",
                   tint: Palette.gold.base)
    }

    private func inlineNote(icon: String, text: String, tint: Color) -> some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 11, weight: .bold))
            Text(text).font(VType.scaledBody(12, .semibold))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 11).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ClayBackground(style: .inset, radius: Radius.sm))
    }

    private func perkAccessibilityLabel(_ perk: PartnerPerk, locked: Bool,
                                        redeemed: Bool, affordable: Bool) -> String {
        var parts = ["\(perk.title) at \(perk.partner)", "\(perk.pointCost) points"]
        if redeemed { parts.append("already redeemed") }
        else if locked {
            parts.append("Verdure Plus early access")
            if let o = perk.earlyAccessUntil { parts.append("opens to everyone \(Self.relative(o))") }
        }
        else if perk.isSoldOut { parts.append("out of codes") }
        else if !affordable { parts.append("not enough points yet") }
        return parts.joined(separator: ", ")
    }

    // MARK: - Cash cards (secondary)

    @ViewBuilder
    private var cashSection: some View {
        let cards = economy.hasLoaded ? economy.catalog.activeCash : Self.fallbackCash
        if !cards.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                sectionHeader(icon: "creditcard.fill", kind: .gold, title: "Gift Cards",
                              subtitle: economy.catalog.cashEligible
                                  ? "Members only · \(economy.catalog.rollingRemainingUsd) dollars left this year"
                                  : "A Verdure+ member benefit")
                VStack(spacing: 12) {
                    ForEach(cards) { cashCard($0) }
                }
                .padding(.horizontal, Spacing.md)
            }
        }
    }

    private func cashCard(_ cash: CashReward) -> some View {
        let redeemed = gameState.isRedeemed(cash.id)
        let affordable = gameState.pointsBalance >= cash.cost
        let membersOnly = economy.hasLoaded && !economy.catalog.cashEligible

        return HStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: membersOnly ? "lock.fill" : "giftcard.fill",
                         kind: .gold, size: 50, radius: Radius.chip)
            VStack(alignment: .leading, spacing: 3) {
                Text(cash.name).font(VType.scaledDisplay(15, .semibold)).foregroundStyle(Palette.ink)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Text("\(cash.cost.formatted()) points")
                    .font(VType.scaledBody(12)).foregroundStyle(Palette.inkSoft).lineLimit(1)
            }
            Spacer(minLength: Spacing.sm)
            if redeemed {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.seal.fill").font(.system(size: 13, weight: .bold))
                    Text("Redeemed").font(VType.scaledBody(11, .bold))
                }
                .foregroundStyle(Palette.teal.base)
            } else if membersOnly {
                Button { Haptics.tap(); showPaywall = true } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "lock.fill").font(.system(size: 10, weight: .bold))
                        Text("Verdure+").font(VType.scaledBody(11, .bold))
                    }
                    .foregroundStyle(Palette.gold.onColor)
                    .padding(.horizontal, 11).padding(.vertical, 8)
                    .background(ClayBackground(style: .accent(.gold), radius: Radius.chip, elevation: 0.4))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(cash.name) requires Verdure Plus")
            } else {
                Button { Haptics.tap(); confirmingCash = cash } label: {
                    Text("Redeem").font(VType.scaledBody(13, .bold))
                        .foregroundStyle(affordable ? Palette.spruce.onColor : Palette.inkFaint)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(ClayBackground(style: affordable ? .accent(.spruce) : .inset,
                                                   radius: Radius.chip, elevation: 0.4))
                }
                .buttonStyle(.plain)
                .disabled(!affordable || isRedeeming || economy.catalog.treasuryPaused)
            }
        }
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: redeemed ? 0.5 : 0.85)
        .opacity(redeemed ? 0.7 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(cash.name), \(cash.cost) points"
            + (redeemed ? ", already redeemed" : membersOnly ? ", requires Verdure Plus"
               : affordable ? "" : ", not enough points yet"))
    }

    /// DEBUG offline fallback only — never shown once the server has answered.
    private static var fallbackCash: [CashReward] {
        #if DEBUG
        SampleData.rewards.map {
            CashReward(id: $0.id, name: $0.name,
                       usd: SampleData.rewardUSD[$0.id] ?? 0,
                       cost: $0.pointCost, active: true)
        }
        #else
        []
        #endif
    }

    // MARK: - Shared bits

    private func sectionHeader(icon: String, kind: ClayStyle.ClayAccentKind,
                               title: String, subtitle: String) -> some View {
        HStack(spacing: 10) {
            ClayIconTile(systemImage: icon, kind: kind, size: 38, radius: Radius.chip)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(VType.scaledDisplay(18, .semibold)).foregroundStyle(Palette.ink)
                Text(subtitle).font(VType.scaledBody(12, .medium)).foregroundStyle(Palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.horizontal, Spacing.md)
        .accessibilityElement(children: .combine)
    }

    private var loadingRow: some View {
        HStack(spacing: 10) {
            ProgressView().tint(Palette.teal.base)
            Text("Loading perks…").font(VType.scaledBody(13, .medium)).foregroundStyle(Palette.inkSoft)
            Spacer()
        }
        .padding(Spacing.md).padding(.horizontal, Spacing.md)
    }

    static func relative(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter(); f.unitsStyle = .full
        return f.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Honest zero-perk state

private struct EmptyPerksCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: 10) {
                ClayIconTile(systemImage: "storefront.fill", kind: .teal, size: 44, radius: Radius.chip)
                Text("No perks live yet").font(VType.scaledDisplay(16, .semibold))
                    .foregroundStyle(Palette.ink)
            }
            Text("Perks are small offers from local partners — a free coffee, a discount at a shop near a trail — that cost far fewer points than a gift card. Local offers will appear here when partners join.")
                .font(VType.scaledBody(13)).foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true).lineSpacing(3)
            Text("Your points keep accruing in the meantime.")
                .font(VType.scaledBody(12, .semibold)).foregroundStyle(Palette.teal.base)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
        .padding(.horizontal, Spacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Code display (copy to clipboard)

private struct PerkCodeSheet: View {
    let sheet: RewardsStoreView.RedeemedCodeSheet
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        ZStack {
            VerdureBackground()
            VStack(spacing: Spacing.lg) {
                Spacer()
                ClayIconTile(systemImage: "checkmark.circle.fill", kind: .teal, size: 96, radius: Radius.lg)
                Text("Perk redeemed").font(VType.scaledDisplay(26, .bold)).foregroundStyle(Palette.ink)
                Text("\(sheet.title) · \(sheet.partner)")
                    .font(VType.scaledBody(15)).foregroundStyle(Palette.inkSoft)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)

                VStack(spacing: Spacing.sm) {
                    Text("YOUR CODE").font(VType.scaledBody(10, .bold)).tracking(1.4)
                        .foregroundStyle(Palette.inkSoft)
                    Text(sheet.code)
                        .font(VType.scaledNum(24, .bold)).monospacedDigit()
                        .foregroundStyle(Palette.ink).textSelection(.enabled)
                        .lineLimit(2).minimumScaleFactor(0.6)
                        .multilineTextAlignment(.center)
                }
                .padding(Spacing.lg).frame(maxWidth: .infinity)
                .background(ClayBackground(style: .inset, radius: Radius.md))
                .padding(.horizontal, Spacing.lg)

                ClayButton(copied ? "Copied" : "Copy code",
                           systemImage: copied ? "checkmark" : "doc.on.doc",
                           kind: .spruce, fullWidth: true) {
                    UIPasteboard.general.string = sheet.code
                    Haptics.success()
                    withAnimation { copied = true }
                    AccessibilityNotification.Announcement("Code copied").post()
                }
                .padding(.horizontal, Spacing.lg)

                Text("Saved to My Codes — you can find it again any time.")
                    .font(VType.scaledBody(12)).foregroundStyle(Palette.inkFaint)
                Spacer()
                ClayButton("Done", systemImage: "checkmark", kind: .ghost, fullWidth: true) { dismiss() }
                    .padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.lg)
            }
        }
    }
}

// MARK: - My Codes

private struct MyCodesView: View {
    @Environment(EconomyService.self) private var economy
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                if economy.myCodes.isEmpty {
                    VStack(spacing: Spacing.md) {
                        ClayIconTile(systemImage: "ticket", kind: .teal, size: 60, radius: Radius.md)
                        Text("No codes yet").font(VType.scaledDisplay(18, .semibold)).foregroundStyle(Palette.ink)
                        Text("Perks you redeem show up here with their codes.")
                            .font(VType.scaledBody(13)).foregroundStyle(Palette.inkSoft)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(.top, 80).padding(.horizontal, Spacing.xl)
                    .accessibilityElement(children: .combine)
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(economy.myCodes) { code in codeRow(code) }
                    }
                    .padding(Spacing.md)
                }
            }
            .background(VerdureBackground())
            .navigationTitle("My Codes").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(Palette.spruce.base)
                }
            }
            .task { await economy.loadMyCodes() }
        }
    }

    private func codeRow(_ c: RedeemedPerkCode) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(c.partner.uppercased()).font(VType.scaledBody(10, .bold)).tracking(1.1)
                .foregroundStyle(Palette.teal.base)
            Text(c.title).font(VType.scaledDisplay(15, .semibold)).foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Text(c.code).font(VType.scaledNum(16, .bold)).foregroundStyle(Palette.ink)
                    .textSelection(.enabled).lineLimit(1).minimumScaleFactor(0.7)
                Spacer()
                Button {
                    UIPasteboard.general.string = c.code
                    Haptics.success()
                    AccessibilityNotification.Announcement("Code copied").post()
                } label: {
                    Image(systemName: "doc.on.doc").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Palette.spruce.base)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy code for \(c.title)")
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(ClayBackground(style: .inset, radius: Radius.sm))

            HStack(spacing: 10) {
                if let r = c.redeemedAt {
                    Label("Redeemed \(r.formatted(date: .abbreviated, time: .omitted))", systemImage: "calendar")
                }
                if let e = c.expiresAt {
                    Label("Expires \(e.formatted(date: .abbreviated, time: .omitted))", systemImage: "hourglass")
                }
            }
            .font(VType.scaledBody(11, .medium)).foregroundStyle(Palette.inkFaint)
            if let terms = c.terms {
                Text(terms).font(VType.scaledBody(11)).foregroundStyle(Palette.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(c.title) at \(c.partner), code \(c.code)")
    }
}

#Preview {
    RewardsStoreView()
        .environment(GameStateManager())
        .environment(StoreService())
        .environment(EconomyService())
}
