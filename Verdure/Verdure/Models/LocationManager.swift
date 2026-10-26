import Foundation
import CoreLocation
import SwiftUI
import Observation

@MainActor
@Observable
final class LocationManager: NSObject {

    // MARK: - Published State

    var userLocation: CLLocation?
    var authorizationStatus: CLAuthorizationStatus = .notDetermined
    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    // MARK: - Private

    private let manager = CLLocationManager()
    private var delegate: Delegate?

    // MARK: - Init

    override init() {
        super.init()
        let d = Delegate { [weak self] location in
            Task { @MainActor in self?.userLocation = location }
        } authChanged: { [weak self] status in
            Task { @MainActor in
                self?.authorizationStatus = status
                if self?.isAuthorized == true {
                    self?.startUpdating()
                }
            }
        }
        self.delegate = d
        manager.delegate = d
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 20
        manager.allowsBackgroundLocationUpdates = false
        authorizationStatus = manager.authorizationStatus
        // Start immediately if already authorized
        if isAuthorized {
            manager.startUpdatingLocation()
        }
    }

    // MARK: - Actions

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    func startUpdating() {
        manager.startUpdatingLocation()
    }

    func stopUpdating() {
        manager.stopUpdatingLocation()
    }

    // MARK: - Distance Calculations

    func distanceMiles(to coordinate: CLLocationCoordinate2D) -> Double? {
        guard let userLoc = userLocation else { return nil }
        let placeLoc = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let meters = userLoc.distance(from: placeLoc)
        return meters / 1609.34
    }

    func formattedDistance(to coordinate: CLLocationCoordinate2D) -> String {
        guard let miles = distanceMiles(to: coordinate) else { return "—" }
        if miles < 0.1 {
            let feet = Int(miles * 5280)
            return "\(feet) ft"
        } else if miles < 10 {
            return String(format: "%.1f mi", miles)
        } else {
            return String(format: "%.0f mi", miles)
        }
    }

    /// 500 feet ≈ 0.0947 miles
    func isNearby(_ coordinate: CLLocationCoordinate2D, radius: Double = 0.0947) -> Bool {
        guard let miles = distanceMiles(to: coordinate) else { return false }
        return miles < radius
    }

    /// Live GPS when available; otherwise browse the configured launch area.
    /// A fallback coordinate never authorizes proximity check-ins.
    var userCoordinate: CLLocationCoordinate2D {
        if let userLocation { return userLocation.coordinate }
        if QAData.offline { return SampleData.defaultCenter }
        return LaunchArea.builtIn[0].center
    }

    /// Search and map filters use the launch-area center until GPS is available.
    /// Proximity check-ins still require `userLocation` itself.
    var browsingLocation: CLLocation {
        let coordinate = userCoordinate
        return CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
}

// MARK: - CLLocationManager Delegate (Sendable)

private final class Delegate: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    let locationUpdate: (CLLocation) -> Void
    let authChanged: (CLAuthorizationStatus) -> Void

    init(locationUpdate: @escaping (CLLocation) -> Void, authChanged: @escaping (CLAuthorizationStatus) -> Void) {
        self.locationUpdate = locationUpdate
        self.authChanged = authChanged
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        let age = -latest.timestamp.timeIntervalSinceNow
        guard age < 10, latest.horizontalAccuracy >= 0, latest.horizontalAccuracy < 100 else { return }
        locationUpdate(latest)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Silently handle — the UI shows "—" when location is unavailable
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authChanged(manager.authorizationStatus)
    }
}
