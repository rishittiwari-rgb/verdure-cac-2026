import CoreLocation

/// The first data loads after sign-in. Places come from OpenStreetMap mirrors that can
/// take tens of seconds (or fail); events come from Firestore. They are independent, so
/// neither waits for the other — awaiting places first held the signed-in event and
/// Program load about 22 s behind a slow Overpass.
@MainActor
enum InitialLoad {
    @discardableResult
    static func start(around center: CLLocationCoordinate2D,
                      places: @escaping @MainActor (CLLocationCoordinate2D) async -> Void,
                      events: @escaping @MainActor (CLLocationCoordinate2D) async -> Void)
        -> (places: Task<Void, Never>, events: Task<Void, Never>) {
        (Task { await places(center) }, Task { await events(center) })
    }
}
