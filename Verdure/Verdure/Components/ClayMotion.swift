import SwiftUI

// MARK: - QA motion kill-switch
//
// Continuous (repeatForever) animations never reach quiescence, which blocks
// XCUITest's accessibility-audit snapshotter ("Audit failed to complete in
// time"). UI tests launch with `-QADisableMotion YES` to freeze ambient motion;
// release builds are unaffected.
@MainActor
enum QAMotion {
    #if DEBUG
    static let disabled = UserDefaults.standard.bool(forKey: "QADisableMotion")
    #else
    static let disabled = false
    #endif
}

/// `-QAOfflineData YES`: skip live network fetches (cache/samples only) so
/// screens settle instantly and deterministically for UI tests + audits.
@MainActor
enum QAData {
    #if DEBUG
    static let offline = UserDefaults.standard.bool(forKey: "QAOfflineData")
    #else
    static let offline = false
    #endif
}
import CoreMotion

// =====================================================================
//  ClayMotion — the motion + faux-3D layer.
//  Physical springs, gyroscope parallax tilt, shimmer sweeps, ambient
//  glows and a soft clay grain. The "weight" that makes clay feel real.
// =====================================================================

// MARK: - Device motion (gyroscope parallax)

@MainActor
final class MotionManager: ObservableObject {
    static let shared = MotionManager()
    @Published var roll: Double = 0   // -1...1 (left/right)
    @Published var pitch: Double = 0  // -1...1 (up/down)

    private let manager = CMMotionManager()
    private var active = 0

    func start() {
        active += 1
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let m = motion else { return }
            // Clamp and smooth toward target.
            let targetRoll = max(-1, min(1, m.attitude.roll / 0.7))
            let targetPitch = max(-1, min(1, (m.attitude.pitch - 0.6) / 0.7))
            self.roll += (targetRoll - self.roll) * 0.12
            self.pitch += (targetPitch - self.pitch) * 0.12
        }
    }

    func stop() {
        active = max(0, active - 1)
        if active == 0 { manager.stopDeviceMotionUpdates() }
    }
}

/// Tilts the view in faux-3D based on device attitude. Degrades gracefully
/// on the simulator (no gyro → stays flat).
struct ParallaxTilt: ViewModifier {
    var magnitude: Double = 6
    var shadow: Bool = true
    @StateObject private var motion = MotionManager.shared
    func body(content: Content) -> some View {
        content
            .rotation3DEffect(.degrees(motion.roll * magnitude),
                              axis: (x: 0, y: 1, z: 0), perspective: 0.5)
            .rotation3DEffect(.degrees(-motion.pitch * magnitude),
                              axis: (x: 1, y: 0, z: 0), perspective: 0.5)
            .shadow(color: shadow ? Palette.surfaceShadow.opacity(0.5) : .clear,
                    radius: 12, x: -motion.roll * 8, y: -motion.pitch * 8 + 6)
            .onAppear { motion.start() }
            .onDisappear { motion.stop() }
    }
}

extension View {
    func parallaxTilt(magnitude: Double = 6, shadow: Bool = true) -> some View {
        modifier(ParallaxTilt(magnitude: magnitude, shadow: shadow))
    }
}

// MARK: - Shimmer sweep

struct Shimmer: ViewModifier {
    var active: Bool = true
    @State private var phase: CGFloat = -1
    func body(content: Content) -> some View {
        content.overlay {
            if active {
                GeometryReader { geo in
                    LinearGradient(
                        colors: [.clear, Palette.surfaceLight.opacity(0.7), .clear],
                        startPoint: .topLeading, endPoint: .bottomTrailing)
                    .frame(width: geo.size.width * 1.4)
                    .offset(x: phase * geo.size.width * 1.6)
                    .blendMode(.screen)
                    .allowsHitTesting(false)
                }
                .mask(content)
                .onAppear {
                    guard !QAMotion.disabled else { return }
                    withAnimation(.linear(duration: 2.4).repeatForever(autoreverses: false)) {
                        phase = 1.2
                    }
                }
            }
        }
    }
}

extension View {
    func shimmer(_ active: Bool = true) -> some View { modifier(Shimmer(active: active)) }
}

// MARK: - Idle float (weighted bob)

struct IdleFloat: ViewModifier {
    var distance: CGFloat = 8
    var duration: Double = 3.2
    @State private var up = false
    func body(content: Content) -> some View {
        content
            .offset(y: up ? -distance : distance / 2)
            .onAppear {
                guard !QAMotion.disabled else { return }
                withAnimation(.easeInOut(duration: duration).repeatForever(autoreverses: true)) {
                    up = true
                }
            }
    }
}

extension View {
    func idleFloat(distance: CGFloat = 8, duration: Double = 3.2) -> some View {
        modifier(IdleFloat(distance: distance, duration: duration))
    }
}

// MARK: - Ambient glow (decorative blurred orb)

struct AmbientGlow: View {
    var color: Color
    var size: CGFloat = 320
    var opacity: Double = 0.5
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .blur(radius: size * 0.42)
            .opacity(opacity)
            .allowsHitTesting(false)
    }
}

// MARK: - Soft clay grain (deterministic, drawn once)

struct SoftGrain: View {
    var opacity: Double = 0.05
    var density: Int = 1400
    var body: some View {
        Canvas { ctx, size in
            var rng: UInt64 = 0x9E3779B97F4A7C15
            func next() -> Double {
                rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17
                return Double(rng % 10000) / 10000.0
            }
            for _ in 0..<density {
                let x = next() * size.width
                let y = next() * size.height
                let s = 0.6 + next() * 0.9
                let a = next() * opacity
                ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: s, height: s)),
                         with: .color(.black.opacity(a)))
            }
        }
        .blendMode(.multiply)
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}

// MARK: - Verdure page background (canvas + sculpted vignette + grain)

struct VerdureBackground: View {
    var glow: Bool = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift: CGFloat = 0
    var body: some View {
        ZStack {
            Palette.canvas
            RadialGradient(colors: [Palette.surfaceLight.opacity(0.6), .clear],
                           center: .topLeading, startRadius: 0, endRadius: 520)
            RadialGradient(colors: [Palette.surfaceShadow.opacity(0.5), .clear],
                           center: .bottomTrailing, startRadius: 0, endRadius: 560)
            if glow {
                // Continuously drifting aurora — always-on ambient motion.
                AmbientGlow(color: Palette.teal.base.opacity(0.22), size: 380, opacity: 0.7)
                    .offset(x: -150 + drift * 70, y: -260 + drift * 50)
                AmbientGlow(color: Palette.spruce.base.opacity(0.18), size: 320, opacity: 0.6)
                    .offset(x: 150 - drift * 60, y: -120 + drift * 40)
                AmbientGlow(color: Palette.gold.base.opacity(0.16), size: 300, opacity: 0.6)
                    .offset(x: 170 - drift * 50, y: 320 - drift * 60)
            }
            SoftGrain()
        }
        .ignoresSafeArea()
        .onAppear {
            guard !reduceMotion, !QAMotion.disabled else { return }
            withAnimation(.easeInOut(duration: 11).repeatForever(autoreverses: true)) { drift = 1 }
        }
    }
}

// MARK: - Appear-on-scroll: weighted rise (Jakub recipe: opacity + translateY + blur)

struct RiseIn: ViewModifier {
    var delay: Double = 0
    var from: CGFloat = 14
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            // No animated blur — it's GPU-expensive and janky. Just opacity + a small rise.
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : from)
            .onAppear {
                if reduceMotion { shown = true; return }
                withAnimation(.spring(response: 0.55, dampingFraction: 0.85).delay(delay)) {
                    shown = true
                }
            }
    }
}

extension View {
    /// Weighted spring entrance with a subtle blur-in. Stagger via `delay`.
    func riseIn(delay: Double = 0, from: CGFloat = 26) -> some View {
        modifier(RiseIn(delay: delay, from: from))
    }

    /// Convenience for index-based staggered choreography (lead → follow).
    func riseIn(index: Int, base: Double = 0.04, from: CGFloat = 26) -> some View {
        modifier(RiseIn(delay: Double(index) * base, from: from))
    }
}

// MARK: - Dramatic reveal (bigger, more visible than riseIn)

struct DramaticRise: ViewModifier {
    var delay: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            // Subtle settle only — no animated blur/rotation/big slide (those read as
            // choppy "auto-scrolling" when every section replays on tab switch).
            .opacity(shown || reduceMotion ? 1 : 0)
            .scaleEffect(shown || reduceMotion ? 1 : 0.96, anchor: .center)
            .offset(y: shown || reduceMotion ? 0 : 16)
            .onAppear {
                if reduceMotion { shown = true; return }
                withAnimation(.spring(response: 0.5, dampingFraction: 0.85).delay(delay)) { shown = true }
            }
    }
}

extension View {
    func dramaticRise(delay: Double = 0) -> some View { modifier(DramaticRise(delay: delay)) }
    func dramaticRise(index: Int, base: Double = 0.07) -> some View {
        modifier(DramaticRise(delay: Double(index) * base))
    }
}

// MARK: - Breathing (continuous subtle pulse — always-on life)

struct Breathing: ViewModifier {
    var scale: CGFloat = 1.04
    var duration: Double = 2.6
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var on = false
    func body(content: Content) -> some View {
        content
            .scaleEffect(on && !reduceMotion ? scale : 1)
            .onAppear {
                guard !reduceMotion, !QAMotion.disabled else { return }
                withAnimation(.easeInOut(duration: duration).repeatForever(autoreverses: true)) { on = true }
            }
    }
}

extension View {
    func breathing(scale: CGFloat = 1.04, duration: Double = 2.6) -> some View {
        modifier(Breathing(scale: scale, duration: duration))
    }
}

// MARK: - Pulsing ring (expanding halo — draws the eye)

struct PulseHalo: View {
    var color: Color
    var size: CGFloat = 80
    var lineWidth: CGFloat = 2
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false
    var body: some View {
        Circle()
            .stroke(color, lineWidth: lineWidth)
            .frame(width: size, height: size)
            .scaleEffect(pulse && !reduceMotion ? 1.9 : 1)
            .opacity(pulse && !reduceMotion ? 0 : 0.8)
            .onAppear {
                guard !reduceMotion, !QAMotion.disabled else { return }
                withAnimation(.easeOut(duration: 1.9).repeatForever(autoreverses: false)) { pulse = true }
            }
            .allowsHitTesting(false)
    }
}

// MARK: - Count-up number (animates value on appear / change)

/// A Text that ticks up to `value` on appear. Pass font/foreground at the call site.
struct CountUp: View {
    var value: Int
    var duration: Double = 1.1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var current: Int = 0
    var body: some View {
        Text(verbatim: "\(current)")
            .onAppear { run() }
            .onChange(of: value) { _, _ in run() }
    }
    private func run() {
        if reduceMotion { current = value; return }
        let steps = 28
        let target = value
        current = 0
        for i in 1...steps {
            let t = duration * Double(i) / Double(steps)
            DispatchQueue.main.asyncAfter(deadline: .now() + t) {
                // ease-out
                let p = Double(i) / Double(steps)
                let eased = 1 - pow(1 - p, 3)
                current = Int((Double(target) * eased).rounded())
            }
        }
    }
}

// MARK: - Marquee (continuously scrolling ticker)

struct Marquee<Content: View>: View {
    var spacing: CGFloat = 28
    var speed: Double = 40 // points per second
    @ViewBuilder var content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var offset: CGFloat = 0
    @State private var contentWidth: CGFloat = 0

    var body: some View {
        GeometryReader { _ in
            HStack(spacing: spacing) {
                content()
                content()
            }
            .fixedSize()
            .background(GeometryReader { g in
                Color.clear.onAppear { contentWidth = g.size.width / 2 }
            })
            .offset(x: offset)
            .onAppear {
                guard !reduceMotion, !QAMotion.disabled, contentWidth > 0 else { return }
                withAnimation(.linear(duration: Double(contentWidth) / speed).repeatForever(autoreverses: false)) {
                    offset = -contentWidth - spacing
                }
            }
            .onChange(of: contentWidth) { _, w in
                guard !reduceMotion, !QAMotion.disabled, w > 0 else { return }
                offset = 0
                withAnimation(.linear(duration: Double(w) / speed).repeatForever(autoreverses: false)) {
                    offset = -w - spacing
                }
            }
        }
        .clipped()
    }
}

// MARK: - Floating decorative clay blob

struct FloatingBlob: View {
    var color: Color
    var size: CGFloat
    var delay: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var f = false
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .blur(radius: size * 0.3)
            .offset(y: f && !reduceMotion ? -size * 0.25 : size * 0.2)
            .onAppear {
                guard !reduceMotion, !QAMotion.disabled else { return }
                withAnimation(.easeInOut(duration: 3.4).repeatForever(autoreverses: true).delay(delay)) { f = true }
            }
            .allowsHitTesting(false)
    }
}
