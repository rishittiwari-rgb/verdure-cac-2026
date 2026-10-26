import SwiftUI

// =====================================================================
//  Verdure — Warm Forest Design System
//
//  One light source, TOP-LEFT, everywhere. Highlights live top-left,
//  depth lives bottom-right. Sage-cream is the dominant surface in light
//  mode; deep evergreen grounds dark mode. Body text
//  is evergreen ink — never a bright accent.
//
//  Light palette : E6E8D4 sage cream · 16BFA5 teal · 14532D spruce ·
//                  B8860B gold · 0E1B16 evergreen ink
//  Dark palette  : 0A140F canvas · evergreen clay surfaces · same accents
// =====================================================================

// MARK: - Hex helpers

extension UIColor {
    convenience init(hex: UInt, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }

    /// Light/dark adaptive color from two hex values.
    static func adaptive(_ light: UInt, _ dark: UInt) -> Color {
        Color(uiColor: UIColor { tc in
            tc.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

// MARK: - Clay accent triple (base / top-left gloss / bottom-right depth)

struct ClayAccent {
    let base: Color
    let gloss: Color   // inner top-left highlight
    let depth: Color   // inner bottom-right depth
    let onColor: Color // legible text/icon color on this accent

    /// A top-left → bottom-right sculpted gradient for the accent face.
    var faceGradient: LinearGradient {
        LinearGradient(
            colors: [gloss, base, depth],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Verdure palette

enum Palette {
    // ---- Surfaces (adaptive) ----
    //  Dark mode is a deep-evergreen clay world: a near-black canvas with
    //  CLEARLY-lifted card surfaces (real luminance gap), near-black outer
    //  drops + a visible light rim so the clay sculpting reads. No muddy mids.
    /// Page background canvas — the dominant surface.
    //  Dark v2 "Warm Graphite Forest": near-neutral graphite surfaces (only a
    //  whisper of green) so the teal/gold/spruce accents pop instead of
    //  blending into a green-on-green soup. (v1 backup: DARK_MODE_BACKUP.md)
    static let canvas        = Color.adaptive(0xECEEDD, 0x0F1110)
    /// Neutral clay face — mid tone of the sculpted gradient.
    static let surface       = Color.adaptive(0xEDEFDE, 0x1E211F)
    /// Clay face top-left highlight (lightest point of the gradient).
    static let surfaceTop     = Color.adaptive(0xF7F9EF, 0x2D322E)
    /// Clay face bottom-right sink / inset well base.
    static let surfaceSink    = Color.adaptive(0xE2E6CD, 0x161917)
    /// Outer drop shadow — dark side (bottom-right).
    static let surfaceShadow  = Color.adaptive(0xCCD1B4, 0x050605)
    /// Outer drop shadow — light side (top-left).
    static let surfaceLight   = Color.adaptive(0xFBFCF1, 0x363C37)

    // ---- Text (cream, high-contrast on dark) ----
    static let ink      = Color.adaptive(0x0E1B16, 0xF3F5EF)
    static let inkSoft  = Color.adaptive(0x46574C, 0xACB4AC)
    static let inkFaint = Color.adaptive(0x8A9484, 0x737B74)
    static let hairline = Color.adaptive(0xCCD1B4, 0x31362F)

    // ---- Accents (vivid in dark so they pop on the evergreen canvas) ----
    static let teal = ClayAccent(
        base:  .adaptive(0x16BFA5, 0x2AE6CB),
        gloss: .adaptive(0x62E6D3, 0x95FCEE),
        depth: .adaptive(0x0B8A77, 0x12A28C),
        onColor: Color(hex: 0x06231D)
    )
    static let spruce = ClayAccent(
        base:  .adaptive(0x14532D, 0x40B46D),
        gloss: .adaptive(0x2E7A4C, 0x5BCD86),
        depth: .adaptive(0x0A3A1E, 0x1B6038),
        onColor: Color(hex: 0xFBF7EC)
    )
    static let gold = ClayAccent(
        base:  .adaptive(0xB8860B, 0xF2C24E),
        gloss: .adaptive(0xE6BB44, 0xFCDF82),
        depth: .adaptive(0x835F08, 0xAD8418),
        onColor: Color(hex: 0x2A1F03)
    )
    //  "Premium hero tile" (player card, vault, events banner). Light mode is a
    //  rich deep-forest green (NOT near-black) so it reads as branded, not a
    //  black box; dark mode is a lifted dark evergreen.
    static let evergreen = ClayAccent(
        base:  .adaptive(0x1A4D33, 0x21443A),
        gloss: .adaptive(0x2E6A49, 0x356355),
        depth: .adaptive(0x0C341F, 0x0A1813),
        onColor: Color(hex: 0xF4F6EE)
    )

    /// Warm clay-friendly destructive (terracotta-red, not neon).
    static let danger = Color.adaptive(0xC0392B, 0xE05C4D)

    // ---- Category / rarity accent family (warm-forest harmonized) ----
    static let terracotta = ClayAccent(
        base:  .adaptive(0xC96E4A, 0xDA7E59),
        gloss: .adaptive(0xE89C7E, 0xF0A98C),
        depth: .adaptive(0x9A4E30, 0xA85636),
        onColor: Color(hex: 0x2E160C)
    )
    static let sky = ClayAccent(
        base:  .adaptive(0x4A93B8, 0x5BA6CB),
        gloss: .adaptive(0x86C4E0, 0x9AD2EC),
        depth: .adaptive(0x336E8E, 0x39788F),
        onColor: Color(hex: 0x0B2530)
    )

}

// MARK: - Clay shadow metrics (top-left light source)

enum ClayMetric {
    /// Outer float offset / blur for the standard clay surface.
    static let outerOffset: CGFloat = 3
    static let outerBlur: CGFloat = 10
    /// Used only for inset controls.
    static let innerOffset: CGFloat = 2
    static let innerBlur: CGFloat = 4
}

// MARK: - Typography — system serif (display) + Rubik (body)

enum DisplayWeight {
    case regular, medium, semibold, bold

    var uiWeight: UIFont.Weight {
        switch self {
        case .regular: return .regular
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        }
    }
}

enum RubikWeight: String {
    case light    = "Rubik-Light"
    case regular  = "Rubik-Regular"
    case medium   = "Rubik-Medium"
    case semibold = "Rubik-SemiBold"
    case bold     = "Rubik-Bold"
}

/// Verdure type ramp. Display uses the native editorial serif for headers.
/// Everything else = Rubik (legible at small sizes).
///
/// DYNAMIC TYPE: every variant scales with the user's text-size setting
/// (`relativeTo:`), so the whole app honors accessibility sizes without
/// per-call-site adoption. Display tracks .title2 (headers), body/num track
/// .body. Existing lineLimit/minimumScaleFactor guards keep tight layouts
/// usable at the largest sizes.
enum VType {
    private static func serif(_ size: CGFloat, _ w: DisplayWeight, relativeTo style: UIFont.TextStyle) -> Font {
        let base = UIFont.systemFont(ofSize: size, weight: w.uiWeight)
        let descriptor = base.fontDescriptor.withDesign(.serif) ?? base.fontDescriptor
        let face = UIFont(descriptor: descriptor, size: size)
        return Font(UIFontMetrics(forTextStyle: style).scaledFont(for: face))
    }

    // Display — New York via the iOS system serif; metrics honor Dynamic Type.
    static func display(_ size: CGFloat = 40, _ w: DisplayWeight = .semibold) -> Font {
        serif(size, w, relativeTo: .title2)
    }
    // Body / UI — Rubik.
    static func body(_ size: CGFloat = 16, _ w: RubikWeight = .regular) -> Font {
        .custom(w.rawValue, size: size, relativeTo: .body)
    }
    /// Tabular-number Rubik for stats/counters (pair with .monospacedDigit()).
    static func num(_ size: CGFloat = 16, _ w: RubikWeight = .bold) -> Font {
        .custom(w.rawValue, size: size, relativeTo: .body)
    }

    // Explicit-relative variants (same faces; pick the text style yourself).
    static func scaledDisplay(_ size: CGFloat, _ w: DisplayWeight = .semibold,
                              relativeTo style: Font.TextStyle = .title3) -> Font {
        let uiStyle: UIFont.TextStyle
        switch style {
        case .headline: uiStyle = .headline
        case .subheadline: uiStyle = .subheadline
        case .title2: uiStyle = .title2
        default: uiStyle = .title3
        }
        return serif(size, w, relativeTo: uiStyle)
    }
    static func scaledBody(_ size: CGFloat = 16, _ w: RubikWeight = .regular,
                           relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(w.rawValue, size: size, relativeTo: style)
    }
    static func scaledNum(_ size: CGFloat = 16, _ w: RubikWeight = .bold,
                          relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(w.rawValue, size: size, relativeTo: style)
    }
}

/// Back-compat façade for the old `CFont` call sites — rerouted to Verdure
/// fonts so legacy views adopt the current type ramp.
struct CFont {
    static func display(_ size: CGFloat = 34) -> Font { VType.display(size, .bold) }
    static func title(_ size: CGFloat = 24) -> Font { VType.display(size, .semibold) }
    static func headline(_ size: CGFloat = 17) -> Font { VType.body(size, .semibold) }
    static func body(_ size: CGFloat = 16) -> Font { VType.body(size, .regular) }
    static func caption(_ size: CGFloat = 13) -> Font { VType.body(size, .medium) }
    static func label(_ size: CGFloat = 11) -> Font { VType.body(size, .semibold) }
    static func mono(_ size: CGFloat = 16) -> Font { VType.num(size, .bold) }
}

// MARK: - Spacing

enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 48
}

// MARK: - Corner radius

enum Radius {
    static let chip: CGFloat = 10
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    static let lg: CGFloat = 20
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 28
    static let pill: CGFloat = 999
}

// MARK: - Back-compat color aliases (legacy views compile + adopt new palette)

extension Color {
    static let verdureGreen       = Palette.teal.base
    static let verdureGreenBright  = Palette.teal.gloss
    static let verdureGreenDeep    = Palette.spruce.base
    static let verdureDestructive  = Palette.danger
    static let verdureBorder       = Palette.hairline

    static let surfaceBackground = Palette.canvas
    static let surfaceCard       = Palette.surface
    static let surfaceElevated   = Palette.surfaceTop

    static let textPrimary   = Palette.ink
    static let textSecondary = Palette.inkSoft
    static let textTertiary  = Palette.inkFaint

    static let accentCoral    = Palette.terracotta.base
    static let accentAmber    = Palette.gold.base
    static let accentSky      = Palette.sky.base
    static let accentLavender = Palette.spruce.base
    static let accentMint     = Palette.teal.base
}

extension ShapeStyle where Self == Color {
    static var cardSurface: Color { Palette.surface }
    static var pageSurface: Color { Palette.canvas }
    static var elevatedSurface: Color { Palette.surfaceTop }
    static var primaryText: Color { Palette.ink }
    static var secondaryText: Color { Palette.inkSoft }
    static var tertiaryText: Color { Palette.inkFaint }
    static var subtleBorder: Color { Palette.hairline }
    static var greenSurface: Color { Color.adaptive(0xD9E8D8, 0x102A1C) }
    static var greenCard: Color { Color.adaptive(0xEAF1DD, 0x12231A) }
}
