import SwiftUI
import MapKit

/// Keeps the member's saved snapshot out of another account's navigation stack,
/// and removes it from view as soon as its seven-day lifetime ends.
struct OfflineSnapshotGuard<Content: View>: View {
    let ownerUid: String, expiresAtMs: Double
    @Environment(AuthService.self) private var auth
    @ViewBuilder let content: () -> Content
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            if auth.currentUser?.uid == ownerUid && context.date.timeIntervalSince1970 * 1000 < expiresAtMs {
                content()
            } else {
                ContentUnavailableView("Pack unavailable", systemImage: "clock.badge.exclamationmark",
                                       description: Text("This pack expired or belongs to a different account. Download a fresh pack when online."))
            }
        }
    }
}

struct OfflinePacksView: View {
    @Environment(OfflinePackService.self) private var service
    @Environment(PlacesAPIService.self) private var places
    @Environment(GameStateManager.self) private var game
    @State private var error: String?
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { _ in storageContent }
    }
    private var storageContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("Take your park day with you").font(VType.display(30, .semibold))
                Text("Download park guides, trail lines and your plans for seven days. Background map imagery is not included.")
                    .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                NavigationLink { OfflinePackBuilderView() } label: {
                    Label("Choose parks or an area", systemImage: "arrow.down.circle").font(VType.body(16, .semibold)).frame(minHeight: 44)
                }.tint(Palette.spruce.base).accessibilityIdentifier("chooseOfflinePack")
                if service.isWorking { ProgressView(value: service.progress) { Text("Preparing or refreshing a pack") } }
                if let message = error ?? service.lastError { Text(message).font(VType.body(14)).foregroundStyle(Palette.inkSoft) }
                if service.entries.isEmpty {
                    Text("Your downloaded packs will appear here with their size and freshness.").font(VType.body(15))
                }
                ForEach(service.entries) { entry in
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        NavigationLink { OfflinePackDetailView(entry: entry) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(entry.label).font(VType.display(22, .semibold)).foregroundStyle(Palette.ink)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(entry.bytes), countStyle: .file)).font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                                Text("Downloaded \(entry.downloadedAt.formatted(.relative(presentation: .named)))").font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                                Text(entry.expired ? "Expired — refresh when online" : "Expires \(Date(timeIntervalSince1970: entry.expiresAtMs / 1000).formatted(date: .abbreviated, time: .shortened))")
                                    .font(VType.body(13, .semibold)).foregroundStyle(entry.expired ? Palette.terracotta.base : Palette.spruce.base)
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).disabled(entry.expired).accessibilityIdentifier("offline-pack:\(entry.id)")
                        Button(role: .destructive) { do { try service.delete(entry) } catch { self.error = error.localizedDescription } } label: {
                            Label("Delete pack", systemImage: "trash").font(VType.body(14)).frame(minHeight: 44)
                        }.accessibilityLabel("Delete \(entry.label)")
                    }.padding(Spacing.md).claySurface(.surface, radius: Radius.md)
                }
                Text("Packs refresh on Wi-Fi when you open Verdure, at most once an hour. Signing out removes this account's packs from this device.")
                    .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
            }.padding(Spacing.md).padding(.bottom, 110)
        }.background(VerdureBackground()).navigationTitle("Offline packs").navigationBarTitleDisplayMode(.inline)
        .refreshable { await service.refreshOnWiFi(places: places.places, savedPlaceIDs: game.savedPlaceIDs) }
    }
}

struct OfflinePackBuilderView: View {
    var initialParkID: String? = nil
    @Environment(OfflinePackService.self) private var service
    @Environment(ParkGuideService.self) private var parks
    @Environment(PlacesAPIService.self) private var places
    @Environment(GameStateManager.self) private var game
    @Environment(LocationManager.self) private var location
    @Environment(AuthService.self) private var auth
    @State private var selected: Set<String> = []
    @State private var area = false
    @State private var radius = 1.0
    @State private var preview: OfflinePackPreview?
    @State private var error: String?
    @State private var finished = false
    @State private var showPaywall = false
    @State private var parkSearch = ""
    private var selection: OfflineSelection {
        area ? .init(kind: "area", latitude: location.userCoordinate.latitude, longitude: location.userCoordinate.longitude, radiusMiles: radius)
            : .parks(Array(selected))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("Ready before you leave").font(VType.display(30, .semibold))
                Text("Verdure+ stores a park, several parks or an area for the next seven days. Park guides remain free online.")
                    .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                if auth.currentUser == nil { Text("Sign in from Profile to download a pack.").font(VType.body(15, .semibold)) }
                if let preview {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text(preview.label).font(VType.display(24, .semibold))
                        Text("Download size: \(ByteCountFormatter.string(fromByteCount: Int64(preview.downloadBytes), countStyle: .file))")
                            .font(VType.body(18, .semibold)).accessibilityIdentifier("offlineDownloadSize")
                        Text("\(preview.counts.parks) \(preview.counts.parks == 1 ? "park" : "parks"), \(preview.counts.events) \(preview.counts.events == 1 ? "event" : "events"), \(preview.counts.plans) plans, \(preview.counts.places) places and \(preview.counts.perks) view-only perks.")
                            .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        if preview.unavailableThumbnails > 0 {
                            Text("\(preview.unavailableThumbnails) \(preview.unavailableThumbnails == 1 ? "event image" : "event images") could not be stored; event details are included.").font(VType.body(13))
                        }
                        Text("50 MB maximum. No background map imagery. RSVP, redemption, new plans and check-in require a connection.")
                            .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                        if service.isWorking { ProgressView(value: service.progress) }
                        if finished {
                            Label("Pack downloaded", systemImage: "checkmark.circle.fill").font(VType.body(17, .semibold)).foregroundStyle(Palette.spruce.base)
                            NavigationLink { OfflinePacksView() } label: {
                                Text("Open your packs").frame(minHeight: 44).contentShape(Rectangle())
                            }
                        } else {
                            ClayButton("Download pack", systemImage: "arrow.down.circle.fill", kind: .spruce, fullWidth: true) {
                                Task { do { try await service.download(preview); finished = true } catch { self.error = error.localizedDescription } }
                            }.disabled(service.isWorking || !NetworkStatus.shared.isOnline).accessibilityIdentifier("downloadOfflinePack")
                            Button { Task { await service.cancel(preview.packId); self.preview = nil } } label: {
                                Text("Change selection").frame(minHeight: 44).contentShape(Rectangle())
                            }.disabled(service.isWorking)
                        }
                    }.padding(Spacing.md).claySurface(.surface, radius: Radius.md)
                } else {
                    Toggle("Download an area", isOn: $area).tint(Palette.spruce.base).font(VType.body(16))
                    if area {
                        Text("Around your current browsing location").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        Text("Radius: \(Int(radius)) miles").font(VType.body(17, .semibold))
                        Slider(value: $radius, in: 1...20, step: 1).tint(Palette.spruce.base).accessibilityLabel("Area radius in miles")
                        prepareButton
                    } else {
                        Text("\(selected.count) selected. Choose up to 50 parks.").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        prepareButton
                        TextField("Find a park", text: $parkSearch).font(VType.body(16)).textInputAutocapitalization(.never)
                            .padding(12).claySurface(.surface, radius: Radius.sm).accessibilityIdentifier("offlineParkSearch")
                        ForEach(parks.parks.filter { parkSearch.isEmpty || $0.name.localizedCaseInsensitiveContains(parkSearch) }) { park in
                            Button {
                                if selected.contains(park.id) { selected.remove(park.id) }
                                else if selected.count < 50 { selected.insert(park.id) }
                            } label: {
                                HStack {
                                    Image(systemName: selected.contains(park.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(Palette.spruce.base)
                                    Text(park.name).font(VType.body(15)).foregroundStyle(Palette.ink)
                                    Spacer()
                                }.frame(minHeight: 44).contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityLabel(park.name).accessibilityValue(selected.contains(park.id) ? "Selected" : "Not selected")
                                .accessibilityIdentifier("offline-choice:\(park.id)")
                        }
                    }
                }
                if !NetworkStatus.shared.isOnline { Text("Downloading is available when you're back online.").font(VType.body(14)) }
                if let error { Text(error).font(VType.body(14)).foregroundStyle(Palette.inkSoft) }
                Button { showPaywall = true } label: {
                    Text("Verdure+ details").frame(minHeight: 44).contentShape(Rectangle())
                }.tint(Palette.spruce.base)
            }.padding(Spacing.md).padding(.bottom, 110)
        }.background(VerdureBackground()).navigationTitle("Download a pack").navigationBarTitleDisplayMode(.inline)
        .task {
            if let initialParkID { selected.insert(initialParkID) }
            await parks.load(around: location.userCoordinate, radiusMiles: 10)
        }
        .onDisappear { if let preview, !finished { Task { await service.cancel(preview.packId) } } }
        .sheet(isPresented: $showPaywall) { PaywallView() }
    }
    private var prepareButton: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if service.isWorking { ProgressView("Preparing size preview") }
            ClayButton("Prepare download", systemImage: "arrow.down.circle", kind: .spruce, fullWidth: true) {
                Task { do { preview = try await service.preview(selection: selection, places: places.places, savedPlaceIDs: game.savedPlaceIDs) } catch { self.error = error.localizedDescription } }
            }.disabled(service.isWorking || auth.currentUser == nil || (!area && selected.isEmpty) || !NetworkStatus.shared.isOnline)
                .accessibilityIdentifier("prepareOfflinePack")
        }
    }
}

struct OfflinePackDetailView: View {
    let entry: OfflinePackEntry
    @Environment(OfflinePackService.self) private var service
    @Environment(EconomyService.self) private var economy
    @State private var pack: OfflinePack?
    @State private var error: String?
    private var displayedPerks: [OfflinePerk] {
        guard let pack else { return [] }
        let now = Date().timeIntervalSince1970 * 1000
        if !NetworkStatus.shared.isOnline { return pack.perks.filter { $0.expiresAtMs > now } }
        let ids = Set(pack.perks.map(\.id))
        return economy.catalog.perks.compactMap { perk in
            guard ids.contains(perk.id), let expiresAt = perk.expiresAt, expiresAt > Date() else { return nil }
            return OfflinePerk(id: perk.id, title: perk.title, partner: perk.partner, description: perk.description ?? "",
                               pointCost: perk.pointCost, latitude: perk.latitude, longitude: perk.longitude,
                               expiresAtMs: expiresAt.timeIntervalSince1970 * 1000,
                               earlyAccessUntilMs: perk.earlyAccessUntil.map { $0.timeIntervalSince1970 * 1000 }, viewOnly: true)
        }
    }
    var body: some View {
        OfflineSnapshotGuard(ownerUid: entry.ownerUid, expiresAtMs: entry.expiresAtMs) {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    Text(entry.label).font(VType.display(30, .semibold))
                    Text("Downloaded \(entry.downloadedAt.formatted(.relative(presentation: .named)))").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                    if let pack, service.entries.contains(where: { $0.id == entry.id }) {
                        Text("Stored guides and trail lines work without a connection. Map imagery depends on the system's cache. GPS still needs location permission.")
                            .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        ForEach(pack.guides, id: \.park.id) { guide in
                            NavigationLink { ParkGuideView(parkID: guide.park.id, snapshot: guide, snapshotOwnerUid: pack.ownerUid, snapshotExpiresAtMs: pack.expiresAtMs) } label: {
                                ParkGuideRow(park: guide.park)
                            }.buttonStyle(.plain).accessibilityIdentifier("park-guide:\(guide.park.id)")
                        }
                        Text("Events and saves").font(VType.display(23, .semibold))
                        ForEach(pack.events.filter { $0.isCurrent(birthYear: pack.memberBirthYear) }) { event in
                            NavigationLink { OfflineEventView(event: event, thumbnail: pack.thumbnails[event.id], ownerUid: pack.ownerUid, expiresAtMs: pack.expiresAtMs, birthYear: pack.memberBirthYear) } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(event.title).font(VType.body(16, .semibold)).foregroundStyle(Palette.ink)
                                    Text(Date(timeIntervalSince1970: event.startMs / 1000).formatted(date: .abbreviated, time: .shortened)).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                                    if pack.savedEventIDs.contains(event.id) { Label("Saved", systemImage: "bookmark.fill").font(VType.body(12)).foregroundStyle(Palette.spruce.base) }
                                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }.buttonStyle(.plain)
                        }
                        Text("Your plans").font(VType.display(23, .semibold))
                        ForEach(pack.plans) { plan in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(plan.title).font(VType.body(17, .semibold))
                                if let intro = plan.intro { Text(intro).font(VType.body(14)) }
                                ForEach(plan.eventIDs, id: \.self) { id in
                                    if let event = pack.events.first(where: { $0.id == id }) { Text(event.title).font(VType.body(14)) }
                                }
                                ForEach(plan.stops ?? []) { stop in
                                    Text("\(stop.name)\(stop.minutes.map { " — \(Int($0)) minutes" } ?? "")").font(VType.body(14, .semibold))
                                    Text(stop.why).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                                }
                            }.padding(Spacing.md).claySurface(.surface, radius: Radius.md)
                        }
                        Text("Places").font(VType.display(23, .semibold))
                        ForEach(pack.places) { place in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(place.name).font(VType.body(17, .semibold))
                                Text(place.description).font(VType.body(14))
                                if let hours = place.hours { Text(hours).font(VType.body(13)) }
                                if place.saved { Label("Saved place", systemImage: "bookmark.fill").font(VType.body(13)) }
                                Text(place.attribution).font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                            }.padding(.vertical, 8)
                        }
                        Text("Partner perks, view only").font(VType.display(23, .semibold))
                        Text(NetworkStatus.shared.isOnline ? "Showing current offers for this pack." : "Saved when downloaded. Availability may have changed; reconnect to check.")
                            .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                        ForEach(displayedPerks) { perk in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(perk.partner).font(VType.body(17, .semibold))
                                Text(perk.title).font(VType.body(15))
                                Text(perk.description).font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                                Text("\(perk.pointCost) points. Redemption is available when you're back online.").font(VType.body(13))
                            }.padding(.vertical, 8)
                        }
                        Text("RSVP, perk redemption, plan generation and check-in are available when you're back online. Check-ins are never queued.")
                            .font(VType.body(14, .semibold)).foregroundStyle(Palette.inkSoft)
                    }
                    if let error { Text(error).font(VType.body(15)) }
                }.padding(Spacing.md).padding(.bottom, 110)
            }.background(VerdureBackground())
        }.navigationTitle("Downloaded pack").navigationBarTitleDisplayMode(.inline)
        .task(id: entry.id) {
            do { pack = try service.open(entry) } catch { self.error = error.localizedDescription }
            if NetworkStatus.shared.isOnline { await economy.refresh() }
        }
        .onChange(of: NetworkStatus.shared.isOnline) { _, online in if online { Task { await economy.refresh() } } }
    }
}

private struct OfflineEventView: View {
    let event: OfflineEvent, thumbnail: String?, ownerUid: String, expiresAtMs: Double
    let birthYear: Int?
    var body: some View {
        OfflineSnapshotGuard(ownerUid: ownerUid, expiresAtMs: expiresAtMs) {
            TimelineView(.periodic(from: Date(timeIntervalSince1970: 0), by: 30)) { context in
                if event.isCurrent(birthYear: birthYear, now: context.date) {
                    detailContent
                } else {
                    ContentUnavailableView("Listing unavailable", systemImage: "clock.badge.exclamationmark",
                                           description: Text("This listing expired or its age eligibility changed. Refresh your pack when online."))
                }
            }
        }.navigationTitle("Saved event").navigationBarTitleDisplayMode(.inline)
    }
    private var detailContent: some View {
        ScrollView {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    if let thumbnail, let data = Data(base64Encoded: thumbnail), let image = UIImage(data: data) {
                        Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: Radius.md)).accessibilityHidden(true)
                    }
                    Text(event.title).font(VType.display(30, .semibold))
                    Text(event.organizer).font(VType.body(16, .semibold))
                    Text(Date(timeIntervalSince1970: event.startMs / 1000).formatted(date: .complete, time: .shortened)).font(VType.body(15))
                    Text(event.locationName).font(VType.body(15))
                    Text(event.description).font(VType.body(15))
                    if event.isProgram {
                        Text("Read the official listing and apply on the organization’s site when you're back online.").font(VType.body(14, .semibold)).foregroundStyle(Palette.inkSoft)
                        if let minimum = event.minimumAge, let maximum = event.maximumAge { Text("Ages \(minimum)–\(maximum)").font(VType.body(14)) }
                        if event.isFree == true { Text("Free").font(VType.body(14)) }
                        else if let cost = event.priceMin { Text(cost, format: .currency(code: "USD")).font(VType.body(14)) }
                    } else {
                        Text("RSVP and check-in are available when you're back online.").font(VType.body(14, .semibold)).foregroundStyle(Palette.inkSoft)
                    }
                    if let website = event.website, let url = URL(string: website), url.scheme == "https" {
                        Link("Official listing — requires a connection", destination: url).font(VType.body(15)).frame(minHeight: 44)
                    }
                    Text("Source: \(event.source)").font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                }.padding(Spacing.md).padding(.bottom, 110)
        }.background(VerdureBackground())
    }
}
