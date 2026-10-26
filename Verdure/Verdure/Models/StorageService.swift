import Foundation
import CryptoKit
@preconcurrency import FirebaseStorage
@preconcurrency import FirebaseAuth

// MARK: - Storage Service (proof-of-attendance uploads)
//
// Uploads check-in proof photos to Cloud Storage at `proofs/{uid}/{eventDigest}.jpg`
// — the exact path shape storage.rules restricts to the owner (≤8MB images). The
// checkInToEvent callable receives this path and validates it belongs to the caller.
//
// Stateless + Sendable, same pattern as FunctionsService: nothing non-Sendable
// crosses an actor boundary.

enum StorageService {

    /// Deterministic, filename-safe name for an event's proof photo. Event IDs can
    /// contain slashes/spaces (SerpApi titles), so hash them — SHA-256 is stable
    /// across launches (unlike `hashValue`), which keeps the path idempotent for
    /// repeat online attempts.
    static func proofFileName(for eventId: String) -> String {
        let digest = SHA256.hash(data: Data(eventId.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return String(hex.prefix(32)) + ".jpg"
    }

    /// Upload a proof JPEG for an event. Returns the storage path for the server
    /// to verify. Throws on failure; attendance is never queued.
    static func uploadProof(eventId: String, jpeg: Data) async throws -> String {
        guard let uid = Auth.auth().currentUser?.uid else {
            throw ServerCallError.notSignedIn
        }
        let path = "proofs/\(uid)/\(proofFileName(for: eventId))"
        let ref = Storage.storage().reference(withPath: path)
        let metadata = StorageMetadata()
        metadata.contentType = "image/jpeg"
        _ = try await ref.putDataAsync(jpeg, metadata: metadata)
        return path
    }
}
