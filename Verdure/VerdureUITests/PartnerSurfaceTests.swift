import XCTest
import CoreLocation

@MainActor final class PartnerSurfaceTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func post(_ url: String, _ body: [String: Any], token: String? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: url)!)
        request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (bytes, response) = try await URLSession.shared.data(for: request)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200, "Local fixture request failed: \(result)")
        return result
    }

    /// The fixture partners sit here (the old CLI-set simulator location).
    private let partnerOrigin = CLLocation(latitude: 33.2, longitude: -114.1)

    private func signInToFixture() -> XCUIApplication {
        let app = QA.launch(tab: "profile", extraArguments: ["-QAOfflineData", "NO", "-QAUseFirestoreEmulator", "YES", "-QAResetAuth", "YES"], location: partnerOrigin)
        let signIn = app.buttons["profileSignIn"]
        QA.reveal(signIn, in: app, maxSwipes: 20)
        QA.waitFor(signIn, "guest sign-in").tap()
        let email = QA.waitFor(app.textFields["Email address"], "email")
        QA.type("qa-rewards-native-staff@example.test\n", into: email)
        let password = app.secureTextFields["Password"]
        QA.type("local-rewards-native-only\n", into: password)   // Return closes the keyboard that covers submit
        let submit = app.buttons["authSubmit"]
        QA.reveal(submit, in: app, maxSwipes: 4)
        QA.waitFor(submit, "sign-in submit").tap()
        QA.waitForSignedIn(app)
        return app
    }

    func testLiveStaffWithdrawalDismissesOpenMapOffer() async throws {
        // Run with a CLI-set simulated location at 33.2,-114.1 and location
        // authorization. This proves native sheet behavior, not outdoor GPS.
        let signedIn = try await post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local",
            ["email": "qa-rewards-native-staff@example.test", "password": "local-rewards-native-only", "returnSecureToken": true])
        let token = try XCTUnwrap(signedIn["idToken"] as? String)
        func call(_ name: String, _ data: [String: Any]) async throws {
            let response = try await post("http://127.0.0.1:5002/connectify-19dd8/us-central1/\(name)", ["data": data], token: token)
            XCTAssertNotNil(response["result"], "Local fixture callable failed: \(response)")
        }
        let partnerID = "qa-rewards-native-partner", perkID = "qa-rewards-native-map-ui"
        try await call("savePartner", ["partnerId": partnerID, "name": "Fictional Native Map Business", "category": "retail",
            "address": "42 Fictional Native Rewards Road", "contactName": "Fictional owner", "contactEmail": "fictional-owner@example.test",
            "active": true, "agreement": ["agreedBy": "Fictional owner", "agreedAtMs": Date().addingTimeInterval(-10).timeIntervalSince1970 * 1000,
                                         "reference": "Local fictional QA agreement; no real business"], "reason": "Local map UI fixture"])
        try await call("upsertPartnerPerk", ["partnerId": partnerID, "perkId": perkID, "title": "Fictional Open Map Offer",
            "description": "Local QA only", "terms": "Fictional QA only", "pointCost": 500,
            "expiresAtMs": Date().addingTimeInterval(300).timeIntervalSince1970 * 1000,
            "codes": ["LOCAL-MAP-UI-\(UUID().uuidString)"], "reason": "Local map UI fixture"])
        var app = signInToFixture()
        app.terminate()
        app = QA.launch(tab: "map", extraArguments: ["-QAOfflineData", "NO", "-QAUseFirestoreEmulator", "YES"], location: partnerOrigin)
        let pin = app.buttons["partner-pin:\(perkID)"]
        QA.waitFor(pin, "real callable-backed partner pin", timeout: 40)
        XCTAssertTrue(app.frame.contains(pin.frame), "The actual map annotation must be on screen.")
        // MapKit annotations can reject XCTest's AX scroll-to-visible action
        // despite being visible. Tap the current annotation's measured centre.
        pin.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let detail = app.scrollViews["partnerOfferDetail"]
        QA.waitFor(detail, "open partner detail")
        XCTAssertTrue(app.staticTexts["Fictional Open Map Offer"].exists)
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "Live partner detail before withdrawal"; before.lifetime = .keepAlways; add(before)
        try await call("deactivatePartnerOffer", ["kind": "partner", "targetId": partnerID, "reason": "Withdraw fictional open map business"])
        let closed = NSPredicate { _, _ in !detail.exists && !pin.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: nil)], timeout: 15), .completed,
                       "The open sheet and pin must disappear without dismissal, movement or manual refresh.")
        let after = XCTAttachment(screenshot: app.screenshot())
        after.name = "Live map after partner withdrawal"; after.lifetime = .keepAlways; add(after)
        app.terminate()
    }

    func testSeparateMapLayerControlCanBeToggled() throws {
        let app = QA.launch(tab: "map")
        let toggle = QA.waitFor(app.descendants(matching: .any).matching(identifier: "partnerMapLayer").firstMatch,
                                "partner layer toggle")
        XCTAssertTrue(toggle.isHittable)
        toggle.tap()
        XCTAssertTrue(toggle.exists)
        toggle.tap()
        try QA.audit(app, screen: "partner-map-layer")
    }

    func testRewardsOffersNearbyAndDefaultSort() {
        let app = QA.launch(tab: "rewards")
        QA.waitFor(app.staticTexts["AVAILABLE POINTS"], "Rewards")
        let nearby = QA.waitFor(app.buttons["Nearby"], "Nearby rewards sort")
        nearby.tap()
        // Without a location fix the store says so and keeps the default order; with one
        // (QA.launch answers the permission prompt) Nearby itself is the active order.
        if !app.staticTexts["Location unavailable · using the default order"].waitForExistence(timeout: 5) {
            XCTAssertTrue(nearby.isSelected, "Nearby order should be active when location is available")
        }
        QA.waitFor(app.buttons["Default"], "default rewards order").tap()
    }

    func testActualStaffWithdrawalClosesPendingRewardsConfirmation() async throws {
        // Only the local Auth/Functions endpoints are used. The grant itself
        // comes from rewards-native-fixture.mjs using staff-admin.mjs.
        let signedIn = try await post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local",
            ["email": "qa-rewards-native-staff@example.test", "password": "local-rewards-native-only", "returnSecureToken": true])
        let token = try XCTUnwrap(signedIn["idToken"] as? String)
        XCTAssertEqual(signedIn["localId"] as? String, "qa-rewards-native-staff")
        func call(_ name: String, _ payload: [String: Any]) async throws {
            let result = try await post("http://127.0.0.1:5002/connectify-19dd8/us-central1/\(name)", ["data": payload], token: token)
            XCTAssertNotNil(result["result"], "Local staff callable failed: \(result)")
        }
        // A separate offer keeps the journey independent of SDK tests that
        // legitimately redeemed the stocked fixture earlier in the same run.
        let partnerID = "qa-rewards-native-partner", perkID = "qa-rewards-native-ui"
        try await call("savePartner", ["partnerId": partnerID, "name": "Fictional Native Rewards Business", "category": "retail",
            "address": "42 Fictional Native Rewards Road", "contactName": "Fictional owner", "contactEmail": "fictional-owner@example.test",
            "active": true, "agreement": ["agreedBy": "Fictional owner", "agreedAtMs": Date().addingTimeInterval(-10).timeIntervalSince1970 * 1000,
                                         "reference": "Local fictional QA agreement; no real business"], "reason": "Local UI fixture"])
        try await call("upsertPartnerPerk", ["partnerId": partnerID, "perkId": perkID, "title": "Fictional UI Withdrawal Offer",
            "description": "Local QA only", "terms": "Fictional QA only", "pointCost": 500,
            "expiresAtMs": Date().addingTimeInterval(300).timeIntervalSince1970 * 1000,
            "codes": ["LOCAL-UI-\(UUID().uuidString)"], "reason": "Local UI fixture"])
        var app = signInToFixture()
        app.terminate()
        app = QA.launch(tab: "rewards", extraArguments: ["-QAOfflineData", "NO", "-QAUseFirestoreEmulator", "YES"], location: partnerOrigin)
        let redeem = app.buttons["redeem-perk:\(perkID)"]
        QA.waitFor(redeem, "actual stocked reward", timeout: 30)
        for _ in 0..<8 where redeem.frame.midY >= app.frame.height - 160 { QA.scroll(app) }
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: redeem)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 15), .completed, "Wait for the actual account balance before redemption.")
        XCTAssertTrue(redeem.isHittable)
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "Rewards before redemption confirmation"; before.lifetime = .keepAlways; add(before)
        redeem.tap()
        let confirmation = app.alerts["Redeem this perk?"]
        if !confirmation.waitForExistence(timeout: 5) { print(app.debugDescription.prefix(12000)) }
        QA.waitFor(confirmation, "redemption confirmation")
        try await call("deactivatePartnerOffer", ["kind": "perk", "targetId": perkID, "reason": "Withdraw fictional UI offer"])
        let withdrawn = NSPredicate { _, _ in !confirmation.exists && !redeem.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: withdrawn, object: nil)], timeout: 15), .completed,
                       "Staff withdrawal must remove the row and pending confirmation without a gesture or manual refresh.")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Rewards after live staff withdrawal"; screenshot.lifetime = .keepAlways; add(screenshot)
        try QA.audit(app, screen: "Rewards after live withdrawal")
        app.terminate()
    }
}
