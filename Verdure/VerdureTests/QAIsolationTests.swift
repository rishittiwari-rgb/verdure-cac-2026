import XCTest
import FirebaseFirestore
@testable import Verdure

final class QAIsolationTests: XCTestCase {
    func testUnitHostUsesPlaintextLocalFirestore() {
        let settings = Firestore.firestore().settings
        XCTAssertEqual(settings.host, "127.0.0.1:8899", "Tests must never use the configured live project")
        XCTAssertFalse(settings.isSSLEnabled)
        XCTAssertTrue(settings.cacheSettings is MemoryCacheSettings)
    }
}
