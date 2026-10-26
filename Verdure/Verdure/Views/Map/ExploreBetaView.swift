import SwiftUI
import CoreLocation
@preconcurrency import AVFoundation

private final class ExplorePreviewUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
private struct ExploreCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> UIView {
        let view = ExplorePreviewUIView(); view.preview.videoGravity = .resizeAspectFill; view.preview.session = session
        return view
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
private struct ExploreLabel: Identifiable {
    let id: String, title: String, subtitle: String
    let coordinate: CLLocationCoordinate2D
    let place: Place?
    let event: Event?
}

private struct ProjectedExploreLabel: Identifiable {
    let label: ExploreLabel
    let angle: Double
    let slot: Int
    var id: String { label.id }
}

struct ExploreBetaView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(LocationManager.self) private var location
    @Environment(PlacesAPIService.self) private var places
    @Environment(EventsAPIService.self) private var events
    @Environment(DiscoveryFilters.self) private var filters
    @Environment(ModerationService.self) private var moderation
    @State private var camera = ExploreCamera()
    @State private var compass = ExploreCompass()
    @State private var showList = false
    @State private var selectedPlace: Place?
    @State private var selectedEvent: Event?

    private var nearby: [ExploreLabel] {
        guard let origin = location.userLocation, abs(origin.timestamp.timeIntervalSinceNow) < 60 else { return [] }
        let placeLabels = filters.apply(to: places.places, query: "", userLocation: origin).compactMap { place -> ExploreLabel? in
            guard let coordinate = place.coordinate, CLLocationCoordinate2DIsValid(coordinate) else { return nil }
            return ExploreLabel(id: "place:\(place.id)", title: place.name, subtitle: "Place", coordinate: coordinate, place: place, event: nil)
        }
        let eventLabels = filters.apply(to: events.events.filter { events.isEligible($0) }, query: "", userLocation: origin).filter { $0.date > Date() && $0.virtual != true && !moderation.isBlocked($0.creatorID) }.compactMap { event -> ExploreLabel? in
            guard let coordinate = event.coordinate, CLLocationCoordinate2DIsValid(coordinate) else { return nil }
            return ExploreLabel(id: "event:\(event.id)", title: event.title, subtitle: "Event", coordinate: coordinate, place: nil, event: event)
        }
        return (placeLabels + eventLabels).filter { origin.distance(from: CLLocation(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude)) <= 2000 }
            .sorted { origin.distance(from: CLLocation(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude)) < origin.distance(from: CLLocation(latitude: $1.coordinate.latitude, longitude: $1.coordinate.longitude)) }
    }
    private var facing: [ProjectedExploreLabel] {
        guard let origin = location.userLocation, let heading = compass.heading else { return [] }
        let projected: [(ExploreLabel, Double)] = nearby.compactMap { label in
            guard let bearing = ExploreProjection.bearing(from: origin.coordinate, to: label.coordinate),
                  let angle = ExploreProjection.relativeAngle(bearing: bearing, heading: heading), abs(angle) <= 35 else { return nil }
            return (label, angle)
        }
        return projected.prefix(6).enumerated().map { ProjectedExploreLabel(label: $0.element.0, angle: $0.element.1, slot: $0.offset) }
    }
    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if camera.state == .ready {
                    ExploreCameraPreview(session: camera.session).ignoresSafeArea().accessibilityHidden(true)
                    GeometryReader { proxy in projectedLabels(size: proxy.size) }
                }
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Explore view (beta)").font(VType.display(25, .semibold)).accessibilityAddTraits(.isHeader)
                    Text("Labels use GPS and compass and may drift a few metres. Use the map for navigation. No camera frames are stored or sent.")
                        .font(VType.body(13)).fixedSize(horizontal: false, vertical: true)
                    if places.places.contains(where: { $0.id.hasPrefix("osm-") }) {
                        OpenStreetMapCredit(color: .white.opacity(0.85), asOf: places.osmDataDate)
                    }
                    Spacer()
                    status
                    if camera.state == .ready, location.userLocation == nil || compass.heading == nil {
                        Text("Live location or compass is unavailable. Use the nearby list or return to the map.").font(VType.body(14))
                    } else if camera.state == .ready && facing.isEmpty {
                        Text("No nearby labels in this direction. Turn slowly, or open the nearby list.").font(VType.body(14))
                    }
                    Button { showList.toggle() } label: { Label(showList ? "Close nearby list" : "Nearby list", systemImage: "list.bullet").frame(maxWidth: .infinity, minHeight: 44) }
                        .buttonStyle(.borderedProminent).tint(Palette.spruce.base).accessibilityIdentifier("exploreBetaNearbyList")
                    if showList {
                        ScrollView { VStack(spacing: 8) { ForEach(nearby.prefix(30)) { labelButton($0) } } }.frame(maxHeight: 280)
                        if nearby.isEmpty { Text("No nearby places or events with current location. The standard map and list still work.").font(VType.body(14)) }
                    }
                }.padding(Spacing.md).foregroundStyle(.white)
                    .background(LinearGradient(colors: [.black.opacity(0.7), .clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom))
            }
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Back to map") { dismiss() }.foregroundStyle(.white).accessibilityIdentifier("closeExploreBeta") } }
            .sheet(item: $selectedPlace) { place in NavigationStack { PlaceDetailView(place: place) } }
            .sheet(item: $selectedEvent) { EventDeepLinkSheet(eventId: $0.id) }
            .task { compass.start(); await camera.start() }
            .onDisappear { camera.stop(); compass.stop() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { compass.start(); Task { await camera.start() } }
                else { camera.stop(); compass.stop() }
            }
        }
    }
    private func projectedLabels(size: CGSize) -> some View {
        ZStack {
            ForEach(facing) { item in
                labelButton(item.label).frame(width: min(220, size.width - 40))
                    .position(labelPosition(item, size: size))
            }
        }
    }
    private func labelPosition(_ item: ProjectedExploreLabel, size: CGSize) -> CGPoint {
        let horizontal = CGFloat(item.angle / 70) * max(0, size.width - 240)
        let x = max(120, min(size.width - 120, size.width / 2 + horizontal))
        let spacing = min(76.0, max(50.0, (size.height - 320) / 6))
        return CGPoint(x: x, y: 160 + CGFloat(item.slot) * spacing)
    }
    @ViewBuilder private var status: some View {
        switch camera.state {
        case .checking: ProgressView("Opening camera").tint(.white)
        case .ready: EmptyView()
        case .denied:
            Text("Camera access is off. This optional view never limits the standard map or list.").font(VType.body(15))
            Button("Open camera settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }.frame(minHeight: 44)
        case .unavailable(let message): Text(message).font(VType.body(15))
        }
    }
    private func labelButton(_ label: ExploreLabel) -> some View {
        Button { selectedPlace = label.place; selectedEvent = label.event } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(label.title).font(VType.body(14, .semibold)).lineLimit(2)
                Text(label.subtitle).font(VType.body(12))
            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(9)
                .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(.white)
        }.buttonStyle(.plain).accessibilityLabel("\(label.subtitle), \(label.title), approximate location")
    }
}
