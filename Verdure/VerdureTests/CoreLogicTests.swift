import XCTest
import CryptoKit
import CoreLocation
import SceneKit
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@testable import Verdure

// MARK: - Core-logic QA: Daily Gem rotation, sanitizer, personalization mapping

@MainActor
final class CoreLogicTests: XCTestCase {

    func testOverlappingFeedDocumentsKeepOneCardAndFirstOrder() {
        let first = Event(id: "overlap", title: "First read", organizer: "QA", date: Date(), time: "Now", locationName: "QA", attendeeCount: 0, maxAttendees: nil, category: .workshop, imagePlaceholder: "leaf", pointValue: 0)
        let later = Event(id: "overlap", title: "Overlapping read", organizer: "QA", date: Date(), time: "Now", locationName: "QA", attendeeCount: 0, maxAttendees: nil, category: .workshop, imagePlaceholder: "leaf", pointValue: 0)
        let other = Event(id: "other", title: "Second card", organizer: "QA", date: Date(), time: "Now", locationName: "QA", attendeeCount: 0, maxAttendees: nil, category: .workshop, imagePlaceholder: "leaf", pointValue: 0)
        let service = EventsAPIService()
        service.events = [first, other, later, first]
        XCTAssertEqual(service.events.map(\.id), ["overlap", "other"])
        XCTAssertEqual(service.events.first?.title, "First read")
    }

    func testVolunteerSupplyReadsCompletePublicCorpusBeyondFirstDiscoveryPage() async throws {
        try LocalStack.require()
        try? Auth.auth().signOut()
        // Signed out = not a verified adult: rules (W2) only allow the adultOnly == false
        // shape, which is also exactly what EventsAPIService queries for this viewer.
        let query = Firestore.firestore().collection("events")
            .whereField("hidden", isEqualTo: false).whereField("active", isEqualTo: true)
            .whereField("broadcast", isEqualTo: true).whereField("category", isEqualTo: "Volunteer")
            .whereField("adultOnly", isEqualTo: false)
            .whereField("date", isGreaterThan: Timestamp(date: Date())).order(by: "date")
        var expected: Set<String> = [], cursor: DocumentSnapshot?
        while true {
            let page = try await (cursor.map { query.start(afterDocument: $0) } ?? query).limit(to: 500).getDocuments(source: .server)
            expected.formUnion(page.documents.map(\.documentID))
            if page.documents.count < 500 { break }
            cursor = page.documents.last
        }
        // The property needs supply the first discovery page (EventsAPIService.maxEvents = 80
        // chronological cards, every category) cannot hold. A fixed count (> 80) stood in for that
        // and failed on a day the live feeds listed 79 public volunteer events.
        let firstPage = try await Firestore.firestore().collection("events")
            .whereField("hidden", isEqualTo: false).whereField("active", isEqualTo: true)
            .whereField("broadcast", isEqualTo: true).whereField("adultOnly", isEqualTo: false)
            .whereField("date", isGreaterThanOrEqualTo: Timestamp(date: Date().addingTimeInterval(-3600))).order(by: "date")
            .limit(to: 80).getDocuments(source: .server)
        XCTAssertFalse(expected.isSubset(of: Set(firstPage.documents.map(\.documentID))),
                       "This connected test requires the refreshed public corpus: volunteer listings beyond the first discovery page")
        let service = EventsAPIService()
        await service.refresh(around: CLLocationCoordinate2D(latitude: 37.3382, longitude: -121.8863))
        XCTAssertEqual(Set(service.events.filter { $0.category == .volunteer }.map(\.id)), expected)
        XCTAssertEqual(Set(service.everythingEvents.filter { $0.category == .volunteer }.map(\.id)), expected)
        XCTAssertTrue(DiscoveryFilters.opportunityCategories(service.events, origin: CLLocation(latitude: 37.3382, longitude: -121.8863), radiusMiles: 25).contains(.volunteer))
    }

    func testVolunteerChipRequiresThirtyUniqueCurrentListingsInRadius() {
        let now = Date(), origin = CLLocation(latitude: 37.3382, longitude: -121.8863)
        func volunteer(_ id: String, start: Date = Date().addingTimeInterval(86400), latitude: Double = 37.3382) -> Event {
            Event(id: id, title: "Fixture service", organizer: "Fixture", date: start, time: "Morning", locationName: "Fixture",
                  attendeeCount: 0, maxAttendees: nil, category: .volunteer, imagePlaceholder: "leaf", pointValue: 200,
                  latitude: latitude, longitude: -121.8863)
        }
        let twentyNine = (0..<29).map { volunteer("volunteer-\($0)") }
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(twentyNine + [twentyNine[0]], origin: origin, radiusMiles: 25, now: now).contains(.volunteer))
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(twentyNine + [volunteer("expired", start: now)], origin: origin, radiusMiles: 25, now: now).contains(.volunteer))
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(twentyNine + [volunteer("far", latitude: 0)], origin: origin, radiusMiles: 25, now: now).contains(.volunteer))
        XCTAssertTrue(DiscoveryFilters.opportunityCategories(twentyNine + [volunteer("thirtieth")], origin: origin, radiusMiles: 25, now: now).contains(.volunteer))
    }

    func testSavedProgramRechecksDeadlineAndAgeAsTimeAdvancesOffline() throws {
        let deadline = try XCTUnwrap(ISO8601DateFormatter().date(from: "2027-01-10T00:00:00Z"))
        let fields: [String: Any] = ["id": "saved-program", "title": "Fictional listing", "description": "", "organizer": "Fixture",
                                   "category": "Program", "locationName": "Virtual", "source": "staff-program",
                                   "startMs": deadline.timeIntervalSince1970 * 1000, "deadlineMs": deadline.timeIntervalSince1970 * 1000,
                                   "minimumAge": 16, "maximumAge": 16]
        let event = try JSONDecoder().decode(OfflineEvent.self, from: JSONSerialization.data(withJSONObject: fields))
        let december = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-12-31T12:00:00Z"))
        let january = try XCTUnwrap(ISO8601DateFormatter().date(from: "2027-01-01T12:00:00Z"))
        XCTAssertTrue(event.isCurrent(birthYear: 2010, now: december))
        XCTAssertFalse(event.isCurrent(birthYear: nil, now: december))
        XCTAssertFalse(event.isCurrent(birthYear: 2015, now: december))
        XCTAssertFalse(event.isCurrent(birthYear: 2010, now: january), "An open offline listing must recheck age after the year changes")
        XCTAssertTrue(event.isCurrent(birthYear: 2011, now: deadline.addingTimeInterval(-1)))
        XCTAssertFalse(event.isCurrent(birthYear: 2011, now: deadline), "The deadline is exclusive even without a connection")
    }

    func testProgramActualSDKEligibilityFullSupplyAccountChangeAndDeepLinks() async throws {
        try LocalStack.require()
        let auth = Auth.auth()
        try await auth.signIn(withEmail: "program-native-adult@example.test", password: "local-program-native-only")
        defer { try? auth.signOut() }
        let service = EventsAPIService()
        let center = CLLocationCoordinate2D(latitude: 37.335, longitude: -121.89)
        await service.refresh(around: center)
        let adultPrograms = service.events.filter { $0.isProgram && $0.id.hasPrefix("program-native-") }
        XCTAssertEqual(adultPrograms.count, 10)
        XCTAssertTrue(adultPrograms.allSatisfy { $0.minimumAge == 18 && $0.pointValue == 0 })
        XCTAssertTrue(DiscoveryFilters.opportunityCategories(adultPrograms, origin: CLLocation(latitude: center.latitude, longitude: center.longitude), radiusMiles: 25).contains(.program))
        let expired = await service.event(withID: "program-native-11")
        XCTAssertNil(expired)
        let teenOnly = await service.event(withID: "program-native-10")
        XCTAssertNil(teenOnly)
        try await auth.signIn(withEmail: "program-native-teen@example.test", password: "local-program-native-only")
        XCTAssertTrue(service.events.filter { $0.isProgram }.isEmpty, "Previous account's eligibility never leaks")
        await service.refresh(around: center)
        let teenPrograms = service.events.filter { $0.isProgram && $0.id.hasPrefix("program-native-") }
        XCTAssertEqual(teenPrograms.map(\.id), ["program-native-10"])
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(teenPrograms, origin: CLLocation(latitude: center.latitude, longitude: center.longitude), radiusMiles: 25).contains(.program))
        let adultOnly = await service.event(withID: "program-native-0")
        XCTAssertNil(adultOnly)
        try auth.signOut()
        XCTAssertTrue(service.events.filter { $0.isProgram }.isEmpty)
    }

    func testProgramThresholdUsesUniqueCurrentInRadiusListingsAndFiltersDeadlines() {
        let now = Date(), origin = CLLocation(latitude: 37.335, longitude: -121.89)
        func program(_ id: String, deadline: Date = Date().addingTimeInterval(86400), latitude: Double = 37.335) -> Event {
            Event(id: id, title: "Fictional program", organizer: "Fixture", date: deadline, time: "Application deadline", locationName: "Fixture",
                  attendeeCount: 0, maxAttendees: nil, category: .program, imagePlaceholder: "graduationcap", pointValue: 0,
                  latitude: latitude, longitude: -121.89, minimumAge: 13, maximumAge: 17, applicationDeadline: deadline)
        }
        let nine = (0..<9).map { program("fixture-\($0)") }
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(nine + [nine[0]], origin: origin, radiusMiles: 25, now: now).contains(.program))
        let ten = nine + [program("tenth")]
        XCTAssertTrue(DiscoveryFilters.opportunityCategories(ten, origin: origin, radiusMiles: 25, now: now).contains(.program))
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(nine + [program("expired", deadline: now)], origin: origin, radiusMiles: 25, now: now).contains(.program))
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(nine + [program("far", latitude: 0)], origin: origin, radiusMiles: 25, now: now).contains(.program))
        XCTAssertFalse(DiscoveryFilters.opportunityCategories(ten, origin: nil, radiusMiles: 25, now: now).contains(.program))
        let filtered = DiscoveryFilters.filterEvents(ten + [program("expired", deadline: now)], state: DiscoveryFilterState(), query: "", userLocation: origin, now: now)
        XCTAssertFalse(filtered.contains { $0.id == "expired" })
    }

    func testOfflinePackActualSDKDownloadPersistenceIsolationAndDeletion() async throws {
        try LocalStack.require()
        let auth = Auth.auth()
        try await auth.signIn(withEmail: "offline-native-plus@example.test", password: "local-offline-native-only")
        defer { NetworkStatus.shared.forceOfflineForTesting = false; NetworkStatus.shared.forceWiFiForTesting = false; try? auth.signOut() }
        for _ in 0..<50 where !NetworkStatus.shared.isOnline { try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertTrue(NetworkStatus.shared.isOnline)
        let uid = try XCTUnwrap(auth.currentUser?.uid)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("offline-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let service = OfflinePackService(directory: directory); service.connect(uid)
        let preview = try await service.preview(selection: .parks(["county-boundaries_20"]), places: [], savedPlaceIDs: [])
        XCTAssertGreaterThan(preview.downloadBytes, preview.storedBytes)
        XCTAssertLessThanOrEqual(preview.downloadBytes, OfflinePackService.maxBytes)
        XCTAssertEqual(preview.expiresAtMs - preview.createdAtMs, 604_800_000)
        XCTAssertTrue(service.entries.isEmpty, "Size preview must not install a pack")
        try await service.download(preview)
        let entry = try XCTUnwrap(service.entries.first)
        let pack = try service.open(entry)
        XCTAssertEqual(pack.guides.count, 1); XCTAssertFalse(pack.guides[0].trails.isEmpty)
        XCTAssertNotNil(pack.guides[0].park.geometry); XCTAssertFalse(pack.guides[0].credits.isEmpty)
        XCTAssertFalse(pack.mapImageryIncluded); XCTAssertFalse(pack.checkInAllowed)
        // UI preflight forced offline. Opening uses only the checked local file;
        // actual cellular/GPS/airplane-mode testing is still a physical gate.
        NetworkStatus.shared.forceOfflineForTesting = true
        let restored = OfflinePackService(directory: directory); restored.connect(uid)
        XCTAssertEqual(restored.entries.count, 1)
        XCTAssertEqual(try restored.open(entry).guides[0].trails.count, pack.guides[0].trails.count)
        do { _ = try await restored.preview(selection: entry.selection, places: [], savedPlaceIDs: []); XCTFail("Offline generation must be refused") }
        catch { XCTAssertEqual(error.localizedDescription, "Available when you're back online.") }
        let accountDirectory = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        XCTAssertEqual(try accountDirectory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        let bytes = try JSONEncoder().encode(pack)
        func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
        XCTAssertThrowsError(try OfflinePackService.verifiedPack(bytes, sha256: "damaged", ownerUid: uid))
        XCTAssertThrowsError(try OfflinePackService.verifiedPack(bytes, sha256: hash(bytes), ownerUid: "another-account"))
        XCTAssertThrowsError(try OfflinePackService.verifiedPack(bytes, sha256: hash(bytes), ownerUid: uid, nowMs: pack.expiresAtMs))
        for patch in [["checkInAllowed": true], ["mapImageryIncluded": true], ["version": 2], ["expiresAtMs": pack.createdAtMs + 604_800_001]] as [[String: Any]] {
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            object.merge(patch) { _, new in new }
            let changed = try JSONSerialization.data(withJSONObject: object)
            XCTAssertThrowsError(try OfflinePackService.verifiedPack(changed, sha256: hash(changed), ownerUid: uid))
        }
        try restored.delete(entry)
        XCTAssertTrue(restored.entries.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: accountDirectory.appendingPathComponent(entry.id + ".json").path))
        restored.connect("another-account")
        XCTAssertFalse(FileManager.default.fileExists(atPath: accountDirectory.path))
        XCTAssertThrowsError(try restored.open(entry))
    }

    func testOfflinePackWiFiRefreshReplacesOnlyACompleteDownloadAndKeepsPlaces() async throws {
        try LocalStack.require()
        let auth = Auth.auth()
        try await auth.signIn(withEmail: "offline-native-plus@example.test", password: "local-offline-native-only")
        defer { NetworkStatus.shared.forceOfflineForTesting = false; NetworkStatus.shared.forceWiFiForTesting = false; try? auth.signOut() }
        for _ in 0..<50 where !NetworkStatus.shared.isOnline { try await Task.sleep(for: .milliseconds(100)) }
        let uid = try XCTUnwrap(auth.currentUser?.uid)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let service = OfflinePackService(directory: directory); service.connect(uid)
        let guide = try await ParkGuideService().guide(id: "county-boundaries_20")
        let point = guide.park.coordinate
        let place = Place(id: "osm-local-offline-fixture", name: "Fictional cached provider place", category: .parks,
                          shortDescription: "Local fixture", distance: "", distanceValue: 0, rating: nil, reviewCount: nil,
                          imagePlaceholder: "leaf.fill", accentColor: .verdureGreen, isFeatured: false, latitude: point.latitude, longitude: point.longitude)
        let preview = try await service.preview(selection: .parks([guide.park.id]), places: [place], savedPlaceIDs: [place.id])
        try await service.download(preview)
        let first = try XCTUnwrap(service.entries.first)
        XCTAssertEqual(try service.open(first).places.count, 1)
        NetworkStatus.shared.forceOfflineForTesting = true
        await service.refreshOnWiFi(places: [], savedPlaceIDs: [place.id])
        XCTAssertEqual(service.entries.first?.id, first.id, "Offline refresh must keep the current complete pack")
        NetworkStatus.shared.forceOfflineForTesting = false; NetworkStatus.shared.forceWiFiForTesting = true
        await service.refreshOnWiFi(places: [], savedPlaceIDs: [place.id])
        XCTAssertNil(service.lastError)
        let updated = try XCTUnwrap(service.entries.first)
        XCTAssertNotEqual(updated.id, first.id)
        XCTAssertEqual(service.entries.count, 1)
        let fresh = try service.open(updated)
        XCTAssertEqual(fresh.places.first?.id, place.id); XCTAssertEqual(fresh.places.first?.saved, true)
        XCTAssertTrue(fresh.places.first?.attribution.contains("OpenStreetMap") == true)
        XCTAssertThrowsError(try service.open(first), "Old file must be deleted only after a complete replacement")
        await service.refreshOnWiFi(places: [], savedPlaceIDs: [])
        XCTAssertEqual(service.entries.first?.id, updated.id, "Repeated foregrounds must respect the hourly refresh bound")
    }

    func testOfflinePackFreeAccountRefusedByActualSDKAndActionsDoNotMutate() async throws {
        try LocalStack.require()
        let auth = Auth.auth()
        try await auth.signIn(withEmail: "offline-native-free@example.test", password: "local-offline-native-only")
        defer { NetworkStatus.shared.forceOfflineForTesting = false; try? auth.signOut() }
        for _ in 0..<50 where !NetworkStatus.shared.isOnline { try await Task.sleep(for: .milliseconds(100)) }
        let service = OfflinePackService(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        service.connect(auth.currentUser?.uid)
        do { _ = try await service.preview(selection: .parks(["city-parks_342"]), places: [], savedPlaceIDs: []); XCTFail("Free account must be refused by server") }
        catch { XCTAssertEqual((error as NSError).code, 7, "Firebase permission denied") }
        XCTAssertTrue(service.entries.isEmpty)
        NetworkStatus.shared.forceOfflineForTesting = true
        let social = SocialService()
        let going = await social.setGoing("never-submit-offline", going: true)
        XCTAssertFalse(going)
        XCTAssertFalse(social.isGoing("never-submit-offline"))
        XCTAssertEqual(social.lastError, "Available when you're back online.")
        do { _ = try await AdventurePlannerService().plan(places: [], interests: [], timeOfDay: "morning", durationMinutes: 60, latitude: 37, longitude: -121); XCTFail("Offline planning must be refused") }
        catch { XCTAssertEqual(error.localizedDescription, "Plan generation is available when you're back online.") }
    }

    func testParkGeometryJoinsByBoundaryAndExcludesHoles() throws {
        let json = #"{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[4,2],[4,4],[2,4],[2,2]]]}"#
        let geometry = try JSONDecoder().decode(ParkGeometry.self, from: Data(json.utf8))
        XCTAssertTrue(geometry.contains(.init(latitude: 1, longitude: 1)))
        XCTAssertFalse(geometry.contains(.init(latitude: 3, longitude: 3)))
        XCTAssertTrue(geometry.contains(.init(latitude: 3, longitude: 2)))
        XCTAssertFalse(geometry.contains(.init(latitude: 3, longitude: 11)))
        let roundTrip = try JSONDecoder().decode(ParkGeometry.self, from: JSONEncoder().encode(geometry))
        XCTAssertEqual(roundTrip.polygons, geometry.polygons)
        XCTAssertEqual(geometry.coordinatePaths.count, 2)
    }

    func testParkGeometryPreservesSeparateIslandsAndRejectsBadCoordinates() throws {
        let json = #"{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,1],[0,0]]],[[[20,20],[21,20],[21,21],[20,21],[20,20]]]]}"#
        let geometry = try JSONDecoder().decode(ParkGeometry.self, from: Data(json.utf8))
        XCTAssertTrue(geometry.contains(.init(latitude: 20.5, longitude: 20.5)))
        XCTAssertFalse(geometry.contains(.init(latitude: 15, longitude: 15)))
        for json in [#"{"type":"LineString","coordinates":[[200,1],[2,1]]}"#,
                     #"{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}"#] {
            XCTAssertThrowsError(try JSONDecoder().decode(ParkGeometry.self, from: Data(json.utf8)))
        }
    }

    func testParkAmenityFiltersPersistWithoutLosingExistingChoices() throws {
        let legacy = try JSONDecoder().decode(DiscoveryFilterState.self, from: Data(#"{"radiusMiles":25,"placeCategories":["Parks"]}"#.utf8))
        XCTAssertFalse(legacy.hasParkFilters)
        XCTAssertEqual(legacy.radiusMiles, 25)
        XCTAssertEqual(legacy.placeCategories, [.parks])
        var state = legacy; state.toddlerPlayground = true; state.parkRestrooms = true
        let restored = try JSONDecoder().decode(DiscoveryFilterState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored, state)
        XCTAssertFalse(ParkFlags(toddler: true, dogs: false, restrooms: false, water: true).matches(state))
        XCTAssertTrue(ParkFlags(toddler: true, dogs: false, restrooms: true, water: false).matches(state))
        let defaults = UserDefaults(suiteName: "park-filter-\(UUID().uuidString)")!
        let filters = DiscoveryFilters(defaults: defaults); filters.state = state
        filters.resetPlaceFilters()
        XCTAssertFalse(filters.state.hasParkFilters)
    }

    func testParkGuideLoadsRealCatalogThroughLocalCallableSDK() async throws {
        try LocalStack.require()
        let service = ParkGuideService()
        await service.load(around: .init(latitude: 37.335, longitude: -121.89), radiusMiles: 2, force: true)
        XCTAssertNil(service.lastError)
        let park = try XCTUnwrap(service.parks.first)
        let geometry = try XCTUnwrap(park.geometry)
        XCTAssertTrue(geometry.contains(park.coordinate))
        let matches = try await service.matching(park.coordinate)
        XCTAssertTrue(matches.contains { $0.id == park.id })
        let guide = try await service.guide(id: park.id)
        XCTAssertEqual(guide.park.id, park.id)
        XCTAssertFalse(guide.credits.isEmpty)
        XCTAssertTrue(guide.credits.contains { $0.attribution.contains("City of San José") })
        XCTAssertNotNil(guide.park.geometry)
    }

    func testParkCatalogRequestSurvivesCallerNavigationCancellation() async throws {
        try LocalStack.require()
        let service = ParkGuideService()
        let task = Task { await service.load(around: .init(latitude: 37.335, longitude: -121.89), radiusMiles: 2, force: true) }
        await Task.yield()
        task.cancel()
        await task.value
        XCTAssertFalse(service.isLoading)
        XCTAssertNil(service.lastError)
        XCTAssertFalse(service.parks.isEmpty)
    }

    func testSignupAgeAllowsNeutralAnswersAndKeepsMinorBoundary() {
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: nil, currentYear: 2026), .invalid)
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: 2027, currentYear: 2026), .invalid)
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: 1915, currentYear: 2026), .invalid)
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: 2026, currentYear: 2026), .under13)
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: 2014, currentYear: 2026), .under13)
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: 2013, currentYear: 2026), .eligible(2013))
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: 2009, currentYear: 2026), .eligible(2009))
        XCTAssertEqual(AuthService.signupAgeDecision(birthYear: 2008, currentYear: 2026), .eligible(2008))
    }

    func testRestoredTermsLinkResolvesAgainstExplicitLocalWebsite() async throws {
        let defaults = UserDefaults.standard
        let keys = ["QAUseFirestoreEmulator", "QAWebsiteBaseURL"]
        let before = keys.map { defaults.object(forKey: $0) }
        defer {
            for (key, value) in zip(keys, before) {
                if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
            }
        }
        defaults.set(true, forKey: "QAUseFirestoreEmulator")
        defaults.set("http://127.0.0.1:3105", forKey: "QAWebsiteBaseURL")
        XCTAssertEqual(Legal.termsOfServiceURL.absoluteString, "http://127.0.0.1:3105/terms")
        var request = URLRequest(url: Legal.termsOfServiceURL)
        request.timeoutInterval = 10
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) }
        catch { throw XCTSkip("Start the local website on port 3105 to verify the restored web Terms link: \(error.localizedDescription)") }
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("Terms of Service"))
        defaults.set("https://evil.example", forKey: "QAWebsiteBaseURL")
        XCTAssertEqual(Legal.termsOfServiceURL.absoluteString, "https://verdure-app.com/terms")
        defaults.set("http://evil.127.0.0.1:3105", forKey: "QAWebsiteBaseURL")
        XCTAssertEqual(Legal.termsOfServiceURL.absoluteString, "https://verdure-app.com/terms")
        defaults.set("http://127.0.0.1:3105", forKey: "QAWebsiteBaseURL")
        defaults.set(false, forKey: "QAUseFirestoreEmulator")
        XCTAssertEqual(Legal.termsOfServiceURL.absoluteString, "https://verdure-app.com/terms")
    }

    func testUnder13SignupEndsBeforeCredentialProcessingOrPersistence() async {
        let auth = AuthService()
        let originalUser = auth.currentUser
        let keys = ["accountType", "interestCategories", "verdureUser"]
        let before = keys.map { UserDefaults.standard.object(forKey: $0) as? NSObject }
        do {
            try await auth.signUp(email: "invalid-before-age-check", password: "", displayName: "", birthYear: Calendar.current.component(.year, from: Date()) - 12,
                                  studentStatus: true, school: "Under13 fixture", interests: ["Under13 fixture"])
            XCTFail("An under-13 answer must never reach account creation")
        } catch {
            XCTAssertEqual(auth.errorMessage, "Sign-up is unavailable for this birth year.")
        }
        XCTAssertEqual(auth.currentUser?.uid, originalUser?.uid)
        XCTAssertFalse(auth.isLoading)
        XCTAssertEqual(keys.map { UserDefaults.standard.object(forKey: $0) as? NSObject }, before)
    }

    /// The auth listener (and with it the first For You fetch) fires at createUser, before the
    /// profile exists. The refetch signal must come only once the picks are actually stored.
    func testSignupSignalsProfileSavedOnlyAfterInterestsAreStored() async throws {
        try LocalStack.require()
        guard Firestore.firestore().settings.host == "127.0.0.1:8899", !Firestore.firestore().settings.isSSLEnabled else {
            throw XCTSkip("Requires the explicitly local Firebase test host.")
        }
        let savedUser = UserDefaults.standard.object(forKey: "currentUserJSON")
        let auth = AuthService()
        XCTAssertNil(auth.signupProfileSavedAt)
        let email = "signup-interests-\(UUID().uuidString.prefix(8).lowercased())@example.test"
        try await auth.signUp(email: email, password: "local-signup-check", displayName: "Fictional Signup",
                              birthYear: Calendar.current.component(.year, from: Date()) - 20,
                              studentStatus: true, school: "Fictional School", interests: ["Parks", "Trails"])
        XCTAssertNotNil(auth.signupProfileSavedAt)
        let user = try XCTUnwrap(Auth.auth().currentUser)
        let doc = try await Firestore.firestore().collection("users").document(user.uid).getDocument(source: .server)
        XCTAssertEqual(Set(doc.data()?["interests"] as? [String] ?? []), ["Parks", "Trails"])
        try? await user.delete()
        UserDefaults.standard.set(savedUser, forKey: "currentUserJSON")
    }

    /// BiblioCommons lists day-long events as a midnight start ("12:00 AM") ending 23:59:59.
    /// 422 of the 8,126 San José listings looked like that and showed "at 12:00 AM".
    func testDayLongListingsShowAllDayNotMidnight() {
        let midnight = Calendar.current.startOfDay(for: Calendar.current.date(byAdding: .day, value: 1, to: .now)!)
        func event(time: String, start: Date, end: Date?) -> Event {
            var e = Event(id: "all-day-\(time)", title: "Spooky Season Scavenger Hunt", organizer: "San José Public Library",
                          date: start, time: time, locationName: "Biblioteca Latinoamericana", attendeeCount: 0,
                          maxAttendees: nil, category: .social, imagePlaceholder: "sparkles", pointValue: 0)
            e.endDate = end
            return e
        }
        let dayLong = event(time: "12:00 AM", start: midnight, end: midnight.addingTimeInterval(86_399))
        XCTAssertTrue(dayLong.isAllDay)
        XCTAssertEqual(dayLong.displayTime, "All day")
        XCTAssertTrue(dayLong.whenText.hasSuffix(" · All day"), dayLong.whenText)
        XCTAssertFalse(dayLong.whenText.contains("12:00"), dayLong.whenText)
        XCTAssertTrue(event(time: "All day", start: midnight, end: nil).isAllDay)
        let timed = event(time: "3:00 PM", start: midnight.addingTimeInterval(15 * 3600), end: midnight.addingTimeInterval(17 * 3600))
        XCTAssertFalse(timed.isAllDay)
        XCTAssertEqual(timed.displayTime, "3:00 PM")
        // A real event that genuinely starts at midnight and runs two hours keeps its time.
        XCTAssertFalse(event(time: "12:00 AM", start: midnight, end: midnight.addingTimeInterval(7200)).isAllDay)
    }

    /// The Daily Gem's reveal tap lands on a decorative SceneKit medallion; an SCNView takes
    /// touches by default, so the tap was sometimes absorbed before the SwiftUI gesture saw it.
    func testDecorativeMedallionTakesNoTouches() {
        let coordinator = VerdureMedallion3D.Coordinator()
        let builtIn = SCNView().gestureRecognizers?.count ?? 0   // SCNView ships its own recognizers
        let decorative = SCNView()
        VerdureMedallion3D.configureTouches(decorative, interactive: false, coordinator: coordinator)
        XCTAssertFalse(decorative.isUserInteractionEnabled, "a decorative medallion must not take the tap")
        XCTAssertEqual(decorative.gestureRecognizers?.count ?? 0, builtIn)
        let interactive = SCNView()
        VerdureMedallion3D.configureTouches(interactive, interactive: true, coordinator: coordinator)
        XCTAssertTrue(interactive.isUserInteractionEnabled)
        XCTAssertEqual(interactive.gestureRecognizers?.count ?? 0, builtIn + 1, "the interactive one adds its pan")
    }

    private let gemKeys = ["dailyGem.splashDay", "dailyGem.indexDay", "dailyGem.todayIndex", "dailyGem.seenIndices"]

    override func setUp() async throws {
        for key in gemKeys { UserDefaults.standard.removeObject(forKey: key) }
    }
    override func tearDown() async throws {
        for key in gemKeys { UserDefaults.standard.removeObject(forKey: key) }
    }

    // MARK: Daily Gem

    func testGemFactIsStableWithinADay() {
        let first = DailyGemStore.todaysFact
        let second = DailyGemStore.todaysFact
        XCTAssertEqual(first.id, second.id, "re-viewing today must show the same fact")
    }

    func testGemSplashShowsExactlyOncePerDay() {
        XCTAssertTrue(DailyGemStore.shouldShowSplash, "fresh day → splash due")
        DailyGemStore.markSplashShown()
        XCTAssertFalse(DailyGemStore.shouldShowSplash, "second open the same day → no splash")
    }

    func testGemNeverRepeatsUntilPoolExhausts() {
        // Simulate day-by-day selection by clearing the per-day pin while keeping
        // the seen-set, mirroring what a date change does.
        var seen = Set<String>()
        let poolSize = SampleData.gemFacts.count
        for _ in 0..<poolSize {
            let fact = DailyGemStore.todaysFact
            XCTAssertFalse(seen.contains(fact.id), "a fact repeated before the pool was exhausted")
            seen.insert(fact.id)
            UserDefaults.standard.removeObject(forKey: "dailyGem.indexDay")   // "next day"
        }
        XCTAssertEqual(seen.count, poolSize, "every fact appears exactly once per cycle")
        // Pool exhausted → recycles instead of crashing.
        XCTAssertNotNil(DailyGemStore.todaysFact)
    }

    // MARK: Sanitizer (external data is hostile)

    func testSanitizerStripsMarkupAndControlCharacters() {
        XCTAssertEqual(Sanitize.text("<b>Hello</b>\u{0007} world"), "Hello world")
        XCTAssertEqual(Sanitize.text("a &amp; b"), "a & b")
        XCTAssertEqual(Sanitize.text("  spaced   out  "), "spaced out")
        XCTAssertEqual(Sanitize.text(String(repeating: "x", count: 500), max: 10).count, 10)
    }

    func testSanitizerBlocksDangerousURLs() {
        XCTAssertNil(Sanitize.url("javascript:alert(1)"))
        XCTAssertNil(Sanitize.url("data:text/html,<script>"))
        XCTAssertNil(Sanitize.url("file:///etc/passwd"))
        XCTAssertNotNil(Sanitize.url("https://example.com/photo.jpg"))
    }

    func testSanitizerClampsCoordinates() {
        XCTAssertNil(Sanitize.latitude(91))
        XCTAssertNil(Sanitize.latitude(0), "0,0 (null island) treated as missing")
        XCTAssertEqual(Sanitize.latitude(44.98), 44.98)
        XCTAssertNil(Sanitize.longitude(181))
        XCTAssertEqual(Sanitize.coord("-93.26"), -93.26, "string coords parse")
    }

    // MARK: Personalization mapping

    func testEveryInterestMapsToAtLeastOneEventCategory() {
        for interest in PlaceCategory.allCases {
            XCTAssertFalse(interest.relatedEventCategories.isEmpty,
                           "\(interest.rawValue) must produce event recommendations")
        }
    }

    /// CAC 2026: the offline fallback map must not reach for the catch-all
    /// categories — Meetup, Social, Workshop and Hackathon are how career and
    /// developer events reached a Parks + Trails user when the server was down.
    func testFallbackMappingAvoidsCatchAllCategories() {
        let catchAlls: Set<EventCategory> = [.meetup, .social, .workshop, .hackathon, .program]
        for interest in PlaceCategory.allCases {
            XCTAssertTrue(Set(interest.relatedEventCategories).isDisjoint(with: catchAlls),
                          "(interest.rawValue) must not map to a catch-all category")
        }
        XCTAssertTrue(PlaceCategory.community.relatedEventCategories.contains(.volunteer))
        XCTAssertFalse(PlaceCategory.trails.relatedEventCategories.contains(.sports),
                       "Trails → Sports was the bug the brief describes")
    }
}


final class LivePartnerWakeTests: XCTestCase {
    @MainActor func testAuthRestorationConnectsWithoutForegroundViewAndSignOutClearsEligibility() async throws {
        try LocalStack.require()
        XCTAssertEqual(Firestore.firestore().settings.host, "127.0.0.1:8899")
        try Auth.auth().signOut()
        let service = LivePartnerAlerts()
        service.start()
        _ = try await Auth.auth().signIn(withEmail: "program-native-adult@example.test", password: "local-program-native-only")
        let readyBy = Date().addingTimeInterval(15)
        while !service.eligible, Date() < readyBy { try await Task.sleep(for: .milliseconds(40)) }
        XCTAssertTrue(service.eligible, "Restored Auth and server profile must connect independently of RootView callbacks")
        XCTAssertFalse(service.enabled, "An adult account without explicit consent stays off")
        XCTAssertEqual(service.monitoredCount, 0)
        try Auth.auth().signOut()
        let clearedBy = Date().addingTimeInterval(15)
        while service.eligible, Date() < clearedBy { try await Task.sleep(for: .milliseconds(40)) }
        XCTAssertFalse(service.eligible)
        XCTAssertFalse(service.enabled)
        XCTAssertEqual(service.monitoredCount, 0)
    }
    func testColdEntryWaitsForSameAccountAndCurrentCatalog() {
        let now = Date(timeIntervalSince1970: 1000), id = "verdure-live:fictional-a"
        var wake = LivePartnerWakeBuffer(owner: "account-a")
        wake.record(id, monitoredIDs: [id], now: now)
        XCTAssertTrue(wake.belongs(to: "account-a"))
        wake.bind("account-a")
        XCTAssertEqual(wake.drain(currentIDs: [id], now: now.addingTimeInterval(5)), [id])
        XCTAssertEqual(wake.drain(currentIDs: [id], now: now.addingTimeInterval(6)), [], "An entry is evaluated only once")
    }
    func testColdEntryCannotCrossAccountOrSignOut() {
        let now = Date(timeIntervalSince1970: 1000), id = "verdure-live:fictional-a"
        var wake = LivePartnerWakeBuffer(owner: "account-a")
        wake.record(id, monitoredIDs: [id], now: now)
        XCTAssertFalse(wake.belongs(to: "account-b"))
        XCTAssertFalse(wake.belongs(to: nil))
        wake.bind("account-b")
        XCTAssertEqual(wake.drain(currentIDs: [id], now: now), [])
        wake.record(id, monitoredIDs: [id], now: now)
        wake.clear()
        XCTAssertEqual(wake.drain(currentIDs: [id], now: now), [])
    }
    func testExpiredWithdrawnAndUnregisteredWakeEntriesDoNotDeliver() {
        let now = Date(timeIntervalSince1970: 1000), id = "verdure-live:fictional-a"
        var wake = LivePartnerWakeBuffer(owner: "account-a")
        wake.record(id, monitoredIDs: [], now: now)
        XCTAssertEqual(wake.drain(currentIDs: [id], now: now), [])
        wake.record(id, monitoredIDs: [id], now: now)
        XCTAssertEqual(wake.drain(currentIDs: [], now: now), [], "Fresh catalog withdrawal wins over the saved OS region")
        wake.record(id, monitoredIDs: [id], now: now)
        XCTAssertEqual(wake.drain(currentIDs: [id], now: now.addingTimeInterval(61)), [])
        wake.record(id, monitoredIDs: [id], now: now.addingTimeInterval(1))
        XCTAssertEqual(wake.drain(currentIDs: [id], now: now), [], "Future timestamps are not fresh")
    }
    func testWakeBufferIsBoundedAndRejectsOtherLocationFeatures() {
        let now = Date(timeIntervalSince1970: 1000)
        let ids = Set((0..<25).map { "verdure-live:fictional-\($0)" })
        var wake = LivePartnerWakeBuffer(owner: "account-a")
        for id in ids.sorted() { wake.record(id, monitoredIDs: ids, now: now) }
        wake.record("other-feature:region", monitoredIDs: ["other-feature:region"], now: now)
        XCTAssertEqual(wake.drain(currentIDs: ids, now: now).count, 20)
    }
}
