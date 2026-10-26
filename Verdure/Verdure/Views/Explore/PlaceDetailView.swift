import SwiftUI
import MapKit

struct PlaceDetailView: View {
    let place: Place
    @State private var showCelebration = false
    @State private var celebrationPoints = 0
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(GameStateManager.self) private var gameState
    @Environment(PlacesAPIService.self) private var placesService
    @Environment(EventsAPIService.self) private var eventsService
    @Environment(LocationManager.self) private var locationManager
    @Environment(ParkGuideService.self) private var parkGuides
    @State private var matchedParks: [ParkSummary] = []
    @State private var parkMatchError = false

    private var isSaved: Bool { gameState.isPlaceSaved(place.id) }

    /// Non-park venues use real coordinates; full park-week events are in the
    /// geometry-matched guide below, independent of the current feed cache.
    private var eventsHere: [Event] {
        guard let coordinate = place.coordinate else { return [] }
        let venue = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        return eventsService.events.filter { event in
            guard event.date > Date(), event.virtual != true, let point = event.coordinate else { return false }
            return venue.distance(from: CLLocation(latitude: point.latitude, longitude: point.longitude)) <= 50
        }.sorted { $0.date < $1.date }
    }

    /// Open Apple Maps with directions to the place (real coords when known).
    private func openDirections() {
        Haptics.tap()
        if let coord = place.coordinate {
            let item = MKMapItem(placemark: MKPlacemark(coordinate: coord))
            item.name = place.name
            item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
        } else {
            let query = place.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            if let url = URL(string: "http://maps.apple.com/?daddr=\(query)&dirflg=d") { openURL(url) }
        }
    }

    private var collectible: CollectiblePlace? {
        placesService.collectible(for: place)
    }
    private var isCollected: Bool {
        guard let c = collectible else { return false }
        return gameState.isCollected(c.id)
    }
    private var kind: ClayStyle.ClayAccentKind { place.category.clayKind }

    var body: some View {
        ZStack {
            VerdureBackground()

            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    hero
                    quickStats
                    aboutSection
                    PlaceStorySection(placeID: place.id)
                    parkGuideLinks
                    actions
                    eventsSection
                    if place.id.hasPrefix("osm-") {
                        OpenStreetMapCredit(asOf: placesService.osmDataDate)
                    }
                }
                .padding(Spacing.md)
                .padding(.bottom, 110)   // clear the floating tab bar: the OpenStreetMap credit is the last row
            }
            .task(id: place.id) {
                matchedParks = []; parkMatchError = false
                guard let coordinate = place.coordinate else { return }
                do {
                    let parks = try await parkGuides.matching(coordinate)
                    guard !Task.isCancelled else { return }
                    matchedParks = parks
                } catch { if !Task.isCancelled { parkMatchError = true } }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: "\(place.name) — found on Verdure. \(place.shortDescription)") {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 15, weight: .semibold))
                    }
                    .tint(Palette.ink)
                    .accessibilityLabel("Share \(place.name)")
                }
            }

            if showCelebration, let c = collectible {
                CollectionCelebrationView(collectible: c, pointsEarned: celebrationPoints) {
                    withAnimation { showCelebration = false }
                }
                .transition(.opacity)
            }
        }
    }

    // MARK: - Hero

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .fill(kind.accent.faceGradient)
                .frame(height: 250)
                .overlay {
                    if let urlString = place.photoURL, let url = URL(string: urlString) {
                        // Real photo from the place's source (NPS/RecGov/OSM).
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                                .overlay(LinearGradient(colors: [.clear, .black.opacity(0.45)],
                                                        startPoint: .center, endPoint: .bottom))
                        } placeholder: {
                            Image(systemName: place.imagePlaceholder)
                                .font(.system(size: 150, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.16))
                                .rotationEffect(.degrees(-8))
                                .offset(x: 70, y: 10)
                        }
                        .frame(height: 250)
                    } else {
                        Image(systemName: place.imagePlaceholder)
                            .font(.system(size: 150, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.16))
                            .rotationEffect(.degrees(-8))
                            .offset(x: 70, y: 10)
                            .clipped()
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                        .strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                .shadow(color: kind.accent.depth.opacity(0.5), radius: 24, x: 10, y: 14)
                .parallaxTilt(magnitude: 5, shadow: false)

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    if let c = collectible { RarityBadge(rarity: c.rarity) }
                    if isCollected {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.seal.fill").font(.system(size: 11, weight: .bold))
                            Text("COLLECTED").font(VType.body(10, .bold)).tracking(0.6)
                        }
                        .foregroundStyle(Palette.teal.onColor)
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(ClayBackground(style: .accent(.teal), radius: Radius.chip, elevation: 0.3))
                    }
                }
                HStack(spacing: 6) {
                    Image(systemName: place.category.icon).font(.system(size: 11, weight: .bold))
                    Text(place.category.rawValue.uppercased()).font(VType.body(11, .bold)).tracking(0.8)
                }
                .foregroundStyle(kind.accent.onColor.opacity(0.85))
                Text(place.name)
                    .font(VType.display(30, .bold))
                    .foregroundStyle(kind.accent.onColor)
                    .lineLimit(2).minimumScaleFactor(0.7)
                    .shadow(color: kind.accent.depth.opacity(0.4), radius: 4, x: 1, y: 2)
            }
            .padding(Spacing.lg)
        }
    }

    // MARK: - Quick stats

    private var quickStats: some View {
        HStack(spacing: 10) {
            statWell(place.distance, "Away", "location.fill", Palette.teal.base)
            if let rating = place.rating {   // only REAL ratings are shown
                statWell(String(format: "%.1f", rating), "\(place.reviewCount ?? 0) reviews", "star.fill", Palette.gold.base)
            }
            if let c = collectible {
                statWell("\(c.pointValue)", c.rarity.rawValue, c.rarity.icon, c.rarity.accent.base)
            } else {
                statWell(place.isFeatured ? "Yes" : "—", "Featured", "sparkles", Palette.spruce.base)
            }
        }
    }

    private func statWell(_ value: String, _ label: String, _ icon: String, _ tint: Color) -> some View {
        VStack(spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundStyle(tint)
                Text(value).font(VType.num(16, .bold)).foregroundStyle(Palette.ink)
            }
            Text(label).font(VType.body(11, .medium)).foregroundStyle(Palette.inkSoft)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
        .background(ClayBackground(style: .inset, radius: Radius.sm))
    }

    // MARK: - About

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("About").font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
            Text(place.shortDescription)
                .font(VType.body(15)).foregroundStyle(Palette.inkSoft).lineSpacing(4)

            Divider().background(Palette.surfaceShadow.opacity(0.4))

            if let hours = place.openHoursReal, !hours.isEmpty {
                Text("Hours: \(hours)").font(VType.body(14)).foregroundStyle(Palette.ink)
            } else {
                Text("Hours are not published for this place. Check its official source before visiting.")
                    .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
            }
            Text("Confirmed park amenities and accessibility details appear in the park guide where data is available.")
                .font(VType.body(13)).foregroundStyle(Palette.inkSoft)

        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .claySurface(.surface, radius: Radius.md)
    }

    @ViewBuilder private var parkGuideLinks: some View {
        if !matchedParks.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Park guides at this location").font(VType.display(22, .semibold))
                ForEach(matchedParks) { park in
                    NavigationLink { ParkGuideView(parkID: park.id) } label: { ParkGuideRow(park: park) }.buttonStyle(.plain)
                }
            }
        } else if parkMatchError {
            Text("Park data couldn't be checked for this location. Try again when connected.")
                .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
        }
    }

    // MARK: - Actions

    private var actions: some View {
        VStack(spacing: Spacing.sm) {
            collectButton
            HStack(spacing: Spacing.sm) {
                ClayButton("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill",
                           kind: .teal, fullWidth: true) { openDirections() }
                ClayButton(isSaved ? "Saved" : "Save", systemImage: isSaved ? "bookmark.fill" : "bookmark",
                           kind: .ghost, fullWidth: true) {
                    withAnimation(.spring(response: 0.3)) { gameState.togglePlaceSaved(place.id) }
                }
            }
        }
    }

    @ViewBuilder
    private var collectButton: some View {
        if let c = collectible {
            if isCollected {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.teal.base)
                        .font(.system(size: 18, weight: .bold))
                    Text("Collected").font(VType.body(16, .bold)).foregroundStyle(Palette.ink)
                    Spacer()
                    PointsBadge(points: c.pointValue, prefix: "")
                }
                .padding(Spacing.md)
                .claySurface(.surface, radius: Radius.md)
            } else if c.isNearbyStatic {
                ClayButton("Collect  ·  +\(c.pointValue) pts", systemImage: "plus.circle.fill",
                           kind: .spruce, fullWidth: true) {
                    celebrationPoints = gameState.collectPlace(c, userCoordinate: locationManager.userLocation?.coordinate)
                    Haptics.success()
                    withAnimation(.spring(response: 0.4)) { showCelebration = true }
                }
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "location.slash.fill").foregroundStyle(Palette.inkFaint)
                    Text("Too far to collect").font(VType.body(15, .semibold)).foregroundStyle(Palette.inkSoft)
                    Spacer()
                    Text(place.distance).font(VType.num(13, .semibold)).foregroundStyle(Palette.inkFaint)
                    PointsBadge(points: c.pointValue)
                }
                .padding(Spacing.md)
                .background(ClayBackground(style: .inset, radius: Radius.md))
            }
        }
    }

    // MARK: - Events

    private var eventsSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Upcoming Events Here").font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
            if eventsHere.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "calendar").foregroundStyle(Palette.inkFaint)
                    Text("No upcoming events at this location.")
                        .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                    Spacer()
                }
                .padding(Spacing.md)
                .background(ClayBackground(style: .inset, radius: Radius.md))
            } else {
                ForEach(eventsHere.prefix(3)) { event in
                    HStack(spacing: Spacing.md) {
                        ClayIconTile(systemImage: event.imagePlaceholder,
                                     kind: event.category.clayKind, size: 42, radius: Radius.chip)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title).font(VType.display(14, .semibold)).foregroundStyle(Palette.ink)
                                .lineLimit(1)
                            Text("\(event.date.formatted(date: .abbreviated, time: .omitted)) · \(event.displayTime)")
                                .font(VType.body(12)).foregroundStyle(Palette.inkSoft).lineLimit(1)
                        }
                        Spacer()
                        PointsBadge(points: event.pointValue)
                    }
                    .padding(Spacing.sm)
                    .claySurface(.surface, radius: Radius.md, elevation: 0.7)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        PlaceDetailView(place: SampleData.places[0])
            .environment(GameStateManager())
            .environment(PlacesAPIService())
            .environment(EventsAPIService())
            .environment(LocationManager())
            .environment(ParkGuideService())
            .environment(AuthService())
    }
}
