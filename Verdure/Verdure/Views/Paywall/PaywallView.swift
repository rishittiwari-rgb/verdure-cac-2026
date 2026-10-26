import SwiftUI
import StoreKit

// MARK: - Verdure+ Paywall
//
// HONEST-COPY POLICY (App Store 2.3.1/3.1.2 safety): this sheet lists ONLY
// features that exist in the shipping build. Roadmap items from the Verdure
// Subscription Model doc (Adventure Planner, AR Adventures, health
// integrations, premium navigation, smart insights, Community+) are NOT sold
// here — they get added to `features` one by one as they actually ship. A
// single muted line acknowledges that more is in development, promising nothing.
//
// Live Verdure+ benefits today:
//   • Premium Rewards — Gold ($25) + Platinum ($50) gift-card tiers unlock
//   • Member badge on the profile player card

struct PaywallView: View {
    @Environment(StoreService.self) private var store
    @Environment(\.dismiss) private var dismiss

    /// Where the paywall was opened from, so conversion can be attributed to a
    /// surface rather than averaged into one meaningless rate.
    var source: String = "unspecified"
    @State private var selectedID = StoreService.yearlyID
    @State private var isWorking = false

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: Spacing.xl) {
                    hero
                    if store.isPlus {
                        memberCard
                    } else {
                        featureList
                        planPicker
                        purchaseCTA
                    }
                    footer
                }
                .padding(.horizontal, Spacing.md)
                .padding(.top, Spacing.sm)
                .padding(.bottom, Spacing.xxl)
            }
            .background(VerdureBackground())
            .navigationTitle("Verdure+").navigationBarTitleDisplayMode(.inline)
            .onAppear { Analytics.log(event: .paywallShown, params: ["source": source]) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
    }

    // MARK: - Hero

    private var hero: some View {
        VStack(spacing: Spacing.md) {
            ZStack {
                AmbientGlow(color: Palette.gold.base.opacity(0.4), size: 210, opacity: 0.8)
                MedallionHero(size: 150, interactive: false)
            }
            .frame(height: 160)
            .accessibilityHidden(true)

            KickerLabel(text: "Go further outside", color: Palette.gold.base, dot: Palette.gold.base)
            Text("Verdure+")
                .font(VType.display(38, .bold)).foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
            Text("Everything in free, plus premium rewards\nand member perks.")
                .font(VType.scaledBody(15, relativeTo: .subheadline)).foregroundStyle(Palette.inkSoft)
                .multilineTextAlignment(.center).lineSpacing(3)
        }
    }

    // MARK: - Active member state

    private var memberCard: some View {
        VStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: "checkmark.seal.fill", kind: .teal, size: 64, radius: Radius.md)
            Text("You're a Verdure+ member")
                .font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
            Text("Premium rewards are unlocked. Manage or cancel anytime in App Store settings.")
                .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                .multilineTextAlignment(.center).lineSpacing(3)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity)
        .claySurface(.surface, radius: Radius.lg, elevation: 1.1)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Features (from the subscription model doc)

    struct PlusFeature: Identifiable {
        let icon: String
        let title: String
        let detail: String
        let kind: ClayStyle.ClayAccentKind
        var id: String { title }
    }

    /// ONLY shipped features belong in this list — see the honest-copy policy above.
    ///
    /// FOUR, not five. The Verdure+ member badge is still real and still shows
    /// on the player card, but it is a cosmetic delight rather than a reason to
    /// pay, and padding the list with it weakens the four that are. The streak
    /// freeze is deliberately absent for a different reason: it is FREE for
    /// every account (see GameStateManager.streakInsuranceDays), and a test
    /// fails if any string here mentions it.
    ///
    /// NOTE: the Verdure+ earn multiplier is deliberately ABSENT, and the reason
    /// has NARROWED but not gone away.
    ///
    /// Entitlement verification now exists: `functions/src/subscriptions.ts`
    /// verifies the purchase with Apple and writes `users/{uid}.plusExpiresAt`,
    /// which `earnMultiplier()` reads — and the E2E suite proves a member earns
    /// 1.25x while a non-member and an expired member both earn 1.0x.
    ///
    /// What's still missing is DEPLOYMENT. Cloud Functions are not live (billing
    /// is still Spark), so in production nothing writes that field and the
    /// multiplier pays nothing. Two things unblock this line:
    ///   1. `firebase deploy --only functions` on Blaze
    ///   2. the Apple IAP secrets set (see subscriptions.ts SETUP)
    /// When both are true, add the multiplier here AND to the App Store
    /// description in the same commit — AppStore/LISTING.md carries the exact
    /// copy and the same instruction, so the two can never drift apart.
    let features: [PlusFeature] = [
        // ORDER MATTERS: the planner leads because it is the benefit a member
        // uses on day one. What was here before led with "Unlock the Gold &
        // Platinum tiers — redeem $25 and $50 gift cards", which the server
        // refuses: those four rewards are `active: false` in CASH_CATALOG.
        // Charging $4.99/month for a benefit the backend declines is an App
        // Review rejection under the auto-renewing subscription guidelines and a
        // consumer-protection exposure independent of Apple.
        PlusFeature(icon: "wand.and.stars", title: "Unlimited Adventure Planner",
                    detail: "Plan as many outings as you like — free members get 5 a month", kind: .teal),
        PlusFeature(icon: "bolt.fill", title: "Early Access to Partner Perks",
                    detail: "See and claim new local perks before everyone else", kind: .terracotta),
        PlusFeature(icon: "giftcard.fill", title: "Cash Gift Cards",
                    detail: "$5 and $10 cards, members only", kind: .gold),
        PlusFeature(icon: "chart.bar.fill", title: "Advanced Stats",
                    detail: "Where your points come from, and your last 30 days", kind: .spruce),
        PlusFeature(icon: "square.stack.3d.up.fill", title: "Advanced Personalization",
                    detail: "Switch interest profiles and save event filters", kind: .teal),
        PlusFeature(icon: "arrow.down.circle.fill", title: "Offline park and place packs",
                    detail: "Seven-day downloads of guides, trail lines and plans; background map imagery is not included", kind: .spruce),
    ]

    /// The feature COPY, exposed for tests.
    ///
    /// Two rules are asserted against this rather than trusted: nothing here may
    /// name a reward tier the server has as `active: false`, and nothing here
    /// may mention the streak freeze — that is free for every account and
    /// selling it would make the streak a lever on the subscription.
    static var featureCopyForTesting: [String] {
        PaywallView().features.flatMap { [$0.title, $0.detail] }
    }

    private var featureList: some View {
        VStack(spacing: 12) {
            ForEach(features) { feature in
                HStack(spacing: Spacing.md) {
                    ClayIconTile(systemImage: feature.icon, kind: feature.kind, size: 44, radius: Radius.chip)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(feature.title)
                            .font(VType.scaledDisplay(15, .semibold, relativeTo: .subheadline))
                            .foregroundStyle(Palette.ink)
                        Text(feature.detail)
                            .font(VType.scaledBody(12, relativeTo: .caption)).foregroundStyle(Palette.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                }
                .padding(Spacing.md)
                .claySurface(.surface, radius: Radius.md, elevation: 0.75)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(feature.title). \(feature.detail).")
            }

            // Roadmap acknowledgement — deliberately vague, promises nothing.
            Text("More member features are in development and will be included as they launch.")
                .font(VType.scaledBody(11, relativeTo: .caption2)).foregroundStyle(Palette.inkFaint)
                .multilineTextAlignment(.center)
                .padding(.top, 2)
        }
    }

    // MARK: - Plans

    private var planPicker: some View {
        HStack(spacing: 12) {
            planCard(id: StoreService.monthlyID,
                     title: "Monthly",
                     price: store.monthly?.displayPrice ?? "$4.99",
                     cadence: "per month",
                     badge: nil)
            planCard(id: StoreService.yearlyID,
                     title: "Yearly",
                     price: store.yearly?.displayPrice ?? "$49.99",
                     cadence: "per year",
                     badge: "SAVE 17%")
        }
    }

    private func planCard(id: String, title: String, price: String, cadence: String, badge: String?) -> some View {
        let isSelected = selectedID == id
        return Button {
            Haptics.tap()
            withAnimation(.spring(response: 0.35)) { selectedID = id }
        } label: {
            VStack(spacing: 6) {
                if let badge {
                    Text(badge)
                        .font(VType.body(9, .bold)).tracking(0.8)
                        .foregroundStyle(Palette.gold.onColor)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(ClayBackground(style: .accent(.gold), radius: Radius.chip, elevation: 0.3))
                } else {
                    Spacer().frame(height: 21)
                }
                Text(title).font(VType.body(13, .semibold))
                    .foregroundStyle(isSelected ? Palette.spruce.onColor : Palette.inkSoft)
                Text(price).font(VType.num(24, .bold)).monospacedDigit()
                    .foregroundStyle(isSelected ? Palette.spruce.onColor : Palette.ink)
                Text(cadence).font(VType.body(11))
                    .foregroundStyle(isSelected ? Palette.spruce.onColor.opacity(0.8) : Palette.inkFaint)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.md)
        }
        .buttonStyle(ClayPressButtonStyle(
            style: isSelected ? .accent(.spruce) : .surface,
            radius: Radius.md, elevation: isSelected ? 1.0 : 0.7))
        .accessibilityLabel("\(title) plan, \(price) \(cadence)\(badge != nil ? ", best value" : "")")
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    // MARK: - CTA

    private var selectedProduct: Product? {
        selectedID == StoreService.yearlyID ? store.yearly : store.monthly
    }

    private var purchaseCTA: some View {
        VStack(spacing: Spacing.sm) {
            if store.products.isEmpty && !store.isLoadingProducts {
                Text("Subscriptions aren't available right now. In the simulator, run the Verdure scheme (it loads Verdure.storekit); on device this needs App Store Connect products.")
                    .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                    .multilineTextAlignment(.center)
                    .padding(Spacing.md)
                    .background(ClayBackground(style: .inset, radius: Radius.sm))
            }

            ClayButton(isWorking ? "One moment…" : "Start Verdure+",
                       systemImage: "sparkles", kind: .spruce, fullWidth: true) {
                guard let product = selectedProduct, !isWorking else { return }
                isWorking = true
                Task {
                    let purchased = await store.purchase(product)
                    isWorking = false
                    if purchased {
                        AccessibilityNotification.Announcement("Welcome to Verdure Plus.").post()
                    }
                }
            }
            .disabled(selectedProduct == nil || isWorking)
            .opacity(selectedProduct == nil || isWorking ? 0.6 : 1)
            .accessibilityLabel("Start Verdure Plus")
            .accessibilityHint("Subscribes to the selected plan.")

            Button {
                guard !isWorking else { return }
                isWorking = true
                Task { await store.restorePurchases(); isWorking = false }
            } label: {
                Text("Restore Purchases")
                    .font(VType.body(13, .semibold)).foregroundStyle(Palette.spruce.base)
            }
            .buttonStyle(.plain)

            if let error = store.lastError {
                Text(error)
                    .font(VType.body(12, .medium)).foregroundStyle(Palette.danger)
                    .multilineTextAlignment(.center)
            }
        }
    }

    /// Subscription disclosure required by App Review 3.1.2: length, that the
    /// price shown is the price charged, auto-renewal, and live Terms/Privacy links.
    private var footer: some View {
        VStack(spacing: 8) {
            Text("Verdure+ Monthly renews every \(Legal.Subscription.monthlyLength); Verdure+ Yearly renews every \(Legal.Subscription.yearlyLength). Payment is charged to your Apple ID at confirmation and the subscription renews automatically at the price shown unless cancelled at least 24 hours before the period ends. Manage or cancel in App Store settings.")
                .font(VType.scaledBody(11, relativeTo: .caption2)).foregroundStyle(Palette.inkFaint)
                .multilineTextAlignment(.center).lineSpacing(2)
            LegalLinksRow()
        }
    }
}

#Preview {
    PaywallView()
        .environment(StoreService())
}
