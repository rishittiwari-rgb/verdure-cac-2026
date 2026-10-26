import XCTest
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions
@testable import Verdure

@MainActor final class PlaceStoryTests: XCTestCase {
    func testConnectedOwnerEditingGuestReadAndLiveWithdrawal() async throws {
        guard Firestore.firestore().settings.host == "127.0.0.1:8899", !Firestore.firestore().settings.isSSLEnabled else {
            throw XCTSkip("Requires local Firebase native story fixture.")
        }
        let user = try await Auth.auth().signIn(withEmail: "qa-stories-native-owner@example.test", password: "local-story-native-only").user
        let placeID = "osm-999999999999998", service = PlaceStoryService()
        func until(_ label: String, _ condition: () -> Bool) async throws {
            let end = Date().addingTimeInterval(15)
            while !condition(), Date() < end { try await Task.sleep(for: .milliseconds(40)) }
            XCTAssertTrue(condition(), label)
        }
        try await until("System network path") { NetworkStatus.shared.isOnline }
        var ownership: [String: any Sendable] = ["placeId": placeID, "organizerId": "qa-stories-native-org", "placeName": "Fictional Native Story Place",
            "officialURL": "https://www.openstreetmap.org/node/999999999999998", "active": true,
            "verificationReference": "Fictional local-only ownership verification", "reason": "Native owner story withdrawal/reinstatement proof"]
        do {
            let initialPage = try await PlaceStoryAPI.owned()
            let initial = try XCTUnwrap(initialPage.places.first { $0.id == placeID })
            XCTAssertTrue(initial.canEdit)
            let content = String(repeating: "🌳", count: 400)
            try await PlaceStoryAPI.save(initial, content: content)
            await service.begin(placeID: placeID)
            XCTAssertEqual(service.story?.content, content)
            let ownedPage = try await PlaceStoryAPI.owned()
            let owned = try XCTUnwrap(ownedPage.places.first { $0.id == placeID })
            XCTAssertEqual(owned.version, initial.version + 1)
            do { try await PlaceStoryAPI.save(initial, content: "Stale editor"); XCTFail("Stale overwrite accepted") } catch { }
            let encoded = try JSONEncoder().encode(try XCTUnwrap(service.story))
            XCTAssertEqual(try JSONDecoder().decode(PlaceStory.self, from: encoded).content, content, "Offline Codable preserves story")
            try await PlaceStoryAPI.save(owned, content: "Fictional edited text; no local history claim.")
            try await until("SDK revision automatically loads edited prose") { service.story?.content == "Fictional edited text; no local history claim." }
            _ = try await Functions.functions().httpsCallable("approveOrganizer").call(["organizerId": "qa-stories-native-org", "action": "suspend", "reason": "Fictional native story gate proof"])
            try await until("Organizer suspension clears open story") { service.story == nil }
            _ = try await Functions.functions().httpsCallable("approveOrganizer").call(["organizerId": "qa-stories-native-org", "action": "reinstate", "reason": "Reinstate already-reviewed fictional organizer"])
            try await until("Reinstatement refetches canonical story") { service.story != nil }
            ownership["active"] = false
            _ = try await Functions.functions().httpsCallable("setPlaceStoryOwnership").call(ownership)
            try await until("Ownership withdrawal clears open story") { service.story == nil }
            ownership["active"] = true
            _ = try await Functions.functions().httpsCallable("setPlaceStoryOwnership").call(ownership)
            try await until("Ownership restoration loads canonical story") { service.story != nil }
            try Auth.auth().signOut()
            XCTAssertNil(service.visibleStory(account: nil), "Old account response never crosses account boundary")
            await service.begin(placeID: placeID)
            XCTAssertNotNil(service.story, "Guest reading is free")
            service.stop()
            XCTAssertNil(service.story)
        } catch { service.stop(); try? Auth.auth().signOut(); throw error }
        try? Auth.auth().signOut()
        XCTAssertEqual(user.uid, "qa-stories-native-owner")
    }
}
