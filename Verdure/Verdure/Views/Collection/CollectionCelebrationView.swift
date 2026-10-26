import SwiftUI

/// Full-screen clay overlay shown when a place is collected.
struct CollectionCelebrationView: View {
    let collectible: CollectiblePlace
    let pointsEarned: Int
    let onDismiss: () -> Void

    @State private var showCard = false
    @State private var showText = false
    @State private var showPoints = false
    @State private var particles: [Particle] = []
    @State private var particlesVisible = false
    @State private var ringPulse = false

    private var kind: ClayStyle.ClayAccentKind { collectible.rarity.clayKind }

    var body: some View {
        ZStack {
            Color(hex: 0x0A140F).opacity(0.78).ignoresSafeArea()
                .onTapGesture { onDismiss() }

            // Expanding rarity ring
            Circle()
                .stroke(collectible.rarity.accent.base.opacity(0.6), lineWidth: 3)
                .frame(width: 200, height: 200)
                .scaleEffect(ringPulse ? 2.6 : 0.4)
                .opacity(ringPulse ? 0 : 0.8)
                .animation(.easeOut(duration: 1.4).repeatForever(autoreverses: false), value: ringPulse)

            // Particles
            ForEach(particles) { p in
                Image(systemName: p.symbol)
                    .font(.system(size: p.size, weight: .bold))
                    .foregroundStyle(p.color)
                    .offset(x: particlesVisible ? p.endX : 0, y: particlesVisible ? p.endY : 0)
                    .opacity(particlesVisible ? 0 : 1)
                    .rotationEffect(.degrees(particlesVisible ? p.rotation : 0))
                    .scaleEffect(particlesVisible ? 0.3 : 1)
            }
            .animation(.easeOut(duration: 1.6), value: particlesVisible)

            VStack(spacing: Spacing.lg) {
                RarityBadge(rarity: collectible.rarity, size: .large)
                    .scaleEffect(showCard ? 1 : 0)
                    .animation(.spring(response: 0.5, dampingFraction: 0.6).delay(0.2), value: showCard)

                VStack(spacing: Spacing.md) {
                    RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                        .fill(kind.accent.faceGradient)
                        .frame(width: 200, height: 160)
                        .overlay {
                            Image(systemName: collectible.place.imagePlaceholder)
                                .font(.system(size: 64, weight: .semibold))
                                .foregroundStyle(kind.accent.onColor.opacity(0.92))
                        }
                        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                            .strokeBorder(.white.opacity(0.2), lineWidth: 1))
                        .shadow(color: collectible.rarity.accent.depth.opacity(0.7), radius: 28, x: 0, y: 14)

                    Text(collectible.place.name)
                        .font(VType.display(22, .semibold)).foregroundStyle(.white)
                }
                .scaleEffect(showCard ? 1 : 0.3)
                .opacity(showCard ? 1 : 0)
                .animation(.spring(response: 0.6, dampingFraction: 0.62), value: showCard)

                Text("COLLECTED!")
                    .font(VType.display(30, .bold))
                    .foregroundStyle(collectible.rarity.accent.base)
                    .scaleEffect(showText ? 1 : 0.5).opacity(showText ? 1 : 0)
                    .animation(.spring(response: 0.5, dampingFraction: 0.5).delay(0.4), value: showText)

                HStack(spacing: 6) {
                    Image(systemName: "leaf.circle.fill").font(.system(size: 18, weight: .bold))
                    Text("+\(pointsEarned) pts").font(VType.num(22, .bold)).monospacedDigit()
                }
                .foregroundStyle(Palette.gold.onColor)
                .padding(.horizontal, 16).padding(.vertical, 9)
                .background(ClayBackground(style: .accent(.gold), radius: Radius.chip, elevation: 0.5))
                .scaleEffect(showPoints ? 1 : 0).opacity(showPoints ? 1 : 0)
                .animation(.spring(response: 0.5, dampingFraction: 0.6).delay(0.6), value: showPoints)
            }
        }
        .onAppear {
            generateParticles()
            ringPulse = true
            showCard = true; showText = true; showPoints = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { particlesVisible = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { onDismiss() }
        }
    }

    private func generateParticles() {
        let palette = [collectible.rarity.accent.base, Palette.teal.base, Palette.gold.base, Color.white]
        let symbols = ["leaf.fill", "sparkle", "circle.fill", "star.fill"]
        particles = (0..<26).map { _ in
            Particle(
                color: palette.randomElement()!,
                symbol: symbols.randomElement()!,
                size: CGFloat.random(in: 8...18),
                endX: CGFloat.random(in: -190...190),
                endY: CGFloat.random(in: -270...270),
                rotation: Double.random(in: -220...220)
            )
        }
    }
}

private struct Particle: Identifiable {
    let id = UUID()
    let color: Color
    let symbol: String
    let size: CGFloat
    let endX: CGFloat
    let endY: CGFloat
    let rotation: Double
}

#Preview {
    CollectionCelebrationView(collectible: SampleData.collectiblePlaces[6], pointsEarned: 1000) {}
}
