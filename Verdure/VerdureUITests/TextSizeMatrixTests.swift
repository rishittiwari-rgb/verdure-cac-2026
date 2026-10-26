import XCTest

// MARK: - Accessibility text-size screenshot matrix
//
// WHY THIS EXISTS SEPARATELY FROM THE AUDITS.
// `QA.audit` deliberately excludes the VISUAL audit types (dynamic type,
// contrast, clipping) — running them across these dense clay screens blows the
// audit engine's internal time budget (error -56). QA.md designates a
// light/dark x text-size screenshot matrix as the substitute. That makes this
// file — not AccessibilityAuditTests — the actual Dynamic Type check, so a
// green audit run is NOT evidence that a layout survives accessibility sizes.
//
// Screenshots land as XCTAttachments in the .xcresult; pull them out with:
//
//   xcrun xcresulttool export attachments \
//     --path <result>.xcresult --output-path <dir>
//
// Covers the screens changed this cycle. The planner is the one that needs it
// most: four duration chips share a single row, so it's the layout most likely
// to truncate before it wraps.

@MainActor
final class TextSizeMatrixTests: XCTestCase {

    /// UIKit reads this launch argument to force a content size category —
    /// the same lever the Settings > Accessibility > Larger Text slider moves.
    private static let accessibilityXL = [
        "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL",
    ]

    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways   // keep on success too — the point is review
        add(shot)
    }

    private func matrix(tab: String, anchor: String, dark: Bool) throws {
        var args = Self.accessibilityXL
        if dark { args += ["-prefersDarkMode", "YES"] }
        let app = QA.launch(tab: tab, extraArguments: args)
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts[anchor], "\(tab) anchor at accessibility XL")
        capture(app, "\(tab)-XL-\(dark ? "dark" : "light")")

        // A single screenshot only proves the ABOVE-THE-FOLD layout survives —
        // at accessibility sizes everything below is pushed off-screen and goes
        // unreviewed, which is exactly where truncation hides. Step down the
        // screen one swipe at a time rather than jumping: two swipes at once
        // skipped a whole section on Explore the first time this ran, and a
        // section nobody screenshots is a section nobody checks.
        for step in 1...3 {
            app.swipeUp()
            capture(app, "\(tab)-XL-\(dark ? "dark" : "light")-scroll\(step)")
        }
    }

    func testExploreAtAccessibilityXL() throws {
        try matrix(tab: "explore", anchor: "Explore", dark: false)
    }

    /// The DEFAULT text size baseline.
    ///
    /// Without this the matrix only ever shows the accessibility end, so a fix
    /// that rescues XL by wrecking the normal layout looks like a clean pass.
    /// The quest cards in particular are content-hugging with a 184pt floor —
    /// this is what proves that floor still holds at default size, where the
    /// overwhelming majority of users actually are.
    func testExploreAtDefaultTextSize() throws {
        let app = QA.launch(tab: "explore")
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts["Explore"], "explore anchor at default text size")
        capture(app, "explore-default")
        for step in 1...3 {
            app.swipeUp()
            capture(app, "explore-default-scroll\(step)")
        }
    }

    func testExploreAtAccessibilityXLDark() throws {
        try matrix(tab: "explore", anchor: "Explore", dark: true)
    }

    func testProfileAtAccessibilityXL() throws {
        try matrix(tab: "profile", anchor: "YOUR PROFILE", dark: false)
    }

    func testCommunityAtAccessibilityXL() throws {
        try matrix(tab: "community", anchor: "Community", dark: false)
    }

    func testPlanAtAccessibilityXL() throws {
        try matrix(tab: "plan", anchor: "Make a plan.", dark: false)
    }

    func testFriendsAtAccessibilityXL() throws {
        try matrix(tab: "friends", anchor: "Together, nearby.", dark: false)
    }

    func testRewardsAtAccessibilityXL() throws {
        try matrix(tab: "rewards", anchor: "AVAILABLE POINTS", dark: false)
    }

    /// The planner sheet at the largest text size, light and dark.
    /// Its duration row is four chips wide — if anything clips, it's here.
    func testAdventurePlannerAtAccessibilityXL() throws {
        for dark in [false, true] {
            var args = Self.accessibilityXL
            if dark { args += ["-prefersDarkMode", "YES"] }
            let app = QA.launch(tab: "explore", extraArguments: args)
            let entry = QA.waitFor(app.buttons["Plan my adventure"].firstMatch, "planner entry")
            // The floating tab bar is taller at accessibility sizes. Bring
            // the tile well above it before tapping, rather than letting
            // XCTest auto-scroll its center onto the bar's hit region.
            for _ in 0..<8 {
                let midpoint = entry.frame.midY
                if entry.isHittable && midpoint > 120 && midpoint < app.frame.height - 190 { break }
                app.swipeUp()
            }
            XCTAssertTrue(entry.isHittable, "planner tile must clear the floating tab bar at XL")
            entry.tap()
            let header = app.staticTexts["How long have you got?"]
            guard header.waitForExistence(timeout: 12) else {
                XCTFail("planner sheet did not open at accessibility XL")
                app.terminate()
                continue
            }
            capture(app, "adventure-planner-XL-\(dark ? "dark" : "light")")

            // Every duration option must remain hittable at XL — a chip that
            // has collapsed to zero width still "exists" in the tree.
            for label in ["1 hour", "2 hours", "3 hours", "4 hours"] {
                let chip = app.buttons[label]
                XCTAssertTrue(chip.exists, "duration chip '\(label)' missing at accessibility XL")
                XCTAssertTrue(chip.isHittable, "duration chip '\(label)' not hittable at accessibility XL")
                // Tolerance is deliberate. The chips are laid out at exactly
                // 44pt, but the frame comes back as 43.999969482421875 — a
                // float artifact of the accessibility frame conversion, not a
                // shrunken target. Asserting a bare >= 44 fails on a 0.00003pt
                // difference no user could ever experience, so the right fix is
                // the tolerance, NOT padding the button to 45 to appease it.
                XCTAssertGreaterThanOrEqual(chip.frame.height, 43.5,
                    "duration chip '\(label)' below the 44pt minimum target at accessibility XL")
            }
            app.terminate()
        }
    }

    /// The paywall sells the subscription — clipped benefit copy here is a
    /// billing-clarity problem, not just a cosmetic one.
    func testPaywallAtAccessibilityXL() throws {
        let app = QA.launch(tab: "profile", extraArguments: Self.accessibilityXL)
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts["Verdure+"].firstMatch, "Verdure+ settings row").tap()
        QA.waitFor(app.buttons["Start Verdure Plus"], "paywall CTA at XL")
        capture(app, "paywall-XL-light")
    }
}
