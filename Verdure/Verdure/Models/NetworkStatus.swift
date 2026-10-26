import Network
import Observation

/// Starts unknown/offline until the system reports a usable path. A path is
/// only a UI preflight; a successful server response is still required.
@MainActor @Observable
final class NetworkStatus {
    static let shared = NetworkStatus()
    private var systemOnline = false
    private var systemWiFi = false
    #if DEBUG
    /// A deterministic unit/UI seam, never evidence of physical airplane mode.
    var forceOfflineForTesting = false
    var forceWiFiForTesting = false
    #endif
    var isOnline: Bool {
        #if DEBUG
        if forceOfflineForTesting { return false }
        #endif
        return systemOnline
    }
    var isWiFi: Bool {
        #if DEBUG
        return isOnline && (systemWiFi || forceWiFiForTesting)
        #else
        return isOnline && systemWiFi
        #endif
    }
    private let monitor: NWPathMonitor?

    init(monitoring: Bool = true) {
        monitor = monitoring ? NWPathMonitor() : nil
        monitor?.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            let wifi = online && path.usesInterfaceType(.wifi) && !path.isExpensive && !path.isConstrained
            Task { @MainActor in self?.systemOnline = online; self?.systemWiFi = wifi }
        }
        monitor?.start(queue: .init(label: "verdure.network"))
    }
}
