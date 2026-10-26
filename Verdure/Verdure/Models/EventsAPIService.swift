import Foundation
import CoreLocation
import SwiftUI
import Observation
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFunctions

// MARK: - Events Service (Firestore only)
//
// INGEST-AND-OWN. Events are fetched from every source (Ticketmaster, library
// and civic calendars, Localist, NPS, SerpApi as a gap-filler, organizer
// accounts) by scheduled Cloud Functions, deduplicated once at write time and
// stored in the normalized /events collection. This class READS THAT
// COLLECTION AND NOTHING ELSE: no user request ever triggers an upstream API
// call, no vendor key ships in the app, and the same corpus powers push,
// personalisation and the planner.
//
// The previous model (SerpApi + five client-side providers fanned out on every
// open) could do none of that and burned the 100-search monthly quota on the
// first few users. It is gone, not disabled — see functions/src/ingest/.
@MainActor @Observable
final class EventsAPIService {

    // MARK: - Published State

    private var storedEvents: [Event] = []
    var events: [Event] {
        get { storedEvents.filter { isEligible($0) }.excluding(hiddenIDs: hiddenEventIDs) }
        set { storedEvents = Self.uniqueEvents(newValue).annotated(with: rankedFeed) }
    }
    private var programOwnerID: String?
    private var eligibleProgramIDs: Set<String> = []
    func isEligible(_ event: Event, now: Date = Date()) -> Bool {
        guard event.isProgram else { return true }
        return programOwnerID != nil && programOwnerID == Auth.auth().currentUser?.uid &&
            eligibleProgramIDs.contains(event.id) && event.programIsCurrent(now: now)
    }
    private(set) var rankedEventIDs: [String] = []
    private var feedSessionID: String?
    /// Every id the server put in this feed session's slate (telemetry accepts
    /// only those), including ones the user has since hidden.
    private var sessionEventIDs: Set<String> = []
    /// W5: the ranked rows by event id — reasons and series dates are merged
    /// onto the matching /events documents whenever either side changes.
    private(set) var rankedFeed: [String: RankedFeedEvent] = [:]
    /// W5: events hidden in this process. The server also excludes them from
    /// every later feed; this set keeps them out of the current session at once.
    private(set) var hiddenEventIDs: Set<String> = []
    private var storedEverythingEvents: [Event] = []
    private(set) var everythingEvents: [Event] {
        get { storedEverythingEvents.filter { isEligible($0) }.excluding(hiddenIDs: hiddenEventIDs) }
        set { storedEverythingEvents = Self.uniqueEvents(newValue) }
    }
    private(set) var everythingHasMore = true
    private(set) var everythingLoading = false
    private(set) var everythingError: String?
    var isLoading = false
    var lastError: String? = nil
    /// Set when the user is outside every launch area — the honest reason the
    /// list may be empty or far away. Nil inside a covered area.
    var coverageNotice: String? = nil
    /// The launch area the user is in (or nearest to).
    var activeArea: LaunchArea? = nil
    private(set) var launchAreas: [LaunchArea] = LaunchArea.builtIn

    // MARK: - Private

    private var db: Firestore { Firestore.firestore() }
    private var followedOrganizerIDs: Set<String> = []
    private var lastFetchDate: Date?
    private var cachedCenter: CLLocationCoordinate2D?
    /// Firestore reads are cheap and the store changes hourly; refresh gently.
    private let fetchCooldown: TimeInterval = 300
    /// The whole upcoming corpus for a launch area comfortably fits; filtering
    /// (radius, category, free/paid, search) happens locally with no network.
    private let maxEvents = 80
    private var everythingCursor: DocumentSnapshot?
    private var everythingAreaId: String?
    private var everythingStartAt = Date()

    // MARK: - Adult-only gate (W2)
    //
    // The rules serve an adultOnly listing only to a signed-in account whose
    // server-written ageBand is "adult". Rules are not filters: a query from a
    // minor, unknown-age or signed-out session that does not itself constrain
    // adultOnly == false is denied outright. So every /events query below exists
    // in two spellings — the adult one and the filtered one — chosen by
    // `viewerIsAdult`. (They are written out in full rather than through a
    // helper because the Firestore index inventory, functions/scripts/
    // firestore-query-inventory.mjs, follows only literal query chains and
    // fails closed on anything it cannot read.)
    private(set) var viewerIsAdult = false
    private var viewerAgeUID: String?

    /// Re-reads the caller's age band when the account changes or is not yet
    /// known to be adult. Unknown age fails closed and browses like a minor.
    func refreshViewerAgeBand() async {
        guard let uid = Auth.auth().currentUser?.uid else { viewerIsAdult = false; viewerAgeUID = nil; return }
        if viewerAgeUID == uid && viewerIsAdult { return }
        do {
            let snapshot = try await db.collection("users").document(uid).getDocument(source: .server)
            viewerIsAdult = (snapshot.data()?["ageBand"] as? String) == "adult"
        } catch {
            viewerIsAdult = false
        }
        viewerAgeUID = uid
    }

    // Cache
    private let cacheKey = "cachedEventsJSON.v2"
    private let cacheCenterKey = "cachedEventsCenter.v2"
    private let cacheTimestampKey = "cachedEventsTimestamp.v2"
    private let cacheTTL: TimeInterval = 6 * 3600

    // MARK: - Init

    init() {
        if QAData.offline { useSampleFallback() }
        else { loadCachedEvents() }
    }

    /// Overlapping async feed/opportunity reads can return the same document.
    /// Preserve the first occurrence and its order without duplicating cards.
    static func uniqueEvents(_ input: [Event]) -> [Event] {
        var seen: Set<String> = []
        return input.filter { seen.insert($0.id).inserted }
    }

    // MARK: - Public API

    /// Load upcoming events from the normalized store. `center` is used only
    /// for the coverage notice — the query itself is not geographic, because
    /// ingestion is already scoped to launch areas.
    func fetchNearbyEvents(around center: CLLocationCoordinate2D, followedOrganizerIDs: Set<String> = []) async {
        if QAData.offline { return }   // QA: cached/sample data only
        updateCoverage(for: center)
        await fetchPrograms(around: center)
        await fetchVolunteerSupply()
        // Remember the follow set across plain refreshes (which pass none).
        if !followedOrganizerIDs.isEmpty { self.followedOrganizerIDs = followedOrganizerIDs }
        if let cached = cachedCenter, let last = lastFetchDate,
           Date().timeIntervalSince(last) < fetchCooldown,
           distance(cached, center) < 5000 {
            if rankedEventIDs.isEmpty { await fetchPersonalized(around: center) }
            return
        }

        // Unstructured so it survives view-lifecycle churn at launch.
        await Task { @MainActor in
            self.isLoading = true
            self.lastError = nil
            if let fetched = await self.fetchFirestoreEvents() {
                // Followed organizers who aren't approved yet are visible only to
                // their followers — a separate, rules-permitted query per organizer.
                let followerOnly = await self.fetchFollowedOrganizerEvents(self.followedOrganizerIDs)
                var merged = fetched
                let seen = Set(fetched.map(\.id))
                merged.append(contentsOf: followerOnly.filter { !seen.contains($0.id) })
                merged.removeAll { $0.isProgram || $0.category == .volunteer }
                merged.append(contentsOf: self.storedEvents.filter { ($0.isProgram && self.isEligible($0)) || $0.category == .volunteer })
                // A successful read is the truth — including an honest empty list.
                self.events = merged.sorted { $0.date < $1.date }
                self.cachedCenter = center
                self.persistCache(center: center)
            }
            // nil = the read failed (offline / rules / no auth); keep what we had.
            self.lastFetchDate = Date()
            self.isLoading = false
        }.value
        await fetchPersonalized(around: center)
    }

    /// Rank against the server's bounded area snapshot. The first ten missing
    /// records are fetched by ID so a social pick outside the initial time page
    /// still has a real, tappable card on the phone.
    private func fetchPersonalized(around center: CLLocationCoordinate2D) async {
        guard !QAData.offline, Auth.auth().currentUser != nil else { return }
        do {
            let area = LaunchArea.nearest(to: center, in: launchAreas)?.id ?? "san-jose-ca"
            let data = try await Functions.functions().httpsCallable("recommendedEvents").call([
                "areaId": area, "lat": center.latitude, "lng": center.longitude, "limit": 50,
                "telemetryEnabled": Analytics.isEnabled,
            ]).data as? [String: Any] ?? [:]
            let slate = RankedFeedEvent.decode(data)
            feedSessionID = data["feedSessionId"] as? String
            sessionEventIDs = Set(slate.map(\.id))
            // The server already excludes hidden events; a hide made during this
            // session is filtered here too so it never reappears before the refresh lands.
            let rows = slate.filter { !hiddenEventIDs.contains($0.id) }
            rankedFeed = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            storedEvents = storedEvents.annotated(with: rankedFeed)
            let ids = rows.map(\.id)
            for id in ids.prefix(10) where !events.contains(where: { $0.id == id }) {
                if let event = await event(withID: id) { events.append(event) }
            }
            rankedEventIDs = ids
        } catch {
            // A local event list still works while Functions are unavailable.
            rankedEventIDs = []
            rankedFeed = [:]
            storedEvents = storedEvents.annotated(with: rankedFeed)
            feedSessionID = nil
            sessionEventIDs = []
        }
    }

    func recordFeedEvent(for eventID: String, action: String) async {
        guard !QAData.offline, Analytics.isEnabled, Auth.auth().currentUser != nil,
              let feedSessionID, sessionEventIDs.contains(eventID) else { return }
        do {
            let payload: [String: any Sendable] = [
                "sessionId": feedSessionID, "eventId": eventID, "action": action
            ]
            _ = try await Functions.functions().httpsCallable("recordFeedEvent").call(payload)
        } catch {
            print("[EventsAPI] feed telemetry failed: \(error.localizedDescription)")
        }
    }

    /// Feedback is server-owned and affects the next ranked feed. The view
    /// signal is weak; explicit more/less choices are stronger.
    func recordFeedback(for eventID: String, kind: String) async {
        guard !QAData.offline, Auth.auth().currentUser != nil else { return }
        do {
            _ = try await Functions.functions().httpsCallable("recordEventFeedback")
                .call(["eventId": eventID, "kind": kind])
            if kind == "less" { await recordFeedEvent(for: eventID, action: "dismiss") }
            if kind != "view" { await fetchPersonalized(around: cachedCenter ?? LaunchArea.builtIn[0].center) }
        } catch {
            print("[EventsAPI] feedback failed: \(error.localizedDescription)")
        }
    }

    /// W5 "Hide this event": the local part, synchronous so the card is gone
    /// before any network round trip. Drops the event from the feed, the ranked
    /// order and the Everything list, and keeps it out of this session.
    func markHidden(_ eventID: String) {
        hiddenEventIDs.insert(eventID)
        rankedEventIDs.removeAll { $0 == eventID }
        rankedFeed[eventID] = nil
    }

    /// W5 "Hide this event": removes the card immediately, then records the
    /// server-side exclusion (`recordEventFeedback` kind "hide" adds the id to
    /// the user's `hiddenEventIDs`, so no later feed ranks it again).
    func hideEvent(_ eventID: String) async {
        markHidden(eventID)
        guard !QAData.offline, Auth.auth().currentUser != nil else { return }
        do {
            _ = try await Functions.functions().httpsCallable("recordEventFeedback")
                .call(["eventId": eventID, "kind": "hide"])
            await recordFeedEvent(for: eventID, action: "dismiss")
            await fetchPersonalized(around: cachedCenter ?? LaunchArea.builtIn[0].center)
        } catch {
            print("[EventsAPI] hide failed: \(error.localizedDescription)")
        }
    }

    func updateInterests(_ names: [String]) async {
        guard let uid = Auth.auth().currentUser?.uid else { return }
        let clean = Array(Set(names.map { Sanitize.text($0, max: 40) }.filter { !$0.isEmpty })).sorted().prefix(20)
        do {
            try await db.collection("users").document(uid).setData(["interests": Array(clean)], merge: true)
            await fetchPersonalized(around: cachedCenter ?? LaunchArea.builtIn[0].center)
        } catch {
            print("[EventsAPI] interests sync failed: \(error.localizedDescription)")
        }
    }

    /// Date-cursor paging over the entire broadcast corpus for the nearest
    /// launch area. Filters are applied to accumulated pages in EventsView.
    /// A page costs at most 40 document reads, even with 9,000 indexed events.
    func loadEverythingPage(around center: CLLocationCoordinate2D, reset: Bool = false) async {
        if QAData.offline {
            everythingEvents = events.sorted { $0.date < $1.date }
            everythingHasMore = false
            return
        }
        let area = LaunchArea.nearest(to: center, in: launchAreas)?.id ?? "san-jose-ca"
        if reset || everythingAreaId != area {
            everythingEvents = events.filter { $0.isProgram || $0.category == .volunteer }
            everythingCursor = nil
            everythingHasMore = true
            everythingAreaId = area
            everythingStartAt = Date()
        }
        guard everythingHasMore, !everythingLoading else { return }
        everythingLoading = true
        everythingError = nil
        defer { everythingLoading = false }
        await refreshViewerAgeBand()
        do {
            var query: Query = viewerIsAdult
                ? db.collection("events")
                    .whereField("hidden", isEqualTo: false)
                    .whereField("active", isEqualTo: true)
                    .whereField("broadcast", isEqualTo: true)
                    .whereField("areaId", isEqualTo: area)
                    .whereField("date", isGreaterThanOrEqualTo: Timestamp(date: everythingStartAt))
                    .order(by: "date")
                    .limit(to: 40)
                : db.collection("events")
                    .whereField("hidden", isEqualTo: false)
                    .whereField("active", isEqualTo: true)
                    .whereField("broadcast", isEqualTo: true)
                    .whereField("areaId", isEqualTo: area)
                    .whereField("adultOnly", isEqualTo: false)
                    .whereField("date", isGreaterThanOrEqualTo: Timestamp(date: everythingStartAt))
                    .order(by: "date")
                    .limit(to: 40)
            if let everythingCursor { query = query.start(afterDocument: everythingCursor) }
            // An empty local Firestore cache is not a successful feed refresh.
            let page = try await query.getDocuments(source: .server)
            everythingCursor = page.documents.last
            everythingHasMore = page.documents.count == 40
            let seen = Set(everythingEvents.map(\.id))
            everythingEvents.append(contentsOf: page.documents.compactMap { Self.mapFirestoreDocument($0) }
                .filter { !seen.contains($0.id) })
        } catch {
            everythingError = "Couldn't load more events. Try again."
        }
    }

    /// Force refresh, ignoring cooldown.
    /// Look up a single event by id — the shape a notification deep link
    /// arrives in. Checks what's already loaded first, then Firestore, because
    /// a tap that lands on a cached event should be instant and offline-safe.
    /// Returns nil when the event is genuinely gone (cancelled, hidden by
    /// moderation, or aged out between the push and the tap), which the caller
    /// must show honestly rather than as an empty screen.
    func event(withID id: String) async -> Event? {
        if let local = events.first(where: { $0.id == id }), isEligible(local) { return local }
        do {
            let doc = try await Firestore.firestore().collection("events").document(id).getDocument()
            guard doc.exists else { return nil }
            guard let event = Self.mapFirestoreDocument(doc) else { return nil }
            if event.isProgram {
                await fetchPrograms(around: cachedCenter ?? LaunchArea.builtIn[0].center)
                guard isEligible(event) else { return nil }
            }
            return event
        } catch {
            print("[EventsAPI] event(withID:) failed: \(error.localizedDescription)")
            return nil
        }
    }

    func ensureEvents(_ ids: [String]) async {
        for id in ids.prefix(4) where !events.contains(where: { $0.id == id }) {
            if let event = await event(withID: id) { events.append(event) }
        }
    }

    func refresh(around center: CLLocationCoordinate2D) async {
        lastFetchDate = nil
        cachedCenter = nil
        UserDefaults.standard.removeObject(forKey: cacheTimestampKey)
        await fetchNearbyEvents(around: center)
    }

    /// Refresh the launch-area list from the server (cheap; falls back to the mirror).
    func refreshLaunchAreas() async {
        do {
            let result = try await Functions.functions().httpsCallable("listLaunchAreas").call([:])
            guard let data = result.data as? [String: Any],
                  let raw = data["areas"] as? [[String: Any]] else { return }
            let parsed: [LaunchArea] = raw.compactMap { a in
                guard let id = a["id"] as? String, let name = a["name"] as? String,
                      let center = a["center"] as? [String: Any],
                      let lat = Sanitize.coord(center["lat"]), let lng = Sanitize.coord(center["lng"]),
                      let radius = Sanitize.coord(a["radiusMiles"]) else { return nil }
                return LaunchArea(id: id, name: Sanitize.text(name, max: 60), latitude: lat, longitude: lng, radiusMiles: radius)
            }
            if !parsed.isEmpty { launchAreas = parsed }
        } catch {
            // The built-in mirror is fine; this is a courtesy refresh.
        }
    }

    /// Create a community event (server-owned visibility flags are set by rules/functions).
    func createEvent(
        title: String,
        description: String,
        organizer: String,
        date: Date,
        time: String,
        locationName: String,
        maxAttendees: Int?,
        category: EventCategory
    ) async -> Event? {
        guard let currentUser = Auth.auth().currentUser else {
            lastError = "You must be signed in to create an event."
            return nil
        }

        let eventID = UUID().uuidString
        let pointValue = category.defaultPoints

        // Best-effort forward geocode of the venue so the server can verify
        // attendee proximity at check-in. Failure is non-fatal (event still posts).
        let venueCoordinate = await Self.geocode(locationName)

        var data: [String: Any] = [
            "title": sanitize(title, max: 200),
            "description": sanitize(description, max: 2000),
            "organizer": sanitize(organizer, max: 200),
            "date": Timestamp(date: date),
            "time": sanitize(time, max: 50),
            "locationName": sanitize(locationName, max: 300),
            "attendeeCount": 1,
            "maxAttendees": maxAttendees as Any,
            "category": category.rawValue,
            "imagePlaceholder": category.icon,
            "pointValue": pointValue,
            "creatorID": currentUser.uid,
            "createdAt": FieldValue.serverTimestamp(),
            // Moderation + store flags — required on create by the rules, server-owned after.
            "hidden": false,
            "active": true,
            "source": "community",
            // Required on every event (W1): a community event is not broadcast, so a
            // client flag cannot put an adult-only listing in front of a minor.
            "adultOnly": false,
        ]
        if let venueCoordinate {
            data["latitude"] = venueCoordinate.latitude
            data["longitude"] = venueCoordinate.longitude
        }

        do {
            try await db.collection("events").document(eventID).setData(data)
            let event = Event(
                id: eventID, title: title, organizer: organizer, date: date, time: time,
                locationName: locationName, attendeeCount: 1, maxAttendees: maxAttendees,
                category: category, imagePlaceholder: category.icon, pointValue: pointValue,
                description: description, creatorID: currentUser.uid,
                latitude: venueCoordinate?.latitude, longitude: venueCoordinate?.longitude,
                source: "community", isFree: true)
            events.insert(event, at: 0)
            events.sort { $0.date < $1.date }
            return event
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    /// Delete an event (only if current user is the creator).
    func deleteEvent(_ eventID: String) async -> Bool {
        guard let currentUser = Auth.auth().currentUser else { return false }
        guard let event = events.first(where: { $0.id == eventID }),
              event.creatorID == currentUser.uid else {
            lastError = "You can only delete events you created."
            return false
        }
        do {
            try await db.collection("events").document(eventID).delete()
            events.removeAll { $0.id == eventID }
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    private func fetchPrograms(around center: CLLocationCoordinate2D) async {
        guard !QAData.offline, let uid = Auth.auth().currentUser?.uid else {
            eligibleProgramIDs = []; programOwnerID = nil; storedEvents.removeAll { $0.isProgram }; return
        }
        do {
            let response = try await Functions.functions().httpsCallable("programListings")
                .call(["lat": center.latitude, "lng": center.longitude, "radiusMiles": 50.0])
            guard Auth.auth().currentUser?.uid == uid,
                  let payload = response.data as? [String: Any], let items = payload["items"] as? [[String: Any]] else { return }
            let programs = items.compactMap { item -> Event? in
                guard let id = item["id"] as? String, let ms = item["deadlineMs"] as? Double else { return nil }
                var data = item
                data["date"] = Timestamp(date: Date(timeIntervalSince1970: ms / 1000))
                data["applicationDeadline"] = data["date"]
                return Self.mapPayload(data, id: id)
            }
            programOwnerID = uid; eligibleProgramIDs = Set(programs.map(\.id))
            storedEvents.removeAll { $0.isProgram }; storedEvents.append(contentsOf: programs)
            storedEverythingEvents.removeAll { $0.isProgram }; storedEverythingEvents.append(contentsOf: programs)
        } catch {
            // Fail closed for age eligibility; ordinary event discovery remains available.
            eligibleProgramIDs = []; programOwnerID = nil
        }
    }

    // MARK: - Firestore

    /// Opportunity thresholds use complete current supply, not the first 80
    /// chronological discovery cards. Public rule constraints also work signed out.
    private func fetchVolunteerSupply() async {
        let now = Timestamp(date: Date())
        await refreshViewerAgeBand()
        let query: Query = viewerIsAdult
            ? db.collection("events")
                .whereField("hidden", isEqualTo: false)
                .whereField("active", isEqualTo: true)
                .whereField("broadcast", isEqualTo: true)
                .whereField("category", isEqualTo: "Volunteer")
                .whereField("date", isGreaterThan: now)
                .order(by: "date")
            : db.collection("events")
                .whereField("hidden", isEqualTo: false)
                .whereField("active", isEqualTo: true)
                .whereField("broadcast", isEqualTo: true)
                .whereField("category", isEqualTo: "Volunteer")
                .whereField("adultOnly", isEqualTo: false)
                .whereField("date", isGreaterThan: now)
                .order(by: "date")
        do {
            var docs: [QueryDocumentSnapshot] = []
            var cursor: DocumentSnapshot?
            while true {
                let page = try await (cursor.map { query.start(afterDocument: $0) } ?? query)
                    .limit(to: 250).getDocuments(source: .server)
                docs.append(contentsOf: page.documents)
                guard docs.count <= 2000 else {
                    throw NSError(domain: "VolunteerSupply", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: "Volunteer supply exceeds this view's bound."])
                }
                if page.documents.count < 250 { break }
                cursor = page.documents.last
            }
            let volunteers = docs.compactMap { Self.mapFirestoreDocument($0) }
            storedEvents.removeAll { $0.category == .volunteer }
            storedEvents.append(contentsOf: volunteers)
            storedEverythingEvents.removeAll { $0.category == .volunteer }
            storedEverythingEvents.append(contentsOf: volunteers)
        } catch {
            // Never retain a stale full count after a failed current-supply read.
            storedEvents.removeAll { $0.category == .volunteer }
            storedEverythingEvents.removeAll { $0.category == .volunteer }
            print("[EventsAPI] Volunteer supply unavailable: \(error.localizedDescription)")
        }
    }

    /// The main discovery query. Every clause is required by the read rules
    /// ("rules are not filters"): hidden == false, and either broadcast == true
    /// (public listings — readable signed out) or the caller follows the organizer.
    /// Returns nil when the read fails so callers keep their cache.
    private func fetchFirestoreEvents() async -> [Event]? {
        await refreshViewerAgeBand()
        do {
            let now = Timestamp(date: Date().addingTimeInterval(-3600))
            let snapshot = try await (viewerIsAdult
                ? db.collection("events")
                    .whereField("hidden", isEqualTo: false)
                    .whereField("active", isEqualTo: true)
                    .whereField("broadcast", isEqualTo: true)
                    .whereField("date", isGreaterThanOrEqualTo: now)
                    .order(by: "date")
                    .limit(to: maxEvents)
                : db.collection("events")
                    .whereField("hidden", isEqualTo: false)
                    .whereField("active", isEqualTo: true)
                    .whereField("broadcast", isEqualTo: true)
                    .whereField("adultOnly", isEqualTo: false)
                    .whereField("date", isGreaterThanOrEqualTo: now)
                    .order(by: "date")
                    .limit(to: maxEvents)
            ).getDocuments(source: .server)
            return snapshot.documents.compactMap { Self.mapFirestoreDocument($0) }
        } catch {
            lastError = "Couldn't reach the event store. Showing what was saved on this device."
            print("[EventsAPI] Firestore error: \(error.localizedDescription)")
            return nil
        }
    }

    /// Events from organizers the user follows that are NOT yet broadcast. The
    /// rules allow this read only when the query pins organizerId, which is why
    /// it is one query per followed organizer (bounded to 20).
    private func fetchFollowedOrganizerEvents(_ organizerIDs: Set<String>) async -> [Event] {
        guard Auth.auth().currentUser != nil, !organizerIDs.isEmpty else { return [] }
        var out: [Event] = []
        let cutoff = Timestamp(date: Date().addingTimeInterval(-3600))
        await refreshViewerAgeBand()
        for orgId in organizerIDs.prefix(20) {
            do {
                let snap = try await (viewerIsAdult
                    ? db.collection("events")
                        .whereField("hidden", isEqualTo: false)
                        .whereField("active", isEqualTo: true)
                        .whereField("organizerId", isEqualTo: orgId)
                        .whereField("date", isGreaterThanOrEqualTo: cutoff)
                        .limit(to: 100)
                    : db.collection("events")
                        .whereField("hidden", isEqualTo: false)
                        .whereField("active", isEqualTo: true)
                        .whereField("organizerId", isEqualTo: orgId)
                        .whereField("adultOnly", isEqualTo: false)
                        .whereField("date", isGreaterThanOrEqualTo: cutoff)
                        .limit(to: 100)
                ).getDocuments(source: .server)
                out.append(contentsOf: snap.documents.compactMap { Self.mapFirestoreDocument($0) })
            } catch {
                print("[EventsAPI] organizer \(orgId) query failed: \(error.localizedDescription)")
            }
        }
        return out
    }

    /// Community events are user-generated and ingested events came from third
    /// parties — both are scrubbed on read like any other external data.
    static func mapFirestoreDocument(_ doc: DocumentSnapshot) -> Event? {
        guard let data = doc.data() else { return nil }
        return mapPayload(data, id: doc.documentID)
    }

    private static func mapPayload(_ data: [String: Any], id: String) -> Event? {
        guard let title = data["title"] as? String,
              let organizer = data["organizer"] as? String,
              let timestamp = data["date"] as? Timestamp,
              let time = data["time"] as? String,
              let locationName = data["locationName"] as? String,
              let categoryRaw = data["category"] as? String else {
            return nil
        }
        let category = EventCategory(rawValue: categoryRaw) ?? .social
        let safeDescription = Sanitize.text(data["description"] as? String, max: 600)
        let tags = ((data["tags"] as? [String]) ?? []).map { Sanitize.text($0, max: 40) }.filter { !$0.isEmpty }
        let sources = (data["sources"] as? [[String: Any]]) ?? []
        let priceMin = Sanitize.coord(data["priceMin"])
        return Event(
            id: id,
            title: Sanitize.text(title, max: 120).ifEmpty("Untitled event"),
            organizer: Sanitize.text(organizer, max: 80).ifEmpty("Community"),
            date: timestamp.dateValue(),
            time: Sanitize.text(time, max: 60).ifEmpty("Time TBA"),
            locationName: Sanitize.text(locationName, max: 100).ifEmpty("Location TBA"),
            attendeeCount: data["attendeeCount"] as? Int ?? 0,
            maxAttendees: data["maxAttendees"] as? Int,
            category: category,
            imagePlaceholder: category.icon,   // never trust a remote SF Symbol name
            pointValue: min(data["pointValue"] as? Int ?? category.defaultPoints, category.defaultPoints),
            description: safeDescription.isEmpty ? nil : safeDescription,
            creatorID: data["creatorID"] as? String,
            website: Sanitize.url(data["website"] as? String),
            latitude: Sanitize.latitude(Sanitize.coord(data["latitude"])),
            longitude: Sanitize.longitude(Sanitize.coord(data["longitude"])),
            source: (data["source"] as? String).map { Sanitize.text($0, max: 30) } ?? "community",
            sourceCount: max(1, sources.count),
            isFree: data["isFree"] as? Bool,
            priceMin: priceMin,
            imageURL: Sanitize.url(data["imageURL"] as? String),
            tags: tags,
            areaId: data["areaId"] as? String,
            organizerId: data["organizerId"] as? String,
            isBroadcast: (data["broadcast"] as? Bool) ?? true,
            expectedSize: data["expectedSize"] as? Int,
            indoorOutdoor: data["indoorOutdoor"] as? String,
            ageSuitability: data["ageSuitability"] as? String,
            endDate: (data["endDate"] as? Timestamp)?.dateValue(),
            minimumAge: data["minimumAge"] as? Int,
            maximumAge: data["maximumAge"] as? Int,
            accessibilityFeatures: data["accessibilityFeatures"] as? [String] ?? [],
            publicVenue: data["publicVenue"] as? Bool,
            recurring: data["recurring"] as? Bool,
            virtual: data["virtual"] as? Bool,
            applicationDeadline: (data["applicationDeadline"] as? Timestamp)?.dateValue(),
            opportunitySubtype: data["opportunitySubtype"] as? String,
            adultOnly: data["adultOnly"] as? Bool ?? false
        )
    }

    /// Forward-geocode a venue string to a coordinate (best-effort, nil on failure).
    static func geocode(_ address: String) async -> CLLocationCoordinate2D? {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let geocoder = CLGeocoder()
        let placemarks = try? await geocoder.geocodeAddressString(trimmed)
        return placemarks?.first?.location?.coordinate
    }

    // MARK: - Coverage

    private func updateCoverage(for center: CLLocationCoordinate2D) {
        guard let nearest = LaunchArea.nearest(to: center, in: launchAreas) else { return }
        activeArea = nearest
        if nearest.covers(center) {
            coverageNotice = nil
        } else {
            let miles = Int(nearest.distanceMiles(from: center).rounded())
            coverageNotice = "Verdure hasn't launched where you are yet. Showing \(nearest.name), \(miles) miles away."
        }
    }

    // MARK: - Cache

    private func persistCache(center: CLLocationCoordinate2D) {
        let encodable = events.map { CachedEvent(from: $0) }
        if let data = try? JSONEncoder().encode(encodable) {
            UserDefaults.standard.set(data, forKey: cacheKey)
        }
        UserDefaults.standard.set([center.latitude, center.longitude], forKey: cacheCenterKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: cacheTimestampKey)
    }

    private func loadCachedEvents() {
        guard let data = UserDefaults.standard.data(forKey: cacheKey),
              let cached = try? JSONDecoder().decode([CachedEvent].self, from: data),
              let centerArr = UserDefaults.standard.array(forKey: cacheCenterKey) as? [Double],
              centerArr.count == 2,
              isCacheValid() else { return }
        cachedCenter = CLLocationCoordinate2D(latitude: centerArr[0], longitude: centerArr[1])
        // Drop anything that has already happened.
        let cutoff = Date().addingTimeInterval(-3600)
        events = cached.map { $0.toEvent() }.filter { $0.date >= cutoff }
    }

    private func isCacheValid() -> Bool {
        let ts = UserDefaults.standard.double(forKey: cacheTimestampKey)
        guard ts > 0 else { return false }
        return Date().timeIntervalSince1970 - ts < cacheTTL
    }

    // MARK: - Helpers

    /// QA harness only (DEBUG + `-QAOfflineData YES`). In every other build this
    /// is a no-op and the screens render their honest empty states.
    private func useSampleFallback() {
        guard SampleData.isEnabled else { return }
        events = SampleData.events
        #if DEBUG
        // `-QAFeedReasons YES`: a deterministic ranked feed with server-shaped
        // reasons and series dates, so UI tests can audit the W5 controls.
        if UserDefaults.standard.bool(forKey: "QAFeedReasons") {
            rankedFeed = SampleData.feedReasons
            rankedEventIDs = SampleData.events.map(\.id).filter { rankedFeed[$0] != nil }
            storedEvents = storedEvents.annotated(with: rankedFeed)
        }
        #endif
    }

    private func sanitize(_ input: String, max: Int) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(trimmed.prefix(max))
    }

    private func distance(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: a.latitude, longitude: a.longitude)
            .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
    }
}

// MARK: - Cache Model

private struct CachedEvent: Codable {
    let id: String
    let title: String
    let organizer: String
    let dateInterval: TimeInterval
    let time: String
    let locationName: String
    let attendeeCount: Int
    let maxAttendees: Int?
    let categoryRaw: String
    let imagePlaceholder: String
    let pointValue: Int
    let description: String?
    let creatorID: String?
    let website: String?
    let latitude: Double?
    let longitude: Double?
    let source: String?
    let sourceCount: Int?
    let isFree: Bool?
    let priceMin: Double?
    let imageURL: String?
    let tags: [String]?
    let areaId: String?
    let organizerId: String?
    let isBroadcast: Bool?
    let expectedSize: Int?
    let indoorOutdoor: String?
    let ageSuitability: String?
    let endDate: Date?
    let minimumAge: Int?
    let maximumAge: Int?
    let accessibilityFeatures: [String]?
    let publicVenue: Bool?
    let recurring: Bool?
    let virtual: Bool?
    let applicationDeadline: TimeInterval?
    let opportunitySubtype: String?

    init(from event: Event) {
        id = event.id; title = event.title; organizer = event.organizer
        dateInterval = event.date.timeIntervalSince1970; time = event.time
        locationName = event.locationName; attendeeCount = event.attendeeCount
        maxAttendees = event.maxAttendees; categoryRaw = event.category.rawValue
        imagePlaceholder = event.imagePlaceholder; pointValue = event.pointValue
        description = event.description; creatorID = event.creatorID; website = event.website
        latitude = event.latitude; longitude = event.longitude
        source = event.source; sourceCount = event.sourceCount; isFree = event.isFree
        priceMin = event.priceMin; imageURL = event.imageURL; tags = event.tags
        areaId = event.areaId; organizerId = event.organizerId; isBroadcast = event.isBroadcast
        expectedSize = event.expectedSize; indoorOutdoor = event.indoorOutdoor
        ageSuitability = event.ageSuitability; endDate = event.endDate
        minimumAge = event.minimumAge; maximumAge = event.maximumAge
        accessibilityFeatures = event.accessibilityFeatures; publicVenue = event.publicVenue
        recurring = event.recurring; virtual = event.virtual
        applicationDeadline = event.applicationDeadline?.timeIntervalSince1970
        opportunitySubtype = event.opportunitySubtype
    }

    func toEvent() -> Event {
        let category = EventCategory(rawValue: categoryRaw) ?? .social
        return Event(
            id: id, title: title, organizer: organizer,
            date: Date(timeIntervalSince1970: dateInterval), time: time,
            locationName: locationName, attendeeCount: attendeeCount, maxAttendees: maxAttendees,
            category: category, imagePlaceholder: imagePlaceholder, pointValue: pointValue,
            description: description, creatorID: creatorID, website: website,
            latitude: latitude, longitude: longitude,
            source: source ?? "community", sourceCount: sourceCount ?? 1, isFree: isFree,
            priceMin: priceMin, imageURL: imageURL, tags: tags ?? [],
            areaId: areaId, organizerId: organizerId, isBroadcast: isBroadcast ?? true,
            expectedSize: expectedSize, indoorOutdoor: indoorOutdoor, ageSuitability: ageSuitability, endDate: endDate,
            minimumAge: minimumAge, maximumAge: maximumAge,
            accessibilityFeatures: accessibilityFeatures ?? [], publicVenue: publicVenue,
            recurring: recurring, virtual: virtual,
            applicationDeadline: applicationDeadline.map { Date(timeIntervalSince1970: $0) },
            opportunitySubtype: opportunitySubtype)
    }
}

// MARK: - Errors

enum EventsAPIError: LocalizedError {
    case serverError
    case notAuthenticated

    var errorDescription: String? {
        switch self {
        case .serverError: return "Server returned an error"
        case .notAuthenticated: return "You must be signed in"
        }
    }
}
