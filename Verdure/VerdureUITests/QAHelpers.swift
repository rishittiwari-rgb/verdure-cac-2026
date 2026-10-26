import XCTest
import CoreLocation

// MARK: - Shared UI-test launch plumbing
//
// State is injected through the NSArgumentDomain (`-key value` launch arguments
// feed UserDefaults for that run), so tests are deterministic without any app
// code beyond the DEBUG `-QATab` initial-tab hook.

@MainActor
enum QA {
    static var today: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    /// SampleData.defaultCenter: the offline fixtures (places, events, plans) sit around it.
    static let sampleCenter = CLLocation(latitude: 44.98, longitude: -93.265)
    /// The launch area the local emulators are seeded for.
    static let sanJose = CLLocation(latitude: 37.3352, longitude: -121.8811)

    /// Launch the app straight into a tab with onboarding done, the Daily Gem
    /// splash already shown today, and interests pre-picked.
    ///
    /// The simulated location is set per launch. Once location is allowed, offline sample
    /// events are filtered by distance from GPS, so a simulator left in San José showed
    /// "No events match" for the Minneapolis fixtures, depending on earlier runs.
    static func launch(tab: String = "events", extraArguments: [String] = [],
                       location: CLLocation? = nil) -> XCUIApplication {
        let offline = !zip(extraArguments, extraArguments.dropFirst()).contains { $0 == "-QAOfflineData" && $1 == "NO" }
        XCUIDevice.shared.location = XCUILocation(location: location ?? (offline ? sampleCenter : sanJose))
        let app = XCUIApplication()
        app.launchArguments += [
            "-hasCompletedOnboarding", "YES",
            "-dailyGem.splashDay", today,          // suppress the once-a-day splash
            "-interestCategories", "Parks,Trails,Community",
            "-QATab", tab,
            "-QADisableMotion", "YES",   // audits need quiescence
            "-QAOfflineData", "YES",     // deterministic content, no fetch churn
            "-QAResetDiscoveryFilters", "YES", // independent initial filters
        ]
        app.launchArguments += extraArguments
        app.launch()
        allowLocationIfAsked()
        return app
    }

    /// Each test run reinstalls the app, which resets its location permission, so the
    /// system prompt can sit over the first screen and leave the app without GPS
    /// (it then browses the launch-area centre). Answer it the way a user would.
    static func allowLocationIfAsked() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons["Allow While Using App"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
    }

    /// Run Apple's accessibility audit on the current screen.
    ///
    /// Scope: the STRUCTURAL types (labels, hit regions, traits, element
    /// detection) — these fail tests. Visual types (contrast / dynamic type /
    /// clipping) are excluded from the machine audit: running them across these
    /// dense clay screens exceeds the audit engine's internal time budget
    /// (error -56), and they're covered by the light/dark × text-size
    /// screenshot matrix reviewed in QA.md instead.
    static func audit(_ app: XCUIApplication, screen: String,
                      file: StaticString = #filePath, line: UInt = #line) throws {
        // The audit service only inspects the frontmost app; make sure it is, then audit
        // once. Any error — a finding or the audit service failing — fails the test.
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), "app not frontmost for the audit", file: file, line: line)
        try runAudit(app, screen: screen, file: file, line: line)
    }

    private static func runAudit(_ app: XCUIApplication, screen: String,
                                 file: StaticString, line: UInt) throws {
        let structural: XCUIAccessibilityAuditType = [
            .sufficientElementDescription, .hitRegion, .trait,
        ]
        // The Program detail's combined structural request repeatedly exceeds
        // the system audit time budget. Run the same three types separately,
        // requiring all of them; do not suppress findings or accept a timeout.
        let scopes: [XCUIAccessibilityAuditType] = screen == "Curated Program detail"
            ? [.sufficientElementDescription, .hitRegion, .trait] : [structural]
        for scope in scopes {
            try XCTContext.runActivity(named: "AUDIT-SCOPE [\(screen)] \(scope.rawValue)") { _ in
                try app.performAccessibilityAudit(for: scope) { issue in
                    let element = issue.element.map { "\($0)" } ?? "?"
                    // MapKit owns the Legal attribution link and exposes its text-sized
                    // frame. Keep it visible and actionable; exclude only that native
                    // link's hit-region finding, never Verdure pins or controls.
                    if screen == "partner-map-layer", issue.auditType == .hitRegion,
                       issue.element?.label == "Legal" {
                        XCTContext.runActivity(named: "AUDIT-NOTE [\(screen)] native MapKit Legal link; physical VoiceOver check remains required") { _ in }
                        return true
                    }
                    // Known SwiftUI limitation: a TextField's audit frame is its text rect
                    // even when the surrounding container focuses it on tap (ours are ≥44pt
                    // clay wells wired via FocusState). Note it; don't fail.
                    if issue.auditType == .hitRegion, issue.element?.elementType == .textField {
                        XCTContext.runActivity(named: "AUDIT-NOTE [\(screen)] textField rect (container focuses ≥44pt) → \(element.prefix(120))") { _ in }
                        return true
                    }
                    XCTContext.runActivity(named: "AUDIT [\(screen)] \(issue.compactDescription) → \(element.prefix(160))") { _ in }
                    return false   // every other structural finding fails the test
                }
            }
        }
    }

    /// Scroll until `element` is hittable AND clear of the floating tab bar. XCUITest
    /// reports a row under the bar as hittable, and the tap then lands on a tab.
    /// An element already on screen is dragged just far enough (held, so no momentum); a full
    /// swipe would fling a row that sits just under the bar up beneath the pinned search field.
    static func reveal(_ element: XCUIElement, in app: XCUIApplication, maxSwipes: Int = 20) {
        var swiped = false
        let height = app.frame.height
        for _ in 0..<maxSwipes where !(element.exists && element.isHittable && element.frame.maxY < height - 140) {
            let frame = element.exists ? element.frame : .zero
            if frame.minY > 0, frame.minY < height {
                let lift = min(frame.maxY - (height - 180), height * 0.5)
                let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -max(lift, 60))),
                            withVelocity: .slow, thenHoldForDuration: 0.3)
            } else {
                scroll(app)
            }
            swiped = true
        }
        if swiped { settle(element) }
    }

    /// Scroll by 40 % of the screen with a held drag: the finger stops before it lifts, so
    /// nothing coasts afterwards. After a swipe the list keeps moving for seconds below what frame
    /// polling can see, and a tap in that tail only stops the scroll — the Curated Program poster
    /// and Profile's Sign in were lost that way. Use swipes only where nothing is tapped next.
    /// The drag stays in the middle band, clear of a raised keyboard, bottom bars and the tab bar:
    /// started at 80 % it landed on the offline-pack search keyboard and scrolled nothing.
    static func scroll(_ app: XCUIApplication, up: Bool = true) {
        let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.55 : 0.15))
        let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.15 : 0.55))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0.3)
    }

    /// A swipe keeps the list coasting for a few seconds, and a tap during deceleration
    /// only stops the scroll (standard UIKit). Wait until the element stops moving.
    static func settle(_ element: XCUIElement, timeout: TimeInterval = 5) {
        var last = element.exists ? element.frame : .zero
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
            let now = element.exists ? element.frame : .zero
            if now == last { return }
            last = now
        }
    }

    /// Waits until `element` exists and its label and frame have not changed for `quiet`
    /// seconds: data that lands after the first render (a ranked slate, friends-going counts)
    /// rebuilds the row, and a tap during that rebuild is lost.
    @discardableResult
    static func waitUntilStable(_ element: XCUIElement, quiet: TimeInterval = 1.0, timeout: TimeInterval = 20) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        guard element.waitForExistence(timeout: timeout) else { return false }
        var last = (element.label, element.frame), since = Date()
        while Date() < deadline {
            let now = element.exists ? (element.label, element.frame) : ("", CGRect.zero)
            if now != last { last = now; since = Date() }
            else if Date().timeIntervalSince(since) >= quiet { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return false
    }

    /// Onboarding: Continue through the pages until `target` appears. Each tap waits for the
    /// button to settle (the pager animates between pages) and must advance the page — the
    /// dots' identifier changes — or reveal the target; a tap that does neither fails.
    static func continueUntil(_ target: XCUIElement, in app: XCUIApplication, maxPages: Int = 8,
                              file: StaticString = #filePath, line: UInt = #line) {
        let cta = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Continue'")).firstMatch
        let dots = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'onboardingDots-'")).firstMatch
        for _ in 0..<maxPages where !target.exists {
            XCTAssertTrue(waitUntilStable(cta), "Continue never settled", file: file, line: line)
            let page = dots.exists ? dots.identifier : ""
            cta.tap()
            let advanced = NSPredicate { _, _ in target.exists || (dots.exists ? dots.identifier : "") != page }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: advanced, object: nil)], timeout: 8), .completed,
                           "Continue did not advance onboarding from \(page)", file: file, line: line)
        }
        XCTAssertTrue(target.waitForExistence(timeout: 8), "onboarding never reached \(target)", file: file, line: line)
    }

    /// Signed in = the auth sheet is gone and Profile no longer offers "Sign in". The
    /// "openOfflinePacks" row is on the signed-out Profile too, so waiting on it returned at
    /// once and a test that terminated next killed the sign-in still in flight.
    static func waitForSignedIn(_ app: XCUIApplication, timeout: TimeInterval = 30,
                                file: StaticString = #filePath, line: UInt = #line) {
        let signedIn = NSPredicate { _, _ in
            !app.buttons["authSubmit"].exists && !app.buttons["profileSignIn"].exists && app.buttons["openOfflinePacks"].exists
        }
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: signedIn, object: nil)], timeout: timeout)
        XCTAssertEqual(result, .completed, "sign-in did not complete", file: file, line: line)
    }

    /// Types into a field once it has settled (a sheet or keyboard may still be moving it) and
    /// owns the keyboard after a single tap; a tap that doesn't focus the field fails.
    /// End the text with "\n" when the next field sits under the keyboard: XCTest otherwise
    /// scrolls that field into view itself and taps while the form still moves, and the
    /// password field then never took focus.
    static func type(_ text: String, into field: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(waitUntilStable(field), "\(field) never settled", file: file, line: line)
        field.tap()
        let focused = NSPredicate { _, _ in (field.value(forKey: "hasKeyboardFocus") as? Bool) == true }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: focused, object: nil)], timeout: 5), .completed,
                       "\(field) did not take keyboard focus", file: file, line: line)
        field.typeText(text)
    }

    /// Wait helper with a clear failure message.
    @discardableResult
    static func waitFor(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 12,
                        file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.waitForExistence(timeout: timeout),
                      "expected \(what) to appear", file: file, line: line)
        return element
    }
}
