import SwiftUI

// =====================================================================
//  ClayKit — the Verdure surface primitive layer.
//
//  Cards and tiles have one restrained outer shadow. Only inset controls
//  carry an inner shadow, where depth communicates an actual well.
// =====================================================================

// MARK: - Clay style

enum ClayStyle: Equatable {
    case surface          // neutral cream/evergreen clay
    case inset            // pressed-in well (inputs, tracks)
    case accent(ClayAccentKind)

    enum ClayAccentKind: Equatable { case teal, spruce, gold, evergreen, terracotta, sky }
}

extension ClayStyle.ClayAccentKind {
    var accent: ClayAccent {
        switch self {
        case .teal: return Palette.teal
        case .spruce: return Palette.spruce
        case .gold: return Palette.gold
        case .evergreen: return Palette.evergreen
        case .terracotta: return Palette.terracotta
        case .sky: return Palette.sky
        }
    }
}

private extension ClayStyle {
    var faceStyle: AnyShapeStyle {
        switch self {
        case .surface:
            return AnyShapeStyle(LinearGradient(
                colors: [Palette.surfaceTop, Palette.surface, Palette.surfaceSink],
                startPoint: .topLeading, endPoint: .bottomTrailing))
        case .inset:
            return AnyShapeStyle(LinearGradient(
                colors: [Palette.surfaceSink, Palette.surface],
                startPoint: .topLeading, endPoint: .bottomTrailing))
        case .accent(let k):
            return AnyShapeStyle(k.accent.faceGradient)
        }
    }
    var gloss: Color {
        switch self {
        // Softer inner highlight on neutral clay → gentle bevel, no harsh rim.
        case .surface, .inset: return Palette.surfaceLight.opacity(0.7)
        case .accent(let k): return k.accent.gloss
        }
    }
    var depth: Color {
        switch self {
        // Reduced-opacity dark for the inner shadow so neutral chips/cards get a
        // soft sculpt instead of a harsh near-black ring (esp. in dark mode).
        case .surface, .inset: return Palette.surfaceShadow.opacity(0.45)
        case .accent(let k): return k.accent.depth
        }
    }
    var outerDark: Color {
        switch self {
        case .surface: return Palette.surfaceShadow
        case .inset: return .clear
        case .accent(let k): return k.accent.depth.opacity(0.42)
        }
    }
    var outerLight: Color {
        switch self {
        case .surface: return Palette.surfaceLight
        case .inset: return .clear
        case .accent: return Palette.surfaceLight.opacity(0.55)
        }
    }
    /// Foreground color that reads on this surface.
    var onColor: Color {
        switch self {
        case .surface, .inset: return Palette.ink
        case .accent(let k): return k.accent.onColor
        }
    }
}

// MARK: - Clay background (the sculpted shape)

struct ClayBackground: View {
    var style: ClayStyle
    var radius: CGFloat = Radius.md
    var pressed: Bool = false
    /// Depth multiplier — bigger for hero cards, smaller for chips.
    var elevation: CGFloat = 1

    var body: some View {
        let oo = ClayMetric.outerOffset * elevation
        let ob = ClayMetric.outerBlur * elevation
        let isInset = style == .inset

        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let face: AnyShapeStyle = isInset
            ? AnyShapeStyle(style.faceStyle
                .shadow(.inner(color: style.gloss, radius: ClayMetric.innerBlur,
                               x: -ClayMetric.innerOffset, y: -ClayMetric.innerOffset))
                .shadow(.inner(color: style.depth, radius: ClayMetric.innerBlur,
                               x: ClayMetric.innerOffset, y: ClayMetric.innerOffset)))
            : style.faceStyle
        shape
            .fill(face)
            .clipShape(shape)
            // One quiet outer shadow; it settles when pressed.
            .shadow(color: style.outerDark.opacity(pressed ? 0.4 : 1),
                    radius: pressed ? ob * 0.4 : ob,
                    x: pressed ? oo * 0.3 : oo,
                    y: pressed ? oo * 0.3 : oo)
    }
}

// MARK: - Clay surface modifier (non-interactive)

struct ClaySurfaceModifier: ViewModifier {
    var style: ClayStyle
    var radius: CGFloat
    var elevation: CGFloat
    func body(content: Content) -> some View {
        content.background(ClayBackground(style: style, radius: radius, elevation: elevation))
    }
}

extension View {
    /// Wrap content in a sculpted clay surface.
    func claySurface(_ style: ClayStyle = .surface,
                     radius: CGFloat = Radius.md,
                     elevation: CGFloat = 1) -> some View {
        modifier(ClaySurfaceModifier(style: style, radius: radius, elevation: elevation))
    }
}

// MARK: - Pressable clay (button style)

struct ClayPressButtonStyle: ButtonStyle {
    var style: ClayStyle = .surface
    var radius: CGFloat = Radius.md
    var elevation: CGFloat = 1
    var hapticOnPress: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(ClayBackground(style: style, radius: radius,
                                       pressed: configuration.isPressed, elevation: elevation))
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(.spring(response: 0.34, dampingFraction: 0.62), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, pressed in
                if pressed && hapticOnPress { Haptics.soft() }
            }
    }
}

// MARK: - Clay CTA button

struct ClayButton: View {
    enum Kind { case spruce, teal, gold, ghost }
    var title: String
    var systemImage: String?
    var kind: Kind = .spruce
    var fullWidth: Bool = false
    var action: () -> Void

    init(_ title: String, systemImage: String? = nil, kind: Kind = .spruce,
         fullWidth: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.systemImage = systemImage
        self.kind = kind; self.fullWidth = fullWidth; self.action = action
    }

    private var style: ClayStyle {
        switch kind {
        case .spruce: return .accent(.spruce)
        case .teal: return .accent(.teal)
        case .gold: return .accent(.gold)
        case .ghost: return .surface
        }
    }
    private var fg: Color {
        switch kind {
        case .spruce: return Palette.spruce.onColor
        case .teal: return Palette.teal.onColor
        case .gold: return Palette.gold.onColor
        case .ghost: return Palette.ink
        }
    }

    var body: some View {
        Button(action: { Haptics.tap(); action() }) {
            HStack(spacing: 9) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 16, weight: .bold)) }
                Text(title).font(VType.body(17, .bold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(fg)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.vertical, 16)
            .padding(.horizontal, 26)
        }
        .buttonStyle(ClayPressButtonStyle(style: style, radius: Radius.md))
    }
}

// MARK: - Kicker label (uppercase, tracked Rubik)

struct KickerLabel: View {
    var text: String
    var color: Color = Palette.inkSoft
    var dot: Color? = nil
    var body: some View {
        HStack(spacing: 8) {
            if let dot {
                Circle().fill(dot).frame(width: 7, height: 7)
            }
            Text(text.uppercased())
                .font(VType.body(11, .semibold))
                .tracking(2.2)
                .foregroundStyle(color)
        }
    }
}

// MARK: - Section header (numbered index + kicker + display title)

struct ClaySectionHeader: View {
    var index: String? = nil
    var kicker: String
    var title: String
    var accent: Color = Palette.spruce.base
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                if let index {
                    Text(index).font(VType.num(16, .bold)).foregroundStyle(accent)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(Capsule().fill(accent.opacity(0.16)))
                        .overlay(Capsule().strokeBorder(accent.opacity(0.35), lineWidth: 1))
                }
                KickerLabel(text: kicker)
            }
            Text(title)
                .font(VType.display(30, .semibold))
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Clay chip

struct ClayChip: View {
    var text: String
    var systemImage: String? = nil
    var selected: Bool = false
    var accent: ClayAccent = Palette.spruce
    var body: some View {
        HStack(spacing: 7) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 12, weight: .bold))
            }
            Text(text).font(VType.body(13, .semibold))
        }
        .foregroundStyle(selected ? accent.onColor : Palette.inkSoft)
        .padding(.vertical, 9)
        .padding(.horizontal, 15)
        .background(
            ClayBackground(style: selected ? .accent(accentKind) : .surface,
                           radius: Radius.chip, elevation: 0.55)
        )
    }
    private var accentKind: ClayStyle.ClayAccentKind {
        // map accent back to kind for chip fill
        if accent.base == Palette.teal.base { return .teal }
        if accent.base == Palette.gold.base { return .gold }
        if accent.base == Palette.terracotta.base { return .terracotta }
        if accent.base == Palette.sky.base { return .sky }
        return .spruce
    }
}

// MARK: - Clay icon tile

struct ClayIconTile: View {
    var systemImage: String
    var kind: ClayStyle.ClayAccentKind = .teal
    var size: CGFloat = 52
    var radius: CGFloat = Radius.sm
    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(kind.accent.onColor)
            .frame(width: size, height: size)
            .background(ClayBackground(style: .accent(kind), radius: radius, elevation: 0.7))
    }
}

// MARK: - Clay progress bar (inset track + clay fill)

struct ClayProgressBar: View {
    var value: Double                 // 0...1
    var gradient: [Color] = [Palette.teal.depth, Palette.teal.base, Palette.gold.base]
    var height: CGFloat = 16
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                ClayBackground(style: .inset, radius: height / 2)
                Capsule(style: .continuous)
                    .fill(
                        LinearGradient(colors: gradient, startPoint: .leading, endPoint: .trailing)
                            .shadow(.inner(color: .white.opacity(0.45), radius: 3, x: 0, y: 2))
                    )
                    .padding(2)
                    .frame(width: max(height, geo.size.width * value))
            }
        }
        .frame(height: height)
    }
}

// MARK: - Hairline divider

struct ClayHairline: View {
    var body: some View {
        Rectangle()
            .fill(LinearGradient(colors: [Palette.surfaceShadow, Palette.surfaceLight],
                                 startPoint: .top, endPoint: .bottom))
            .frame(height: 2)
            .opacity(0.7)
    }
}

// MARK: - Haptics

@MainActor
enum Haptics {
    static func tap() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
    }
    static func soft() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.7)
        #endif
    }
    static func success() {
        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }
    static func rigid() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        #endif
    }
}
