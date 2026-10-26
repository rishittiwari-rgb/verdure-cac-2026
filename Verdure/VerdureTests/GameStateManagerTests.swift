import XCTest
import CoreLocation
@testable import Verdure

// MARK: - GameStateManager transaction-logic smoke tests
//
// Confirmed attendance never enters the retry queue. Place collections retain
// their existing retry semantics. These are local units, not live server proof.

@MainActor
final class GameStateManagerTests: XCTestCase {

    private let gameStateKeys = [
        "collectedPlaceIDs", "checkedInEventIDs", "pointsBalance", "lifetimePoints",
        "redeemedRewardIDs", "savedEventIDs", "savedPlaceIDs", "pendingServerOps",
        "earnHistory", "streakCount", "streakLastDay", "challengeBonusXP",
        "completedChallengeKeys", "earnedBadges", "notificationInbox",
    ]

    override func setUp() async throws {
        wipePersistedState()
    }

    override func tearDown() async throws {
        wipePersistedState()
        try? FileManager.default.removeItem(at: GameStateManager.proofsDirectory)
    }

    private func wipePersistedState() {
        for key in gameStateKeys { UserDefaults.standard.removeObject(forKey: key) }
        // Suppress the demo seed so managers start empty and deterministic.
        UserDefaults.standard.set(true, forKey: "gameStateSeeded_v2")
    }

    private func freshManager() -> GameStateManager { GameStateManager() }

    /// A real fresh install (no QA fixture flag) must start with nothing earned. The demo
    /// seed used to run unconditionally: 280 points, two sample check-ins and a sample
    /// collection that sign-in then synced into the user's Firestore document.
    func testFreshInstallStartsEmptyOutsideTheFixtureHarness() {
        UserDefaults.standard.removeObject(forKey: "gameStateSeeded_v2")
        UserDefaults.standard.removeObject(forKey: "QAOfflineData")
        XCTAssertFalse(SampleData.isEnabled)
        let gs = freshManager()
        XCTAssertEqual(gs.pointsBalance, 0)
        XCTAssertEqual(gs.lifetimePoints, 0)
        XCTAssertTrue(gs.collectedPlaceIDs.isEmpty)
        XCTAssertTrue(gs.checkedInEventIDs.isEmpty)
    }

    // Fixtures use their OWN ids: SampleData ids are refused at the earn boundary
    // (fabricated content can never earn), so a test that used them would prove
    // nothing.
    private var sampleEvent: Event { TestFixtures.event }            // 200-pt hackathon
    private var samplePlace: CollectiblePlace { TestFixtures.collectible }
    private var sampleReward: Reward { SampleData.rewards[0] }       // cheapest catalog entry

    // MARK: Check-in

    func testConfirmedAttendanceUsesServerAwardAndNeverQueues() {
        let state = freshManager()
        let awarded = state.acceptAttendanceForTesting(sampleEvent, awarded: 75)
        XCTAssertEqual(awarded, 75)
        XCTAssertEqual(state.pointsBalance, 75)
        XCTAssertEqual(state.lifetimePoints, 75)
        XCTAssertTrue(state.isCheckedIn(sampleEvent.id))
        XCTAssertTrue(state.pendingOps.isEmpty)
        XCTAssertTrue(state.serverConfirmed)
    }

    func testConfirmedDoubleCheckInIsANoOp() {
        let state = freshManager()
        _ = state.acceptAttendanceForTesting(sampleEvent)
        XCTAssertEqual(state.acceptAttendanceForTesting(sampleEvent), 0)
        XCTAssertEqual(state.pointsBalance, sampleEvent.pointValue)
        XCTAssertTrue(state.pendingOps.isEmpty)
    }

    func testLegacyAttendanceProofIsRemovedRatherThanUploadedLater() throws {
        let file = StorageService.proofFileName(for: sampleEvent.id)
        let url = GameStateManager.proofsDirectory.appendingPathComponent(file)
        try Data([0xFF, 0xD8]).write(to: url)
        let op = GameStateManager.PendingOp(kind: .checkIn, id: sampleEvent.id, category: "Social", points: 100, proofFile: file)
        UserDefaults.standard.set(try JSONEncoder().encode([op]), forKey: "pendingServerOps")
        let state = freshManager()
        XCTAssertTrue(state.pendingOps.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }

    // MARK: Place collection

    func testCollectPlaceAwardsOnceAndQueuesOp() {
        let state = freshManager()

        let first = state.collectPlace(samplePlace)
        let second = state.collectPlace(samplePlace)

        XCTAssertEqual(first, samplePlace.pointValue)
        XCTAssertEqual(second, 0, "double collect must award nothing")
        XCTAssertEqual(state.pointsBalance, samplePlace.pointValue)
        XCTAssertTrue(state.isCollected(samplePlace.id))
        XCTAssertEqual(state.pendingOps.filter { $0.kind == .collect }.count, 1)
    }

    // MARK: Redeem (signed-out local path — server path needs live Functions)

    func testRedeemSignedOutIsRefusedNotFaked() async {
        // The old "demo mode" deducted points locally and delivered nothing —
        // a fabricated reward. Signed out, redemption must be refused outright.
        let state = freshManager()
        state.pointsBalance = sampleReward.pointCost + 250

        let result = await state.redeemReward(sampleReward)

        XCTAssertEqual(result, .signInRequired)
        XCTAssertEqual(state.pointsBalance, sampleReward.pointCost + 250, "no points may move without a server")
        XCTAssertFalse(state.isRedeemed(sampleReward.id))
    }

    func testSampleContentCanNeverEarn() {
        let state = freshManager()
        XCTAssertEqual(state.acceptAttendanceForTesting(SampleData.events[0]), 0)
        XCTAssertEqual(state.collectPlace(SampleData.collectiblePlaces[0]), 0)
        XCTAssertEqual(state.pointsBalance, 0)
        XCTAssertTrue(state.pendingOps.isEmpty, "fixture ids must never reach the server queue")
    }

    func testRedeemRejectsInsufficientPoints() async {
        let state = freshManager()
        state.pointsBalance = sampleReward.pointCost - 1

        let result = await state.redeemReward(sampleReward)

        XCTAssertEqual(result, .notEnoughPoints)
        XCTAssertEqual(state.pointsBalance, sampleReward.pointCost - 1, "no deduction on failure")
        XCTAssertFalse(state.isRedeemed(sampleReward.id))
    }

    /// Signed out, redemption must REFUSE rather than deduct.
    ///
    /// This test used to assert that one of two concurrent redemptions
    /// succeeded locally. That behaviour was removed deliberately: without an
    /// account no fulfilment is possible, so "succeeding" took points and
    /// delivered nothing — a fabricated reward. The double-tap coverage is kept;
    /// the expectation is now that BOTH are refused and no points move.
    func testFastDoubleRedeemDeductsNothingWhenSignedOut() async {
        let state = freshManager()
        let reward = sampleReward                      // hoisted: async-let children may not touch self
        state.pointsBalance = reward.pointCost         // could afford one, if it were allowed

        async let a = state.redeemReward(reward)
        async let b = state.redeemReward(reward)
        let results = await [a, b]

        XCTAssertTrue(results.allSatisfy { $0 != .success }, "no redemption may succeed without an account")
        XCTAssertTrue(results.contains(.signInRequired), "the refusal should say why")
        XCTAssertEqual(state.pointsBalance, reward.pointCost, "no points may be deducted")
        XCTAssertFalse(state.isRedeemed(reward.id))
    }

    // MARK: Queue persistence (offline replay survives relaunch)

    func testPendingOpsPersistAcrossManagerInstances() {
        let first = freshManager()
        _ = first.collectPlace(samplePlace)
        XCTAssertEqual(first.pendingOps.count, 1)

        // Simulate an app relaunch: a brand-new manager must reload the queue.
        let second = GameStateManager()
        XCTAssertEqual(second.pendingOps, first.pendingOps,
                       "queued server ops must survive relaunch for offline replay")
    }

    func testLegacyQueuePayloadStillDecodes() throws {
        // v1 ops (before proof/GPS fields existed) must keep decoding.
        let legacyJSON = #"[{"kind":"checkIn","id":"old-event","category":"Social","points":100}]"#
        UserDefaults.standard.set(Data(legacyJSON.utf8), forKey: "pendingServerOps")

        let state = GameStateManager()

        XCTAssertTrue(state.pendingOps.isEmpty, "Legacy attendance decodes but cannot be replayed")
    }

    // MARK: Reset

    func testResetAllClearsEverything() {
        let state = freshManager()
        _ = state.acceptAttendanceForTesting(sampleEvent)
        _ = state.collectPlace(samplePlace)

        state.resetAll()

        XCTAssertEqual(state.pointsBalance, 0)
        XCTAssertEqual(state.lifetimePoints, 0)
        XCTAssertTrue(state.checkedInEventIDs.isEmpty)
        XCTAssertTrue(state.collectedPlaceIDs.isEmpty)
        XCTAssertTrue(state.redeemedRewardIDs.isEmpty)
        XCTAssertTrue(state.pendingOps.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: GameStateManager.proofsDirectory
                .appendingPathComponent(StorageService.proofFileName(for: sampleEvent.id)).path),
            "spooled proof photos are wiped on reset")
    }
}
