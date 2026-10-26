import SwiftUI

// =====================================================================
//  Rarity & points badges — clay tiles. Plus the canonical mapping from
//  rarity / category / reward tier to the Warm-Forest clay accents.
// =====================================================================

// MARK: - Accent mappings

extension PlaceRarity {
    var clayKind: ClayStyle.ClayAccentKind {
        switch self {
        case .common: return .teal
        case .uncommon: return .gold
        case .rare: return .spruce
        case .legendary: return .terracotta
        }
    }
    var accent: ClayAccent { clayKind.accent }
}

extension PlaceCategory {
    /// Interest categories the user picked during onboarding (empty = no preference yet).
    static var userInterests: Set<PlaceCategory> {
        let raw = UserDefaults.standard.string(forKey: "interestCategories") ?? ""
        return Set(raw.split(separator: ",").compactMap { PlaceCategory(rawValue: String($0)) })
    }

    var clayKind: ClayStyle.ClayAccentKind {
        switch self {
        case .parks: return .spruce
        case .trails: return .gold
        case .gardens: return .teal
        case .playgrounds: return .sky
        case .waterfront: return .sky
        case .sports: return .terracotta
        case .scenic: return .spruce
        case .community: return .teal
        }
    }
    var accent: ClayAccent { clayKind.accent }
}

extension EventCategory {
    var clayKind: ClayStyle.ClayAccentKind {
        switch self {
        case .cleanup, .volunteer: return .teal
        case .sports: return .terracotta
        case .social, .meetup: return .gold
        case .workshop, .hackathon, .program: return .spruce
        case .market: return .gold
        case .festival: return .terracotta
        }
    }
    var accent: ClayAccent { clayKind.accent }
}

extension RewardTier {
    var clayKind: ClayStyle.ClayAccentKind {
        switch self {
        case .bronze: return .terracotta
        case .silver: return .sky
        case .gold: return .gold
        case .platinum: return .spruce
        }
    }
    var accent: ClayAccent { clayKind.accent }
}

// MARK: - Rarity Badge (clay chip)

struct RarityBadge: View {
    let rarity: PlaceRarity
    var size: RarityBadgeSize = .regular

    enum RarityBadgeSize {
        case small, regular, large
        var iconSize: CGFloat { self == .small ? 8 : (self == .large ? 13 : 10) }
        var fontSize: CGFloat { self == .small ? 9 : (self == .large ? 13 : 11) }
        var hPadding: CGFloat { self == .small ? 7 : (self == .large ? 12 : 9) }
        var vPadding: CGFloat { self == .small ? 4 : (self == .large ? 7 : 5) }
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: rarity.icon).font(.system(size: size.iconSize, weight: .bold))
            Text(rarity.rawValue.uppercased())
                .font(VType.body(size.fontSize, .bold)).tracking(0.6)
        }
        .foregroundStyle(rarity.accent.onColor)
        .padding(.horizontal, size.hPadding)
        .padding(.vertical, size.vPadding)
        .background(ClayBackground(style: .accent(rarity.clayKind), radius: Radius.chip, elevation: 0.35))
    }
}

// MARK: - Points Badge (gold clay)

struct PointsBadge: View {
    let points: Int
    var prefix: String = "+"
    /// Tint the tag by tier so the colour signals point value at a glance (defaults to gold).
    var kind: ClayStyle.ClayAccentKind = .gold
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "leaf.circle.fill").font(.system(size: 11, weight: .bold))
            Text("\(prefix)\(points) pts").font(VType.num(11, .bold)).monospacedDigit()
        }
        .foregroundStyle(kind.accent.onColor)
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(ClayBackground(style: .accent(kind), radius: Radius.chip, elevation: 0.35))
    }
}

// MARK: - Rarity Dot (inline indicator)

struct RarityDot: View {
    let rarity: PlaceRarity
    var size: CGFloat = 9
    var body: some View {
        Image(systemName: rarity.icon)
            .font(.system(size: size, weight: .bold))
            .foregroundStyle(rarity.accent.base)
            .shadow(color: rarity.accent.depth.opacity(0.4), radius: 1, x: 0.5, y: 0.5)
    }
}
