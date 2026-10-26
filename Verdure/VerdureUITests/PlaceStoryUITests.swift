import XCTest

@MainActor final class PlaceStoryUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func prepareEmptyOwnedStory() async throws {
        func post(_ url: String, _ body: [String: Any], token: String? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: url)!)
            request.httpMethod = "POST"; request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let credentials = try await post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local",
            ["email": "qa-stories-native-owner@example.test", "password": "local-story-native-only", "returnSecureToken": true])
        let token = try XCTUnwrap(credentials["idToken"] as? String)
        let base = "http://127.0.0.1:5002/connectify-19dd8/us-central1/"
        let owned = try await post(base + "myStoryPlaces", ["data": ["limit": 100]], token: token)
        let result = try XCTUnwrap(owned["result"] as? [String: Any])
        let places = try XCTUnwrap(result["places"] as? [[String: Any]])
        let place = try XCTUnwrap(places.first { $0["placeId"] as? String == "osm-999999999999998" })
        let version = try XCTUnwrap(place["version"] as? Int)
        let saved = try await post(base + "savePlaceStory", ["data": ["placeId": "osm-999999999999998", "content": "", "expectedVersion": version]], token: token)
        XCTAssertNotNil(saved["result"], "Explicit owner save prepares a blank draft independently of SDK test order")
    }
    func testApprovedOwnerEditsVerifiedPlace() async throws {
        try await prepareEmptyOwnedStory()
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
        QA.waitFor(submit, "Submit").tap()
        QA.waitForSignedIn(app)
        let organizer = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Organizer profile Fictional Native Story Organizer")).firstMatch
        QA.reveal(organizer, in: app, maxSwipes: 25)
        QA.waitFor(organizer, "Approved organizer profile").tap()
        QA.waitFor(app.buttons["myPlaceStories"], "My place stories").tap()
        QA.waitFor(app.buttons["ownedStory:osm-999999999999998"], "Verified place", timeout: 20).tap()
        let editor = QA.waitFor(app.textViews["placeStoryEditor"], "Place story editor")
        editor.tap()
        editor.typeText("Fictional native UI story written by its verified organizer.")
        app.swipeUp()
        let save = app.buttons["savePlaceStory"]
        QA.waitFor(save, "Save story").tap()
        XCTAssertTrue(app.buttons["ownedStory:osm-999999999999998"].waitForExistence(timeout: 20), "Successful server save returns to owned places")
        let saved = XCTAttachment(screenshot: app.screenshot()); saved.name = "story-native-owner-editor-saved"; saved.lifetime = .keepAlways; add(saved)
        app.buttons["ownedStory:osm-999999999999998"].tap()
        XCTAssertEqual(QA.waitFor(app.textViews["placeStoryEditor"], "Saved prose").value as? String,
                       "Fictional native UI story written by its verified organizer.")
        app.swipeUp()
        QA.waitFor(app.buttons["viewPublishedStory"], "Public story preview").tap()
        QA.waitFor(app.staticTexts["placeStoryText"], "Canonical public story", timeout: 20)
        QA.waitFor(app.buttons["expandPlaceStory"], "Read story").tap()
        XCTAssertEqual(app.staticTexts["placeStoryText"].label, "Fictional native UI story written by its verified organizer.")
        let reloaded = XCTAttachment(screenshot: app.screenshot()); reloaded.name = "story-native-owner-editor-reloaded"; reloaded.lifetime = .keepAlways; add(reloaded)
    }
}
