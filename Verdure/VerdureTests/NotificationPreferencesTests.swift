import XCTest
@testable import Verdure

// MARK: - Notification preference parsing
//
// The server is the authority on these values. The client's job is to read what
// it sends without ever silently turning something back ON that the user turned
// off — which is the one failure here that would be felt as a betrayal.

@MainActor
final class NotificationPreferencesTests: XCTestCase {

    func testParsesAServerResponse() {
        let p = NotificationPreferences.parse([
            "eventSuggestions": false, "friendActivity": true,
            "quietStart": 22, "quietEnd": 7, "timeZone": "America/New_York",
        ])
        XCTAssertFalse(p.eventSuggestions)
        XCTAssertTrue(p.friendActivity)
        XCTAssertEqual(p.quietStart, 22)
        XCTAssertEqual(p.quietEnd, 7)
        XCTAssertEqual(p.timeZone, "America/New_York")
    }

    func testAnExplicitFalseIsNeverReadAsMissing() {
        // The bug this guards: `d["x"] as? Bool ?? true` on a real `false`
        // works, but treating false as "absent" would re-enable a channel the
        // user switched off, and they would never trust the toggle again.
        let p = NotificationPreferences.parse(["eventSuggestions": false, "friendActivity": false])
        XCTAssertFalse(p.eventSuggestions)
        XCTAssertFalse(p.friendActivity)
    }

    func testOutOfRangeHoursAreIgnoredRatherThanStored() {
        let p = NotificationPreferences.parse(["quietStart": 99, "quietEnd": -3])
        XCTAssertEqual(p.quietStart, 21, "falls back to the default window")
        XCTAssertEqual(p.quietEnd, 8)
    }

    func testMissingKeysKeepDefaults() {
        let p = NotificationPreferences.parse([:])
        XCTAssertTrue(p.eventSuggestions)
        XCTAssertTrue(p.friendActivity)
        XCTAssertFalse(p.rsvpPartnerOffers, "Promotional RSVP offers require opt-in")
        XCTAssertEqual(p.quietStart, 21)
        XCTAssertEqual(p.quietEnd, 8)
    }

    func testRSVPOfferConsentIsReadExactly() {
        XCTAssertTrue(NotificationPreferences.parse(["rsvpPartnerOffers": true]).rsvpPartnerOffers)
        XCTAssertFalse(NotificationPreferences.parse(["rsvpPartnerOffers": false]).rsvpPartnerOffers)
        XCTAssertFalse(NotificationPreferences.parse(["rsvpPartnerOffers": "true"]).rsvpPartnerOffers)
    }

    func testWrongTypesDoNotCorruptState() {
        let p = NotificationPreferences.parse([
            "eventSuggestions": "yes", "quietStart": "late", "timeZone": 7,
        ])
        XCTAssertTrue(p.eventSuggestions, "a non-Bool is ignored, not coerced")
        XCTAssertEqual(p.quietStart, 21)
        XCTAssertFalse(p.timeZone.isEmpty)
    }

    func testQuietHoursDescriptionSaysOffWhenTheWindowIsEmpty() {
        XCTAssertEqual(NotificationPreferences.describeQuietHours(start: 0, end: 0), "Off")
        XCTAssertNotEqual(NotificationPreferences.describeQuietHours(start: 21, end: 8), "Off")
    }
}
