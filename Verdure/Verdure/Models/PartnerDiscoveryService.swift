import SwiftUI
import CoreLocation
import Observation
@preconcurrency import FirebaseFunctions
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore

struct PartnerMapOffer: Identifiable, Equatable {
    let id: String
    let partnerID: String
    let partner: String
    let title: String
    let description: String
    let pointCost: Int
    let latitude: Double
    let longitude: Double
    let distanceMeters: Double
    let walkingMinutes: Int
    let claimable: Bool
    let opensAt: Date?
    var expiresAt: Date? = nil
    var partnerRevision: String? = nil
    var perkRevision: String? = nil
    var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }

    static func parse(_ data: [String: Any]) -> PartnerMapOffer? {
        guard let id = data["perkId"] as? String, let partnerID = data["partnerId"] as? String,
              let latitude = data["latitude"] as? Double, let longitude = data["longitude"] as? Double,
              latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180 else { return nil }
        return .init(id: id, partnerID: partnerID,
                     partner: Sanitize.text(data["partner"] as? String, max: 60),
                     title: Sanitize.text(data["title"] as? String, max: 80),
                     description: Sanitize.text(data["description"] as? String, max: 200),
                     pointCost: data["pointCost"] as? Int ?? 0, latitude: latitude, longitude: longitude,
                     distanceMeters: data["distanceMeters"] as? Double ?? 0,
                     walkingMinutes: data["walkingMinutes"] as? Int ?? 1,
                     claimable: data["claimable"] as? Bool ?? false,
                     opensAt: (data["earlyAccessUntilMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) },
                     expiresAt: (data["expiresAtMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) },
                     partnerRevision: data["partnerRevision"] as? String,
                     perkRevision: data["perkRevision"] as? String)
    }
}

// Own listener lifetimes outside the actor-isolated observable model. Swift 6
// deinitializers are nonisolated; cleanup needs no UI state or actor access.
private final class PartnerDiscoveryResources {
    var listeners: [ListenerRegistration] = []
    var expiryTask: Task<Void, Never>?
    var invalidationTask: Task<Void, Never>?
    deinit {
        expiryTask?.cancel()
        invalidationTask?.cancel()
        for listener in listeners { listener.remove() }
    }
}

@MainActor @Observable
final class PartnerDiscoveryService {
    private(set) var offers: [PartnerMapOffer] = []
    private(set) var nearYou: PartnerMapOffer?
    /// True once every invalidation listener for the displayed offers has had its first server
    /// snapshot — from then on a withdrawal reaches the app through the listener.
    private(set) var isWatchingForWithdrawals = false
    @ObservationIgnored private var awaitingServer = Set<String>()
    private(set) var layerEnabled = true
    private(set) var error: String?
    private var uid: String?
    private var sessionID = UUID().uuidString
    private var shownNearYou = false
    private var lastRequest = ""
    private var dismissed = Set<String>()
    private var nearYouExpiresAt = Date.distantPast
    private var requestID = UUID()
    private var listenerID = UUID()
    private var lastOrigin: CLLocation?
    @ObservationIgnored private let resources = PartnerDiscoveryResources()

    private func stopListening() {
        listenerID = UUID()
        isWatchingForWithdrawals = false
        for listener in resources.listeners { listener.remove() }
        resources.listeners = []
        resources.invalidationTask?.cancel()
        resources.invalidationTask = nil
        resources.expiryTask?.cancel()
    }

    func beginSession() {
        stopListening()
        requestID = UUID()
        sessionID = UUID().uuidString
        shownNearYou = false
        nearYou = nil
        offers = []
        lastRequest = ""
    }

    func setLayerEnabled(_ enabled: Bool) {
        layerEnabled = enabled
        if let uid { UserDefaults.standard.set(enabled, forKey: "partnerMapLayer.\(uid)") }
    }

    func refresh(around origin: CLLocation?) async {
        let current = Auth.auth().currentUser?.uid
        if current != uid {
            stopListening(); requestID = UUID()
            uid = current; offers = []; nearYou = nil; dismissed = []; lastRequest = ""
            sessionID = UUID().uuidString; shownNearYou = false
            if let uid, UserDefaults.standard.object(forKey: "partnerMapLayer.\(uid)") != nil {
                layerEnabled = UserDefaults.standard.bool(forKey: "partnerMapLayer.\(uid)")
            } else { layerEnabled = true }
        }
        guard let current, let origin else {
            stopListening(); requestID = UUID(); lastOrigin = nil; lastRequest = ""
            offers = []; nearYou = nil; return
        }
        lastOrigin = origin
        expireOffers()
        if Date() >= nearYouExpiresAt { nearYou = nil }
        let key = "\(current):\(Int(origin.coordinate.latitude * 1000)):\(Int(origin.coordinate.longitude * 1000)):\(Int(Date().timeIntervalSince1970 / 3600))"
        guard key != lastRequest else { return }
        lastRequest = key
        let request = UUID(), session = sessionID
        requestID = request
        do {
            let map = try await Functions.functions().httpsCallable("nearbyPartners").call([
                "lat": origin.coordinate.latitude, "lng": origin.coordinate.longitude,
                "sessionId": session, "surface": "map"])
            guard uid == current, Auth.auth().currentUser?.uid == current, requestID == request, sessionID == session else { return }
            let data = map.data as? [String: Any] ?? [:]
            offers = (data["offers"] as? [[String: Any]] ?? []).compactMap(PartnerMapOffer.parse)
                .filter { !dismissed.contains($0.id) && ($0.expiresAt ?? .distantFuture) > Date() }
            // A cached card ceases to be eligible immediately when it becomes
            // too far away or its live perk disappears. Never substitute a far offer.
            if let card = nearYou, !offers.contains(where: { $0.id == card.id }) ||
                origin.distance(from: CLLocation(latitude: card.latitude, longitude: card.longitude)) > 800 { nearYou = nil }
            if !shownNearYou {
                let result = try await Functions.functions().httpsCallable("nearbyPartners").call([
                    "lat": origin.coordinate.latitude, "lng": origin.coordinate.longitude,
                    "sessionId": session, "surface": "near_you"])
                guard uid == current, Auth.auth().currentUser?.uid == current, requestID == request, sessionID == session else { return }
                let payload = result.data as? [String: Any] ?? [:]
                nearYou = (payload["offers"] as? [[String: Any]] ?? []).compactMap(PartnerMapOffer.parse)
                    .first { !dismissed.contains($0.id) && ($0.expiresAt ?? .distantFuture) > Date() }
                nearYouExpiresAt = Date(timeIntervalSince1970: (payload["validUntilMs"] as? Double ?? 0) / 1000)
                shownNearYou = nearYou != nil
            }
            listenForInvalidation(account: current)
            error = nil
        } catch {
            guard uid == current, Auth.auth().currentUser?.uid == current, requestID == request, sessionID == session else { return }
            stopListening()
            offers = []; nearYou = nil; lastRequest = ""
            self.error = "Partner offers couldn't refresh."
        }
    }

    private func expireOffers() {
        let now = Date()
        offers.removeAll { ($0.expiresAt ?? .distantFuture) <= now }
        if let card = nearYou, now >= nearYouExpiresAt || (card.expiresAt ?? .distantFuture) <= now { nearYou = nil }
    }

    private func scheduleExpiry() {
        resources.expiryTask?.cancel()
        var deadlines = offers.compactMap(\.expiresAt)
        if let card = nearYou { deadlines.append(min(nearYouExpiresAt, card.expiresAt ?? .distantFuture)) }
        guard let deadline = deadlines.min() else { return }
        resources.expiryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow))) }
            catch { return }
            guard let self else { return }
            self.expireOffers()
            self.scheduleExpiry()
        }
    }

    private func listenForInvalidation(account: String) {
        stopListening()
        let generation = listenerID
        awaitingServer = []
        let displayed = offers + (nearYou.map { [$0] } ?? [])
        var paths = Set<String>()
        for offer in displayed {
            for (path, revision, partner) in [
                ("partnerStatus/\(offer.partnerID)", offer.partnerRevision, true),
                ("perkStatus/\(offer.id)", offer.perkRevision, false)
            ] where paths.insert(path).inserted {
                awaitingServer.insert(path)
                let targetID = partner ? offer.partnerID : offer.id
                let registration = Firestore.firestore().document(path).addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, _ in
                    // A stale disk/cache snapshot must not invalidate a newer
                    // callable response. Missing metadata permits legacy offers.
                    if let snapshot, !snapshot.metadata.isFromCache {
                        Task { @MainActor [weak self] in
                            guard let self, self.listenerID == generation else { return }
                            self.awaitingServer.remove(path)
                            if self.awaitingServer.isEmpty { self.isWatchingForWithdrawals = true }
                        }
                    }
                    guard let snapshot, !snapshot.metadata.isFromCache, let data = snapshot.data() else { return }
                    let unavailable = data["available"] as? Bool == false ||
                        (!partner && (data["expiresAtMs"] as? Double ?? .greatestFiniteMagnitude) <= Date().timeIntervalSince1970 * 1000)
                    let comparable = partner || data["revisionVersion"] as? Int == 2
                    let changed = comparable && revision != nil && (data["revision"] as? String) != revision
                    guard unavailable || changed else { return }
                    Task { @MainActor [weak self] in
                        guard let self, self.uid == account, Auth.auth().currentUser?.uid == account,
                              self.listenerID == generation else { return }
                        self.offers.removeAll { partner ? $0.partnerID == targetID : $0.id == targetID }
                        if let card = self.nearYou, partner ? card.partnerID == targetID : card.id == targetID { self.nearYou = nil }
                        self.scheduleExpiry()
                        self.queueInvalidationRefresh()
                    }
                }
                resources.listeners.append(registration)
            }
        }
        scheduleExpiry()
    }

    private func queueInvalidationRefresh() {
        // Coalesce the two metadata updates from one transaction into one fetch.
        guard resources.invalidationTask == nil else { return }
        resources.invalidationTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(150)) }
            catch { return }
            guard let self else { return }
            self.resources.invalidationTask = nil
            self.lastRequest = ""
            await self.refresh(around: self.lastOrigin)
        }
    }

    func dismiss(_ offer: PartnerMapOffer) async {
        let account = Auth.auth().currentUser?.uid
        do {
            _ = try await Functions.functions().httpsCallable("dismissPerk").call(["perkId": offer.id])
            guard account == Auth.auth().currentUser?.uid, account == uid else { return }
            dismissed.insert(offer.id); offers.removeAll { $0.id == offer.id }
            if nearYou?.id == offer.id { nearYou = nil }
            if let uid { listenForInvalidation(account: uid) }
            error = nil
            Analytics.log(event: .perkDismissed, params: ["perkId": offer.id])
        } catch { self.error = "Couldn't remember that dismissal. Try again." }
    }
}
