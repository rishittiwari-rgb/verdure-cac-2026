import Foundation
import CoreLocation

// MARK: - OpenStreetMap data: Overpass mirrors, per-area cache, bundled snapshot
//
// Nearby places come from OpenStreetMap (ODbL). Live data is fetched through the
// public Overpass mirrors; the last good answer per area is kept on device; a dated
// snapshot of central San José ships in the bundle as the starting cache, used only
// when no mirror answers and nothing is cached. Every source carries its data date,
// which is shown next to the "© OpenStreetMap contributors" credit.

/// One Overpass element (node or way with a center), as the app's query returns it.
struct OSMElement: Codable, Sendable {
    let type: String
    let id: Int
    let lat: Double?
    let lon: Double?
    let center: OSMCenter?
    let tags: [String: String]?

    var coordinate: CLLocationCoordinate2D? {
        guard let lat = lat ?? center?.lat, let lon = lon ?? center?.lon, lat != 0, lon != 0 else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

struct OSMCenter: Codable, Sendable {
    let lat: Double
    let lon: Double
}

private struct OverpassResponse: Decodable {
    let elements: [OSMElement]
    let remark: String?
}

/// Overpass access. overpass-api.de answers 406 to a request without a User-Agent, and
/// a busy instance can hold a request open without answering, so every request carries
/// the app's User-Agent, each mirror gets a bounded time, and the next mirror is tried.
struct OverpassClient: Sendable {
    typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    static let userAgent = "Verdure/1.0 (+https://verdure-app.com)"
    static let defaultMirrors: [URL] = [
        URL(string: "https://overpass-api.de/api/interpreter")!,
        URL(string: "https://overpass.private.coffee/api/interpreter")!,
        URL(string: "https://overpass.kumi.systems/api/interpreter")!,
        URL(string: "https://maps.mail.ru/osm/tools/overpass/api/interpreter")!,
    ]
    static let perMirrorTimeout: TimeInterval = 25

    /// A request/resource limit of 25 s: a mirror that accepts the connection but never
    /// answers costs at most that long before the next one is tried.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = perMirrorTimeout
        config.timeoutIntervalForResource = perMirrorTimeout
        config.httpAdditionalHeaders = ["User-Agent": userAgent]
        return URLSession(configuration: config)
    }()

    var mirrors: [URL] = OverpassClient.defaultMirrors
    var transport: Transport = { try await OverpassClient.session.data(for: $0) }

    static func request(query: String, to url: URL) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: perMirrorTimeout)
        request.httpMethod = "POST"
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed) ?? query
        request.httpBody = Data("data=\(encoded)".utf8)
        request.assumesHTTP3Capable = false
        return request
    }

    /// Elements from the first mirror that returns HTTP 200 with a usable answer. A busy
    /// instance can return 200 with no elements and a runtime-error remark; that counts as
    /// a failure so the next mirror is asked.
    func fetch(query: String) async throws -> [OSMElement] {
        var lastError: Error = PlacesAPIError.serverError
        for mirror in mirrors {
            do {
                let (data, response) = try await transport(Self.request(query: query, to: mirror))
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw PlacesAPIError.serverError }
                let decoded = try JSONDecoder().decode(OverpassResponse.self, from: data)
                if decoded.elements.isEmpty, let remark = decoded.remark, remark.localizedCaseInsensitiveContains("error") {
                    throw PlacesAPIError.serverError
                }
                return decoded.elements
            } catch {
                lastError = error
            }
        }
        throw lastError
    }
}

/// A set of OSM elements with the date they were fetched.
struct OSMDataSet: Codable, Sendable {
    let fetchedAt: Date
    let center: OSMCenter
    let radiusMeters: Double
    let elements: [OSMElement]

    /// Elements within `meters` of `center`, nearest first.
    func elements(near center: CLLocationCoordinate2D, within meters: Double) -> [OSMElement] {
        let origin = CLLocation(latitude: center.latitude, longitude: center.longitude)
        return elements
            .compactMap { e -> (OSMElement, Double)? in
                guard let c = e.coordinate else { return nil }
                let d = origin.distance(from: CLLocation(latitude: c.latitude, longitude: c.longitude))
                return d <= meters ? (e, d) : nil
            }
            .sorted { $0.1 < $1.1 }
            .map(\.0)
    }

    /// True when a `meters` search around `point` lies inside the area this set covers.
    func covers(_ point: CLLocationCoordinate2D, searchRadius meters: Double) -> Bool {
        let d = CLLocation(latitude: center.lat, longitude: center.lon)
            .distance(from: CLLocation(latitude: point.latitude, longitude: point.longitude))
        return d + meters <= radiusMeters
    }
}

/// The last good Overpass answer per area (about 2 km cells), kept on device with its date.
struct OSMAreaCache: Sendable {
    let directory: URL

    static let shared = OSMAreaCache(directory: FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("osm-area-cache", isDirectory: true))

    static func areaKey(_ c: CLLocationCoordinate2D) -> String {
        String(format: "%.2f_%.2f", (c.latitude * 50).rounded() / 50, (c.longitude * 50).rounded() / 50)
    }

    func load(_ center: CLLocationCoordinate2D) -> OSMDataSet? {
        let url = directory.appendingPathComponent(Self.areaKey(center) + ".json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? Self.decoder.decode(OSMDataSet.self, from: data)
    }

    func save(_ set: OSMDataSet) {
        let center = CLLocationCoordinate2D(latitude: set.center.lat, longitude: set.center.lon)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? Self.encoder.encode(set) else { return }
        try? data.write(to: directory.appendingPathComponent(Self.areaKey(center) + ".json"), options: .atomic)
    }

    static let encoder: JSONEncoder = { let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e }()
    static let decoder: JSONDecoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d }()
}

/// The bundled, dated snapshot of OpenStreetMap features around central San José.
enum OSMSnapshot {
    static let resourceName = "osm-snapshot-san-jose"

    static let bundled: OSMDataSet? = load(from: .main)

    static func load(from bundle: Bundle) -> OSMDataSet? {
        guard let url = bundle.url(forResource: resourceName, withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? OSMAreaCache.decoder.decode(OSMDataSet.self, from: data)
    }
}
