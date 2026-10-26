import SwiftUI

// =====================================================================
//  Shared components — rebuilt on ClayKit. Public APIs are preserved so
//  every screen inherits the Warm-Forest claymorphism automatically.
// =====================================================================

// MARK: - Verdure Button (clay)

struct VerdureButton: View {
    let title: String
    var icon: String? = nil
    var style: ButtonStyle = .primary
    let action: () -> Void

    enum ButtonStyle { case primary, secondary, ghost }

    private var kind: ClayButton.Kind {
        switch style {
        case .primary: return .spruce
        case .secondary: return .teal
        case .ghost: return .ghost
        }
    }

    var body: some View {
        ClayButton(title, systemImage: icon, kind: kind, fullWidth: true, action: action)
    }
}

// MARK: - Category Pill (clay chip)

struct CategoryPill: View {
    let label: String
    let icon: String
    let tint: Color
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: { Haptics.soft(); action() }) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .bold))
                Text(label).font(VType.body(13, .semibold))
            }
            .foregroundStyle(isSelected ? Palette.spruce.onColor : Palette.inkSoft)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .buttonStyle(ClayPressButtonStyle(
            style: isSelected ? .accent(.spruce) : .surface,
            radius: Radius.chip, elevation: 0.5, hapticOnPress: false))
    }
}

// MARK: - Stat Card (clay tile)

struct StatCard: View {
    let value: String
    let label: String
    let icon: String
    var accent: ClayStyle.ClayAccentKind = .teal

    var body: some View {
        VStack(spacing: 10) {
            ClayIconTile(systemImage: icon, kind: accent, size: 42, radius: Radius.chip)
            Text(value)
                .font(VType.num(24, .bold)).monospacedDigit()
                .foregroundStyle(Palette.ink)
            Text(label)
                .font(VType.body(11, .medium))
                .foregroundStyle(Palette.inkSoft)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.lg)
        .padding(.horizontal, Spacing.sm)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
    }
}

// MARK: - Section Header

struct SectionHeader: View {
    let title: String
    var action: String? = nil
    var onAction: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title)
                .font(VType.display(22, .semibold))
                .foregroundStyle(Palette.ink)
            Spacer()
            if let action {
                Button(action: { onAction?() }) {
                    Text(action).font(VType.body(14, .semibold))
                        .foregroundStyle(Palette.spruce.base)
                        .frame(minWidth: 44, minHeight: 44)   // a11y hit target
                        .contentShape(Rectangle())
                }
            }
        }
    }
}

// MARK: - XP Badge (clay gold)

struct XPBadge: View {
    let xp: Int
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "bolt.fill").font(.system(size: 10, weight: .bold))
            Text("+\(xp) XP").font(VType.num(11, .bold))
        }
        .foregroundStyle(Palette.gold.onColor)
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(ClayBackground(style: .accent(.gold), radius: Radius.chip, elevation: 0.4))
    }
}

// MARK: - Place Image Placeholder (sculpted clay)

struct PlacePlaceholder: View {
    let icon: String
    let color: Color
    var height: CGFloat = 140

    private var iconSize: CGFloat { min(height * 0.30, 46) }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .fill(
                    LinearGradient(colors: [Palette.surfaceTop, Palette.surface, Palette.surfaceSink],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
            // soft accent wash
            RadialGradient(colors: [color.opacity(0.28), .clear],
                           center: .topLeading, startRadius: 0, endRadius: height)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))

            Image(systemName: icon)
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(
                    LinearGradient(colors: [color, color.opacity(0.7)],
                                   startPoint: .top, endPoint: .bottom)
                )
                .shadow(color: color.opacity(0.4), radius: 8, x: 2, y: 4)
        }
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .strokeBorder(Palette.surfaceLight.opacity(0.6), lineWidth: 1)
        )
    }
}

// MARK: - Avatar Circle (clay)

/// Avatar that shows the user's chosen profile photo if set, else falls back to initials.
struct UserAvatar: View {
    @AppStorage("profileImageData") private var profileImageData = Data()
    var initials: String = "ME"
    var size: CGFloat = 44
    var accent: ClayAccent = Palette.spruce

    var body: some View {
        if !profileImageData.isEmpty, let ui = UIImage(data: profileImageData) {
            Image(uiImage: ui).resizable().scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(accent.base.opacity(0.6), lineWidth: 2))
        } else {
            AvatarCircle(initials: initials, size: size, accent: accent)
        }
    }
}

extension UIImage {
    /// Downscale so the longest side is at most `maxDimension` (keeps UserDefaults small).
    func downscaled(maxDimension: CGFloat = 400) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxDimension else { return self }
        let scale = maxDimension / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: newSize)) }
    }
}

struct AvatarCircle: View {
    let initials: String
    var size: CGFloat = 40
    var accent: ClayAccent = Palette.spruce

    var body: some View {
        Text(initials)
            .font(VType.display(size * 0.36, .semibold))
            .foregroundStyle(accent.onColor)
            .frame(width: size, height: size)
            .background(ClayBackground(style: accentStyle, radius: size / 2, elevation: 0.5))
    }
    private var accentStyle: ClayStyle {
        if accent.base == Palette.teal.base { return .accent(.teal) }
        if accent.base == Palette.gold.base { return .accent(.gold) }
        return .accent(.spruce)
    }
}

// MARK: - Empty State

struct EmptyStateView: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: icon, kind: .teal, size: 72, radius: Radius.md)
                .idleFloat(distance: 5, duration: 3.4)
            VStack(spacing: 6) {
                Text(title).font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
                Text(subtitle).font(VType.body(14))
                    .foregroundStyle(Palette.inkSoft)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(Spacing.xxl)
    }
}

// MARK: - Progress Ring (clay)

struct ProgressRing: View {
    let progress: Double
    var size: CGFloat = 44
    var lineWidth: CGFloat = 5
    var body: some View {
        NeonProgressRing(progress: progress, size: size, lineWidth: lineWidth)
    }
}

/// Kept name for call-site compatibility; now a clay ring (inset track + accent fill).
struct NeonProgressRing: View {
    let progress: Double
    var size: CGFloat = 44
    var lineWidth: CGFloat = 5
    var color: Color = Palette.teal.base
    var showLabel: Bool = true

    var body: some View {
        ZStack {
            Circle()
                .stroke(Palette.surfaceSink, lineWidth: lineWidth)
                .overlay(
                    Circle().stroke(Palette.surfaceShadow.opacity(0.6), lineWidth: 1)
                        .blur(radius: 1)
                )
            Circle()
                .trim(from: 0, to: max(0.001, progress))
                .stroke(
                    // Honor the passed color (no fixed teal/gold) — single-hue sweep.
                    AngularGradient(colors: [color.opacity(0.45), color, color.opacity(0.85), color],
                                    center: .center),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: color.opacity(0.4), radius: 3, x: 0, y: 1)
                .animation(.spring(response: 0.7, dampingFraction: 0.8), value: progress)
            if showLabel {
                Text("\(Int(progress * 100))%")
                    .font(VType.num(size * 0.24, .bold)).monospacedDigit()
                    .foregroundStyle(Palette.ink)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Accent card modifier (clay surface + accent left bar)

extension View {
    func greenAccentCard(_ accent: Color = Palette.spruce.base) -> some View {
        self
            .padding(Spacing.lg)
            .claySurface(.surface, radius: Radius.md)
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(accent)
                    .frame(width: 4)
                    .padding(.vertical, Spacing.md)
                    .padding(.leading, 6)
            }
    }

    /// Clay outer elevation (dual top-left/bottom-right drop).
    func cardElevation() -> some View {
        self
            .shadow(color: Palette.surfaceShadow.opacity(0.9), radius: 18, x: 10, y: 12)
            .shadow(color: Palette.surfaceLight.opacity(0.9), radius: 14, x: -8, y: -8)
    }
}

// MARK: - Card 3D press style (clay sink + tilt)

struct Card3DButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.972 : 1.0)
            .rotation3DEffect(
                .degrees(configuration.isPressed ? -3.5 : 0),
                axis: (x: 0.4, y: 1.0, z: 0.0),
                perspective: 0.4
            )
            .brightness(configuration.isPressed ? -0.015 : 0)
            .animation(.spring(response: 0.32, dampingFraction: 0.62), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, p in if p { Haptics.soft() } }
    }
}

// MARK: - Data credits

/// The attribution the Open Database License requires wherever a place sourced
/// from OpenStreetMap (id prefixed `osm-`, see `PlacesAPIService`) is on screen.
struct OpenStreetMapCredit: View {
    var color: Color = Palette.inkSoft
    /// When the OpenStreetMap data on screen was fetched (live, cached or the bundled snapshot).
    var asOf: Date? = nil

    var body: some View {
        HStack(spacing: 4) {
            Link("© OpenStreetMap contributors", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
            if let asOf {
                Text("· ODbL · data as of \(asOf.formatted(date: .abbreviated, time: .omitted))")
                    .accessibilityIdentifier("osmDataDate")
            }
        }
        .font(VType.body(11))
        .foregroundStyle(color)
    }
}
