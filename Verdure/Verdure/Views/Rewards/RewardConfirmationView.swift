import SwiftUI

struct RewardConfirmationView: View {
    let reward: Reward
    @Environment(\.dismiss) private var dismiss
    @State private var showCheck = false
    @State private var showContent = false
    @State private var burst = false
    @State private var particles: [ConfettiBit] = []

    private var kind: ClayStyle.ClayAccentKind { reward.tier.clayKind }

    var body: some View {
        ZStack {
            VerdureBackground()

            // Particle burst
            ForEach(particles) { p in
                Image(systemName: p.symbol)
                    .font(.system(size: p.size, weight: .bold))
                    .foregroundStyle(p.color)
                    .offset(x: burst ? p.endX : 0, y: burst ? p.endY : 0)
                    .rotationEffect(.degrees(burst ? p.rotation : 0))
                    .opacity(burst ? 0 : 1)
            }
            .animation(.easeOut(duration: 1.5), value: burst)

            VStack(spacing: Spacing.xl) {
                Spacer()

                ZStack {
                    AmbientGlow(color: Palette.teal.base.opacity(0.4), size: 240, opacity: 0.7)
                    Circle().stroke(Palette.teal.base.opacity(0.5), lineWidth: 3)
                        .frame(width: 150, height: 150)
                        .scaleEffect(burst ? 2.2 : 0.5).opacity(burst ? 0 : 0.8)
                        .animation(.easeOut(duration: 1.3).repeatForever(autoreverses: false), value: burst)
                    ClayIconTile(systemImage: "checkmark.circle.fill", kind: .teal, size: 116, radius: Radius.lg)
                        .scaleEffect(showCheck ? 1 : 0.3)
                        .animation(.spring(response: 0.6, dampingFraction: 0.55), value: showCheck)
                }
                .frame(height: 170)

                VStack(spacing: Spacing.md) {
                    Text("Reward Redeemed!").font(VType.display(26, .bold)).foregroundStyle(Palette.ink)
                    HStack(spacing: 8) {
                        ClayIconTile(systemImage: reward.icon, kind: kind, size: 38, radius: Radius.chip)
                        Text(reward.name).font(VType.display(18, .semibold)).foregroundStyle(kind.accent.base)
                    }
                    Text("Your redemption is recorded. The gift-card code will be emailed to your account address within 48 hours.")
                        .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        .multilineTextAlignment(.center).padding(.horizontal, Spacing.xl).lineSpacing(3)

                    HStack(spacing: 10) {
                        Image(systemName: "envelope.badge.fill")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.teal.base)
                        Text("Delivery via email · keep an eye on your inbox")
                            .font(VType.body(13, .semibold)).foregroundStyle(Palette.inkSoft)
                    }
                    .padding(.vertical, Spacing.md).padding(.horizontal, Spacing.lg)
                    .background(ClayBackground(style: .inset, radius: Radius.sm))
                    .accessibilityElement(children: .combine)
                }
                .opacity(showContent ? 1 : 0)
                .offset(y: showContent ? 0 : 20)
                .animation(.spring(response: 0.6, dampingFraction: 0.8).delay(0.3), value: showContent)

                Spacer()

                ClayButton("Done", systemImage: "checkmark", kind: .spruce, fullWidth: true) { dismiss() }
                    .padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.lg)
            }
        }
        .onAppear {
            generate()
            showCheck = true; showContent = true
            Haptics.success()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { burst = true }
        }
    }

    private func generate() {
        let palette = [Palette.teal.base, Palette.gold.base, Palette.spruce.base, kind.accent.base]
        let symbols = ["leaf.fill", "sparkle", "star.fill", "circle.fill"]
        particles = (0..<24).map { _ in
            ConfettiBit(color: palette.randomElement()!, symbol: symbols.randomElement()!,
                        size: .random(in: 8...18), endX: .random(in: -180...180),
                        endY: .random(in: -260...120), rotation: .random(in: -200...200))
        }
    }
}

private struct ConfettiBit: Identifiable {
    let id = UUID()
    let color: Color
    let symbol: String
    let size: CGFloat
    let endX: CGFloat
    let endY: CGFloat
    let rotation: Double
}

// Make Reward usable with .sheet(item:)
extension Reward: Equatable {
    static func == (lhs: Reward, rhs: Reward) -> Bool { lhs.id == rhs.id }
}
extension Reward: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

#Preview {
    RewardConfirmationView(reward: SampleData.rewards[0])
}
