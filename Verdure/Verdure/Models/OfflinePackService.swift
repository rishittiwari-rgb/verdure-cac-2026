import Foundation
import CryptoKit
import Observation
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFunctions

struct OfflineSelection: Codable, Equatable, Sendable {
    let kind: String
    var parkIds: [String]? = nil
    var latitude: Double? = nil
    var longitude: Double? = nil
    var radiusMiles: Double? = nil
    static func parks(_ ids: [String]) -> Self { .init(kind: "parks", parkIds: ids.sorted()) }
}
struct OfflineEvent: Codable, Identifiable, Sendable {
    let id: String, title: String, description: String, organizer: String, category: String, locationName: String
    let startMs: Double, endMs: Double?
    let latitude: Double?, longitude: Double?
    let website: String?, source: String
    let minimumAge: Int?, maximumAge: Int?, isFree: Bool?
    let deadlineMs: Double?, virtual: Bool?, priceMin: Double?
    var isProgram: Bool { category == "Program" }
    func isCurrent(birthYear: Int?, now: Date = Date()) -> Bool {
        guard (endMs ?? startMs) > now.timeIntervalSince1970 * 1000 else { return false }
        guard isProgram else { return true }
        guard let deadlineMs, deadlineMs > now.timeIntervalSince1970 * 1000, let birthYear, let minimumAge, let maximumAge else { return false }
        let age = Calendar(identifier: .gregorian).component(.year, from: now) - birthYear
        return age >= 13 && age >= minimumAge && age <= maximumAge
    }
}
struct OfflineStop: Codable, Identifiable, Sendable {
    let placeId: String, name: String, latitude: Double, longitude: Double
    let minutes: Double?, why: String, order: Double?
    var id: String { placeId }
}
struct OfflinePlan: Codable, Identifiable, Sendable {
    let id: String, kind: String, title: String, eventIDs: [String]
    let intro: String?, stops: [OfflineStop]?, generatedAtMs: Double?
}
struct OfflinePlace: Codable, Identifiable, Sendable {
    let id: String, name: String, category: String, description: String
    let latitude: Double, longitude: Double
    let hours: String?, source: String, attribution: String, fetchedAtMs: Double?, saved: Bool
}
struct OfflinePerk: Codable, Identifiable, Sendable {
    let id: String, title: String, partner: String, description: String, pointCost: Int
    let latitude: Double?, longitude: Double?, expiresAtMs: Double, earlyAccessUntilMs: Double?, viewOnly: Bool
}
struct OfflinePack: Codable, Sendable {
    let version: Int, ownerUid: String, createdAtMs: Double, expiresAtMs: Double
    let memberBirthYear: Int?
    let selection: OfflineSelection, label: String
    let guides: [ParkGuide], events: [OfflineEvent], savedEventIDs: [String], plans: [OfflinePlan]
    let places: [OfflinePlace], perks: [OfflinePerk], thumbnails: [String: String], unavailableThumbnails: [String]
    let mapImageryIncluded: Bool, checkInAllowed: Bool
}
struct OfflinePackPreview: Codable, Identifiable, Sendable {
    struct Counts: Codable, Sendable { let parks: Int, events: Int, savedEvents: Int, plans: Int, places: Int, perks: Int, thumbnails: Int }
    let packId: String, sha256: String, parts: Int, storedBytes: Int, downloadBytes: Int
    let createdAtMs: Double, expiresAtMs: Double, label: String, counts: Counts
    let unavailableThumbnails: Int, stageExpiresAtMs: Double
    var id: String { packId }
}
struct OfflinePackEntry: Codable, Identifiable, Sendable {
    let id: String, ownerUid: String, label: String, sha256: String, bytes: Int
    let downloadedAtMs: Double, expiresAtMs: Double, selection: OfflineSelection
    var expired: Bool { expiresAtMs <= Date().timeIntervalSince1970 * 1000 }
    var downloadedAt: Date { Date(timeIntervalSince1970: downloadedAtMs / 1000) }
}

@MainActor @Observable
final class OfflinePackService {
    static let maxBytes = 50_000_000
    private(set) var entries: [OfflinePackEntry] = []
    private(set) var ownerUid: String?
    private(set) var isWorking = false
    private(set) var progress = 0.0
    var lastError: String?
    private let base: URL
    private var lastRefresh = Date.distantPast
    private var hasConnected = false

    init(directory: URL? = nil) {
        base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("offlinePacks", isDirectory: true)
    }
    private func directory(_ uid: String) -> URL {
        let hash = SHA256.hash(data: Data(uid.utf8)).map { String(format: "%02x", $0) }.joined()
        return base.appendingPathComponent(hash, isDirectory: true)
    }
    func connect(_ uid: String?) {
        guard uid != ownerUid || !hasConnected else { return }
        hasConnected = true
        // Also clean up a previous account after a terminated sign-out or a
        // restart. Its private snapshots must not survive an account switch.
        let keep = uid.map { directory($0).lastPathComponent }
        for child in (try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil)) ?? [] {
            if child.lastPathComponent != keep { try? FileManager.default.removeItem(at: child) }
        }
        if let old = ownerUid { try? FileManager.default.removeItem(at: directory(old)) }
        ownerUid = uid; entries = []; lastError = nil; lastRefresh = .distantPast
        if let uid, let bytes = try? Data(contentsOf: directory(uid).appendingPathComponent("index.json")),
           let stored = try? JSONDecoder().decode([OfflinePackEntry].self, from: bytes) {
            entries = stored.filter { $0.ownerUid == uid && UUID(uuidString: $0.id) != nil }
        }
    }
    private func account() throws -> String {
        guard let uid = ownerUid, Auth.auth().currentUser?.uid == uid else { throw ServerCallError.notSignedIn }
        guard NetworkStatus.shared.isOnline else { throw ServerCallError.offline }
        return uid
    }
    private func call<T: Decodable & Sendable>(_ payload: [String: any Sendable]) async throws -> T {
        let callable = Functions.functions().httpsCallable("offlinePack")
        // Thumbnail preparation has bounded workers and can take longer than
        // the SDK's default timeout. Keep transfer/control requests bounded.
        callable.timeoutInterval = payload["action"] as? String == "preview" ? 540 : 60
        let reply = try await callable.call(payload)
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: reply.data))
    }
    private struct CancelReply: Decodable, Sendable { let deleted: Bool }
    private struct Chunk: Decodable, Sendable { let index: Int, data: String, sha256: String }

    func preview(selection: OfflineSelection, places: [Place], savedPlaceIDs: Set<String>, retainedPlaces: [OfflinePlace] = []) async throws -> OfflinePackPreview {
        let uid = try account()
        guard !isWorking else { throw ServerCallError.server("A download is already being prepared.") }
        isWorking = true; defer { isWorking = false }
        var selectionObject: [String: any Sendable] = ["kind": selection.kind]
        if let ids = selection.parkIds { selectionObject["parkIds"] = ids }
        if let latitude = selection.latitude { selectionObject["latitude"] = latitude }
        if let longitude = selection.longitude { selectionObject["longitude"] = longitude }
        if let radius = selection.radiusMiles { selectionObject["radiusMiles"] = radius }
        var local: [[String: any Sendable]] = places.filter { !SampleData.isSample(id: $0.id) }.compactMap { place in
            guard let latitude = place.latitude, let longitude = place.longitude else { return nil }
            let osm = place.id.hasPrefix("osm-")
            return ["id": place.id, "name": place.name, "category": place.category.rawValue, "description": place.shortDescription,
                    "latitude": latitude, "longitude": longitude, "hours": place.openHoursReal ?? "",
                    "source": osm ? "OpenStreetMap" : "Existing place provider",
                    "attribution": osm ? "© OpenStreetMap contributors, ODbL" : "Source details in the online place listing",
                    "saved": savedPlaceIDs.contains(place.id)]
        }
        let currentIDs = Set(places.map(\.id))
        for place in retainedPlaces where !currentIDs.contains(place.id) {
            local.append(["id": place.id, "name": place.name, "category": place.category, "description": place.description,
                          "latitude": place.latitude, "longitude": place.longitude, "hours": place.hours ?? "",
                          "source": place.source, "attribution": place.attribution, "fetchedAtMs": place.fetchedAtMs ?? 0,
                          "saved": savedPlaceIDs.contains(place.id)])
        }
        let result: OfflinePackPreview = try await call(["action": "preview", "selection": selectionObject, "places": local])
        guard ownerUid == uid, Auth.auth().currentUser?.uid == uid else { throw ServerCallError.notSignedIn }
        guard result.downloadBytes <= Self.maxBytes, result.storedBytes <= Self.maxBytes, result.parts > 0, result.parts <= 334,
              UUID(uuidString: result.packId) != nil else { throw ServerCallError.server("The pack exceeds the download limit.") }
        return result
    }
    func download(_ preview: OfflinePackPreview, replacing: String? = nil) async throws {
        let uid = try account()
        guard !isWorking else { throw ServerCallError.server("A download is already in progress.") }
        guard preview.downloadBytes <= Self.maxBytes, preview.storedBytes <= Self.maxBytes, preview.parts > 0, preview.parts <= 334,
              preview.stageExpiresAtMs > Date().timeIntervalSince1970 * 1000 else { throw ServerCallError.server("Prepare a fresh size preview first.") }
        isWorking = true; progress = 0; defer { isWorking = false }
        var data = Data()
        for index in 0..<preview.parts {
            try Task.checkCancellation()
            guard ownerUid == uid, Auth.auth().currentUser?.uid == uid else { throw ServerCallError.notSignedIn }
            let chunk: Chunk = try await call(["action": "chunk", "packId": preview.packId, "index": index])
            guard chunk.index == index, chunk.sha256 == preview.sha256, let bytes = Data(base64Encoded: chunk.data),
                  data.count + bytes.count <= Self.maxBytes else { throw ServerCallError.server("A download part could not be verified. Prepare a fresh pack.") }
            data.append(bytes); progress = Double(index + 1) / Double(preview.parts)
        }
        guard ownerUid == uid, Auth.auth().currentUser?.uid == uid else { throw ServerCallError.notSignedIn }
        let pack = try Self.verifiedPack(data, sha256: preview.sha256, ownerUid: uid)
        guard data.count == preview.storedBytes else { throw ServerCallError.server("Download size did not match its preview.") }
        try persist(pack, data: data, id: preview.packId, sha256: preview.sha256, replacing: replacing)
        await cancel(preview.packId)
    }
    static func verifiedPack(_ data: Data, sha256: String, ownerUid: String, nowMs: Double = Date().timeIntervalSince1970 * 1000) throws -> OfflinePack {
        guard data.count <= maxBytes, SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == sha256 else {
            throw ServerCallError.server("This pack is incomplete or damaged. Download it again when online.")
        }
        let pack = try JSONDecoder().decode(OfflinePack.self, from: data)
        guard pack.version == 1, pack.ownerUid == ownerUid, !pack.mapImageryIncluded, !pack.checkInAllowed,
              pack.expiresAtMs > nowMs, pack.expiresAtMs - pack.createdAtMs == 604_800_000 else {
            throw ServerCallError.server("This pack has expired or belongs to another account. Download a fresh pack when online.")
        }
        return pack
    }
    private func persist(_ pack: OfflinePack, data: Data, id: String, sha256: String, replacing: String?) throws {
        guard let uid = ownerUid, pack.ownerUid == uid, UUID(uuidString: id) != nil else { throw ServerCallError.notSignedIn }
        let path = directory(uid)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
        var protectedPath = path
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try protectedPath.setResourceValues(values)
        let old = entries
        try data.write(to: path.appendingPathComponent(id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        entries.removeAll { $0.id == id || $0.id == replacing }
        entries.insert(.init(id: id, ownerUid: uid, label: pack.label, sha256: sha256, bytes: data.count,
                             downloadedAtMs: Date().timeIntervalSince1970 * 1000, expiresAtMs: pack.expiresAtMs, selection: pack.selection), at: 0)
        do { try saveIndex(uid) }
        catch { entries = old; try? FileManager.default.removeItem(at: path.appendingPathComponent(id + ".json")); throw error }
        if let replacing, replacing != id { try? FileManager.default.removeItem(at: path.appendingPathComponent(replacing + ".json")) }
    }
    private func saveIndex(_ uid: String) throws {
        try JSONEncoder().encode(entries).write(to: directory(uid).appendingPathComponent("index.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func open(_ entry: OfflinePackEntry) throws -> OfflinePack {
        guard ownerUid == entry.ownerUid, Auth.auth().currentUser?.uid == entry.ownerUid, UUID(uuidString: entry.id) != nil else { throw ServerCallError.notSignedIn }
        let url = directory(entry.ownerUid).appendingPathComponent(entry.id + ".json")
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard (attributes[.size] as? Int ?? Self.maxBytes + 1) <= Self.maxBytes else { throw ServerCallError.server("This pack exceeds the storage limit.") }
        return try Self.verifiedPack(Data(contentsOf: url), sha256: entry.sha256, ownerUid: entry.ownerUid)
    }
    func delete(_ entry: OfflinePackEntry) throws {
        guard ownerUid == entry.ownerUid else { throw ServerCallError.notSignedIn }
        try FileManager.default.removeItem(at: directory(entry.ownerUid).appendingPathComponent(entry.id + ".json"))
        entries.removeAll { $0.id == entry.id }; try saveIndex(entry.ownerUid)
    }
    func cancel(_ id: String) async {
        guard (try? account()) != nil else { return }
        let _: CancelReply? = try? await call(["action": "cancel", "packId": id])
    }
    func refreshOnWiFi(places: [Place], savedPlaceIDs: Set<String>) async {
        guard NetworkStatus.shared.isWiFi, !isWorking, Date().timeIntervalSince(lastRefresh) > 3600 else { return }
        lastRefresh = Date()
        let uid = ownerUid
        for entry in entries {
            guard uid == ownerUid, NetworkStatus.shared.isWiFi else { return }
            do {
                let retainedPlaces = (try? open(entry))?.places ?? []
                let preview = try await preview(selection: entry.selection, places: places, savedPlaceIDs: savedPlaceIDs, retainedPlaces: retainedPlaces)
                try await download(preview, replacing: entry.id)
            } catch { lastError = "Wi-Fi refresh: " + error.localizedDescription }
        }
    }
}
