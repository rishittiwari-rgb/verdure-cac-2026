import SwiftUI

struct ExploreView: View {
    @Environment(GameStateManager.self) private var gameState
    @Environment(PlacesAPIService.self) private var placesService
    @Environment(AuthService.self) private var authService
    @Environment(LocationManager.self) private var locationManager
    @Environment(SocialService.self) private var social
    @Environment(DiscoveryFilters.self) private var filters
    @Environment(ParkGuideService.self) private var parkGuides
    @State private var search = SearchDebouncer()
    @State private var showGem = false
    @State private var showPlanner = false
    @State private var showNotifications = false
    private var placeSearch: String { search.debounced }
    @State private var placeFilter: PlaceCategory? = nil
    @State private var forYou = true
    @AppStorage("interestCategories") private var interestCategoriesRaw = ""

    private var sourcePlaces: [Place] { placesService.places }
    private var interests: Set<PlaceCategory> {
        Set(interestCategoriesRaw.split(separator: ",").compactMap { PlaceCategory(rawValue: String($0)) })
    }
    private var showForYou: Bool { !interests.isEmpty }
    private var nearbyCategories: [PlaceCategory] {
        let present = Set(sourcePlaces.map(\.category))
        return PlaceCategory.allCases.filter { present.contains($0) }
    }
    /// "For You" recommends only the user's chosen interest categories; "All" / a category
    /// chip shows everything. (Per feedback: don't recommend unchosen groups, but still list them.)
    private var filteredPlaces: [Place] {
        // Persisted filters (radius, category) + search, all local; then the
        // screen's own For You / chip narrowing on top.
        filters.apply(to: sourcePlaces, query: placeSearch, userLocation: locationManager.browsingLocation).filter { p in
            guard parkGuides.matches(p, state: filters.state) else { return false }
            if let cat = placeFilter { return p.category == cat }
            if forYou && showForYou { return interests.contains(p.category) }
            return true
        }
    }
    private var level: Int { gameState.level }
    private var xpInLevel: Int { gameState.xpInLevel }
    private var levelProgress: Double { gameState.levelProgress }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    header.riseIn(index: 0)
                    nearbySection.riseIn(index: 1)
                    parkSection
                    plannerTile.riseIn(index: 2)
                    dailyGemTile.riseIn(index: 3)
                }
                .padding(.horizontal, Spacing.md)
                .padding(.top, Spacing.sm)
                .padding(.bottom, 110)
            }
            .background(VerdureBackground())
            .task { await placesService.fetchNearbyPlaces(around: locationManager.userCoordinate) }
            .task(id: "\(locationManager.userCoordinate.latitude),\(locationManager.userCoordinate.longitude),\(filters.state.radiusMiles)") {
                await parkGuides.load(around: locationManager.userCoordinate, radiusMiles: filters.state.radiusMiles)
            }
            .onChange(of: locationManager.userLocation) { _, location in
                guard location != nil else { return }
                Task { await placesService.fetchNearbyPlaces(around: locationManager.userCoordinate) }
            }
            .refreshable { await placesService.fetchNearbyPlaces(around: locationManager.userCoordinate) }
            .searchable(text: Bindable(search).text, placement: .navigationBarDrawer(displayMode: .automatic),
                        prompt: "Search nearby places")
            .onSubmit(of: .search) { search.commit(into: filters) }
            .onChange(of: filteredPlaces.count) { _, count in
                AccessibilityNotification.Announcement("\(count) \(count == 1 ? "place" : "places")").post()
            }
            .navigationDestination(for: Place.self) { PlaceDetailView(place: $0) }
            .sheet(isPresented: $showPlanner) {
                let coord = locationManager.userCoordinate
                AdventurePlannerView(
                    places: sourcePlaces.filter { $0.coordinate != nil },
                    latitude: coord.latitude,
                    longitude: coord.longitude
                )
            }
            .fullScreenCover(isPresented: $showGem) {
                DailyGemView(fact: DailyGemStore.todaysFact) { showGem = false }
            }
            .sheet(isPresented: $showNotifications) { NotificationsInboxView() }
        }
    }

    // MARK: - Header

    private var parkSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            NavigationLink { ParkDirectoryView() } label: {
                Label("Park guides", systemImage: "leaf.fill").font(VType.display(26, .semibold)).foregroundStyle(Palette.ink)
            }.accessibilityIdentifier("parkDirectory")
            Text("Confirmed amenities, trails and this week's events. Free online.").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
            if parkGuides.isLoading { ProgressView("Loading parks") }
            if parkGuides.lastError != nil {
                Text("Park data couldn't be loaded. Open Park guides to retry.").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
            }
            ForEach(parkGuides.filtered(state: filters.state, query: placeSearch).prefix(4)) { park in
                NavigationLink { ParkGuideView(parkID: park.id) } label: { ParkGuideRow(park: park) }.buttonStyle(.plain)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                KickerLabel(text: greeting, dot: Palette.gold.base)
                Text("Explore").font(VType.display(38, .bold)).foregroundStyle(Palette.ink)
            }
            Spacer()
            Button { Haptics.tap(); showNotifications = true } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell.fill").font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Palette.spruce.base)
                        .frame(width: 46, height: 46)
                        .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.6))
                    if NotificationManager.shared.unreadCount + social.unreadNotificationCount > 0 {
                        Text("\(NotificationManager.shared.unreadCount + social.unreadNotificationCount)")
                            .font(VType.num(10, .bold)).foregroundStyle(Palette.terracotta.onColor)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Capsule().fill(Palette.terracotta.base))
                            .offset(x: 6, y: -4)
                    }
                }
            }
            .buttonStyle(.plain)
            UserAvatar(initials: authService.currentUser?.initials ?? "ME", size: 46, accent: Palette.spruce)
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening")
    }

    // MARK: - Hero bento (3D level tile + streak/points column)

    private var heroBento: some View {
        HStack(spacing: 12) {
            levelTile
            VStack(spacing: 12) {
                statTile(value: "\(gameState.currentStreak)", unit: "day streak",
                         icon: "flame.fill", kind: .terracotta)
                statTile(value: "\(gameState.pointsBalance)", unit: "points",
                         icon: "leaf.circle.fill", kind: .gold)
            }
            .frame(width: 132)
        }
    }

    private var levelTile: some View {
        VStack(spacing: 6) {
            ZStack {
                AmbientGlow(color: Palette.teal.base.opacity(0.4), size: 150, opacity: 0.7)
                MedallionHero(size: 130, interactive: false)
            }
            .frame(height: 132)
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("LEVEL").font(VType.body(9, .bold)).tracking(1.4).foregroundStyle(Palette.inkSoft)
                    Text("\(level)").font(VType.num(26, .bold)).foregroundStyle(Palette.ink)
                }
                Spacer()
                NeonProgressRing(progress: levelProgress, size: 42, lineWidth: 5,
                                 color: Palette.teal.base, showLabel: false)
                    .overlay {
                        Image(systemName: "bolt.fill").font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Palette.gold.base)
                    }
            }
            Text("\(xpInLevel) / 500 XP to level \(level + 1)")
                .font(VType.num(10, .medium)).foregroundStyle(Palette.inkFaint)
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity)
        .claySurface(.surface, radius: Radius.lg, elevation: 1.1)
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
            .strokeBorder(Palette.teal.base.opacity(0.38), lineWidth: 1.5))
        .parallaxTilt(magnitude: 4, shadow: false)
    }

    private func statTile(value: String, unit: String, icon: String, kind: ClayStyle.ClayAccentKind) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).font(.system(size: 18, weight: .bold)).foregroundStyle(kind.accent.base)
                .accessibilityHidden(true)   // decorative glyph
            Spacer(minLength: 0)
            Text(value).font(VType.num(28, .bold)).foregroundStyle(Palette.ink).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.5)
            // The value already scales; the unit did not, so at accessibility
            // text sizes "day streak" truncated to "day str…" inside this
            // fixed-height tile. VoiceOver was unaffected (the tile is a single
            // combined element) — but a sighted user at XL couldn't tell a day
            // streak from a day stretch. Scaling rather than wrapping because
            // the 78pt height is fixed and a second line would clip instead.
            Text(unit).font(VType.body(11, .medium)).foregroundStyle(Palette.inkSoft)
                .lineLimit(1).minimumScaleFactor(0.6)
        }
        .accessibilityElement(children: .combine)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 78)
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            .strokeBorder(kind.accent.base.opacity(0.38), lineWidth: 1.5))
    }

    // MARK: - Daily Gem (wide immersive — today's fun fact)

    /// Entry point to the AI planner. Hidden until there are at least two places
    /// with real coordinates to plan around — offering to build an itinerary and
    /// then failing for lack of input is a worse experience than not offering.
    @ViewBuilder
    private var plannerTile: some View {
        let plannable = sourcePlaces.filter { $0.coordinate != nil }
        if plannable.count >= 2 {
            Button(action: { Haptics.tap(); showPlanner = true }) {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(Palette.teal.onColor)
                        .frame(width: 46, height: 46)
                        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
                            .fill(Palette.teal.base))
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Plan my adventure")
                            .font(VType.body(17, .semibold))
                            .foregroundStyle(Palette.ink)
                        Text("An itinerary from real places, shaped by today's weather")
                            .font(VType.body(13))
                            .foregroundStyle(Palette.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Palette.inkSoft)
                        .accessibilityHidden(true)
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(ClayPressButtonStyle(style: .surface, radius: Radius.md))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Plan my adventure")
            .accessibilityHint("Builds an itinerary from real places near you, shaped by today's weather")
            .accessibilityAddTraits(.isButton)
        }
    }

    private var dailyGemTile: some View {
        let fact = DailyGemStore.todaysFact
        let kind = fact.accent
        return Button(action: { Haptics.tap(); showGem = true }) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    HStack(spacing: 5) {
                        Image(systemName: "sparkle").font(.system(size: 10, weight: .bold))
                        Text("TODAY'S GEM").font(VType.body(10, .bold)).tracking(1.2)
                    }
                    .foregroundStyle(Palette.gold.onColor)
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .background(ClayBackground(style: .accent(.gold), radius: Radius.chip, elevation: 0.4))
                    Spacer()
                    Image(systemName: fact.icon).font(.system(size: 16, weight: .bold))
                        .foregroundStyle(kind.accent.base)
                }
                .padding(.bottom, Spacing.md)
                Text(fact.kind).font(VType.display(24, .semibold)).foregroundStyle(Palette.ink)
                    .lineLimit(1)
                Text(fact.text).font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                    .lineLimit(3).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
                HStack(spacing: 6) {
                    Spacer()
                    Text("Reveal").font(VType.body(14, .bold))
                    Image(systemName: "arrow.right").font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(Palette.spruce.base)
                .padding(.top, Spacing.md)
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .claySurface(.surface, radius: Radius.lg, elevation: 1.2)
            // Clip ONLY the decorative glow to the card shape — leaving the clay
            // outer float intact (a card-level clipShape would flatten it).
            .overlay {
                AmbientGlow(color: kind.accent.base.opacity(0.22), size: 200, opacity: 0.6)
                    .offset(x: 40, y: -30)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                    .allowsHitTesting(false)
            }
        }
        .buttonStyle(Card3DButtonStyle())
        .accessibilityLabel("Today's Gem: \(fact.kind)")
        .accessibilityHint("Opens today's fun fact.")
    }

    // MARK: - Stats strip

    private var statsStrip: some View {
        HStack(spacing: 12) {
            pill("\(gameState.totalCollected)", "Collected", "leaf.fill", .teal)
            pill("\(gameState.totalEventsAttended)", "Events", "calendar", .spruce)
            pill("\(gameState.lifetimePoints)", "Lifetime", "chart.line.uptrend.xyaxis", .gold)
        }
    }

    private func pill(_ value: String, _ label: String, _ icon: String, _ kind: ClayStyle.ClayAccentKind) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundStyle(kind.accent.base)
                .accessibilityHidden(true)   // decorative glyph
            Text(value).font(VType.num(20, .bold)).foregroundStyle(Palette.ink).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.5)
            Text(label).font(VType.body(10, .medium)).foregroundStyle(Palette.inkSoft).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .frame(maxWidth: .infinity).padding(.vertical, Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.7)
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
            .strokeBorder(kind.accent.base.opacity(0.35), lineWidth: 1.5))
    }

    // MARK: - Quests

    private var questsSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ClaySectionHeader(index: "01", kicker: "This week", title: "Your Quests",
                              accent: Palette.gold.base)
            ScrollView(.horizontal, showsIndicators: false) {
                // .top alignment + fixedSize(vertical:) is what makes the cards
                // equal height: the row takes its ideal height from the tallest
                // card, and each card's maxHeight: .infinity then fills it. At
                // accessibility text sizes the tallest card is whichever quest
                // has the longest description, and the rest match it instead of
                // truncating or ending up ragged.
                HStack(alignment: .top, spacing: 14) {
                    ForEach(Array(GamificationEngine.challenges(for: gameState).enumerated()), id: \.element.id) { i, c in
                        QuestCard(challenge: c, kind: .spruce)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Nearby

    private var nearbySection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Nearby Places")
                .font(VType.display(30, .semibold))
                .foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)

            // Search lives in the navigation bar (.searchable); recents + filters here.
            HStack(spacing: 10) {
                Text("\(filteredPlaces.count) \(filteredPlaces.count == 1 ? "place" : "places") within \(Int(filters.state.radiusMiles)) mi")
                    .font(VType.body(12, .semibold)).foregroundStyle(Palette.inkSoft)
                    .accessibilityHidden(true)   // announced on change instead
                Spacer()
                FilterButton(mode: .places)
            }
            RecentSearchesRow { q in search.text = q; search.commit(into: filters) }
                .padding(.horizontal, -Spacing.md)

            // Filter chips — "For You" (interests) is the default recommendation set.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if showForYou {
                        CategoryPill(label: "For You", icon: "sparkles", tint: Palette.gold.base,
                                     isSelected: forYou && placeFilter == nil) { forYou = true; placeFilter = nil }
                    }
                    CategoryPill(label: "All", icon: "square.grid.2x2.fill", tint: Palette.teal.base,
                                 isSelected: placeFilter == nil && (!showForYou || !forYou)) { forYou = false; placeFilter = nil }
                    ForEach(nearbyCategories) { cat in
                        CategoryPill(label: cat.rawValue, icon: cat.icon, tint: cat.accent.base,
                                     isSelected: placeFilter == cat) { forYou = false; placeFilter = cat }
                    }
                }
                .padding(.vertical, 2)
            }

            // Cards (filtered)
            if filteredPlaces.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Palette.inkFaint)
                    Text(placesService.isLoading ? "Finding nearby places…" :
                         sourcePlaces.isEmpty ? "No nearby places loaded yet." : "No places match these choices.")
                        .font(VType.scaledBody(14, .medium, relativeTo: .subheadline))
                        .foregroundStyle(Palette.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity)
                .background(ClayBackground(style: .inset, radius: Radius.md))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        ForEach(filteredPlaces.prefix(8)) { place in
                            NavigationLink(value: place) {
                                NearbyCard(place: place, collected: isCollected(place))
                            }
                            .buttonStyle(Card3DButtonStyle())
                            .accessibilityIdentifier(place.id.hasPrefix("osm-") ? "nearbyPlaceCard-osm" : "nearbyPlaceCard-other")
                        }
                    }
                    .padding(.vertical, 4)
                }
                if filteredPlaces.contains(where: { $0.id.hasPrefix("osm-") }) {
                    OpenStreetMapCredit(asOf: placesService.osmDataDate)
                }
            }
        }
    }

    private func isCollected(_ place: Place) -> Bool {
        let id = placesService.collectible(for: place)?.id ?? ""
        return gameState.isCollected(id)
    }
}

// MARK: - Quest card

private struct QuestCard: View {
    let challenge: Challenge
    let kind: ClayStyle.ClayAccentKind

    // The card used to be a hard 196x184. That's fine at default text size and
    // broken at accessibility sizes: the box couldn't grow, so the title and
    // description truncated inside it ("Event Reg…", "Attend 3 events this…").
    // Scaling the BOX with the text is the fix — a smaller minimumScaleFactor
    // would only have shrunk the copy back to its original size, which defeats
    // the point of asking for large text.
    //
    // Width is capped because these scroll horizontally on a phone: past ~320pt
    // a single card fills the screen and stops looking scrollable, so there's
    // no affordance that a second quest exists. Height is left uncapped — the
    // section sits in a vertical scroll, so growing downward costs nothing.
    @ScaledMetric(relativeTo: .body) private var baseWidth: CGFloat = 196

    private var cardWidth: CGFloat { min(baseWidth, 320) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                ClayIconTile(systemImage: challenge.icon, kind: kind, size: 44, radius: Radius.chip)
                Spacer()
                NeonProgressRing(progress: challenge.progress, size: 40, lineWidth: 4,
                                 color: kind.accent.base)
            }
            .padding(.bottom, Spacing.md)
            // Wrap to two lines before shrinking. A quest title that reads
            // "Event Reg…" is indistinguishable from any other quest starting
            // with the same word, which is the whole problem being fixed.
            Text(challenge.title).font(VType.display(16, .semibold)).foregroundStyle(Palette.ink)
                .lineLimit(2).minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            // 3 lines rather than 2: the taller scaled card has the room, and at
            // default text size these descriptions only ever run to two, so this
            // changes nothing below accessibility sizes.
            Text(challenge.description).font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                .lineLimit(3).minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 2)
            Spacer(minLength: Spacing.sm)
            HStack {
                XPBadge(xp: challenge.xpReward)
                Spacer()
                Text("\(challenge.daysRemaining)d").font(VType.body(11, .semibold)).foregroundStyle(Palette.inkFaint)
            }
        }
        .padding(Spacing.md)
        // Height is NOT scaled and NOT fixed.
        //
        // Scaling it left a big empty gap at accessibility sizes (the box grew
        // by the text ratio, the text needed less); fixing it was the original
        // truncation bug. Instead: a 184pt floor so the default layout is
        // unchanged, then `maxHeight: .infinity` so every card stretches to
        // whichever sibling is tallest — the row stays uniform without anyone
        // hardcoding how tall the tallest one is. The equalising comes from
        // `.fixedSize(vertical:)` on the enclosing HStack, which bounds the
        // .infinity to the row's ideal height instead of the scroll view's.
        .frame(width: cardWidth, alignment: .topLeading)
        .frame(minHeight: 184, maxHeight: .infinity, alignment: .topLeading)
        .claySurface(.surface, radius: Radius.md, elevation: 0.9)
        .overlay(alignment: .top) {
            Capsule().fill(kind.accent.faceGradient).frame(height: 5)
                .padding(.horizontal, 20).offset(y: 2)
        }
    }
}

// MARK: - Nearby card (vertical poster, not a list row)

private struct NearbyCard: View {
    let place: Place
    let collected: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .fill(place.category.accent.faceGradient)
                    .frame(height: 110)
                    .overlay {
                        if let urlString = place.photoURL, let url = URL(string: urlString) {
                            // Real photo when the source provides one.
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                Image(systemName: place.imagePlaceholder)
                                    .font(.system(size: 42, weight: .semibold))
                                    .foregroundStyle(place.category.accent.onColor.opacity(0.9))
                            }
                            .frame(height: 110)
                        } else {
                            Image(systemName: place.imagePlaceholder)
                                .font(.system(size: 42, weight: .semibold))
                                .foregroundStyle(place.category.accent.onColor.opacity(0.9))
                        }
                    }
                if collected {
                    VStack { HStack { Spacer()
                        Image(systemName: "checkmark.seal.fill").font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white).shadow(radius: 2) }
                        Spacer() }.padding(8)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(place.category.rawValue.uppercased()).font(VType.body(9, .bold)).tracking(0.6)
                    .foregroundStyle(place.category.accent.base)
                Text(place.name).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                HStack(spacing: 10) {
                    Label(place.distance, systemImage: "location.fill")
                    if let rating = place.rating {   // only show REAL ratings
                        Label(String(format: "%.1f", rating), systemImage: "star.fill")
                    }
                }
                .font(VType.num(11, .semibold)).foregroundStyle(Palette.inkFaint)
            }
        }
        .padding(10)
        .frame(width: 168)
        .claySurface(.surface, radius: Radius.md, elevation: 0.85)
    }
}

#Preview {
    ExploreView()
        .environment(GameStateManager())
        .environment(PlacesAPIService())
        .environment(AuthService())
        .environment(LocationManager())
        .environment(SocialService())
        .environment(DiscoveryFilters())
        .environment(ParkGuideService())
}
