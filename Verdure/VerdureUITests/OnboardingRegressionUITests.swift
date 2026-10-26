import XCTest

/// Regression guard for the blank-onboarding bug: on a fresh install the pager showed
/// Back, Continue and five dots with no page content and no dot lit. Runs the real
/// first-launch path (motion on, no sample data) and checks every page.
@MainActor
final class OnboardingRegressionUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private let titles = [
        "Step Outside.\nConnect Within.",
        "Earn Rewards\nFor Exploring",
        "Build Real\nConnections",
        "What draws you\noutdoors?",
    ]

    private func freshInstallLaunch() -> XCUIApplication {
        let app = XCUIApplication()
        // A fresh install has no stored onboarding state; force the same for this run.
        // Motion off only so XCUITest can reach idle between steps (the medallion and
        // idle-float animations repeat forever); the paging logic under test is unchanged.
        app.launchArguments += ["-QAFreshInstall", "YES", "-QAOfflineData", "NO", "-QADisableMotion", "YES"]
        app.launch()
        return app
    }

    private func assertPage(_ app: XCUIApplication, index: Int, file: StaticString = #filePath, line: UInt = #line) {
        let title = app.staticTexts[titles[index]]
        XCTAssertTrue(title.waitForExistence(timeout: 8), "page \(index + 1) title missing", file: file, line: line)
        // Visible = on screen with a real size, not merely in the tree.
        XCTAssertTrue(title.isHittable || app.windows.firstMatch.frame.intersects(title.frame),
                      "page \(index + 1) title not on screen", file: file, line: line)
        XCTAssertGreaterThan(title.frame.height, 10, "page \(index + 1) title has no size", file: file, line: line)
        // Two-line titles must keep both lines (the interests page once squeezed to "What draws you…").
        XCTAssertGreaterThanOrEqual(title.frame.height, 55, "page \(index + 1) title truncated", file: file, line: line)
        // The top bar must stay below the status bar (it was pushed up over the clock).
        let topControl = app.buttons[index == 0 ? "Skip" : "Back"]
        if topControl.exists {
            XCTAssertGreaterThanOrEqual(topControl.frame.minY, 44, "page \(index + 1) top bar under the status bar", file: file, line: line)
        }
        let dots = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'onboardingDots-'")).firstMatch
        XCTAssertTrue(dots.waitForExistence(timeout: 4), "page dots missing", file: file, line: line)
        XCTAssertEqual(dots.identifier, "onboardingDots-\(index)", "exactly dot \(index + 1) should be lit", file: file, line: line)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "onboarding-page-\(index + 1)"; shot.lifetime = .keepAlways
        add(shot)
    }

    private func litDot(_ app: XCUIApplication) -> String? {
        let dots = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'onboardingDots-'")).firstMatch
        return dots.exists ? dots.identifier : nil
    }

    /// One Continue tap. If the simulator drops the synthesized touch (the page and its
    /// lit dot are both unchanged after 10 s), tap once more; a tap that registered is never repeated.
    private func tapContinue(_ app: XCUIApplication) {
        let cta = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Continue'")).firstMatch
        // The pager animates between pages; tap once the button has settled, and require the move.
        XCTAssertTrue(QA.waitUntilStable(cta), "Continue never settled")
        let before = litDot(app)
        cta.tap()
        let moved = NSPredicate { _, _ in self.litDot(app) != before }
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: moved, evaluatedWith: nil)], timeout: 10), .completed,
                       "Continue did not advance from page \(before)")
    }

    func testEveryOnboardingPageShowsContentAndOneLitDot() {
        let app = freshInstallLaunch()
        for index in titles.indices {
            assertPage(app, index: index)
            if index < titles.count - 1 { tapContinue(app) }
        }
        // Back walks the same pages in reverse with content intact.
        for index in stride(from: titles.count - 2, through: 0, by: -1) {
            let back = app.buttons["Back"]
            XCTAssertTrue(back.waitForExistence(timeout: 4), "Back missing")
            back.tap()
            assertPage(app, index: index)
        }
        // Forward again into auth, then as a guest into the main tabs.
        for _ in 0..<titles.count { tapContinue(app) }
        let guest = app.buttons["Continue as guest"].firstMatch
        XCTAssertTrue(guest.waitForExistence(timeout: 8), "auth page did not appear")
        XCTAssertTrue(app.staticTexts["Verdure"].exists, "auth page title missing")
        guest.tap()
        XCTAssertTrue(app.buttons["Discover"].firstMatch.waitForExistence(timeout: 10), "main tabs not reached")
        XCTAssertTrue(app.buttons["Profile"].firstMatch.exists, "main tabs not reached")
    }

    /// The original symptom: a second Continue tap that lands while the last pager page is
    /// animating out pushed the index past the sign-in step, leaving Back, Continue and five
    /// unlit dots with no content. Rapid taps must stop at sign-in.
    func testRapidContinueOnLastPageStopsAtSignIn() {
        let app = freshInstallLaunch()
        for index in 0..<(titles.count - 1) {
            assertPage(app, index: index)
            tapContinue(app)
        }
        assertPage(app, index: titles.count - 1)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Continue'")).firstMatch.doubleTap()
        XCTAssertTrue(app.buttons["Continue as guest"].firstMatch.waitForExistence(timeout: 8),
                      "rapid taps overshot the sign-in step")
        let unlit = app.otherElements["onboardingDots-"]
        XCTAssertFalse(unlit.exists, "blank pager page with no dot lit")
    }
}
