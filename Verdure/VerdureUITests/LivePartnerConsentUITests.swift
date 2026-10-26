import XCTest

@MainActor final class LivePartnerConsentUITests: XCTestCase {
    func testNearbyDealsRequireSeparatePromotionalConsent() {
        continueAfterFailure = false
        let app = QA.launch(tab: "profile", extraArguments: ["-QAOfflineData", "NO", "-QAUseFirestoreEmulator", "YES", "-QAResetAuth", "YES"])
        let signIn = app.buttons["profileSignIn"]
        QA.reveal(signIn, in: app, maxSwipes: 20)
        QA.waitFor(signIn, "Sign in").tap()
        let email = QA.waitFor(app.textFields["Email address"], "Email")
        QA.type("qa-stories-native-owner@example.test\n", into: email)
        let password = app.secureTextFields["Password"]
        QA.type("local-story-native-only\n", into: password)   // Return closes the keyboard that covers submit
        let submit = app.buttons["authSubmit"]
        QA.reveal(submit, in: app, maxSwipes: 4)
        QA.waitFor(submit, "Sign-in submit").tap()
        QA.waitForSignedIn(app)
        // This fixture account owns an approved organizer. Its row loads after sign-in, grows to two
        // lines and pushes the rows below it down; the Notifications tap landed during that move and
        // the sheet never opened. Position and tap once the row has landed.
        QA.waitFor(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Organizer profile'")).firstMatch, "organizer row", timeout: 20)
        let notifications = app.buttons["Notifications"]
        QA.reveal(notifications, in: app, maxSwipes: 25)
        XCTAssertTrue(QA.waitUntilStable(QA.waitFor(notifications, "Notifications settings")), "Notifications row never settled")
        notifications.tap()
        let toggle = app.switches["livePartnerAlertsToggle"]
        QA.reveal(toggle, in: app, maxSwipes: 5)
        QA.waitFor(toggle, "Adult-only nearby deals", timeout: 20)
        XCTAssertEqual(toggle.value as? String, "0", "Off by default")
        // The labelled SwiftUI wrapper includes the text; tap its actual
        // native switch, rather than depending on label hit-test propagation.
        let nativeSwitch = toggle.switches.firstMatch
        let target = nativeSwitch.exists ? nativeSwitch : toggle
        // The sheet scrolls and its preferences load after it appears; tap once it has settled.
        XCTAssertTrue(QA.waitUntilStable(target), "deals switch never settled")
        target.tap()
        QA.waitFor(app.buttons["confirmLivePartnerConsent"], "Separate promotional consent")
        XCTAssertFalse(app.alerts.firstMatch.exists, "The toggle alone must not request Always location")
        let consent = XCTAttachment(screenshot: app.screenshot()); consent.name = "live-partner-promotional-consent"; consent.lifetime = .keepAlways; add(consent)
        app.buttons["Not now"].tap()
        XCTAssertEqual(toggle.value as? String, "0", "Cancelling never enables monitoring")
    }
}
