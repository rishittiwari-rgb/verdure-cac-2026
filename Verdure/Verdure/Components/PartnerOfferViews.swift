import SwiftUI

struct NearYouPartnerCard: View {
    let offer: PartnerMapOffer
    @Environment(PartnerDiscoveryService.self) private var partners
    @State private var showDetail = false
    var body: some View {
        HStack(alignment: .center, spacing: Spacing.sm) {
            Button { showDetail = true } label: {
                HStack(spacing: Spacing.sm) {
                    ClayIconTile(systemImage: "storefront.fill", kind: .gold, size: 40, radius: Radius.sm)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("NEAR YOU · PARTNER OFFER").font(VType.scaledBody(10, .bold)).foregroundStyle(Palette.inkSoft)
                        Text(offer.partner).font(VType.scaledBody(15, .semibold)).foregroundStyle(Palette.ink)
                        Text("About \(offer.walkingMinutes) min away · \(offer.title)")
                            .font(VType.scaledBody(12)).foregroundStyle(Palette.inkSoft)
                        if !offer.claimable, let opensAt = offer.opensAt {
                            Text("Early access · opens \(opensAt.formatted(date: .abbreviated, time: .omitted))")
                                .font(VType.scaledBody(11)).foregroundStyle(Palette.inkSoft)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }.buttonStyle(.plain)
            Button { Task { await partners.dismiss(offer) } } label: {
                Image(systemName: "xmark").frame(width: 44, height: 44)
            }.buttonStyle(.plain).foregroundStyle(Palette.inkSoft)
                .accessibilityLabel("Dismiss offer from \(offer.partner)")
        }
        .padding(Spacing.sm)
        .background(ClayBackground(style: .surface, radius: Radius.md, elevation: 0.6))
        .padding(.horizontal, Spacing.md).padding(.top, Spacing.sm)
        .sheet(isPresented: $showDetail) { PartnerOfferDetail(offer: offer) }
    }
}

struct PartnerOfferDetail: View {
    let offer: PartnerMapOffer
    @Environment(PartnerDiscoveryService.self) private var partners
    @Environment(\.dismiss) private var dismiss
    @State private var showRewards = false
    private var offerIsCurrent: Bool {
        (offer.expiresAt ?? .distantFuture) > Date() &&
        (partners.offers.contains(offer) || partners.nearYou == offer)
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Label("Partner offer", systemImage: "storefront.fill").foregroundStyle(Palette.gold.base)
                    Text(offer.partner).font(VType.scaledDisplay(26, .bold))
                    Text(offer.title).font(VType.scaledBody(19, .semibold))
                    Text(offer.description).font(VType.scaledBody(15))
                    if !offer.claimable, let opensAt = offer.opensAt {
                        Text("Early access for Verdure+ · opens \(opensAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(VType.scaledBody(13)).foregroundStyle(Palette.inkSoft)
                    }
                    Label("\(offer.pointCost.formatted()) points", systemImage: "sparkles")
                    Label("About \(offer.walkingMinutes) min walk", systemImage: "figure.walk")
                    Text("Walking time is an estimate from distance, not a route.")
                        .font(VType.scaledBody(12)).foregroundStyle(Palette.inkSoft)
                    Button("View in Rewards") { showRewards = true }.buttonStyle(.borderedProminent)
                    Button("Dismiss this offer") {
                        Task { await partners.dismiss(offer); if partners.error == nil { dismiss() } }
                    }.buttonStyle(.bordered)
                    if let error = partners.error { Text(error).foregroundStyle(Palette.terracotta.base) }
                }.padding(Spacing.lg).frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityIdentifier("partnerOfferDetail")
            .background(VerdureBackground()).foregroundStyle(Palette.ink)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $showRewards) { RewardsStoreView() }
        }.presentationDetents([.medium, .large])
            .task { if !offerIsCurrent { dismiss() } }
            .onChange(of: offerIsCurrent) { _, current in if !current { dismiss() } }
    }
}
