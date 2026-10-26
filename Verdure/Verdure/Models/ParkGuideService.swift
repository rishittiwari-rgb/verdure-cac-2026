import Foundation
import CoreLocation
import Observation
@preconcurrency import FirebaseFunctions

struct ParkFlags: Codable, Equatable, Sendable {
    var toddler: Bool
    var dogs: Bool
    var restrooms: Bool
    var water: Bool

    func matches(_ state: DiscoveryFilterState) -> Bool {
        (!state.toddlerPlayground || toddler) && (!state.dogFriendly || dogs) &&
        (!state.parkRestrooms || restrooms) && (!state.drinkingWater || water)
    }
}

struct ParkBounds: Codable, Sendable {
    let west: Double, south: Double, east: Double, north: Double
}

/// Lossless source geometry. Polygon holes and separate islands remain separate;
/// an overlapping bounding box is never sufficient to join an existing place.
struct ParkGeometry: Codable, Sendable {
    let type: String
    let polygons: [[[[Double]]]]
    let paths: [[[Double]]]
    private enum CodingKeys: String, CodingKey { case type, coordinates }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        switch type {
        case "Polygon": polygons = [try c.decode([[[Double]]].self, forKey: .coordinates)]; paths = []
        case "MultiPolygon": polygons = try c.decode([[[[Double]]]].self, forKey: .coordinates); paths = []
        case "LineString": polygons = []; paths = [try c.decode([[Double]].self, forKey: .coordinates)]
        case "MultiLineString": polygons = []; paths = try c.decode([[[Double]]].self, forKey: .coordinates)
        default: throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unsupported park geometry")
        }
        let rings = polygons.flatMap { $0 } + paths
        guard !rings.isEmpty, rings.allSatisfy({ $0.count >= 2 && $0.allSatisfy {
            $0.count == 2 && $0[0].isFinite && $0[1].isFinite && abs($0[0]) <= 180 && abs($0[1]) <= 90
        }}), polygons.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.count >= 4 && $0.first == $0.last } }) else {
            throw DecodingError.dataCorruptedError(forKey: .coordinates, in: c, debugDescription: "Invalid park coordinates")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        switch type {
        case "Polygon": try c.encode(polygons[0], forKey: .coordinates)
        case "MultiPolygon": try c.encode(polygons, forKey: .coordinates)
        case "LineString": try c.encode(paths[0], forKey: .coordinates)
        default: try c.encode(paths, forKey: .coordinates)
        }
    }

    var coordinatePaths: [[CLLocationCoordinate2D]] {
        (polygons.flatMap { $0 } + paths).map { $0.map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) } }
    }

    func contains(_ coordinate: CLLocationCoordinate2D) -> Bool {
        guard CLLocationCoordinate2DIsValid(coordinate) else { return false }
        let x = coordinate.longitude, y = coordinate.latitude
        // 0 outside, 1 inside, 2 on a boundary (including a hole boundary).
        func location(in ring: [[Double]]) -> Int {
            var inside = false
            for i in 1..<ring.count {
                let a = ring[i - 1], b = ring[i]
                let cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])
                if abs(cross) < 1e-10 && x >= min(a[0], b[0]) - 1e-10 && x <= max(a[0], b[0]) + 1e-10 &&
                    y >= min(a[1], b[1]) - 1e-10 && y <= max(a[1], b[1]) + 1e-10 { return 2 }
                if (a[1] > y) != (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0] { inside.toggle() }
            }
            return inside ? 1 : 0
        }
        return polygons.contains { polygon in
            let outer = location(in: polygon[0])
            if outer == 0 { return false }; if outer == 2 { return true }
            for hole in polygon.dropFirst() {
                let result = location(in: hole)
                if result == 2 { return true }; if result == 1 { return false }
            }
            return true
        }
    }
}

struct ParkCredit: Codable, Sendable {
    let publisher: String, attribution: String, datasetURL: String, licenseURL: String, termsReview: String
}

struct ParkSummary: Codable, Identifiable, Sendable {
    let id: String, name: String, status: String, sourceStatus: String, source: String
    let bounds: ParkBounds
    let latitude: Double, longitude: Double
    let flags: ParkFlags
    let ages: [[Int]]
    let address: String, officialURL: String
    let credit: ParkCredit
    let geometry: ParkGeometry?
    let distanceMiles: Double?
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
    var statusLabel: String {
        switch status {
        case "open": return "Listed open"
        case "construction": return "Under construction"
        case "future": return "Future park"
        case "closed": return "Closed"
        case "restricted": return "Restricted access"
        case "seasonal": return "Seasonal access"
        case "permit": return "Permit required"
        default: return "Status not published"
        }
    }
}

struct ParkAmenity: Codable, Identifiable, Sendable {
    let kind: String, label: String, featureId: String, name: String, source: String
    let status: String, sourceStatus: String
    let ages: [Int]?
    let accessibility: String?, entranceDetails: String?
    var id: String { featureId + ":" + kind }
}

struct ParkTrail: Codable, Identifiable, Sendable {
    let id: String, name: String, status: String, sourceStatus: String, officialURL: String
    let geometry: ParkGeometry
    let lengthMiles: Double?, width: Double?, widthUnit: String?, widthClass: String?
    let recreationType: String?, routeType: String?, surface: String?, elevation: Double?
    let dogs: String, notice: String
    let publicAccess: Bool
}

struct ParkEvent: Codable, Identifiable, Sendable {
    let id: String, title: String, description: String, organizer: String, category: String, locationName: String
    let startMs: Double, endMs: Double?
    let latitude: Double, longitude: Double
    let website: String?, imageURL: String?, source: String
    let minimumAge: Int?, maximumAge: Int?, isFree: Bool?
    var date: Date { Date(timeIntervalSince1970: startMs / 1000) }
}

struct ParkGuide: Codable, Sendable {
    let generation: String, publishedAtMs: Double?, refreshDelayed: Bool
    let park: ParkSummary, amenities: [ParkAmenity], trails: [ParkTrail], events: [ParkEvent], credits: [ParkCredit]
    let hours: String?, accessibility: [String], entrances: [ParkAmenity]
    var story: PlaceStory? = nil
}

@MainActor @Observable
final class ParkGuideService {
    private struct ParkPage: Decodable {
        let generation: String, parks: [ParkSummary], nextCursor: String?
        let refreshDelayed: Bool
    }
    private struct ParkMatches: Decodable { let parks: [ParkSummary] }
    private(set) var parks: [ParkSummary] = []
    private(set) var isLoading = false
    private(set) var lastError: String?
    private(set) var refreshDelayed = false
    private var origin: CLLocation?
    private var radius: Double?
    private var fetchedAt = Date.distantPast
    private var requestID = UUID()
    private var loadTask: Task<Void, Never>?

    private static func call<T: Decodable>(_ name: String, data: [String: any Sendable], as: T.Type) async throws -> T {
        let result = try await Functions.functions().httpsCallable(name).call(data)
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: result.data))
    }

    func load(around coordinate: CLLocationCoordinate2D, radiusMiles: Double, force: Bool = false) async {
        guard CLLocationCoordinate2DIsValid(coordinate) else { return }
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        if !force, radius == radiusMiles, let origin, origin.distance(from: location) < 500,
           (isLoading || Date().timeIntervalSince(fetchedAt) < 300) {
            if let loadTask { await loadTask.value }
            return
        }
        let token = UUID(); requestID = token; origin = location; radius = radiusMiles
        isLoading = true; lastError = nil
        // The public catalog request belongs to this shared service. Pushing
        // from Discover to the directory must not cancel its only fetch while
        // the directory is waiting for that same request.
        let task = Task { await self.performLoad(coordinate: coordinate, radiusMiles: radiusMiles, token: token) }
        loadTask = task
        await task.value
    }

    private func performLoad(coordinate: CLLocationCoordinate2D, radiusMiles: Double, token: UUID) async {
        defer { if requestID == token { isLoading = false; loadTask = nil } }
        do {
            var complete: [ParkSummary] = [], cursor: String?, generation: String?, delayed = false
            repeat {
                var input: [String: any Sendable] = ["latitude": coordinate.latitude, "longitude": coordinate.longitude, "radiusMiles": radiusMiles]
                if let cursor { input["cursor"] = cursor }
                let page = try await Self.call("nearbyParkGuides", data: input, as: ParkPage.self)
                try Task.checkCancellation()
                guard requestID == token else { return }
                if let generation, generation != page.generation { throw CocoaError(.fileReadCorruptFile) }
                generation = page.generation; complete += page.parks; cursor = page.nextCursor; delayed = page.refreshDelayed
            } while cursor != nil
            parks = complete.sorted { ($0.distanceMiles ?? .infinity, $0.id) < ($1.distanceMiles ?? .infinity, $1.id) }
            refreshDelayed = delayed; fetchedAt = Date()
        } catch {
            if requestID == token, !Task.isCancelled {
                lastError = error.localizedDescription
                // Do not present a previous area's facts as the new area's list.
                parks = []; fetchedAt = .distantPast
            }
        }
    }

    func guide(id: String) async throws -> ParkGuide {
        try await Self.call("parkGuide", data: ["parkId": id], as: ParkGuide.self)
    }

    func matching(_ coordinate: CLLocationCoordinate2D) async throws -> [ParkSummary] {
        try await Self.call("parksAtCoordinate", data: ["latitude": coordinate.latitude, "longitude": coordinate.longitude], as: ParkMatches.self).parks
    }

    func matches(_ place: Place, state: DiscoveryFilterState) -> Bool {
        guard state.hasParkFilters else { return true }
        guard let coordinate = place.coordinate else { return false }
        return parks.contains { $0.geometry?.contains(coordinate) == true && $0.flags.matches(state) }
    }

    func filtered(state: DiscoveryFilterState, query: String) -> [ParkSummary] {
        guard state.placeCategories.isEmpty || state.placeCategories.contains(.parks), state.rarities.isEmpty else { return [] }
        return parks.filter { $0.flags.matches(state) &&
            (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.address.localizedCaseInsensitiveContains(query)) }
    }
}
