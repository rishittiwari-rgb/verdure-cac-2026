import XCTest

// MARK: - Automated accessibility audits (Apple's audit engine, iOS 17+)
//
// One audit per primary screen. Missing labels / bad hit regions / trait
// problems FAIL; contrast + dynamic-type + clipping findings are recorded as
// activity notes and tracked as design-system items in QA.md.

@MainActor
final class AccessibilityAuditTests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    private func auditTab(_ tab: String, anchor: String) throws {
        let app = QA.launch(tab: tab)
        // Terminate at the end of each test so the next audit can't attach to a
        // stale process (a source of "Invalid target app" on CI).
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts[anchor], "\(tab) anchor '\(anchor)'")
        try QA.audit(app, screen: tab)
    }

    func testAuditEventsTab() throws     { try auditTab("events", anchor: "Events") }
    func testAuditExploreTab() throws    { try auditTab("explore", anchor: "Explore") }
    func testAuditCollectTab() throws    { try auditTab("collect", anchor: "Places collected") }
    func testAuditCommunityTab() throws  { try auditTab("community", anchor: "Community") }
    func testAuditProfileTab() throws    { try auditTab("profile", anchor: "YOUR PROFILE") }
    func testAuditPlanTab() throws       { try auditTab("plan", anchor: "Make a plan.") }
    func testAuditFriendsTab() throws    { try auditTab("friends", anchor: "Together, nearby.") }

    func testAuditRewardsStore() throws {
        let app = QA.launch(tab: "rewards")
        QA.waitFor(app.staticTexts["AVAILABLE POINTS"], "rewards store")
        try QA.audit(app, screen: "rewards-store")
    }

    func testAuditPaywall() throws {
        let app = QA.launch(tab: "profile")
        let plus = QA.waitFor(app.staticTexts["Verdure+"].firstMatch, "Verdure+ settings row")
        QA.reveal(plus, in: app, maxSwipes: 4)   // the row sits under the floating tab bar
        plus.tap()
        QA.waitFor(app.buttons["Start Verdure Plus"], "paywall CTA")
        try QA.audit(app, screen: "paywall")
    }

    /// The Adventure Planner sheet. Audited WITHOUT generating a plan: the
    /// planner needs a deployed Cloud Function, so a test that tried to produce
    /// an itinerary would either hit the network or quietly assert nothing.
    /// The controls the user meets first — duration chips and the CTA — are on
    /// screen immediately and are what this checks.
    func testAuditAdventurePlanner() throws {
        let app = QA.launch(tab: "explore")
        addTeardownBlock { app.terminate() }
        let entry = QA.waitFor(app.buttons["Plan my adventure"].firstMatch,
                               "adventure planner entry tile")
        // The tile sits below the fold when few sample places are in range (simulator
        // location); bring it above the floating tab bar so the tap reaches it.
        for _ in 0..<6 where !(entry.isHittable && entry.frame.maxY < app.frame.height - 140) { QA.scroll(app) }
        QA.settle(entry)
        entry.tap()
        QA.waitFor(app.staticTexts["How long have you got?"], "planner sheet")
        try QA.audit(app, screen: "adventure-planner")
    }

    // MARK: Surfaces added this sprint
    //
    // H4. Each of these is a screen a user can reach and act on, so each gets
    // the same audit the older screens get rather than a visual once-over.

    func testAuditNotificationSettings() throws {
        let app = QA.launch(tab: "profile")
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts["Notifications"].firstMatch, "notifications settings row").tap()
        QA.waitFor(app.staticTexts["What we send"], "notification settings sheet")
        try QA.audit(app, screen: "notification-settings")
    }

    func testAuditMyPerkCodes() throws {
        let app = QA.launch(tab: "rewards")
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts["AVAILABLE POINTS"], "rewards store")
        // My Codes is reachable whether or not any code has been claimed — the
        // empty state is itself a surface that has to pass.
        let myCodes = app.buttons["My Codes"].firstMatch
        if myCodes.waitForExistence(timeout: 4) {
            myCodes.tap()
            try QA.audit(app, screen: "my-perk-codes")
        } else {
            XCTFail("My Codes entry point is missing from the rewards store")
        }
    }

    // MARK: W5 — reasons line, "Why you're seeing this", hide, series dates
    //
    // `-QAFeedReasons YES` seeds a deterministic ranked feed from SampleData
    // (server-shaped reasons and series dates), so the controls exist without
    // a deployed callable. Every surface a user can act on gets the audit.

    private func forYouCard(_ app: XCUIApplication, titled title: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", title, "Why: "))
            .firstMatch
    }

    func testAuditForYouReasonsLine() throws {
        let app = QA.launch(tab: "events", extraArguments: ["-QAFeedReasons", "YES"])
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts["Events"], "events anchor")
        let card = forYouCard(app, titled: "Spring Community Hackathon")
        QA.waitFor(card, "For You card carrying a 'Why:' reasons line", timeout: 20)
        // One element, one label: facts, then "Why: <reason> · <reason>", then the series.
        XCTAssertTrue(card.label.contains("Why: Matches your interest in tech · Close by (0.8 mi)"), card.label)
        XCTAssertTrue(card.label.contains("Repeats — 2 more dates"), card.label)
        try QA.audit(app, screen: "events-for-you-reasons")
    }

    func testAuditEventDetailWhyHideAndSeriesDates() throws {
        let app = QA.launch(tab: "events", extraArguments: ["-QAFeedReasons", "YES"])
        addTeardownBlock { app.terminate() }
        QA.waitFor(app.staticTexts["Events"], "events anchor")
        let card = forYouCard(app, titled: "Spring Community Hackathon")
        QA.waitFor(card, "For You card with reasons", timeout: 20)
        QA.reveal(card, in: app, maxSwipes: 4)
        // Tap the upper part of the card, clear of the in-card series button.
        card.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()

        let why = app.descendants(matching: .any)["whySeeingThis"]
        QA.waitFor(why, "'Why you're seeing this' section")
        XCTAssertTrue(why.label.contains("Matches your interest in tech"), why.label)
        XCTAssertTrue(why.label.contains("Close by (0.8 mi)"), why.label)
        XCTAssertTrue(why.label.contains("Repeats — 2 more dates"), why.label)
        let hide = app.buttons["hideEvent"]
        QA.reveal(hide, in: app, maxSwipes: 4)
        QA.waitFor(hide, "Hide this event control")
        XCTAssertTrue(app.buttons["feedbackLess"].exists, "Show less like this control")
        XCTAssertTrue(app.buttons["feedbackMore"].exists)
        try QA.audit(app, screen: "event-detail-why")

        // The series affordance opens the dates list.
        QA.waitFor(app.buttons["seriesMoreDates"], "Repeats — N more dates").tap()
        QA.waitFor(app.navigationBars["More dates"], "series dates sheet")
        try QA.audit(app, screen: "series-dates")
        app.buttons["seriesDatesDone"].tap()

        // Hide removes the card from the feed immediately (offline: local only).
        QA.reveal(hide, in: app, maxSwipes: 4)
        hide.tap()
        let stillThere = forYouCard(app, titled: "Spring Community Hackathon")
        XCTAssertFalse(stillThere.waitForExistence(timeout: 3), "hidden event must leave the For You feed at once")
        XCTAssertTrue(forYouCard(app, titled: "River Cleanup Day").waitForExistence(timeout: 10),
                      "the other ranked cards keep their reasons")
    }

    func testAuditOnboardingFirstPage() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-hasCompletedOnboarding", "NO", "-QADisableMotion", "YES", "-QAOfflineData", "YES"]
        app.launch()
        QA.waitFor(app.staticTexts["Step Outside.\nConnect Within."], "onboarding hero title")
        try QA.audit(app, screen: "onboarding-1")
    }
}
