import SwiftUI

// MARK: - Daily Gem (tap the gem → reveal today's fun fact with a burst)
//
// Shown automatically once per day on the first open (see RootView + DailyGemStore),
// and re-viewable from the Explore tile. The fact itself is a daily nugget about
// nature, community, events, or the environment.

struct DailyGemView: View {
    let fact: GemFact
    let onDismiss: () -> Void

    @State private var showContent = false
    @State private var revealed = false
    @State private var burst = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            VerdureBackground()

            VStack(spacing: Spacing.lg) {
                Spacer(minLength: 0)

                // The gem — tap to reveal
                ZStack {
                    AmbientGlow(color: (revealed ? fact.accent.accent.base : Palette.gold.base).opacity(0.42),
                                size: revealed ? 280 : 340, opacity: 0.85)

                    // Burst sparkles that fly outward on reveal
                    ForEach(0..<10, id: \.self) { i in burstSparkle(i) }

                    MedallionHero(size: revealed ? 150 : 236, interactive: false)
                        .scaleEffect(showContent ? 1 : 0.5)
                        .opacity(showContent ? 1 : 0)

                    // Idle invitation sparkles (before reveal)
                    if !revealed {
                        sparkle(14, x: -120, y: -20, delay: 0.3)
                        sparkle(10, x: 118, y: -54, delay: 0.5)
                        sparkle(8, x: 128, y: 40, delay: 0.7)
                        sparkle(11, x: -108, y: 70, delay: 0.9)
                    }
                }
                .frame(height: revealed ? 170 : 280)
                .contentShape(Circle())
                .onTapGesture { revealed ? dismiss() : reveal() }
                .scaleEffect(showContent && !revealed ? 1 : (revealed ? 1 : 0.95))
                .breathing(scale: revealed ? 1 : 1.04, duration: 2.4)
                .accessibilityElement()
                .accessibilityLabel(revealed ? "Daily Gem revealed" : "Daily Gem")
                .accessibilityHint(revealed ? "Double tap to close." : "Double tap to reveal today's fun fact.")
                .accessibilityAddTraits(.isButton)

                // Title
                VStack(spacing: Spacing.sm) {
                    KickerLabel(text: "Today's discovery", color: Palette.gold.base, dot: Palette.gold.base)
                    Text("Daily Gem")
                        .font(VType.display(44, .bold))
                        .foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                    if !revealed {
                        Text("Tap the gem to reveal today's\nfun fact about your world.")
                            .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                            .multilineTextAlignment(.center).lineSpacing(3)
                            .transition(.opacity)
                    }
                }
                .opacity(showContent ? 1 : 0)
                .offset(y: showContent ? 0 : 16)

                // Revealed: the fact card
                if revealed {
                    factCard
                        .transition(.scale(scale: 0.82).combined(with: .opacity))
                }

                Spacer(minLength: 0)

                Text(revealed ? "Tap anywhere to continue" : "")
                    .font(VType.body(13, .medium)).foregroundStyle(Palette.inkFaint)
                    .opacity(revealed ? 1 : 0)
                    .padding(.bottom, Spacing.lg)
            }
            .padding(.horizontal, Spacing.xl)
        }
        .contentShape(Rectangle())
        .onTapGesture { if revealed { dismiss() } }
        .onAppear {
            withAnimation(.spring(response: 0.85, dampingFraction: 0.72).delay(0.15)) { showContent = true }
        }
    }

    // MARK: Reveal / dismiss

    private func reveal() {
        guard !revealed else { return }
        Haptics.success()
        withAnimation(.spring(response: 0.55, dampingFraction: 0.62)) { revealed = true }
        if !reduceMotion {
            withAnimation(.easeOut(duration: 0.8)) { burst = true }
        }
        AccessibilityNotification.Announcement("\(fact.kind). \(fact.text)").post()
    }

    private func dismiss() { Haptics.tap(); onDismiss() }

    // MARK: Fact card

    private var factCard: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: 10) {
                ClayIconTile(systemImage: fact.icon, kind: fact.accent, size: 44, radius: Radius.chip)
                Text(fact.kind.uppercased())
                    .font(VType.body(11, .bold)).tracking(1.2)
                    .foregroundStyle(fact.accent.accent.base)
                Spacer()
            }
            Text(fact.text)
                .font(VType.display(18, .medium))
                .foregroundStyle(Palette.ink)
                .lineSpacing(4).fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .claySurface(.surface, radius: Radius.lg, elevation: 1.1)
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
            .strokeBorder(fact.accent.accent.base.opacity(0.4), lineWidth: 1.5))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(fact.kind). \(fact.text)")
    }

    // MARK: Sparkles

    private func sparkle(_ size: CGFloat, x: CGFloat, y: CGFloat, delay: Double) -> some View {
        Image(systemName: "sparkle")
            .font(.system(size: size, weight: .bold))
            .foregroundStyle(Palette.gold.base)
            .offset(x: x, y: y)
            .opacity(showContent ? 0.9 : 0)
            .scaleEffect(showContent ? 1 : 0.4)
            .animation(.spring(response: 0.6, dampingFraction: 0.6).delay(delay), value: showContent)
            .accessibilityHidden(true)
    }

    /// A sparkle that flies outward from the gem center when revealed.
    private func burstSparkle(_ i: Int) -> some View {
        let angle = Double(i) / 10.0 * 2 * .pi
        let dist: CGFloat = burst ? 150 : 0
        return Image(systemName: "sparkle")
            .font(.system(size: i % 2 == 0 ? 12 : 8, weight: .bold))
            .foregroundStyle(fact.accent.accent.base)
            .offset(x: cos(angle) * dist, y: sin(angle) * dist)
            .opacity(burst ? 0 : (revealed ? 0.9 : 0))
            .scaleEffect(burst ? 0.4 : 1)
            .accessibilityHidden(true)
    }
}

#Preview {
    DailyGemView(fact: SampleData.gemFacts[0], onDismiss: {})
}
