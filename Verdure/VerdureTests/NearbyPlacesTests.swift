import XCTest
import CoreLocation
@testable import Verdure

/// Records Overpass requests and answers them from a script, one entry per request.
private final class ScriptedOverpass: @unchecked Sendable {
    enum Reply { case fail, status(Int), elements([OSMElement]), busy }
    private let lock = NSLock()
    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []

    init(_ replies: [Reply]) { self.replies = replies }

    var client: OverpassClient {
        var client = OverpassClient()
        client.transport = { [self] request in try self.answer(request) }
        return client
    }

    private func answer(_ request: URLRequest) throws -> (Data, URLResponse) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        let reply = replies.isEmpty ? .fail : replies.removeFirst()
        let ok = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        switch reply {
        case .fail: throw URLError(.timedOut)
        case .status(let code):
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!)
        case .busy:
            return (Data(#"{"elements":[],"remark":"runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request."}"#.utf8), ok)
        case .elements(let elements):
            let body = try JSONSerialization.data(withJSONObject: ["elements": elements.map { e -> [String: Any] in
                var o: [String: Any] = ["type": e.type, "id": e.id, "tags": e.tags ?? [:]]
                if let lat = e.lat, let lon = e.lon { o["lat"] = lat; o["lon"] = lon }
                if let c = e.center { o["center"] = ["lat": c.lat, "lon": c.lon] }
                return o
            }])
            return (body, ok)
        }
    }
}

@MainActor
final class NearbyPlacesTests: XCTestCase {
    private let sjsu = CLLocationCoordinate2D(latitude: 37.3352, longitude: -121.8811)
    private var cacheDir: URL!
    private var defaults: UserDefaults!

    override func setUp() async throws {
        cacheDir = FileManager.default.temporaryDirectory.appendingPathComponent("osm-cache-\(UUID().uuidString)")
        defaults = UserDefaults(suiteName: "NearbyPlacesTests-\(UUID().uuidString)")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: cacheDir)
    }

    private func park(_ id: Int, _ name: String, dLat: Double = 0.004) -> OSMElement {
        OSMElement(type: "node", id: id, lat: sjsu.latitude + dLat, lon: sjsu.longitude, center: nil,
                   tags: ["leisure": "park", "name": name])
    }

    private func snapshot(_ elements: [OSMElement], date: Date) -> OSMDataSet {
        OSMDataSet(fetchedAt: date, center: OSMCenter(lat: 37.3382, lon: -121.8863), radiusMeters: 9000, elements: elements)
    }

    private func service(_ overpass: ScriptedOverpass, snapshot: OSMDataSet?) -> PlacesAPIService {
        PlacesAPIService(overpass: overpass.client, areaCache: OSMAreaCache(directory: cacheDir),
                         snapshot: snapshot, defaults: defaults, keyedProviders: false)
    }

    // MARK: Overpass client

    func testEveryRequestCarriesTheUserAgentAndMirrorsAreTriedInOrder() async throws {
        // overpass-api.de answers 406 to a request without a User-Agent.
        let scripted = ScriptedOverpass([.fail, .status(504), .elements([park(1, "Plaza de César Chávez")])])
        let elements = try await scripted.client.fetch(query: #"[out:json];node["leisure"="park"];out;"#)
        XCTAssertEqual(elements.map(\.id), [1])
        XCTAssertEqual(scripted.requests.map { $0.url!.host! },
                       ["overpass-api.de", "overpass.private.coffee", "overpass.kumi.systems"])
        for request in scripted.requests {
            XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "Verdure/1.0 (+https://verdure-app.com)")
            XCTAssertEqual(request.timeoutInterval, 25)
            let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
            XCTAssertTrue(body.hasPrefix("data=%5Bout%3Ajson%5D"), "the query is form-encoded: \(body.prefix(40))")
        }
    }

    func testABusyMirrorsEmptyRuntimeErrorAnswerCountsAsAFailure() async throws {
        let scripted = ScriptedOverpass([.busy, .elements([park(2, "Guadalupe River Park")])])
        let elements = try await scripted.client.fetch(query: "q")
        XCTAssertEqual(elements.map(\.id), [2])
        XCTAssertEqual(scripted.requests.count, 2)
    }

    // MARK: Places service

    func testSnapshotPlacesShowWhenEveryMirrorFails() async {
        let date = Date(timeIntervalSince1970: 1_792_627_200)   // 2026-10-21
        let scripted = ScriptedOverpass([.fail, .fail, .fail, .fail])
        let places = service(scripted, snapshot: snapshot([park(10, "St. James Park"), park(11, "Far Away Park", dLat: 0.5)], date: date))
        await places.fetchNearbyPlaces(around: sjsu)
        XCTAssertEqual(scripted.requests.count, OverpassClient.defaultMirrors.count, "every mirror is asked once")
        XCTAssertEqual(places.places.map(\.id), ["osm-10"], "snapshot places within the search radius only")
        XCTAssertEqual(places.osmDataDate, date, "the credit shows the snapshot's date")
        XCTAssertTrue(places.places.allSatisfy { $0.latitude != nil })
    }

    func testLiveAnswerReplacesTheSnapshotAndIsCachedForTheArea() async {
        let snapshotDate = Date(timeIntervalSince1970: 1_792_627_200)
        let scripted = ScriptedOverpass([.elements([park(20, "Discovery Meadow")])])
        let places = service(scripted, snapshot: snapshot([park(10, "St. James Park")], date: snapshotDate))
        await places.fetchNearbyPlaces(around: sjsu)
        XCTAssertEqual(places.places.map(\.id), ["osm-20"])
        XCTAssertGreaterThan(places.osmDataDate ?? .distantPast, snapshotDate)

        // A relaunch within the hour restores the places and their data date.
        let relaunch = service(ScriptedOverpass([]), snapshot: snapshot([park(10, "St. James Park")], date: snapshotDate))
        XCTAssertEqual(relaunch.places.map(\.id), ["osm-20"])
        XCTAssertEqual(relaunch.osmDataDate?.timeIntervalSince1970 ?? 0, places.osmDataDate?.timeIntervalSince1970 ?? -9, accuracy: 0.001,
                       "the credit keeps the live data's date after a relaunch")

        // Later, with every mirror down, the area cache (not the snapshot) supplies the places.
        defaults = UserDefaults(suiteName: "NearbyPlacesTests-\(UUID().uuidString)")
        let offline = service(ScriptedOverpass([.fail, .fail, .fail, .fail]), snapshot: snapshot([park(10, "St. James Park")], date: snapshotDate))
        await offline.fetchNearbyPlaces(around: sjsu)
        XCTAssertEqual(offline.places.map(\.id), ["osm-20"])
        XCTAssertEqual(offline.osmDataDate?.timeIntervalSince1970 ?? 0, places.osmDataDate?.timeIntervalSince1970 ?? -9, accuracy: 1)
    }

    func testNoSnapshotOutsideItsAreaAndNoMirrorMeansAnHonestEmptyList() async {
        let elsewhere = CLLocationCoordinate2D(latitude: 41.4993, longitude: -81.6944)   // Cleveland
        let places = service(ScriptedOverpass([.fail, .fail, .fail, .fail]),
                             snapshot: snapshot([park(10, "St. James Park")], date: Date()))
        await places.fetchNearbyPlaces(around: elsewhere)
        XCTAssertTrue(places.places.isEmpty)
        XCTAssertNil(places.osmDataDate)
        XCTAssertNotNil(places.lastError)
    }

    func testBundledSnapshotIsRealDatedAndCoversTheSanJoseDemoArea() throws {
        let bundled = try XCTUnwrap(OSMSnapshot.load(from: Bundle(for: PlacesAPIService.self)) ?? OSMSnapshot.bundled,
                                    "osm-snapshot-san-jose.json ships in the app bundle")
        XCTAssertTrue(bundled.covers(sjsu, searchRadius: 5000))
        XCTAssertGreaterThan(bundled.elements(near: sjsu, within: 5000).count, 30)
        let featureKeys = ["leisure", "highway", "natural", "tourism", "amenity"]
        XCTAssertTrue(bundled.elements.allSatisfy { e in featureKeys.contains { e.tags?[$0] != nil } },
                      "only the feature types the app's Overpass query asks for")
        XCTAssertLessThan(bundled.fetchedAt, Date())
    }

    // MARK: Events never wait for places

    func testEventsFinishWhilePlacesAreStillLoading() async {
        var releasePlaces: CheckedContinuation<Void, Never>?
        var placesFinished = false
        let eventsLoaded = expectation(description: "events loaded")
        let gate = expectation(description: "places started")
        let tasks = InitialLoad.start(around: sjsu, places: { _ in
            await withCheckedContinuation { releasePlaces = $0; gate.fulfill() }
            placesFinished = true
        }, events: { _ in
            eventsLoaded.fulfill()
        })
        await fulfillment(of: [gate, eventsLoaded], timeout: 5)
        XCTAssertFalse(placesFinished, "events finished while places were still loading")
        releasePlaces?.resume()
        await tasks.places.value
        XCTAssertTrue(placesFinished)
    }
}
