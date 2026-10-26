import XCTest
import CoreLocation
@testable import Verdure

// MARK: - Cloud-merge safety
//
// Regression cover for the "points silently vanish" class of bug: when the
// Cloud Functions are NOT deployed (or are unreachable), the cloud document's
// balance is a meaningless 0. Adopting it as truth would wipe legitimate
// optimistic earnings that can never be re-credited, because event check-ins
// are deliberately not backfilled (there's no honest proof to resubmit).
//
// Rule under test: the server balance is authoritative ONLY after a callable
// has actually round-tripped AND the queue has drained.

@MainActor
final class CloudMergeTests: XCTestCase {

    private let keys = [
        "collectedPlaceIDs", "checkedInEventIDs", "pointsBalance", "lifetimePoints",
        "redeemedRewardIDs", "savedEventIDs", "savedPlaceIDs", "pendingServerOps",
        "earnHistory", "streakCount", "streakLastDay", "challengeBonusXP",
        "completedChallengeKeys", "earnedBadges", "notificationInbox",
    ]

    override func setUp() async throws { wipe() }
    override func tearDown() async throws { wipe() }

    private func wipe() {
        for key in keys { UserDefaults.standard.removeObject(forKey: key) }
        UserDefaults.standard.set(true, forKey: "gameStateSeeded_v2")
    }


    func testOfflineAttendanceNeverAwardsOrQueues() async {
        let state = GameStateManager()
        do {
            _ = try await state.checkInEvent(TestFixtures.event, proofPhoto: Data([1]),
                userLocation: CLLocation(latitude: 37.33, longitude: -121.89), network: NetworkStatus(monitoring: false))
            XCTFail("Offline attendance must be refused")
        } catch { XCTAssertEqual(error.localizedDescription, ServerCallError.offline.localizedDescription) }
        XCTAssertEqual(state.pointsBalance, 0)
        XCTAssertEqual(state.lifetimePoints, 0)
        XCTAssertFalse(state.isCheckedIn(TestFixtures.event.id))
        XCTAssertTrue(state.pendingOps.isEmpty)
        XCTAssertTrue(state.earnHistory.isEmpty)
    }

    func testLegacyOfflineAttendanceIsCancelledWithoutReplaying() throws {
        let old = GameStateManager.PendingOp(kind: .checkIn, id: "old-event", category: "Social", points: 100)
        let place = GameStateManager.PendingOp(kind: .collect, id: "real-place", category: "", points: 5)
        UserDefaults.standard.set(try JSONEncoder().encode([old, place]), forKey: "pendingServerOps")
        UserDefaults.standard.set(try JSONEncoder().encode(["old-event", "confirmed-event"]), forKey: "checkedInEventIDs")
        UserDefaults.standard.set(205, forKey: "pointsBalance")
        UserDefaults.standard.set(305, forKey: "lifetimePoints")
        let state = GameStateManager()
        XCTAssertEqual(state.pendingOps, [place])
        XCTAssertFalse(state.isCheckedIn("old-event"))
        XCTAssertTrue(state.isCheckedIn("confirmed-event"))
        XCTAssertEqual(state.pointsBalance, 105)
        XCTAssertEqual(state.lifetimePoints, 205)
        XCTAssertEqual(GameStateManager().pendingOps, [place])
    }

    /// The exact production scenario today: Functions undeployed, so the user
    /// doc has 0 points while the device holds real optimistic earnings.
    func testUndeployedBackendDoesNotWipeLocalPoints() {
        let state = GameStateManager()
        let earned = state.collectPlace(TestFixtures.collectible)
        XCTAssertEqual(state.pointsBalance, earned)
        XCTAssertFalse(state.serverConfirmed, "no callable has answered yet")

        // Cloud doc as it actually exists with no Functions deployed: all zeroes.
        let emptyCloud = CloudGameState(
            collectedPlaceIDs: [], checkedInEventIDs: [],
            pointsBalance: 0, lifetimePoints: 0, redeemedRewardIDs: [])
        state.applyCloudStateForTesting(emptyCloud)

        XCTAssertEqual(state.pointsBalance, earned,
                       "an unproven server must never zero out local earnings")
        XCTAssertEqual(state.lifetimePoints, earned)
        XCTAssertTrue(state.hasUnsyncedEarnings, "the earning is still queued for credit")
        XCTAssertEqual(state.unsyncedPointsCount, earned)
    }

    /// A genuinely richer cloud balance still wins (fresh install, existing account).
    func testCloudBalanceStillWinsWhenHigher() {
        let state = GameStateManager()
        let cloud = CloudGameState(
            collectedPlaceIDs: ["osm-1"], checkedInEventIDs: ["e1"],
            pointsBalance: 900, lifetimePoints: 1200, redeemedRewardIDs: [])
        state.applyCloudStateForTesting(cloud)

        XCTAssertEqual(state.pointsBalance, 900)
        XCTAssertEqual(state.lifetimePoints, 1200)
        XCTAssertTrue(state.isCollected("osm-1"))
        XCTAssertTrue(state.isCheckedIn("e1"))
    }

    /// Once the server is proven AND the queue is drained, its balance is truth —
    /// including a *decrease* (e.g. a redemption made on another device).
    func testConfirmedServerBalanceIsAuthoritative() {
        let state = GameStateManager()
        state.pointsBalance = 5000       // stale local value
        state.lifetimePoints = 5000
        state.markServerConfirmedForTesting()

        let cloud = CloudGameState(
            collectedPlaceIDs: [], checkedInEventIDs: [],
            pointsBalance: 250, lifetimePoints: 5000, redeemedRewardIDs: ["starbucks-5"])
        state.applyCloudStateForTesting(cloud)

        XCTAssertEqual(state.pointsBalance, 250,
                       "a confirmed server may legitimately lower the balance")
        XCTAssertTrue(state.isRedeemed("starbucks-5"))
    }

    /// Even with a confirmed server, work still queued must not be clobbered.
    func testQueuedWorkBlocksAdoptionOfLowerBalance() {
        let state = GameStateManager()
        state.markServerConfirmedForTesting()
        let earned = state.collectPlace(TestFixtures.collectible)   // queues an op

        let cloud = CloudGameState(
            collectedPlaceIDs: [], checkedInEventIDs: [],
            pointsBalance: 0, lifetimePoints: 0, redeemedRewardIDs: [])
        state.applyCloudStateForTesting(cloud)

        XCTAssertEqual(state.pointsBalance, earned,
                       "pending ops mean the cloud balance is stale by definition")
    }

    /// Collected-place IDs always survive a merge (superset semantics).
    func testMergeKeepsSupersetOfIdentifiers() {
        let state = GameStateManager()
        _ = state.collectPlace(TestFixtures.collectible)
        let localID = TestFixtures.collectible.id

        let cloud = CloudGameState(
            collectedPlaceIDs: ["cloud-only-place"], checkedInEventIDs: ["cloud-only-event"],
            pointsBalance: 0, lifetimePoints: 0, redeemedRewardIDs: [])
        state.applyCloudStateForTesting(cloud)

        XCTAssertTrue(state.isCollected(localID), "local collection survives")
        XCTAssertTrue(state.isCollected("cloud-only-place"), "cloud collection merges in")
        XCTAssertTrue(state.isCheckedIn("cloud-only-event"))
    }
}
