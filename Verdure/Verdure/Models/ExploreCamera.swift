import Foundation
import Observation
import CoreLocation
@preconcurrency import AVFoundation

/// GPS/compass projection, intentionally approximate; no ARKit anchoring.
enum ExploreProjection {
    static func bearing(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) -> Double? {
        guard CLLocationCoordinate2DIsValid(from), CLLocationCoordinate2DIsValid(to) else { return nil }
        let a = from.latitude * .pi / 180, b = to.latitude * .pi / 180, longitude = (to.longitude - from.longitude) * .pi / 180
        let degrees = atan2(sin(longitude) * cos(b), cos(a) * sin(b) - sin(a) * cos(b) * cos(longitude)) * 180 / .pi
        return (degrees + 360).truncatingRemainder(dividingBy: 360)
    }
    static func relativeAngle(bearing: Double, heading: Double) -> Double? {
        guard bearing.isFinite, heading.isFinite, (0..<360).contains(bearing), (0..<360).contains(heading) else { return nil }
        return (bearing - heading + 540).truncatingRemainder(dividingBy: 360) - 180
    }
}
private final class ExploreCameraResources: @unchecked Sendable {
    let session = AVCaptureSession()
    let queue = DispatchQueue(label: "verdure.explore-camera")
    func start(completion: @escaping @Sendable (String?) -> Void) {
        queue.async { [self] in
            do {
                if session.inputs.isEmpty {
                    guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { completion("This device has no available camera."); return }
                    let input = try AVCaptureDeviceInput(device: camera)
                    session.beginConfiguration()
                    guard session.canAddInput(input) else { session.commitConfiguration(); completion("The camera couldn't start."); return }
                    session.addInput(input)
                    // No video/photo/audio output is installed. Pixels go only to
                    // AVCaptureVideoPreviewLayer, never a file, callback or network.
                    session.sessionPreset = .medium; session.commitConfiguration()
                }
                if !session.isRunning { session.startRunning() }
                completion(nil)
            } catch { completion("The camera couldn't start. You can keep using the map or list.") }
        }
    }
    func stop() { queue.async { [self] in if session.isRunning { session.stopRunning() } } }
    deinit { if session.isRunning { session.stopRunning() } }
}

@MainActor @Observable final class ExploreCamera {
    enum State: Equatable { case checking, ready, denied, unavailable(String) }
    private(set) var state = State.checking
    @ObservationIgnored private let resources = ExploreCameraResources()
    private var epoch = UUID()
    private var active = false
    var session: AVCaptureSession { resources.session }
    func start() async {
        let token = UUID(); epoch = token; active = true; state = .checking
        let granted: Bool
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: granted = true
        case .notDetermined: granted = await AVCaptureDevice.requestAccess(for: .video)
        default: granted = false
        }
        guard active, epoch == token, !Task.isCancelled else { return }
        guard granted else { state = .denied; return }
        resources.start { [weak self] error in Task { @MainActor in
            guard let self, self.active, self.epoch == token else { return }
            self.state = error.map(State.unavailable) ?? .ready
        } }
    }
    func stop() { active = false; epoch = UUID(); resources.stop() }
}

@MainActor @Observable final class ExploreCompass: NSObject {
    private(set) var heading: Double?
    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var callbacks: ExploreHeadingDelegate?
    private var active = false
    override init() {
        super.init()
        let callback = ExploreHeadingDelegate { [weak self] value in Task { @MainActor in if self?.active == true { self?.heading = value } } }
        callbacks = callback; manager.delegate = callback; manager.headingOrientation = .portrait
    }
    func start() {
        active = true
        guard CLLocationManager.headingAvailable() else { heading = nil; return }
        manager.headingFilter = 2; manager.startUpdatingHeading()
    }
    func stop() { active = false; heading = nil; manager.stopUpdatingHeading() }
}
private final class ExploreHeadingDelegate: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    let update: (Double?) -> Void
    init(_ update: @escaping (Double?) -> Void) { self.update = update }
    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        let value = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        update(newHeading.headingAccuracy >= 0 && value >= 0 ? value : nil)
    }
}
