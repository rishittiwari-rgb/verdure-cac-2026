import XCTest
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@testable import Verdure

/// Friends → Going soon showed "No shared plans yet" while friendsUpcoming returned the
/// friends' RSVPs. Runs against the seeded demo account (scripts/demo-investor-local.mjs).
@MainActor final class FriendsUpcomingTests: XCTestCase {
    func testGoingSoonListsTheEventsFriendsRSVPdTo() async throws {
        try LocalStack.require()
        guard Firestore.firestore().settings.host == "127.0.0.1:8899" else {
            throw XCTSkip("Requires the explicitly local Firebase test host.")
        }
        _ = try await Auth.auth().signIn(withEmail: "demo-judge@example.test", password: "local-demo-walkthrough")
        defer { try? Auth.auth().signOut() }
        let social = SocialService()
        await social.loadFriendsUpcoming()
        XCTAssertNil(social.lastError)
        XCTAssertFalse(social.friendsUpcoming.isEmpty, "the server returned the friends' plans")
        XCTAssertTrue(social.friendsUpcoming.contains { $0.friendNames.contains("Maya Ortiz") })
    }
}
