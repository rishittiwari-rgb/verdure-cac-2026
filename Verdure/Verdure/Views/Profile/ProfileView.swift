import SwiftUI
import PhotosUI
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseAuth

struct ProfileView: View {
    /// Muted brick red for the destructive Sign Out action — reads on both cream + graphite.
    static let signOutRed = Color(red: 0.82, green: 0.28, blue: 0.25)
    @AppStorage("prefersDarkMode") private var prefersDarkMode = false
    @State private var analyticsEnabled = Analytics.isEnabled
    @State private var crashReportsEnabled = CrashReporting.isEnabled
    @State private var showStats = false
    @AppStorage("profileImageData") private var profileImageData = Data()
    @State private var photoItem: PhotosPickerItem?
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = true
    @AppStorage("accountType") private var accountTypeRaw = AccountType.visitor.rawValue
    @Environment(GameStateManager.self) private var gameState
    @Environment(EconomyService.self) private var economy
    @Environment(AuthService.self) private var authService
    @Environment(StoreService.self) private var store
    @Environment(ModerationService.self) private var moderation
    @Environment(SocialService.self) private var social
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showRewardsStore = false
    @State private var showCollection = false
    @State private var showDeleteConfirm = false
    @State private var isDeletingAccount = false
    @State private var deleteAccountError: String?
    @State private var showPaywall = false
    @State private var showSignOutConfirm = false
    @State private var showSignIn = false
    @State private var showOrganizerVerify = false
    @State private var showAllBadges = false
    @State private var showAllChallenges = false
    @State private var showAbout = false
    @State private var showNotifSettings = false
    @State private var showOfflinePacks = false
    @State private var showSafety = false
    @State private var showLegal = false
    @State private var showHousehold = false
    @State private var householdChildAges: [Int] = []
    @State private var householdTransportMode = "unspecified"
    @State private var householdRadiusMiles = 0
    @State private var householdAccessibilityNeeds: Set<String> = []
    @State private var householdError: String?
    @State private var selectedBadge: Badge?
    @State private var selectedChallenge: Challenge?
    @State private var heroAppeared = false

    private var displayName: String { authService.currentUser?.displayName ?? "Explorer" }
    private var initials: String { authService.currentUser?.initials ?? "ME" }
    private var joinDate: String { authService.currentUser?.joinDateFormatted ?? "March 2026" }
    private var totalXP: Int { gameState.totalXP }
    private var level: Int { gameState.level }
    private var levelProgress: Double { gameState.levelProgress }
    private var badges: [Badge] { GamificationEngine.badges(for: gameState) }
    private var challenges: [Challenge] { GamificationEngine.challenges(for: gameState) }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: Spacing.xl) {
                    playerCard.dramaticRise(index: 0)
                    collectionEntry.dramaticRise(index: 1)
                    statsOrbit.dramaticRise(index: 1)
                    badgesConstellation.dramaticRise(index: 2)
                    challengesRail.dramaticRise(index: 3)
                    settingsSection.dramaticRise(index: 4)
                }
                .padding(.horizontal, Spacing.md)
                .padding(.top, Spacing.md)
                .padding(.bottom, 110)
            }
            .background(VerdureBackground())
            .sheet(isPresented: $showRewardsStore) {
                RewardsStoreView().environment(gameState).environment(economy)
            }
            .sheet(isPresented: $showCollection) { CollectionView() }
            .sheet(isPresented: $showAllBadges) {
                AllBadgesView(badges: badges)
            }
            .sheet(isPresented: $showAllChallenges) {
                AllChallengesView(challenges: challenges)
            }
            .sheet(isPresented: $showAbout) { AboutVerdureView() }
            .sheet(isPresented: $showOfflinePacks) { NavigationStack { OfflinePacksView() } }
            .sheet(isPresented: $showSignIn) {
                AuthView(onSignupRejected: { showSignIn = false }, onComplete: { showSignIn = false })
            }
            .sheet(isPresented: $showOrganizerVerify) { OrganizerVerificationView() }
            .sheet(isPresented: $showSafety) { SafetyView() }
            .sheet(isPresented: $showLegal) { LegalView() }
            .sheet(isPresented: $showNotifSettings) { NotificationSettingsView() }
            .sheet(isPresented: $showHousehold) { householdSheet }
            .sheet(isPresented: $showStats) { StatsAndLeaderboardView().environment(gameState).environment(store) }
            .sheet(item: $selectedBadge) { BadgeDetailSheet(badge: $0) }
            .sheet(item: $selectedChallenge) { ChallengeDetailSheet(challenge: $0) }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let ui = UIImage(data: data),
                       let jpeg = ui.downscaled().jpegData(compressionQuality: 0.85) {
                        await MainActor.run {
                            Haptics.success()
                            profileImageData = jpeg
                        }
                    }
                }
            }
            .onAppear {
                withAnimation(.spring(response: 0.7, dampingFraction: 0.72).delay(0.15)) { heroAppeared = true }
            }
        }
    }

    // MARK: - Profile summary

    private var collectionEntry: some View {
        Button { Haptics.soft(); showCollection = true } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "leaf.fill")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Palette.spruce.base)
                    .frame(width: 48, height: 48)
                    .background(Palette.spruce.base.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.sm))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Your collection")
                        .font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
                    Text("\(gameState.totalCollected) places collected")
                        .font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.inkSoft)
            }
            .padding(Spacing.md)
            .claySurface(.surface, radius: Radius.md, elevation: 0.8)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Your collection, \(gameState.totalCollected) places collected")
    }

    private var playerCard: some View {
        let avatarInitials = initials
        return VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(spacing: Spacing.md) {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    ZStack(alignment: .bottomTrailing) {
                        UserAvatar(initials: avatarInitials, size: 64, accent: Palette.spruce)
                        Image(systemName: "camera.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Palette.spruce.onColor)
                            .padding(5).background(Circle().fill(Palette.spruce.base))
                            .offset(x: 3, y: 3)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Change profile photo")
                VStack(alignment: .leading, spacing: 3) {
                    Text("YOUR PROFILE")
                        .font(VType.body(10, .bold)).tracking(1.8)
                        .foregroundStyle(Palette.spruce.base)
                    Text(displayName)
                        .font(VType.display(28, .bold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Text("Member since \(joinDate)")
                        .font(VType.body(12, .medium))
                        .foregroundStyle(Palette.inkSoft)
                }
                Spacer(minLength: 0)
                if store.isPlus {
                    Label("PLUS", systemImage: "leaf.fill")
                        .font(VType.body(10, .bold))
                        .foregroundStyle(Palette.spruce.base)
                        .accessibilityLabel("Verdure Plus member")
                }
            }

            Rectangle().fill(Palette.spruce.base.opacity(0.16)).frame(height: 1)

            HStack(alignment: .firstTextBaseline) {
                Label("Level \(level)", systemImage: "leaf")
                    .font(VType.body(16, .semibold))
                    .foregroundStyle(Palette.ink)
                Spacer()
                Text("\(gameState.pointsBalance) points")
                    .font(VType.num(15, .semibold))
                    .foregroundStyle(Palette.spruce.base)
            }
            VStack(spacing: 6) {
                ClayProgressBar(value: heroAppeared ? levelProgress : 0,
                                gradient: [Palette.spruce.base, Palette.spruce.gloss], height: 8)
                HStack {
                    Text("\(totalXP) XP")
                    Spacer()
                    Text("Next level at \(level * 500) XP")
                }
                .font(VType.body(11, .medium))
                .foregroundStyle(Palette.inkSoft)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .claySurface(.surface, radius: Radius.lg, elevation: 0.8)
    }

    private var rewardsButton: some View {
        Button { Haptics.tap(); showRewardsStore = true } label: {
            VStack(spacing: 4) {
                Image(systemName: "gift.fill").font(.system(size: 20, weight: .semibold))
                Text("Rewards").font(VType.body(10, .bold))
            }
            .foregroundStyle(Palette.gold.onColor)
            .frame(width: 68, height: 68)
            .background(ClayBackground(style: .accent(.gold), radius: Radius.md, elevation: 0.5))
        }
        .buttonStyle(.plain)
        .breathing(scale: 1.05, duration: 2.4)
    }

    // MARK: - Stats orbit (broken-alignment count-up tiles)

    private var statsOrbit: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 10) {
                    statTiles
                }
            } else {
                HStack(spacing: 10) { statTiles }
            }
        }
    }

    @ViewBuilder private var statTiles: some View {
        statTile(gameState.totalEventsAttended, "Events", "calendar.badge.checkmark", .spruce, dy: 0)
        statTile(gameState.totalCollected, "Places", "leaf.fill", .spruce, dy: 0)
        statTile(gameState.currentStreak, "Streak", "flame.fill", .spruce, dy: 0)
        statTile(gameState.lifetimePoints, "Lifetime", "sparkles", .spruce, dy: 0)
    }

    private func statTile(_ value: Int, _ label: String, _ icon: String,
                          _ kind: ClayStyle.ClayAccentKind, dy: CGFloat) -> some View {
        VStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundStyle(kind.accent.base)
                .accessibilityHidden(true)   // decorative glyph
            CountUp(value: value).font(VType.num(22, .bold)).monospacedDigit().foregroundStyle(Palette.ink)
                .lineLimit(1).minimumScaleFactor(0.5)
            Text(label).font(VType.body(10, .medium)).foregroundStyle(Palette.inkSoft).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label)")
        .frame(maxWidth: .infinity).padding(.vertical, Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            .strokeBorder(kind.accent.base.opacity(0.38), lineWidth: 1.5))
        .offset(y: dy)
    }

    // MARK: - Badges constellation (scattered)

    private var badgesConstellation: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Badges", action: "See All") { Haptics.tap(); showAllBadges = true }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 22) {
                ForEach(Array(badges.enumerated()), id: \.element.id) { i, badge in
                    Button { Haptics.soft(); selectedBadge = badge } label: {
                        badgeTile(badge, index: i)
                    }
                    .buttonStyle(.plain)
                    .offset(y: [0, 9, 4][i % 3])
                }
            }
            .padding(.bottom, 12)
        }
    }

    private func badgeTile(_ badge: Badge, index: Int) -> some View {
        VStack(spacing: 9) {
            ZStack {
                if badge.earned {
                    let bk: ClayStyle.ClayAccentKind = .spruce
                    PulseHalo(color: bk.accent.base.opacity(0.6), size: 64, lineWidth: 1.5)
                    ClayIconTile(systemImage: badge.icon, kind: bk, size: 58, radius: Radius.chip)
                        .idleFloat(distance: 3, duration: 2.8 + Double(index % 3) * 0.4)
                } else {
                    Image(systemName: badge.icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Palette.inkFaint)
                        .frame(width: 58, height: 58)
                        .background(ClayBackground(style: .inset, radius: Radius.chip))
                }
            }
            .frame(height: 64)
            Text(badge.name).font(VType.body(10.5, .semibold))
                .foregroundStyle(badge.earned ? Palette.ink : Palette.inkFaint)
                .multilineTextAlignment(.center)
                .lineLimit(2).minimumScaleFactor(0.8)
        }
        .opacity(badge.earned ? 1 : 0.55)
    }

    // MARK: - Challenges rail

    private var challengesRail: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Active Challenges", action: "View All") { Haptics.tap(); showAllChallenges = true }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(Array(challenges.enumerated()), id: \.element.id) { i, c in
                        Button { Haptics.soft(); selectedChallenge = c } label: {
                            challengeCard(c, kind: .spruce)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func challengeCard(_ challenge: Challenge, kind: ClayStyle.ClayAccentKind) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                ClayIconTile(systemImage: challenge.icon, kind: kind, size: 40, radius: Radius.chip)
                Spacer()
                NeonProgressRing(progress: challenge.progress, size: 40, lineWidth: 4, color: kind.accent.base)
            }
            Text(challenge.title).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink)
            Text(challenge.description).font(VType.body(11.5)).foregroundStyle(Palette.inkSoft)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            XPBadge(xp: challenge.xpReward)
        }
        .padding(Spacing.md)
        .frame(width: 184, height: 168, alignment: .topLeading)
        .claySurface(.surface, radius: Radius.md, elevation: 0.85)
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            .strokeBorder(kind.accent.base.opacity(0.4), lineWidth: 1.5))
    }

    // MARK: - Settings

    private var settingsSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            SectionHeader(title: "Settings")
            VStack(spacing: 0) {
                Button { Haptics.tap(); showPaywall = true } label: {
                    settingsRow(icon: "sparkles", label: "Verdure+", accent: .gold) {
                        if store.isPlus {
                            Text("Active").font(VType.body(12, .bold)).foregroundStyle(Palette.spruce.base)
                        } else {
                            HStack(spacing: 6) {
                                Text("Upgrade").font(VType.body(12, .bold)).foregroundStyle(Palette.gold.base)
                                chevron
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(store.isPlus ? "Verdure Plus, active" : "Verdure Plus, upgrade")
                .accessibilityHint("Opens the Verdure Plus subscription page.")
                rowDivider
                Button { showOfflinePacks = true } label: {
                    settingsRow(icon: "arrow.down.circle.fill", label: "Offline packs", accent: .spruce) { chevron }
                }.buttonStyle(.plain).accessibilityIdentifier("openOfflinePacks")
                rowDivider
                settingsRow(icon: "moon.fill", label: "Dark Mode", accent: .spruce) {
                    Toggle("", isOn: $prefersDarkMode).tint(Palette.spruce.base).labelsHidden()
                }
                rowDivider
                Button { Haptics.tap(); showStats = true } label: {
                    settingsRow(icon: "chart.bar.fill", label: "Stats & Friends", accent: .gold) {
                        chevron
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stats and friends leaderboard")
                .accessibilityHint("Your points breakdown and how you compare with people you follow.")
                rowDivider
                Button { Haptics.tap(); showHousehold = true } label: {
                    settingsRow(icon: "figure.and.child.holdinghands", label: "Household", accent: .spruce) { chevron }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Set the youngest child's age for family event recommendations.")
                rowDivider
                // The privacy policy promises this switch by name ("You can
                // switch them off in Profile › Settings"), so it has to exist
                // and it has to work. See Analytics.isEnabled.
                settingsRow(icon: "chart.bar.fill", label: "Product Analytics", accent: .teal) {
                    Toggle("", isOn: Binding(
                        get: { analyticsEnabled },
                        set: { on in analyticsEnabled = on; Analytics.isEnabled = on }
                    )).tint(Palette.spruce.base).labelsHidden()
                }
                .accessibilityLabel("Product analytics")
                .accessibilityValue(analyticsEnabled ? "On" : "Off")
                .accessibilityHint("App-use and ranked-feed analytics. Feed actions are linked to your account; no precise location is recorded here.")
                rowDivider
                if CrashReporting.permitsCollection {
                    settingsRow(icon: "stethoscope", label: "Crash reports", accent: .teal) {
                        Toggle("", isOn: Binding(get: { crashReportsEnabled }, set: { on in
                            crashReportsEnabled = on; CrashReporting.setEnabled(on)
                        })).tint(Palette.spruce.base).labelsHidden()
                    }.accessibilityLabel("Crash reports").accessibilityValue(crashReportsEnabled ? "On" : "Off")
                        .accessibilityHint("Send crash stacks and device diagnostics to Firebase. No account ID, text or precise location is attached by Verdure.")
                    rowDivider
                }
                #if DEBUG
                if CrashReporting.canRunPhysicalQACrash {
                    Button("Run physical-device QA test crash") { CrashReporting.runPhysicalQACrash() }
                        .frame(minHeight: 44).accessibilityIdentifier("physicalQATestCrash")
                    rowDivider
                }
                #endif
                if let org = social.organizer {
                    Button { Haptics.tap(); showOrganizerVerify = true } label: {
                        settingsRow(icon: org.isApproved ? "checkmark.seal.fill" : "clock.badge.checkmark.fill",
                                    label: org.displayName, accent: org.isApproved ? .spruce : .gold) {
                            HStack(spacing: 6) {
                                Text(org.statusLabel).font(VType.body(12, .bold))
                                    .foregroundStyle(org.isApproved ? Palette.spruce.base : Palette.gold.base)
                                chevron
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Organizer profile \(org.displayName), \(org.statusLabel)")
                } else {
                    Button { Haptics.tap(); showOrganizerVerify = true } label: {
                        settingsRow(icon: "megaphone.fill", label: "Become an Organizer", accent: .terracotta) { chevron }
                    }
                    .buttonStyle(.plain)
                }
                rowDivider
                Button { Haptics.tap(); showNotifSettings = true } label: {
                    settingsRow(icon: "bell.fill", label: "Notifications", accent: .gold) { chevron }
                }
                .buttonStyle(.plain)
                rowDivider
                Button { Haptics.tap(); showSafety = true } label: {
                    settingsRow(icon: "shield.lefthalf.filled", label: "Safety & Blocking", accent: .teal) { chevron }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Report policy, blocked members, and how to reach us.")
                rowDivider
                Button { Haptics.tap(); showLegal = true } label: {
                    settingsRow(icon: "doc.text.fill", label: "Terms & Privacy", accent: .spruce) { chevron }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Terms of Use and Privacy Policy.")
                rowDivider
                Button { Haptics.tap(); showAbout = true } label: {
                    settingsRow(icon: "info.circle.fill", label: "About Verdure", accent: .terracotta) { chevron }
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 6)
            .claySurface(.surface, radius: Radius.md)

            if authService.isAuthenticated {
              Button { Haptics.tap(); showSignOutConfirm = true } label: {
                HStack(spacing: 9) {
                    Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 16, weight: .bold))
                    Text("Sign Out").font(VType.body(17, .bold))
                }
                .foregroundStyle(Self.signOutRed)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(ClayBackground(style: .surface, radius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .strokeBorder(Self.signOutRed.opacity(0.4), lineWidth: 1.5))
            }
            .buttonStyle(.plain)
            .confirmationDialog("Sign out of Verdure?", isPresented: $showSignOutConfirm) {
                Button("Sign Out", role: .destructive) {
                    authService.signOut(); gameState.disconnectCloud()
                    withAnimation { hasCompletedOnboarding = false }
                }
                Button("Reset Demo Data", role: .destructive) { gameState.resetAll() }
                Button("Cancel", role: .cancel) {}
            }
            } else {
                ClayButton("Sign in", systemImage: "person.crop.circle", kind: .spruce, fullWidth: true) { showSignIn = true }
                    .accessibilityIdentifier("profileSignIn")
            }
            deleteAccountButton
            .sheet(isPresented: $showPaywall) {
                PaywallView(source: "profile")
                    .presentationDetents([.large]).presentationDragIndicator(.visible)
            }
        }
    }

    private var householdSheet: some View {
        NavigationStack {
            Form {
                Section {
                    if householdChildAges.isEmpty {
                        Text("No children added").foregroundStyle(Palette.inkSoft)
                    }
                    ForEach(householdChildAges.indices, id: \.self) { index in
                        HStack {
                            Picker("Child \(index + 1)'s age", selection: $householdChildAges[index]) {
                                ForEach(0..<18, id: \.self) { age in Text("\(age)").tag(age) }
                            }
                            Button(role: .destructive) { householdChildAges.remove(at: index) } label: {
                                Image(systemName: "minus.circle.fill")
                            }
                            .accessibilityLabel("Remove child \(index + 1)")
                        }
                    }
                    if householdChildAges.count < 10 {
                        Button("Add a child") { householdChildAges.append(0) }
                    }
                } footer: {
                    Text("Optional ages are used privately to prioritize suitable events and show age warnings. Change or clear them any time.")
                }
                Section("Getting around") {
                    Picker("Usual transport", selection: $householdTransportMode) {
                        Text("No preference").tag("unspecified")
                        Text("Walk or roll").tag("walk")
                        Text("Public transit").tag("transit")
                        Text("Drive").tag("drive")
                    }
                    Picker("Typical distance", selection: $householdRadiusMiles) {
                        Text("No preference").tag(0)
                        ForEach([2, 5, 10, 15, 25, 50], id: \.self) { miles in
                            Text("\(miles) miles").tag(miles)
                        }
                    }
                }
                Section {
                    ForEach(Self.householdAccessOptions, id: \.code) { option in
                        Toggle(option.label, isOn: Binding(
                            get: { householdAccessibilityNeeds.contains(option.code) },
                            set: { enabled in
                                if enabled { householdAccessibilityNeeds.insert(option.code) }
                                else { householdAccessibilityNeeds.remove(option.code) }
                            }
                        ))
                    }
                } header: {
                    Text("Accessibility preferences")
                } footer: {
                    Text("Optional. Listings only receive a preference boost when the organizer confirms a matching feature. Missing details are shown as unconfirmed, not inaccessible.")
                }
                if let householdError { Text(householdError).foregroundStyle(Palette.danger) }
            }
            .navigationTitle("Household")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await saveHousehold() } }
                }
            }
            .task { await loadHousehold() }
        }
    }

    private static let householdAccessOptions: [(code: String, label: String)] = [
        ("stepFree", "Step-free access"),
        ("accessibleRestroom", "Accessible restroom"),
        ("seating", "Seating"),
        ("quietSpace", "Quiet space"),
        ("asl", "ASL interpretation"),
        ("captions", "Captions"),
    ]

    private func loadHousehold() async {
        guard let uid = Auth.auth().currentUser?.uid else { return }
        do {
            let snapshot = try await Firestore.firestore().collection("users").document(uid).getDocument()
            if let ages = snapshot.data()?["householdChildAges"] as? [Int] {
                householdChildAges = ages
            } else if let youngest = snapshot.data()?["householdYoungestAge"] as? Int {
                householdChildAges = [youngest]
            } else {
                householdChildAges = []
            }
            householdTransportMode = snapshot.data()?["householdTransportMode"] as? String ?? "unspecified"
            householdRadiusMiles = snapshot.data()?["householdRadiusMiles"] as? Int ?? 0
            householdAccessibilityNeeds = Set(snapshot.data()?["householdAccessibilityNeeds"] as? [String] ?? [])
        } catch { householdError = error.localizedDescription }
    }

    private func saveHousehold() async {
        guard let uid = Auth.auth().currentUser?.uid else { return }
        do {
            let youngest: Any = householdChildAges.min().map { $0 as Any } ?? FieldValue.delete()
            let ages: Any = householdChildAges.isEmpty ? FieldValue.delete() : householdChildAges
            let transport: Any = householdTransportMode == "unspecified" ? FieldValue.delete() : householdTransportMode
            let radius: Any = householdRadiusMiles == 0 ? FieldValue.delete() : householdRadiusMiles
            let needs: Any = householdAccessibilityNeeds.isEmpty ? FieldValue.delete() : Array(householdAccessibilityNeeds).sorted()
            let ref = Firestore.firestore().collection("users").document(uid)
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ref.updateData(["householdYoungestAge": youngest,
                                "householdChildAges": ages,
                                "householdTransportMode": transport,
                                "householdRadiusMiles": radius,
                                "householdAccessibilityNeeds": needs]) { error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume() }
                }
            }
            showHousehold = false
            householdError = nil
        } catch { householdError = error.localizedDescription }
    }

    // MARK: - Delete account (App Review 5.1.1(v))
    //
    // Deletion is a server callable: it removes the profile, posts, events and
    // their attendee lists, RSVPs, GPS audit rows, queued gift cards, the proof
    // photos in Storage, and finally the Firebase Auth user — so nothing the
    // account owned survives a client that crashes mid-way. Only then does the
    // app wipe its local state.

    private var deleteAccountButton: some View {
        VStack(spacing: 8) {
            Button { Haptics.rigid(); showDeleteConfirm = true } label: {
                HStack(spacing: 9) {
                    if isDeletingAccount {
                        ProgressView().tint(Palette.inkSoft)
                    } else {
                        Image(systemName: "trash").font(.system(size: 14, weight: .bold))
                    }
                    Text(isDeletingAccount ? "Deleting your account…" : "Delete Account")
                        .font(VType.body(14, .semibold))
                }
                .foregroundStyle(Palette.inkSoft)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
            }
            .buttonStyle(.plain)
            .disabled(isDeletingAccount || !authService.isAuthenticated)
            .opacity(authService.isAuthenticated ? 1 : 0.5)
            .accessibilityHint("Permanently deletes your account and all of your data.")
            .confirmationDialog("Delete your Verdure account?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("Delete Everything", role: .destructive) { deleteAccount() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently removes your profile, points, collection, posts, events, RSVPs, photos and any gift cards still waiting to be sent. Delivered gift cards are unaffected. This cannot be undone.")
            }
            if let deleteAccountError {
                Text(deleteAccountError)
                    .font(VType.body(12, .medium)).foregroundStyle(Palette.danger)
                    .multilineTextAlignment(.center)
                    .accessibilityLabel("Error: \(deleteAccountError)")
            }
        }
    }

    private func deleteAccount() {
        guard !isDeletingAccount else { return }
        isDeletingAccount = true
        deleteAccountError = nil
        Task {
            do {
                try await FunctionsService().deleteAccount()
                // The server has already removed the Auth user; clear everything local.
                gameState.disconnectCloud()
                gameState.resetAll()
                moderation.clearLocal()
                authService.signOut()
                isDeletingAccount = false
                AccessibilityNotification.Announcement("Your account has been deleted.").post()
                withAnimation { hasCompletedOnboarding = false }
            } catch {
                isDeletingAccount = false
                deleteAccountError = error.localizedDescription
            }
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.inkFaint)
    }
    private var rowDivider: some View {
        ClayHairline().padding(.leading, 56).padding(.trailing, Spacing.md)
    }

    private func settingsRow<Trailing: View>(icon: String, label: String, accent: ClayStyle.ClayAccentKind,
                                              @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon).font(.system(size: 13, weight: .bold))
                .foregroundStyle(accent.accent.onColor)
                .frame(width: 32, height: 32)
                .background(ClayBackground(style: .accent(accent), radius: 10, elevation: 0.3))
            Text(label).font(VType.body(15, .medium)).foregroundStyle(Palette.ink)
            Spacer()
            trailing()
        }
        .padding(.horizontal, Spacing.md).padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}

#Preview {
    ProfileView()
        .environment(GameStateManager())
        .environment(AuthService())
        .environment(StoreService())
        .environment(ModerationService())
        .environment(SocialService())
}
