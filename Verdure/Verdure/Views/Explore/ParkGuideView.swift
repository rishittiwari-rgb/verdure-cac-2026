import SwiftUI
import MapKit

struct ParkDirectoryView: View {
    @Environment(ParkGuideService.self) private var service
    @Environment(DiscoveryFilters.self) private var filters
    @Environment(LocationManager.self) private var location
    @State private var search = ""

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.md) {
                Text("Plan a park day").font(VType.display(30, .semibold))
                Text("Playgrounds, amenities and this week's events from published sources.")
                    .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                FilterButton(mode: .places)
                NavigationLink { OfflinePacksView() } label: {
                    Label("Offline park and place packs", systemImage: "arrow.down.circle").font(VType.body(15, .semibold)).frame(minHeight: 44)
                }.tint(Palette.spruce.base)
                if service.isLoading { ProgressView("Loading park guides") }
                if let error = service.lastError {
                    Text(error).font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                    Button("Retry") { Task { await service.load(around: location.userCoordinate, radiusMiles: filters.state.radiusMiles, force: true) } }
                }
                if service.refreshDelayed {
                    Text("Showing the last complete park update. The latest refresh is delayed.").font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                }
                let results = service.filtered(state: filters.state, query: search)
                // A short list (any search) lays out eagerly: lazily, the mixed row
                // heights left the stack's height estimate short and the last result
                // could not be scrolled into view (iPhone 16 Pro, 2026-10-22).
                if results.count <= 100 {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(results) { park in parkLink(park) }
                    }
                } else {
                    ForEach(results) { park in parkLink(park) }
                }
                if !service.isLoading && service.lastError == nil && results.isEmpty {
                    Text("No park guides match these choices. Try a wider radius or fewer filters.").font(VType.body(15))
                }
            }.padding(Spacing.md).padding(.bottom, 110)
        }
        .background(VerdureBackground()).navigationTitle("Park guides").navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search parks")
        .toolbar(.visible, for: .navigationBar)
        .task(id: "\(location.userCoordinate.latitude),\(location.userCoordinate.longitude),\(filters.state.radiusMiles)") {
            await service.load(around: location.userCoordinate, radiusMiles: filters.state.radiusMiles)
        }
        .refreshable { await service.load(around: location.userCoordinate, radiusMiles: filters.state.radiusMiles, force: true) }
    }

    private func parkLink(_ park: ParkSummary) -> some View {
        NavigationLink { ParkGuideView(parkID: park.id) } label: { ParkGuideRow(park: park) }
            .buttonStyle(.plain).accessibilityIdentifier("park-guide:\(park.id)")
    }
}

struct ParkGuideRow: View {
    let park: ParkSummary
    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Image(systemName: "leaf.fill").foregroundStyle(Palette.spruce.base).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(park.name).font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
                Text(park.statusLabel).font(VType.body(13, .semibold))
                    .foregroundStyle(park.status == "open" ? Palette.inkSoft : Palette.terracotta.base)
                if let distance = park.distanceMiles {
                    Text(String(format: "%.1f mi to park boundary", distance)).font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                }
                Text(park.credit.publisher).font(VType.body(12)).foregroundStyle(Palette.inkSoft)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(Palette.inkSoft).accessibilityHidden(true)
        }.padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
            .claySurface(.surface, radius: Radius.md).accessibilityElement(children: .combine)
    }
}

struct ParkGuideView: View {
    let parkID: String
    var snapshot: ParkGuide? = nil
    var snapshotOwnerUid: String? = nil
    var snapshotExpiresAtMs: Double? = nil
    @Environment(ParkGuideService.self) private var service
    @Environment(AuthService.self) private var auth
    @State private var guide: ParkGuide?
    @State private var error: String?
    @State private var loading = false
    @State private var loadedAccount = ""
    @State private var requestID = UUID()

    var body: some View {
        Group {
            if let uid = snapshotOwnerUid, let expiry = snapshotExpiresAtMs {
                OfflineSnapshotGuard(ownerUid: uid, expiresAtMs: expiry) { content }
            } else { content }
        }
    }
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if let guide, loadedAccount == (auth.currentUser?.uid ?? "guest") {
                    header(guide)
                    amenities(guide)
                    visitDetails(guide)
                    PlaceStorySection(placeID: parkID, offlineStory: snapshot == nil ? nil : guide.story)
                    events(guide)
                    trails(guide)
                    credits(guide)
                } else if loading { ProgressView("Loading park guide").frame(maxWidth: .infinity) }
                if let error {
                    Text(error).font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                    Button("Try again") { Task { await load() } }.frame(minHeight: 44)
                }
            }.padding(Spacing.md).padding(.bottom, 110)
        }
        .background(VerdureBackground()).navigationTitle("Park guide").navigationBarTitleDisplayMode(.inline)
        // Events are filtered for the signed-in profile. Never keep an old
        // account's event response visible after sign-out or account switching.
        .task(id: parkID + ":" + (auth.currentUser?.uid ?? "guest")) { await load() }
        .refreshable { await load() }
    }

    @MainActor private func load() async {
        let uid = auth.currentUser?.uid
        if let snapshot {
            guard uid == snapshotOwnerUid else { guide = nil; return }
            guide = snapshot; loadedAccount = uid ?? "guest"; loading = false; return
        }
        let token = UUID(); requestID = token
        guide = nil; error = nil; loading = true
        do {
            let response = try await service.guide(id: parkID)
            guard !Task.isCancelled, uid == auth.currentUser?.uid, requestID == token else { return }
            loadedAccount = uid ?? "guest"
            guide = response; loading = false
        } catch {
            guard !Task.isCancelled, uid == auth.currentUser?.uid, requestID == token else { return }
            self.error = error.localizedDescription; loading = false
        }
    }

    private func header(_ guide: ParkGuide) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if snapshot == nil {
                NavigationLink { OfflinePackBuilderView(initialParkID: parkID) } label: {
                    Label("Download for offline use", systemImage: "arrow.down.circle").font(VType.body(15, .semibold)).frame(minHeight: 44)
                }.tint(Palette.spruce.base)
            }
            Text(guide.park.name).font(VType.display(34, .bold)).foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
            Text(guide.park.statusLabel).font(VType.body(17, .semibold))
                .foregroundStyle(guide.park.status == "open" ? Palette.spruce.base : Palette.terracotta.base)
                .accessibilityIdentifier("parkStatus")
            if guide.park.status != "open" {
                Text("This site is not listed as open. Published amenities describe the site and do not confirm access.")
                    .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
            }
            if !guide.park.address.isEmpty { Text(guide.park.address).font(VType.body(14)) }
            ForEach(guide.park.ages.filter { $0.count == 2 }, id: \.self) { ages in
                Text("Good for ages \(ages[0])–\(ages[1])").font(VType.body(16, .semibold))
            }
            if !guide.park.ages.isEmpty {
                Text("From the published playground age types.").font(VType.body(12)).foregroundStyle(Palette.inkSoft)
            }
            if guide.refreshDelayed {
                Text("The latest data refresh is delayed. Showing the last complete update.").font(VType.body(13)).foregroundStyle(Palette.inkSoft)
            }
            if let ms = guide.publishedAtMs {
                Text("Data updated \(Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .omitted))")
                    .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
            }
            officialLink(guide.park.officialURL, title: "Check the park's official site")
            Text(guide.park.credit.attribution).font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                .accessibilityIdentifier("parkAttribution")
            if !guide.trails.isEmpty {
                NavigationLink {
                    if let uid = snapshotOwnerUid, let expiry = snapshotExpiresAtMs {
                        OfflineSnapshotGuard(ownerUid: uid, expiresAtMs: expiry) { ParkTrailMapView(guide: guide) }
                    } else { ParkTrailMapView(guide: guide) }
                } label: {
                    Label("View trail lines", systemImage: "map").font(VType.body(16, .semibold)).frame(minHeight: 44)
                }.tint(Palette.spruce.base).accessibilityIdentifier("parkTrailMap")
            }
        }
    }

    private func amenities(_ guide: ParkGuide) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            heading("Confirmed amenities")
            Text("Presence is confirmed by published data. Availability can change.").font(VType.body(13)).foregroundStyle(Palette.inkSoft)
            if guide.amenities.isEmpty { Text("No amenities are confirmed in the current data.").font(VType.body(14)) }
            ForEach(guide.amenities) { amenity in
                VStack(alignment: .leading, spacing: 3) {
                    Text(amenity.label).font(VType.body(15, .semibold))
                    Text(amenity.name).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                    Text(amenity.status == "open" ? "Listed open" : amenity.status == "unknown" ? "Availability not published" : "\(amenity.status.capitalized): check availability")
                        .font(VType.body(13, .semibold)).foregroundStyle(amenity.status == "open" || amenity.status == "unknown" ? Palette.inkSoft : Palette.terracotta.base)
                    if let ages = amenity.ages, ages.count == 2 {
                        Text("Ages \(ages[0])–\(ages[1])").font(VType.body(13))
                    }
                }.padding(.vertical, 5).accessibilityElement(children: .combine)
            }
        }.padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading).claySurface(.surface, radius: Radius.md)
    }

    private func visitDetails(_ guide: ParkGuide) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            heading("Before you go")
            Text(guide.hours.map { "Hours: " + $0 } ?? "Hours are not published in this park dataset. Check the official site.").font(VType.body(14))
            if guide.accessibility.isEmpty {
                Text("Accessibility details are not published in this park dataset.").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
            }
            ForEach(guide.accessibility, id: \.self) { Text($0).font(VType.body(14)) }
            ForEach(guide.entrances) { entry in
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.name).font(VType.body(14, .semibold))
                    if let detail = entry.entranceDetails { Text(detail).font(VType.body(14)) }
                }
            }
        }
    }

    private func events(_ guide: ParkGuide) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            heading("Here this week")
            if guide.events.isEmpty { Text("No public events are listed here for the next seven days.").font(VType.body(14)).foregroundStyle(Palette.inkSoft) }
            ForEach(guide.events) { event in
                NavigationLink {
                    if let uid = snapshotOwnerUid, let expiry = snapshotExpiresAtMs {
                        OfflineSnapshotGuard(ownerUid: uid, expiresAtMs: expiry) {
                            ParkEventDetail(event: event, viewOnly: true)
                        }
                    } else { ParkEventDetail(event: event) }
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(event.title).font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
                        Text(event.date.formatted(date: .abbreviated, time: .shortened)).font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        Text(event.organizer).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                    }.padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading).claySurface(.surface, radius: Radius.md)
                }.buttonStyle(.plain).accessibilityIdentifier("park-event:\(event.id)")
            }
        }
    }

    private func trails(_ guide: ParkGuide) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            heading("Trails in this park")
            ParkTrailNotice(officialURL: guide.park.officialURL)
            if guide.trails.isEmpty { Text("No trail lines are published for this park in the current data.").font(VType.body(14)).foregroundStyle(Palette.inkSoft) }
            else {
                ForEach(guide.trails) { trail in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(trail.name).font(VType.display(20, .semibold))
                        Text(guide.park.status != "open" ? "Park: \(guide.park.statusLabel). Trail access is not confirmed." :
                             trail.status == "open" && trail.publicAccess ? "Listed open for public use" : "\(trail.status.capitalized): check access before visiting")
                            .font(VType.body(14, .semibold)).foregroundStyle(guide.park.status == "open" && trail.status == "open" && trail.publicAccess ? Palette.inkSoft : Palette.terracotta.base)
                        if let miles = trail.lengthMiles { Text(String(format: "Length: %.2f mi", miles)).font(VType.body(14)) }
                        if let type = trail.recreationType { Text("Type: \(type)").font(VType.body(14)) }
                        if let route = trail.routeType { Text("Route: \(route)").font(VType.body(14)) }
                        if let width = trail.width, let unit = trail.widthUnit { Text("Width: \(width.formatted()) \(unit)").font(VType.body(14)) }
                        else if let widthClass = trail.widthClass { Text("Width: \(widthClass)").font(VType.body(14)) }
                        if let elevation = trail.elevation { Text("Source elevation: \(elevation.formatted())").font(VType.body(14)) }
                        if let surface = trail.surface { Text("Surface: \(surface)").font(VType.body(14)) }
                        Text("Dogs: \(trail.dogs)").font(VType.body(14))
                    }.padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading).claySurface(.surface, radius: Radius.md)
                }
            }
        }
    }

    private func credits(_ guide: ParkGuide) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            heading("Sources")
            ForEach(guide.credits, id: \.datasetURL) { credit in
                VStack(alignment: .leading, spacing: 4) {
                    Text(credit.attribution).font(VType.body(13)).accessibilityIdentifier("parkAttribution")
                    officialLink(credit.datasetURL, title: "Dataset from \(credit.publisher)")
                    officialLink(credit.licenseURL, title: "License and terms")
                }
            }
            Text("Source geometry is normalized and joined to nearby features. No endorsement by the data publishers is implied.")
                .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
        }
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(VType.display(24, .semibold)).foregroundStyle(Palette.ink).accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private func officialLink(_ value: String, title: String) -> some View {
        if let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
            Link(title, destination: url).font(VType.body(14, .semibold)).tint(Palette.spruce.base).frame(minHeight: 44)
        }
    }
}

private struct ParkEventDetail: View {
    let event: ParkEvent
    var viewOnly = false
    @State private var showEvent = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(event.title).font(VType.display(30, .semibold))
                Text(event.date.formatted(date: .complete, time: .shortened)).font(VType.body(16))
                Text(event.organizer).font(VType.body(15, .semibold))
                Text(event.locationName).font(VType.body(15))
                if !event.description.isEmpty { Text(event.description).font(VType.body(15)) }
                if let min = event.minimumAge { Text("Minimum age: \(min)").font(VType.body(14)) }
                if let max = event.maximumAge { Text("Maximum age: \(max)").font(VType.body(14)) }
                if let free = event.isFree { Text(free ? "Free" : "Paid event").font(VType.body(14)) }
                if viewOnly || !NetworkStatus.shared.isOnline {
                    Text("RSVP and check-in are available when you're back online.").font(VType.body(14, .semibold))
                } else {
                    Button("Open event actions") { showEvent = true }.frame(minHeight: 44).tint(Palette.spruce.base)
                }
                if let value = event.website, let url = URL(string: value), ["http", "https"].contains(url.scheme ?? "") {
                    Link("Official event listing", destination: url).frame(minHeight: 44).tint(Palette.spruce.base)
                }
            }.padding(Spacing.md)
        }.background(VerdureBackground()).navigationTitle("Event details").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showEvent) { EventDeepLinkSheet(eventId: event.id) }
    }
}

struct ParkTrailNotice: View {
    let officialURL: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Trail information comes from official sources and may be out of date. Follow posted signs and check the park's official site for closures.")
                .font(VType.body(13)).foregroundStyle(Palette.inkSoft).fixedSize(horizontal: false, vertical: true)
            if let url = URL(string: officialURL), url.scheme == "https" {
                Link("Official closures and park information", destination: url).font(VType.body(14, .semibold)).frame(minHeight: 44).tint(Palette.spruce.base)
            }
        }.accessibilityIdentifier("parkTrailNotice")
    }
}

struct ParkTrailMapView: View {
    let guide: ParkGuide
    private var region: MKCoordinateRegion {
        let b = guide.park.bounds
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (b.south + b.north) / 2, longitude: (b.west + b.east) / 2),
            span: MKCoordinateSpan(latitudeDelta: max(0.005, (b.north - b.south) * 1.2), longitudeDelta: max(0.005, (b.east - b.west) * 1.2)))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Map(initialPosition: .region(region)) {
                UserAnnotation()
                if let boundary = guide.park.geometry {
                    ForEach(Array(boundary.coordinatePaths.enumerated()), id: \.offset) { _, line in
                        MapPolyline(coordinates: line).stroke(Palette.spruce.base, style: StrokeStyle(lineWidth: 2, dash: [5, 3]))
                    }
                }
                ForEach(guide.trails) { trail in
                    ForEach(Array(trail.geometry.coordinatePaths.enumerated()), id: \.offset) { _, line in
                        MapPolyline(coordinates: line).stroke(guide.park.status == "open" && trail.status == "open" && trail.publicAccess ? Palette.teal.base : Palette.terracotta.base, lineWidth: 4)
                    }
                }
            }.mapStyle(.standard(pointsOfInterest: .excludingAll)).mapControls { MapUserLocationButton(); MapCompass() }
                .accessibilityLabel("Published trail lines and park boundary. No route guidance.")
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(guide.park.statusLabel).font(VType.body(14, .semibold))
                        .foregroundStyle(guide.park.status == "open" ? Palette.ink : Palette.terracotta.base)
                    ForEach(Array(Set(guide.credits.map(\.attribution))).sorted(), id: \.self) { attribution in
                        Text(attribution).font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                    }
                    ParkTrailNotice(officialURL: guide.park.officialURL)
                    Text("Dashed green: park boundary. Teal: trails listed open for public use. Terracotta: other access status. These lines do not provide navigation.")
                        .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                    Text("Background map imagery is supplied by the system and may be unavailable without a connection.").font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                }.padding(Spacing.md)
            }.frame(maxHeight: 240)
        }.padding(.bottom, 100).background(VerdureBackground()).navigationTitle(guide.park.name).navigationBarTitleDisplayMode(.inline)
    }
}
