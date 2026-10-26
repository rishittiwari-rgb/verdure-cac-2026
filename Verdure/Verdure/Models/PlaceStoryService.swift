import Foundation
import Observation
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions

struct PlaceStory: Codable, Sendable, Identifiable, Equatable {
    let id: String, placeId: String, placeName: String, organizerId: String
    let organizerName: String, ownerUid: String, content: String
    let version: Int
    let updatedAtMs: Double
    let placeRevision: String
}
struct OwnedStoryPlace: Decodable, Sendable, Identifiable {
    let placeId: String, placeName: String, officialURL: String, content: String
    let version: Int
    let moderated: Bool, active: Bool, canEdit: Bool
    var id: String { placeId }
}
struct StoryPlacesPage: Decodable, Sendable {
    let places: [OwnedStoryPlace]
    let nextCursor: String?
}
struct PlaceStoryResponse: Decodable, Sendable {
    let story: PlaceStory?
    let placeRevision: String
}

@MainActor enum PlaceStoryAPI {
    static func call<T: Decodable>(_ name: String, _ data: [String: any Sendable], as: T.Type) async throws -> T {
        let response = try await Functions.functions().httpsCallable(name).call(data)
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: response.data))
    }
    static func supported(_ id: String) -> Bool {
        id.range(of: "^(?:(?:city-parks|county-boundaries)_[0-9]{1,12}|osm-[0-9]{1,20}|(?:rec|nps)-[a-zA-Z0-9-]{1,140})$", options: .regularExpression) != nil
    }
    static func owned(cursor: String? = nil) async throws -> StoryPlacesPage {
        var data: [String: any Sendable] = ["limit": 30]
        if let cursor { data["cursor"] = cursor }
        return try await call("myStoryPlaces", data, as: StoryPlacesPage.self)
    }
    static func save(_ place: OwnedStoryPlace, content: String) async throws {
        struct Saved: Decodable { let saved: Bool, version: Int }
        _ = try await call("savePlaceStory", ["placeId": place.id, "content": content, "expectedVersion": place.version], as: Saved.self)
    }
    static func engagement(_ story: PlaceStory, stage: String, exposure: String) {
        guard Analytics.isEnabled, NetworkStatus.shared.isOnline else { return }
        let install = Analytics.installID
        Task {
            // Telemetry is optional and never blocks a reading or moderation action.
            _ = try? await Functions.functions().httpsCallable("recordStoryEngagement").call([
                "placeId": story.placeId, "storyId": story.id, "version": story.version,
                "stage": stage, "consent": true, "installID": install, "exposureID": exposure])
        }
    }
}

private final class PlaceStoryResources {
    var listeners: [ListenerRegistration] = []
    var refresh: Task<Void, Never>?
    deinit { refresh?.cancel(); for listener in listeners { listener.remove() } }
}

/// Callable-only prose, with minimal public metadata for prompt invalidation.
@MainActor @Observable final class PlaceStoryService {
    private(set) var story: PlaceStory?
    private(set) var error: String?
    private var placeID = ""
    private var account: String?
    private var generation = UUID()
    private var request = UUID()
    private var invalidation = UUID()
    private var revision = ""
    private var publisher = ""
    private var gateValues: [String: Bool] = [:]
    @ObservationIgnored private let resources = PlaceStoryResources()

    func visibleStory(account uid: String?) -> PlaceStory? { account == uid ? story : nil }
    func stop() {
        generation = UUID(); request = UUID(); invalidation = UUID(); story = nil; publisher = ""; revision = ""
        resources.refresh?.cancel(); resources.refresh = nil
        for listener in resources.listeners { listener.remove() }
        resources.listeners = []; gateValues = [:]
    }
    func begin(placeID: String) async {
        stop(); self.placeID = placeID; account = Auth.auth().currentUser?.uid
        guard PlaceStoryAPI.supported(placeID), NetworkStatus.shared.isOnline else { return }
        await refresh()
    }
    func refresh() async {
        guard NetworkStatus.shared.isOnline, account == Auth.auth().currentUser?.uid else { story = nil; return }
        let token = UUID(), epoch = generation; request = token
        do {
            let response = try await PlaceStoryAPI.call("getPlaceStory", ["placeId": placeID], as: PlaceStoryResponse.self)
            guard !Task.isCancelled, epoch == generation, token == request, account == Auth.auth().currentUser?.uid else { return }
            revision = response.placeRevision; story = response.story; error = nil
            installListeners()
        } catch {
            guard epoch == generation, token == request, account == Auth.auth().currentUser?.uid else { return }
            story = nil; self.error = "This place's story couldn't refresh."
        }
    }
    private func installListeners() {
        let newPublisher = story.map { "\($0.organizerId):\($0.ownerUid)" } ?? publisher
        guard resources.listeners.isEmpty || publisher != newPublisher else { return }
        for listener in resources.listeners { listener.remove() }
        resources.listeners = []; publisher = newPublisher; gateValues = [:]
        let epoch = generation
        var paths = ["placeStoryStatus/\(placeID)"]
        if let story {
            paths += ["organizerStoryStatus/\(story.organizerId)", "storyAuthorStatus/\(story.ownerUid)"]
            for path in paths.dropFirst() { gateValues[path] = true }
        }
        for path in paths {
            let listener = Firestore.firestore().document(path).addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, listenerError in
                let failed = listenerError != nil
                guard failed || snapshot?.metadata.isFromCache == false else { return }
                let exists = snapshot?.exists == true
                let value = snapshot?.data()?["revision"] as? String
                let allowed = snapshot?.data()?["allowed"] as? Bool ?? false
                Task { @MainActor [weak self] in
                    guard let self, self.generation == epoch, self.account == Auth.auth().currentUser?.uid else { return }
                    if failed { self.story = nil; self.error = "This place's story couldn't refresh."; return }
                    if path.hasPrefix("placeStoryStatus/") {
                        if (exists && value != self.revision) || (!exists && self.story != nil) { self.invalidate() }
                    } else {
                        let old = self.gateValues.updateValue(allowed, forKey: path)
                        if (!allowed && self.story != nil) || (old == false && allowed) { self.invalidate() }
                    }
                }
            }
            resources.listeners.append(listener)
        }
    }
    private func invalidate() {
        story = nil; request = UUID()
        resources.refresh?.cancel()
        let refreshID = UUID(); invalidation = refreshID
        resources.refresh = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(80)) } catch { return }
            guard let self else { return }
            await self.refresh()
            if self.invalidation == refreshID { self.resources.refresh = nil }
        }
    }
}
