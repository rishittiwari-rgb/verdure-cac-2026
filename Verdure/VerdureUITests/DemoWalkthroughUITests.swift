import XCTest

/// The judge's path through the app against the local emulators with real ingested
/// events: fresh install → onboarding → sign-in → every tab → feed with reasons →
/// event detail → places → place detail → map → settings → Terms/Privacy.
/// Fails if a main screen is blank, shows an error, or hasn't settled within 15 s.
/// Screenshots are attached in order (`NN-name`) so the demo set can be exported.
@MainActor
final class DemoWalkthroughUITests: XCTestCase {
    private var shot = 0
    private let loadTimeout: TimeInterval = 15

    override func setUp() { continueAfterFailure = false }

    // MARK: Helpers

    private func launch() -> XCUIApplication {
        XCUIDevice.shared.location = XCUILocation(location: QA.sanJose)
        let app = XCUIApplication()
        app.launchArguments += [
            "-QAFreshInstall", "YES",
            "-QAUseFirestoreEmulator", "YES", "-QAEmulatorHost", "127.0.0.1",
            "-QAOfflineData", "NO", "-QAResetAuth", "YES", "-QADisableMotion", "YES",
            "-dailyGem.splashDay", QA.today,
        ]
        app.launch()
        return app
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        shot += 1
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = String(format: "%02d-%@", shot, name); a.lifetime = .keepAlways
        add(a)
    }

    /// After sign-in: relaunch signed in with the system prompts answered, then wait for the feed.
    ///
    /// The keychain "Save Password?" sheet is a remote view: a synthesized tap on its "Not Now"
    /// does not reach it, and terminating the app dismisses it. (Sending the app Home did too, but
    /// on its return the app redrew blank and loaded the signed-in feed for seconds, and the next
    /// tap — the Plan tab, the Places segment — was lost.) The location prompt comes back on the
    /// relaunch because nothing answered it; it is answered before the feed settles, since the
    /// location it grants is part of what the feed loads.
    private func relaunchSignedIn(_ app: XCUIApplication) {
        app.terminate()
        app.launchArguments = ["-QAUseFirestoreEmulator", "YES", "-QAEmulatorHost", "127.0.0.1",
                               "-QAOfflineData", "NO", "-QADisableMotion", "YES", "-dailyGem.splashDay", QA.today]
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<3 {
            let alert = springboard.alerts.firstMatch
            guard alert.waitForExistence(timeout: 5) else { break }
            for label in ["Allow While Using App", "Allow Once", "Allow", "OK"] where alert.buttons[label].exists {
                alert.buttons[label].tap(); break
            }
        }
        XCTAssertTrue(app.buttons["Discover"].firstMatch.waitForExistence(timeout: loadTimeout), "the relaunch did not stay signed in")
        // The signed-in feed lands well after the tabs (events, then the ranked slate) and a tap
        // while it re-renders is lost. The ranked slate is the last read: act once its first card
        // has stopped changing.
        let slate = app.buttons.matching(NSPredicate(format: "label CONTAINS ', Why: '")).firstMatch
        XCTAssertTrue(QA.waitUntilStable(slate, quiet: 1.5, timeout: 60), "the signed-in For You slate never settled")
    }

    private static let errorPredicate = NSPredicate(format:
        "label CONTAINS[c] 'couldn’t' OR label CONTAINS[c] 'couldn\\'t' OR label CONTAINS[c] 'something went wrong' " +
        "OR label BEGINSWITH[c] 'error' OR label CONTAINS[c] 'an error occurred' OR label CONTAINS[c] 'isn\\'t configured' " +
        "OR label CONTAINS[c] 'lorem'")

    /// A screen counts as loaded when `anchor` is present, no spinner remains,
    /// it carries real text, and no error copy is on screen — all within 15 s.
    private func assertLoaded(_ app: XCUIApplication, _ screen: String, anchor: XCUIElement,
                              file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(anchor.waitForExistence(timeout: loadTimeout), "\(screen): never appeared", file: file, line: line)
        let settled = NSPredicate { _, _ in app.activityIndicators.count == 0 }
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: settled, evaluatedWith: nil)], timeout: loadTimeout), .completed,
                       "\(screen): still loading after \(Int(loadTimeout)) s", file: file, line: line)
        XCTAssertGreaterThanOrEqual(app.staticTexts.count, 3, "\(screen): blank", file: file, line: line)
        let errors = app.staticTexts.matching(Self.errorPredicate)
        XCTAssertEqual(errors.count, 0, "\(screen): error on screen — \(errors.firstMatch.exists ? errors.firstMatch.label : "")",
                       file: file, line: line)
    }

    private func tab(_ app: XCUIApplication, _ name: String) {
        let button = app.buttons[name].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: loadTimeout), "tab \(name) missing")
        button.tap()
    }

    /// Scroll until `element` is hittable. Held drags by default: a swipe keeps the list coasting
    /// for seconds after its frames look still, and a tap during deceleration only stops the
    /// scroll. `fling` is for screenshots, where nothing is tapped next.
    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication, maxSwipes: Int = 12, fling: Bool = false) {
        var swiped = false
        for _ in 0..<maxSwipes where !(element.exists && element.isHittable) {
            if fling { app.swipeUp() } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
                    .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)),
                           withVelocity: .fast, thenHoldForDuration: 0.3)
            }
            swiped = true
        }
        if swiped { QA.settle(element) }
    }

    private func type(_ text: String, into field: XCUIElement) { QA.type(text, into: field) }

    private func continueTap(_ app: XCUIApplication) {
        let cta = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Continue'")).firstMatch
        XCTAssertTrue(cta.waitForExistence(timeout: 8)); cta.tap()
    }

    /// Fresh install → onboarding → sign-in on the Auth emulator → main tabs.
    private func onboardAndSignIn(_ app: XCUIApplication, email account: String = "demo-judge@example.test",
                                  password: String = "local-demo-walkthrough", picks: [String] = ["Parks", "Community"]) {
        assertLoaded(app, "Onboarding", anchor: app.staticTexts["Step Outside.\nConnect Within."])
        snap(app, "onboarding")
        let first = app.buttons["\(picks[0]) interest"].firstMatch
        QA.continueUntil(first, in: app)
        for pick in picks { app.buttons["\(pick) interest"].firstMatch.tap() }
        snap(app, "onboarding-interests")
        continueTap(app)

        // Sign in to the local demo account (functions/scripts/demo-account-local.mjs).
        // Sign-up is not driven here: the simulator's Strong Password sheet takes over
        // the new-password field, so typed passwords never land.
        let email = app.textFields["Email address"]
        XCTAssertTrue(email.waitForExistence(timeout: 8), "auth screen missing")
        snap(app, "sign-in")
        type(account + "\n", into: email)
        // Return closes the software keyboard, which otherwise covers the submit button.
        type(password + "\n", into: app.secureTextFields["Password"])
        let submit = app.buttons["authSubmit"]
        scrollTo(submit, in: app, maxSwipes: 4)
        submit.tap()
        XCTAssertTrue(app.buttons["Discover"].firstMatch.waitForExistence(timeout: 30),
                      "sign-in did not reach the main tabs (seed the account with scripts/demo-account-local.mjs)")
        relaunchSignedIn(app)
    }

    /// Leaves the simulator signed in to the seeded demo account (scripts/demo-investor-local.mjs)
    /// with the system prompts answered, so a live demo starts on the Events feed.
    func testPrepareSignedInDemo() {
        let app = launch()
        onboardAndSignIn(app)
        tab(app, "Discover")
        assertLoaded(app, "Events", anchor: app.buttons["Discover"].firstMatch)
        snap(app, "demo-ready")
    }

    /// Read-only tour of the signed-in demo account left by testPrepareSignedInDemo:
    /// every tab loads with no error copy. Run after it; it does not sign in.
    func testTourSignedInDemo() {
        XCUIDevice.shared.location = XCUILocation(location: QA.sanJose)
        let app = XCUIApplication()
        app.launchArguments += ["-QAUseFirestoreEmulator", "YES", "-QAEmulatorHost", "127.0.0.1",
                                "-QAOfflineData", "NO", "-QADisableMotion", "YES", "-dailyGem.splashDay", QA.today]
        app.launch()
        for name in ["Discover", "Plan", "Friends", "Rewards", "Profile"] {
            tab(app, name)
            assertLoaded(app, name, anchor: app.buttons[name].firstMatch)
            if name == "Friends" {
                // The seeded friends RSVP'd; their plans load after the friend list.
                let plan = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Maya Ortiz' AND label CONTAINS ' · '")).firstMatch
                XCTAssertTrue(plan.waitForExistence(timeout: loadTimeout), "Going soon never showed the friends' plans")
            }
            QA.settle(app.buttons[name].firstMatch)
            snap(app, name.lowercased())
        }
    }

    // MARK: The walkthrough

    func testJudgeWalkthrough() {
        let app = launch()
        onboardAndSignIn(app)

        // Events feed with real events and the ranked reasons line.
        let poster = app.buttons.matching(identifier: "event-poster").firstMatch
        assertLoaded(app, "Events feed", anchor: poster)
        snap(app, "events-feed")
        let ranked = app.buttons.matching(NSPredicate(format: "label CONTAINS ', Why: '")).firstMatch
        // Wait for the card before scrolling: swiping while the slate still loaded carried the feed
        // past the card before it existed, and the tap then went to an off-screen point.
        XCTAssertTrue(ranked.waitForExistence(timeout: loadTimeout), "no card carries a reasons line")
        QA.reveal(ranked, in: app, maxSwipes: 4)
        snap(app, "events-feed-reasons")

        // Event detail: why, show less, hide, series. The row is rebuilt as the ranked slate
        // and friends-going counts land; tap once it has stopped changing.
        XCTAssertTrue(QA.waitUntilStable(ranked), "the ranked card never settled")
        ranked.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        let why = app.descendants(matching: .any).matching(identifier: "whySeeingThis").firstMatch
        assertLoaded(app, "Event detail", anchor: app.buttons["hideEvent"].firstMatch)
        snap(app, "event-detail")
        scrollTo(why, in: app, maxSwipes: 6)
        XCTAssertTrue(why.exists, "Why you're seeing this missing")
        snap(app, "event-detail-why")
        let less = app.buttons["feedbackLess"]
        scrollTo(less, in: app, maxSwipes: 4)
        XCTAssertTrue(less.exists, "Show less missing")
        if app.buttons["seriesMoreDates"].exists { snap(app, "event-detail-series") }
        less.tap()
        snap(app, "event-detail-feedback")
        app.buttons["hideEvent"].tap()
        XCTAssertTrue(poster.waitForExistence(timeout: loadTimeout), "feed did not return after Hide")

        // Places, then a place detail. When an OpenStreetMap place is listed (ids `osm-`,
        // encoded in the card identifier), open it and require its licence credit.
        app.buttons["Places"].firstMatch.tap()
        let anyPlace = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'nearbyPlaceCard'")).firstMatch
        scrollTo(anyPlace, in: app, maxSwipes: 6)
        assertLoaded(app, "Places", anchor: anyPlace)
        snap(app, "places")
        let osmPlace = app.buttons["nearbyPlaceCard-osm"].firstMatch
        let isOSM = osmPlace.exists
        (isOSM ? osmPlace : anyPlace).tap()
        assertLoaded(app, "Place detail", anchor: app.navigationBars.firstMatch)
        snap(app, "place-detail")
        if isOSM {
            // Match by label: SwiftUI does not always expose this Link with the link type.
            let osm = app.descendants(matching: .any)["© OpenStreetMap contributors"].firstMatch
            scrollTo(osm, in: app, maxSwipes: 8)
            // Visible, not merely laid out: at the end of the page it sat under the floating tab bar.
            XCTAssertTrue(osm.exists && osm.frame.maxY <= app.buttons["Discover"].firstMatch.frame.minY,
                          "OpenStreetMap credit missing or under the tab bar on an OSM place")
            snap(app, "credit-osm-place")
        } else {
            XCTContext.runActivity(named: "NOTE: no OpenStreetMap place nearby (Overpass unavailable); OSM credit covered by DataCreditTests") { _ in }
        }
        app.navigationBars.buttons.firstMatch.tap()

        // Map.
        app.buttons["Map"].firstMatch.tap()
        assertLoaded(app, "Map", anchor: app.maps.firstMatch)
        snap(app, "map")

        // The other four tabs.
        for (name, label) in [("Plan", "plan"), ("Friends", "friends"), ("Rewards", "rewards"), ("Profile", "profile")] {
            tab(app, name)
            assertLoaded(app, name, anchor: app.buttons[name].firstMatch)
            snap(app, label)
        }

        // Settings → Terms (to the end) → Privacy.
        let legal = app.buttons["Terms & Privacy"].firstMatch
        scrollTo(legal, in: app)
        snap(app, "settings")
        legal.tap()
        let acknowledgements = app.staticTexts["Data and acknowledgements"]
        assertLoaded(app, "Terms", anchor: app.navigationBars["Legal"])
        snap(app, "terms")
        scrollTo(acknowledgements, in: app, maxSwipes: 30, fling: true)
        XCTAssertTrue(acknowledgements.exists, "Data and acknowledgements missing from Terms")
        for _ in 0..<4 { app.swipeUp() }
        snap(app, "credit-terms-end")
        app.buttons["Privacy Policy"].firstMatch.tap()
        assertLoaded(app, "Privacy", anchor: app.navigationBars["Legal"])
        snap(app, "privacy")
    }

    /// For You follows each account's own picks (accounts from
    /// `scripts/foryou-interests-e2e.mjs --keep`): the ranked cards say which pick they match.
    /// One account per pick, then the two two-pick accounts; one screenshot each.
    func testForYouFollowsEachAccountsPicks() {
        let single = ["Parks", "Trails", "Gardens", "Playgrounds", "Waterfront", "Sports", "Scenic", "Community"]
            .map { ("foryou-pick-\($0.lowercased())@example.test", [$0], "foryou-\($0.lowercased())") }
        for (account, picks, name) in single + [("foryou-student-trails@example.test", ["Parks", "Trails"], "foryou-student-trails"),
                                                ("foryou-community-sports@example.test", ["Community", "Sports"], "foryou-community-sports")] {
            let app = launch()
            onboardAndSignIn(app, email: account, password: "local-foryou-check", picks: picks)
            let pick = picks.map { "label CONTAINS 'Because you like \($0)'" }.joined(separator: " OR ")
            let ranked = app.buttons.matching(NSPredicate(format: pick)).firstMatch
            XCTAssertTrue(ranked.waitForExistence(timeout: 30), "\(name): no For You card names one of \(picks)")
            QA.reveal(ranked, in: app, maxSwipes: 4)
            snap(app, name)
            app.terminate()
        }
    }

    /// The Adventure Planner with no model key: the server's deterministic planner builds a
    /// plan from the real nearby places (live OpenStreetMap or the bundled dated snapshot)
    /// and live Open-Meteo weather. No skip: an empty planner is a failure.
    func testAdventurePlannerShowsPlanWithWeatherCredit() throws {
        let app = launch()
        onboardAndSignIn(app)
        app.buttons["Places"].firstMatch.tap()
        let open = app.buttons["Plan my adventure"].firstMatch
        QA.reveal(open, in: app, maxSwipes: 6)
        XCTAssertTrue(open.waitForExistence(timeout: loadTimeout), "planner entry missing: nearby places did not load")
        open.tap()
        // The sheet's CTA shares the tile's label; take the one on top (the sheet).
        XCTAssertTrue(app.staticTexts["How long have you got?"].waitForExistence(timeout: loadTimeout), "planner sheet missing")
        let runs = app.buttons.matching(NSPredicate(format: "label == 'Plan my adventure'"))
        let run = runs.element(boundBy: max(0, runs.count - 1))
        snap(app, "planner")
        QA.reveal(run, in: app, maxSwipes: 4)
        run.tap()
        // Inside this sheet SwiftUI exposes the Link as a button; match the credit by its label.
        let credit = app.descendants(matching: .any)["Weather data by Open-Meteo.com"].firstMatch
        assertLoaded(app, "Planner plan", anchor: credit)
        let stops = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[0-9]+ min$"))
        XCTAssertGreaterThanOrEqual(stops.count, 2, "a plan has at least two stops")
        // The engine kept in the merge (functions/src/adventure-engine.ts) opens with the plan's length
        // and stop count; the Mac's earlier "… from where you started" sentence is not part of it.
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^(\\d+ stops within about \\d+ minutes|About \\d+ minutes across \\d+ real places|A \\d+-minute loop of \\d+ places).*"))
                        .firstMatch.exists, "the intro gives the plan's length and stop count")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", ".*\\bAI\\b.*")).count, 0, "plans never claim AI")
        snap(app, "planner-plan")
        scrollTo(credit, in: app, maxSwipes: 3, fling: true)
        snap(app, "credit-weather")
        // The rest of the plan, every stop with its time and reason.
        app.swipeUp()
        QA.settle(credit)
        snap(app, "planner-stops")
    }

    /// The Plan tab's event planner with no model key: real events in a reachable order.
    func testEventPlannerSequencesRealEvents() {
        let app = launch()
        onboardAndSignIn(app)
        tab(app, "Plan")
        // The defaults ("This weekend", "Short drive") leave little on a Sunday afternoon, and the
        // planner then says, correctly, "Not enough real events fit yet". A full day ahead, anywhere
        // nearby, always has supply.
        let tomorrow = QA.waitFor(app.buttons["Tomorrow"].firstMatch, "the Tomorrow choice")
        XCTAssertTrue(QA.waitUntilStable(tomorrow), "the plan form never settled")
        tomorrow.tap()
        let anywhere = app.buttons["Anywhere nearby"].firstMatch
        anywhere.tap()
        XCTAssertTrue(tomorrow.isSelected && anywhere.isSelected, "the plan choices did not take")
        let find = app.buttons["Find real events"]
        QA.reveal(find, in: app, maxSwipes: 6)
        XCTAssertTrue(find.waitForExistence(timeout: loadTimeout), "Find real events missing")
        find.tap()
        // Each walkthrough run spends two of the Demo Judge's five free plans this month; a third run
        // without a reseed is refused (the app working as designed), so say that rather than "no plan".
        let quota = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Your monthly free plans are used'")).firstMatch
        XCTAssertFalse(quota.waitForExistence(timeout: 5),
                       "the Demo Judge's free plans for this month are used: reseed with ./run-all.command --reload-only")
        let first = app.staticTexts["STOP 01"]
        QA.reveal(first, in: app, maxSwipes: 6)
        assertLoaded(app, "Event plan", anchor: first)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Your best-ranked match'")).firstMatch.waitForExistence(timeout: 5),
                      "the best-ranked event says why it leads")
        let second = app.staticTexts["STOP 02"]
        QA.reveal(second, in: app, maxSwipes: 4)
        snap(app, "planner-events")
    }
}
