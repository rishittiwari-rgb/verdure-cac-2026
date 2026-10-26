import SwiftUI
import MapKit

struct MapExploreView: View {
    @Environment(GameStateManager.self) private var gameState
    @Environment(LocationManager.self) private var locationManager
    @Environment(PlacesAPIService.self) private var placesService
    @Environment(DiscoveryFilters.self) private var filters
    @Environment(PartnerDiscoveryService.self) private var partners
    @Environment(ParkGuideService.self) private var parkGuides
    @State private var selectedPark: ParkSummary?
    @State private var selectedPartner: PartnerMapOffer?
    @State private var search = SearchDebouncer()
    @State private var position: MapCameraPosition = .automatic
    @State private var selectedPlace: Place? = nil
    @State private var showList = false
    @State private var showExploreBeta = false
    @State private var hasCentered = false
    @State private var hasFetched = false
    @State private var fetchedFallback = false
    @State private var showCelebration = false
    @State private var celebrationCollectible: CollectiblePlace? = nil
    @State private var celebrationPoints = 0

    /// Pins, deck and list honour the same persisted filters + search as every other surface.
    private var collectiblePlaces: [CollectiblePlace] {
        filters.apply(to: placesService.collectiblePlaces, query: search.debounced, userLocation: locationManager.browsingLocation)
            .filter { parkGuides.matches($0.place, state: filters.state) }
    }
    private var nearbyUncollected: [CollectiblePlace] {
        gameState.uncollected(from: collectiblePlaces, nearbyOnly: true, userLocation: locationManager.userLocation)
    }
    /// Deck content: nearby-uncollected first, else the closest handful.
    private var deck: [CollectiblePlace] {
        nearbyUncollected.isEmpty ? Array(collectiblePlaces.prefix(8)) : nearbyUncollected
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                mapLayer

                VStack(spacing: 0) {
                    topBar
                    Spacer()
                    if let place = selectedPlace {
                        selectedPlaceCard(place)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                            .padding(.horizontal, Spacing.md)
                            .padding(.bottom, 104)   // clear the floating tab bar
                    } else if !deck.isEmpty {
                        nearbyDeck
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                            .padding(.bottom, 100)   // clear the floating tab bar
                    }
                }

                if showCelebration, let c = celebrationCollectible {
                    CollectionCelebrationView(collectible: c, pointsEarned: celebrationPoints) {
                        withAnimation { showCelebration = false }
                    }
                    .transition(.opacity)
                    .zIndex(10)
                }
            }
            .navigationBarHidden(true)
            .navigationDestination(for: Place.self) { PlaceDetailView(place: $0) }
            .fullScreenCover(isPresented: $showExploreBeta) { ExploreBetaView() }
            .sheet(isPresented: $showList) {
                mapListSheet
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(item: $selectedPartner) { PartnerOfferDetail(offer: $0) }
            .sheet(item: $selectedPark) { park in NavigationStack { ParkGuideView(parkID: park.id) } }
            .task(id: "\(locationManager.userCoordinate.latitude),\(locationManager.userCoordinate.longitude),\(filters.state.radiusMiles)") {
                await parkGuides.load(around: locationManager.userCoordinate, radiusMiles: filters.state.radiusMiles)
            }
        }
    }

    // MARK: - Map

    private var mapLayer: some View {
        Map(position: $position) {
            UserAnnotation()
            if locationManager.userLocation != nil {
                Annotation("", coordinate: locationManager.userCoordinate) { ClayRadarSweep() }
                    .annotationTitles(.hidden)
            }
            ForEach(collectiblePlaces) { collectible in
                Annotation(collectible.place.name, coordinate: collectible.coordinate) {
                    Button { select(collectible) } label: {
                        ClayMapPin(
                            collectible: collectible,
                            isSelected: selectedPlace?.id == collectible.place.id,
                            isCollected: gameState.isCollected(collectible.id),
                            isNearby: collectible.isNearby(from: locationManager.userLocation)
                        ).frame(minWidth: 44, minHeight: 48).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(collectible.place.name), \(collectible.place.category.rawValue)")
                    .accessibilityValue(gameState.isCollected(collectible.id) ? "Collected" : "Uncollected")
                    .accessibilityHint("Show place details")
                }
                .annotationTitles(.hidden)
            }
            if partners.layerEnabled {
                ForEach(partners.offers) { offer in
                    Annotation(offer.partner, coordinate: offer.coordinate) {
                        Button { selectedPartner = offer; selectedPlace = nil } label: {
                            Image(systemName: "storefront.fill").font(.system(size: 20, weight: .bold))
                                .foregroundStyle(Palette.surface).frame(width: 48, height: 48)
                                .background(Palette.ink, in: RoundedRectangle(cornerRadius: Radius.sm))
                                .overlay(RoundedRectangle(cornerRadius: Radius.sm).stroke(Palette.gold.base, lineWidth: 2))
                        }.buttonStyle(.plain).accessibilityLabel("Partner \(offer.partner), \(offer.title), \(offer.pointCost) points")
                            .accessibilityIdentifier("partner-pin:\(offer.id)")
                    }.annotationTitles(.hidden)
                }
            }
            ForEach(parkGuides.filtered(state: filters.state, query: search.debounced)) { park in
                Annotation(park.name, coordinate: park.coordinate) {
                    Button { selectedPark = park; selectedPlace = nil } label: {
                        Image(systemName: park.status == "open" ? "leaf.fill" : "exclamationmark.triangle.fill")
                            .font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.surface)
                            .frame(width: 44, height: 44)
                            .background(park.status == "open" ? Palette.teal.base : Palette.terracotta.base, in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel("Park guide for \(park.name), \(park.statusLabel)")
                }.annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .tint(Palette.spruce.base)
        .ignoresSafeArea()
        .onAppear { centerOnUser(); fetchPlacesIfNeeded() }
        .onChange(of: locationManager.userLocation) { _, _ in
            if !hasCentered { centerOnUser() }
            fetchPlacesIfNeeded()
        }
    }

    // MARK: - Top bar (floating, kinetic)

    private var topBar: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    ClayIconTile(systemImage: "map.fill", kind: .spruce, size: 40, radius: Radius.chip)
                        .accessibilityHidden(true)
                        .breathing(scale: 1.05, duration: 3)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("DISCOVERED").font(VType.body(9, .bold)).tracking(1.6).foregroundStyle(Palette.inkSoft)
                        HStack(alignment: .firstTextBaseline, spacing: 3) {
                            CountUp(value: gameState.totalCollected)
                                .font(VType.num(24, .bold)).foregroundStyle(Palette.ink).monospacedDigit()
                            Text("/ \(collectiblePlaces.count)").font(VType.num(14, .bold)).foregroundStyle(Palette.inkFaint)
                        }
                    }
                }
                .padding(.vertical, 9).padding(.horizontal, 13)
                .background(ClayBackground(style: .surface, radius: Radius.md, elevation: 0.9))
                statusPill
                if placesService.places.contains(where: { $0.id.hasPrefix("osm-") }) {
                    OpenStreetMapCredit(asOf: placesService.osmDataDate)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Palette.surface.opacity(0.92), in: Capsule())
                }
            }
            Spacer()
            VStack(spacing: 12) {
                mapButton(icon: "location.fill") { centerOnUser() }
                mapButton(icon: "list.bullet") { Haptics.soft(); showList.toggle() }
                mapButton(icon: "camera.viewfinder") { showExploreBeta = true }
                    .accessibilityLabel("Open Explore view (beta)").accessibilityIdentifier("openExploreBeta")
                FilterButton(mode: .places)
                Toggle(isOn: Binding(get: { partners.layerEnabled }, set: { partners.setLayerEnabled($0) })) {
                    Text("Partners").frame(minWidth: 70, minHeight: 44)
                }
                    .font(VType.scaledBody(12, .semibold)).toggleStyle(.button)
                    .tint(Palette.gold.base).accessibilityLabel("Partners")
                    .accessibilityHint("Show or hide the partner map layer")
                    .accessibilityIdentifier("partnerMapLayer")
            }
            .breathing(scale: 1.03, duration: 3.4)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.top, Spacing.sm)
    }

    @ViewBuilder
    private var statusPill: some View {
        // Stored places (the area cache or the dated snapshot) are on the map while the mirrors are
        // asked, up to four at 25 s each; the pill is only for a map with nothing on it yet.
        if placesService.isLoading && placesService.places.isEmpty {
            pill(icon: nil, text: "Locating places…", tint: Palette.teal.base) {
                ProgressView().scaleEffect(0.6).tint(Palette.teal.base)
            }
        } else if !locationManager.isAuthorized {
            pill(icon: "location.slash.fill", text: QAData.offline ? "QA sample area · no GPS" : "Showing San Jose · no GPS",
                 tint: Palette.terracotta.base) { EmptyView() }
        }
    }

    private func pill<Leading: View>(icon: String?, text: String, tint: Color, @ViewBuilder leading: () -> Leading) -> some View {
        HStack(spacing: 5) {
            leading()
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .bold)) }
            Text(text).font(VType.body(11, .semibold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 11).padding(.vertical, 7)
        .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
    }

    private func mapButton(icon: String, action: @escaping () -> Void) -> some View {
        Button { Haptics.soft(); action() } label: {
            Image(systemName: icon).font(.system(size: 16, weight: .bold))
                .foregroundStyle(Palette.spruce.base).frame(width: 48, height: 48)
        }
        .buttonStyle(ClayPressButtonStyle(style: .surface, radius: 24, elevation: 0.8, hapticOnPress: false))
    }

    // MARK: - Nearby deck (swipeable, scroll-tilt)

    private var nearbyDeck: some View {
        VStack(alignment: .leading, spacing: 8) {
            KickerLabel(text: nearbyUncollected.isEmpty ? "Closest spots" : "Nearby · swipe to explore",
                        color: Palette.teal.base, dot: Palette.teal.base)
                .padding(.horizontal, Spacing.lg)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(deck) { collectible in
                        DeckCard(collectible: collectible,
                                 distance: locationManager.formattedDistance(to: collectible.coordinate),
                                 collected: gameState.isCollected(collectible.id),
                                 nearby: collectible.isNearby(from: locationManager.userLocation),
                                 onOpen: { select(collectible) },
                                 onCollect: { collect(collectible) })
                            // Size to the screen so one card shows with a clean
                            // peek of the next — never bleeds awkwardly off-edge.
                            .containerRelativeFrame(.horizontal, count: 4, span: 3, spacing: 14)
                            .scrollTransition(.interactive) { content, phase in
                                content
                                    .scaleEffect(phase.isIdentity ? 1 : 0.9)
                                    .rotation3DEffect(.degrees(phase.value * -8), axis: (x: 0, y: 1, z: 0))
                                    .opacity(phase.isIdentity ? 1 : 0.6)
                            }
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
        }
        .padding(.vertical, Spacing.md)
        .background(ClayBackground(style: .surface, radius: Radius.lg, elevation: 1.1).ignoresSafeArea(edges: .bottom))
    }

    // MARK: - Selected place card

    private func selectedPlaceCard(_ place: Place) -> some View {
        let collectible = placesService.collectible(for: place)
        let collected = collectible.map { gameState.isCollected($0.id) } ?? false
        let nearby = collectible?.isNearby(from: locationManager.userLocation) ?? false
        let distance = collectible.map { locationManager.formattedDistance(to: $0.coordinate) } ?? place.distance

        return VStack(spacing: Spacing.sm) {
            NavigationLink(value: place) {
                HStack(spacing: Spacing.md) {
                    PlacePlaceholder(icon: place.imagePlaceholder, color: place.category.accent.base, height: 70)
                        .accessibilityHidden(true)
                        .frame(width: 70)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(place.category.rawValue.uppercased()).font(VType.body(10, .bold)).tracking(0.6)
                                .foregroundStyle(place.category.accent.base)
                            if let c = collectible { RarityDot(rarity: c.rarity, size: 8) }
                            if collected {
                                Image(systemName: "checkmark.seal.fill").font(.system(size: 10))
                                    .foregroundStyle(Palette.teal.base)
                            }
                        }
                        Text(place.name).font(VType.display(17, .semibold)).foregroundStyle(Palette.ink)
                        HStack(spacing: Spacing.sm) {
                            Label(distance, systemImage: "location.fill")
                                .font(VType.num(11, .semibold)).foregroundStyle(Palette.inkFaint)
                            if let c = collectible, !collected { PointsBadge(points: c.pointValue) }
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Palette.spruce.base.opacity(0.6))
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            if let c = collectible, !collected, nearby {
                ClayButton("Collect  ·  +\(c.pointValue) pts", systemImage: "plus.circle.fill",
                           kind: .spruce, fullWidth: true) { collect(c) }
            }
        }
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.lg, elevation: 1.1)
        .overlay(alignment: .topTrailing) {
            Button { withAnimation(.spring(response: 0.3)) { selectedPlace = nil } } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 22))
                    .foregroundStyle(Palette.inkFaint).padding(10)
            }
        }
    }

    // MARK: - Actions

    private func select(_ c: CollectiblePlace) {
        Haptics.soft()
        withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) { selectedPlace = c.place }
        withAnimation(.easeInOut(duration: 0.5)) {
            position = .region(MKCoordinateRegion(center: c.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)))
        }
    }

    private func collect(_ c: CollectiblePlace) {
        let pts = gameState.collectPlace(c, userCoordinate: locationManager.userLocation?.coordinate)
        guard pts > 0 else { return }
        celebrationCollectible = c
        celebrationPoints = pts
        Haptics.success()
        withAnimation(.spring(response: 0.4)) { showCelebration = true }
    }

    // MARK: - List sheet

    private var mapListSheet: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(parkGuides.filtered(state: filters.state, query: search.debounced)) { park in
                        NavigationLink { ParkGuideView(parkID: park.id) } label: { ParkGuideRow(park: park) }.buttonStyle(.plain)
                    }
                    ForEach(collectiblePlaces) { collectible in
                        let collected = gameState.isCollected(collectible.id)
                        let dist = locationManager.formattedDistance(to: collectible.coordinate)
                        HStack(spacing: Spacing.md) {
                            ClayIconTile(systemImage: collectible.place.category.icon,
                                         kind: collectible.rarity.clayKind, size: 44, radius: Radius.chip)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(collectible.place.name).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink)
                                HStack(spacing: 8) {
                                    Text(dist).font(VType.num(12, .semibold)).foregroundStyle(Palette.inkSoft)
                                    RarityBadge(rarity: collectible.rarity, size: .small)
                                }
                            }
                            Spacer()
                            if collected {
                                Image(systemName: "checkmark.seal.fill").font(.system(size: 18, weight: .bold))
                                    .foregroundStyle(Palette.teal.base)
                            } else { PointsBadge(points: collectible.pointValue) }
                        }
                        .padding(Spacing.sm)
                        .claySurface(.surface, radius: Radius.md, elevation: 0.7)
                        .onTapGesture { showList = false; select(collectible) }
                    }
                }
                .padding(Spacing.md)
            }
            // The map hides its navigation bar, so the standard search field lives
            // here in the list sheet; the map's pins follow the same query.
            .searchable(text: Bindable(search).text, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search places on the map")
            .onSubmit(of: .search) { search.commit(into: filters) }
            .onChange(of: collectiblePlaces.count) { _, count in
                AccessibilityNotification.Announcement("\(count) \(count == 1 ? "place" : "places")").post()
            }
            .background(VerdureBackground())
            .navigationTitle("All Places").navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Helpers

    private func fetchPlacesIfNeeded() {
        let usingFallback = locationManager.userLocation == nil
        guard !hasFetched || (fetchedFallback && !usingFallback) else { return }
        hasFetched = true
        fetchedFallback = usingFallback
        Task { await placesService.fetchNearbyPlaces(around: locationManager.userCoordinate) }
    }

    private func centerOnUser() {
        let hasGPS = locationManager.userLocation != nil
        let center = locationManager.userCoordinate
        let delta = hasGPS ? 0.035 : 0.12
        withAnimation(.easeInOut(duration: 0.5)) {
            position = .region(MKCoordinateRegion(center: center,
                span: MKCoordinateSpan(latitudeDelta: delta, longitudeDelta: delta)))
        }
        hasCentered = hasGPS
    }
}

// MARK: - Deck card (swipeable poster)

private struct DeckCard: View {
    let collectible: CollectiblePlace
    let distance: String
    let collected: Bool
    let nearby: Bool
    let onOpen: () -> Void
    let onCollect: () -> Void
    private var accent: ClayAccent { collectible.rarity.accent }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .fill(collectible.place.category.accent.faceGradient)
                    .frame(height: 88)
                    .overlay {
                        Image(systemName: collectible.place.category.icon)
                            .accessibilityHidden(true)
                            .font(.system(size: 38, weight: .semibold))
                            .foregroundStyle(collectible.place.category.accent.onColor.opacity(0.92))
                    }
                if collected {
                    Image(systemName: "checkmark.seal.fill").font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white).padding(8)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            .accessibilityHidden(true)
            .padding(.bottom, 10)

            HStack(spacing: 6) {
                RarityBadge(rarity: collectible.rarity, size: .small)
                Spacer()
                Text(distance).font(VType.num(11, .bold)).foregroundStyle(Palette.inkSoft)
            }
            Text(collectible.place.name).font(VType.display(16, .semibold))
                .foregroundStyle(Palette.ink).lineLimit(1).padding(.top, 6)

            if !collected && nearby {
                ClayButton("Collect · +\(collectible.pointValue)", systemImage: "plus.circle.fill",
                           kind: .spruce, fullWidth: true) { onCollect() }
                    .padding(.top, 10)
            } else {
                Button(action: onOpen) {
                    HStack { Text(collected ? "View" : "Locate").font(VType.body(13, .bold))
                        Spacer()
                        Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .bold)) }
                        .foregroundStyle(Palette.spruce.base)
                        .padding(.vertical, 11).padding(.horizontal, 4).frame(minHeight: 44)
                }
                .accessibilityLabel("\(collected ? "View" : "Locate") \(collectible.place.name)")
                .padding(.top, 6)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .claySurface(.surface, radius: Radius.md, elevation: 1)
        .contentShape(Rectangle())
        .onTapGesture { onOpen() }
    }
}

// MARK: - Clay map pin

private struct ClayMapPin: View {
    let collectible: CollectiblePlace
    let isSelected: Bool
    let isCollected: Bool
    let isNearby: Bool

    private var isNearbyUncollected: Bool { !isCollected && isNearby }
    private var accent: ClayAccent { collectible.rarity.accent }
    private var pinSize: CGFloat { isSelected ? 52 : 40 }

    var body: some View {
        VStack(spacing: -2) {
            ZStack {
                if isNearbyUncollected {
                    PulseHalo(color: accent.base, size: 58, lineWidth: 2)
                }
                Circle()
                    .fill(isCollected ? AnyShapeStyle(Palette.surface) : AnyShapeStyle(accent.faceGradient))
                    .frame(width: pinSize, height: pinSize)
                    .overlay(Circle().strokeBorder(.white.opacity(0.25), lineWidth: 1))
                    .shadow(color: accent.depth.opacity(0.45), radius: 5, x: 2, y: 3)
                    .shadow(color: Palette.surfaceLight.opacity(0.7), radius: 3, x: -2, y: -2)
                Image(systemName: collectible.place.category.icon)
                    .font(.system(size: isSelected ? 21 : 16, weight: .bold))
                    .foregroundStyle(isCollected ? accent.base.opacity(0.5) : accent.onColor)
                if isCollected {
                    Image(systemName: "checkmark.seal.fill").font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Palette.teal.base)
                        .background(Circle().fill(Palette.surface).frame(width: 12, height: 12))
                        .offset(x: pinSize * 0.34, y: -pinSize * 0.34)
                }
            }
            .animation(.spring(response: 0.3), value: isSelected)
            Triangle()
                .fill(isCollected ? AnyShapeStyle(Palette.surface) : AnyShapeStyle(accent.base))
                .frame(width: 14, height: 8)
                .shadow(color: accent.depth.opacity(0.3), radius: 2, y: 2)
        }
    }
}

// MARK: - Clay radar sweep (big, prominent)

private struct ClayRadarSweep: View {
    @State private var sweep = false
    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .stroke(Palette.teal.base.opacity(0.32 - Double(i) * 0.08), lineWidth: 1.5)
                    .frame(width: 80 + CGFloat(i) * 58, height: 80 + CGFloat(i) * 58)
            }
            PulseHalo(color: Palette.teal.base, size: 90, lineWidth: 2)
            Circle()
                .fill(AngularGradient(gradient: Gradient(stops: [
                    .init(color: Palette.teal.base.opacity(0.0), location: 0.0),
                    .init(color: Palette.teal.base.opacity(0.0), location: 0.55),
                    .init(color: Palette.teal.base.opacity(0.4), location: 0.92),
                    .init(color: Palette.spruce.base.opacity(0.6), location: 1.0),
                ]), center: .center))
                .frame(width: 196, height: 196)
                .mask(Circle().frame(width: 196, height: 196))
                .rotationEffect(.degrees(sweep ? 360 : 0))
            Circle()
                .fill(Palette.spruce.faceGradient)
                .frame(width: 18, height: 18)
                .overlay(Circle().strokeBorder(.white.opacity(0.4), lineWidth: 1))
                .shadow(color: Palette.spruce.depth.opacity(0.5), radius: 3, x: 1, y: 1)
                .breathing(scale: 1.3, duration: 1.4)
        }
        .frame(width: 196, height: 196)
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.linear(duration: 4).repeatForever(autoreverses: false)) { sweep = true }
        }
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

#Preview {
    MapExploreView()
        .environment(GameStateManager())
        .environment(LocationManager())
        .environment(PlacesAPIService())
        .environment(DiscoveryFilters())
        .environment(PartnerDiscoveryService())
        .environment(ParkGuideService())
        .environment(AuthService())
}
