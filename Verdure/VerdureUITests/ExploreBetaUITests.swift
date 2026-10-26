import XCTest

@MainActor final class ExploreBetaUITests: XCTestCase {
    func testOptionalBetaCameraAndMapReturn() {
        continueAfterFailure = false
        let app = QA.launch(tab: "map")
        XCTAssertFalse(app.buttons["closeExploreBeta"].exists)
        QA.waitFor(app.buttons["openExploreBeta"], "Optional Explore view").tap()
        QA.waitFor(app.buttons["closeExploreBeta"], "Back to map")
        // A simulator has no real camera/compass; this proves the optional
        // surface, disclosure and fallback, never physical overlay accuracy.
        if app.alerts.firstMatch.waitForExistence(timeout: 3) {
            let allow = app.alerts.buttons["Allow"]
            if allow.exists { allow.tap() } else { app.alerts.buttons.firstMatch.tap() }
        }
        XCTAssertTrue(app.staticTexts["Explore view (beta)"].exists)
        QA.waitFor(app.buttons["exploreBetaNearbyList"], "Nearby list").tap()
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "explore-beta-simulator-fallback"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.buttons["closeExploreBeta"].tap()
        XCTAssertTrue(app.buttons["openExploreBeta"].waitForExistence(timeout: 5))
    }
}
