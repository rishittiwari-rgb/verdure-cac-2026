import Foundation
import CoreLocation

// MARK: - Launch areas (client mirror)
//
// Events are ingested server-side ONLY for configured launch areas
// (functions/src/ingest/areas.ts). The app mirrors that list so it can tell the
// truth when someone opens it 500 miles away: not "no events", but "Verdure
// hasn't launched here yet — the nearest area is San Jose". Keep this in step
// with the server file; `listLaunchAreas` returns the authoritative copy and
// `EventsAPIService` refreshes from it when online.

struct LaunchArea: Identifiable, Equatable, Codable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let radiusMiles: Double

    var center: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }

    /// Miles from a coordinate to this area's centre.
    func distanceMiles(from coordinate: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: latitude, longitude: longitude)
            .distance(from: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)) / 1609.344
    }

    /// Inside the ingestion radius (with the same 5-mile tolerance the server uses).
    func covers(_ coordinate: CLLocationCoordinate2D) -> Bool {
        distanceMiles(from: coordinate) <= radiusMiles + 5
    }

    /// Mirrors LAUNCH_AREAS in functions/src/ingest/areas.ts.
    static let builtIn: [LaunchArea] = [
        LaunchArea(id: "san-jose-ca", name: "San Jose, CA", latitude: 37.3382, longitude: -121.8863, radiusMiles: 25),
    ]

    static func nearest(to coordinate: CLLocationCoordinate2D, in areas: [LaunchArea] = builtIn) -> LaunchArea? {
        areas.min { $0.distanceMiles(from: coordinate) < $1.distanceMiles(from: coordinate) }
    }
}
