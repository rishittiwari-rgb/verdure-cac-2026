import SwiftUI

struct OnboardingView: View {
    @Environment(DiscoveryFilters.self) private var filters
    @Binding var hasCompletedOnboarding: Bool
    @Environment(AuthService.self) private var authService
    @State private var currentPage = 0
    @State private var selectedInterests: Set<PlaceCategory> = []
    @State private var radiusMiles: Double = 15
    @State private var animateIn = false

    private let pages = [
        OnboardingPage(
            icon: "safari.fill",
            kicker: "Beta · 2026",
            title: "Step Outside.\nConnect Within.",
            subtitle: "Verdure turns your neighborhood into an adventure — discover hidden spots, earn rewards, and connect with your community.",
            kind: .teal
        ),
        OnboardingPage(
            icon: "leaf.fill",
            kicker: "Play the outdoors",
            title: "Earn Rewards\nFor Exploring",
            subtitle: "Complete challenges, collect places, and grow your points into real-world gift cards.",
            kind: .gold
        ),
        OnboardingPage(
            icon: "person.3.fill",
            kicker: "Real, local, human",
            title: "Build Real\nConnections",
            subtitle: "Join nearby events, share discoveries, and grow your local community — face to face.",
            kind: .spruce
        ),
    ]

    var body: some View {
        if currentPage == totalPages - 1 {
            AuthView(initialInterests: selectedInterests.map(\.rawValue), onSignupRejected: {
                selectedInterests.removeAll(); radiusMiles = 15
            }, onComplete: {
                UserDefaults.standard.set(selectedInterests.map(\.rawValue).joined(separator: ","), forKey: "interestCategories")
                filters.state.radiusMiles = radiusMiles
                withAnimation(.spring(response: 0.5)) { hasCompletedOnboarding = true }
            })
            .transition(.move(edge: .trailing).combined(with: .opacity))
        } else {
            onboardingFlow
        }
    }

    private var onboardingFlow: some View {
        ZStack {
            VerdureBackground()

            VStack(spacing: 0) {
                // Back / Skip
                HStack {
                    if currentPage > 0 {
                        Button {
                            Haptics.soft()
                            withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { currentPage -= 1 }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold))
                                Text("Back").font(VType.body(15, .medium))
                            }
                            .foregroundStyle(Palette.inkSoft)
                            .frame(minWidth: 44, minHeight: 44)   // a11y hit target
                            .contentShape(Rectangle())
                        }
                        .padding(.leading, Spacing.lg).padding(.top, Spacing.md)
                    }
                    Spacer()
                    if currentPage < pages.count {
                        Button {
                            withAnimation(.spring(response: 0.5)) { currentPage = pages.count }
                        } label: {
                            Text("Skip")
                                .font(VType.body(15, .medium))
                                .foregroundStyle(Palette.inkSoft)
                                .frame(minWidth: 44, minHeight: 44)   // a11y hit target
                                .contentShape(Rectangle())
                        }
                        .padding(.trailing, Spacing.lg).padding(.top, Spacing.md)
                    }
                }

                Spacer()

                Group {
                    if currentPage < pages.count {
                        welcomePage(pages[currentPage], index: currentPage)
                    } else if currentPage == pages.count {
                        // Eight tiles + radius picker are taller than a 6.3" screen; unscrolled, the
                        // stack overflowed and squeezed the title to one line and Back into the status bar.
                        ScrollView(.vertical, showsIndicators: false) { interestsPage }
                    }
                }
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))

                Spacer()

                VStack(spacing: Spacing.md) {
                    HStack(spacing: 7) {
                        ForEach(0..<totalPages, id: \.self) { i in
                            Capsule()
                                .fill(i == currentPage ? Palette.spruce.base : Palette.surfaceShadow)
                                .frame(width: i == currentPage ? 26 : 8, height: 8)
                                .animation(.spring(response: 0.4), value: currentPage)
                        }
                    }
                    .accessibilityHidden(true)   // the 8 pt capsules themselves stay out of the tree
                    // One 44 pt element over the row (an overlay, so layout is untouched). Its
                    // identifier carries which dots are lit, from the same comparison as the fill.
                    .overlay {
                        Color.clear.frame(width: 120, height: 44)
                            .accessibilityElement()
                            .accessibilityLabel("Page \(currentPage + 1) of \(totalPages)")
                            .accessibilityIdentifier("onboardingDots-" + (0..<totalPages).filter { $0 == currentPage }.map(String.init).joined(separator: ","))
                    }
                    .padding(.bottom, Spacing.sm)

                    ClayButton(buttonTitle,
                               systemImage: currentPage == totalPages - 1 ? "arrow.right" : nil,
                               kind: .spruce, fullWidth: true) { advance() }
                        .padding(.horizontal, Spacing.lg)
                        .accessibilityHint("Step \(currentPage + 1) of \(totalPages)")
                }
                .padding(.bottom, Spacing.xl)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.6)) { animateIn = true }
        }
    }

    // MARK: - Welcome pages

    @ViewBuilder
    private func welcomePage(_ page: OnboardingPage, index: Int) -> some View {
        VStack(spacing: Spacing.xl) {
            ZStack {
                AmbientGlow(color: page.kind.accent.base.opacity(0.35), size: 320, opacity: 0.7)
                if index == 0 {
                    MedallionHero(size: 248)
                        .scaleEffect(animateIn ? 1 : 0.7)
                        .opacity(animateIn ? 1 : 0)
                } else {
                    ClayIconTile(systemImage: page.icon, kind: page.kind, size: 132, radius: Radius.lg)
                        .scaleEffect(animateIn ? 1 : 0.6)
                        .idleFloat(distance: 7, duration: 3.4)
                }
            }
            .frame(height: 270)
            .animation(.spring(response: 0.8, dampingFraction: 0.6), value: animateIn)
            .accessibilityHidden(true)   // decorative hero — the title below carries the meaning

            VStack(spacing: Spacing.md) {
                KickerLabel(text: page.kicker, color: page.kind.accent.base, dot: Palette.gold.base)
                Text(page.title)
                    .font(VType.display(38, .semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.ink)
                    .lineSpacing(2)
                    .accessibilityAddTraits(.isHeader)
                Text(page.subtitle)
                    .font(VType.body(16))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.inkSoft)
                    .padding(.horizontal, Spacing.xl)
                    .lineSpacing(3)
            }
        }
        .padding(.horizontal, Spacing.lg)
    }

    // MARK: - Interests

    private var interestsPage: some View {
        VStack(spacing: Spacing.lg) {
            VStack(spacing: Spacing.sm) {
                Text("What draws you\noutdoors?")
                    .font(VType.display(30, .semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.ink)
                Text("Pick a few — we'll personalize your map.")
                    .font(VType.body(15))
                    .foregroundStyle(Palette.inkSoft)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(PlaceCategory.allCases) { category in
                    InterestTile(
                        category: category,
                        isSelected: selectedInterests.contains(category)
                    ) {
                        if selectedInterests.contains(category) { selectedInterests.remove(category) }
                        else { selectedInterests.insert(category) }
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)

            radiusPicker
        }
    }

    /// "How far will you go?" — the same persisted radius every browse surface filters by.
    private var radiusPicker: some View {
        VStack(spacing: 10) {
            Text("How far will you go?")
                .font(VType.body(14, .semibold)).foregroundStyle(Palette.ink)
            HStack(spacing: 8) {
                ForEach(DiscoveryFilterState.radiusChoices, id: \.self) { miles in
                    Button {
                        Haptics.soft()
                        withAnimation(.spring(response: 0.3)) { radiusMiles = miles }
                    } label: {
                        ClayChip(text: "\(Int(miles)) mi", selected: radiusMiles == miles, accent: Palette.spruce)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(Int(miles)) miles")
                    .accessibilityAddTraits(radiusMiles == miles ? [.isSelected] : [])
                }
            }
            Text("You can change this any time from the filter button.")
                .font(VType.body(11)).foregroundStyle(Palette.inkFaint)
        }
        .padding(.horizontal, Spacing.lg)
        .accessibilityElement(children: .contain)
    }

    // MARK: - Helpers

    private var totalPages: Int { pages.count + 2 }

    private var buttonTitle: String {
        if currentPage < pages.count { return "Continue" }
        if currentPage == pages.count {
            return selectedInterests.isEmpty ? "Continue" : "Continue · \(selectedInterests.count) picked"
        }
        return "Continue"
    }

    private func advance() {
        // The pager stays tappable while it animates out to sign-in, so a second Continue
        // tap can arrive after the last step; never move past it (index > last = blank pager).
        guard currentPage < totalPages - 1 else { return }
        authService.clearError()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { currentPage += 1 }
    }

}

// MARK: - Supporting types

private struct OnboardingPage {
    let icon: String
    let kicker: String
    let title: String
    let subtitle: String
    let kind: ClayStyle.ClayAccentKind
}

/// Clay inset text field.
struct ClayField: View {
    let placeholder: String
    @Binding var text: String
    var secure: Bool = false
    var contentType: UITextContentType? = nil
    var keyboard: UIKeyboardType = .default
    var autocap: Bool = true

    var body: some View {
        Group {
            if secure { SecureField(placeholder, text: $text) }
            else { TextField(placeholder, text: $text) }
        }
        .font(VType.body(17))
        .foregroundStyle(Palette.ink)
        .padding(.vertical, 16).padding(.horizontal, 18)
        .background(ClayBackground(style: .inset, radius: Radius.sm))
        .textContentType(contentType)
        .keyboardType(keyboard)
        .textInputAutocapitalization(autocap ? .sentences : .never)
        .autocorrectionDisabled(!autocap)
    }
}

private struct InterestTile: View {
    let category: PlaceCategory
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                ClayIconTile(systemImage: category.icon, kind: category.clayKind,
                             size: 50, radius: Radius.chip)
                Text(category.rawValue)
                    .font(VType.body(14, .semibold))
                    .foregroundStyle(isSelected ? category.accent.onColor : Palette.ink)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
        }
        .buttonStyle(ClayPressButtonStyle(
            style: isSelected ? .accent(category.clayKind) : .surface,
            radius: Radius.md, elevation: 0.7))
        .sensoryFeedback(.selection, trigger: isSelected)
        .accessibilityLabel("\(category.rawValue) interest")
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityHint(isSelected ? "Double tap to remove from your interests." : "Double tap to add to your interests.")
    }
}

#Preview {
    OnboardingView(hasCompletedOnboarding: .constant(false))
        .environment(AuthService())
        .environment(DiscoveryFilters())
}
