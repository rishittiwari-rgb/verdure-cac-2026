import XCTest
import CoreLocation
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@testable import Verdure

@MainActor final class PartnerDiscoveryTests: XCTestCase {
    func testNearbySortAndMissingLocationFallback() {
        let perks = EconomyService.parseCatalog(["perks": [
            ["id": "far", "title": "Far", "latitude": 37.5, "longitude": -121.8863],
            ["id": "missing", "title": "Missing coordinates"],
            ["id": "near", "title": "Near", "latitude": 37.339, "longitude": -121.8863],
        ]]).perks
        XCTAssertEqual(PartnerPerk.sortedNearby(perks, origin: nil).map(\.id), ["far", "missing", "near"])
        let sorted = PartnerPerk.sortedNearby(perks, origin: CLLocation(latitude: 37.3382, longitude: -121.8863))
        XCTAssertEqual(sorted.map(\.id), ["near", "far", "missing"])
    }

    func testNearbySortPreservesServerOrderForEqualOrInvalidDistances() {
        let perks = EconomyService.parseCatalog(["perks": [
            ["id": "first", "title": "First", "latitude": 37.3382, "longitude": -121.8863],
            ["id": "second", "title": "Second", "latitude": 37.3382, "longitude": -121.8863],
            ["id": "invalid", "title": "Invalid", "latitude": 999.0, "longitude": -121.8863],
            ["id": "absent", "title": "Absent"],
        ]]).perks
        XCTAssertEqual(PartnerPerk.sortedNearby(perks, origin: CLLocation(latitude: 37.3382, longitude: -121.8863)).map(\.id),
                       ["first", "second", "invalid", "absent"])
    }

    // Connected integration proof: the actual service uses callable payloads,
    // Firebase listeners and its expiry timer. Fixtures stay on loopback only.
    func testLiveStationaryOfferInvalidationAndExpiry() async throws {
        guard Firestore.firestore().settings.host == "127.0.0.1:8899", !Firestore.firestore().settings.isSSLEnabled else {
            throw XCTSkip("Connected partner test requires the local Firebase test host.")
        }
        let suffix = UUID().uuidString.lowercased(), partnerID = "ios-fixture-\(suffix)", perkID = "\(partnerID)-perk"
        let base = "http://127.0.0.1:8899/v1/projects/connectify-19dd8/databases/(default)/documents"
        func request(_ path: String, method: String, body: [String: Any]? = nil) async throws {
            var req = URLRequest(url: URL(string: "\(base)\(path)")!)
            req.httpMethod = method; req.timeoutInterval = 10
            req.setValue("Bearer owner", forHTTPHeaderField: "Authorization") // Emulator-only fixture administration.
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                throw NSError(domain: "LocalPartnerFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: String(decoding: data, as: UTF8.self)])
            }
        }
        func fields(_ values: [String: Any]) -> [String: Any] {
            values.mapValues { value -> [String: Any] in
                if let date = value as? Date { return ["timestampValue": ISO8601DateFormatter().string(from: date)] }
                if let boolean = value as? Bool { return ["booleanValue": boolean] }
                if let number = value as? Int { return ["integerValue": String(number)] }
                if let number = value as? Double { return ["doubleValue": number] }
                if let object = value as? [String: Any] { return ["mapValue": ["fields": fields(object)]] }
                return ["stringValue": value as! String]
            }
        }
        func set(_ path: String, _ values: [String: Any]) async throws {
            try await request("/\(path)", method: "PATCH", body: ["fields": fields(values)])
        }
        // A missing service is an explicit skip, never physical-device proof.
        do { try await set("qaPartnerListener/\(suffix)", ["local": true]) }
        catch let error as URLError where error.code == .cannotConnectToHost {
            throw XCTSkip("Start sprint-emulators.mjs for the connected partner integration test.")
        }
        let user = try await Auth.auth().signInAnonymously().user
        let service = PartnerDiscoveryService()
        func until(_ stage: String, _ condition: () -> Bool) async throws {
            let end = Date().addingTimeInterval(10)
            while !condition() && Date() < end { try await Task.sleep(for: .milliseconds(40)) }
            XCTAssertTrue(condition(), "Actual partner service did not receive \(stage); offers=\(service.offers.map(\.id)), near=\(service.nearYou?.id ?? "nil"), error=\(service.error ?? "none"), auth=\(Auth.auth().currentUser?.uid ?? "guest").")
        }
        let origin = CLLocation(latitude: 33.2, longitude: -114.1)
        let partner: [String: Any] = ["active": true, "name": "Fictional iOS live fixture", "category": "retail",
            "latitude": origin.coordinate.latitude, "longitude": origin.coordinate.longitude,
            "agreement": ["agreedBy": "Fictional owner", "agreedAt": Date().addingTimeInterval(-10), "reference": "Local fixture; no real business"]]
        var perk: [String: Any] = ["active": true, "partnerId": partnerID, "title": "Local fixture offer", "description": "Local only",
            "pointCost": 500, "codePoolCount": 1, "expiresAt": Date().addingTimeInterval(120)]
        func cleanup() async {
            service.beginSession()
            for path in ["partners/\(partnerID)", "partnerPerks/\(perkID)", "partnerStatus/\(partnerID)", "perkStatus/\(perkID)", "qaPartnerListener/\(suffix)"] {
                try? await request("/\(path)", method: "DELETE")
            }
            try? await user.delete()
        }
        do {
            try await set("partners/\(partnerID)", partner)
            try await set("partnerPerks/\(perkID)", perk)
            try await set("perkStatus/\(perkID)", ["available": true, "revision": "legacy-pre-v2-field-set",
                                                   "expiresAtMs": Date().addingTimeInterval(120).timeIntervalSince1970 * 1000])
            await service.refresh(around: origin)
            XCTAssertEqual(service.offers.map(\.id), [perkID])
            XCTAssertEqual(service.nearYou?.id, perkID)
            let original = try XCTUnwrap(service.offers.first)
            for _ in 0..<25 {
                try await Task.sleep(for: .milliseconds(40))
                XCTAssertEqual(service.offers.first?.id, perkID, "Legacy revision formats must not refetch a fresh map payload forever.")
            }
            // Equivalent to the backend's atomic source/status mutation; no
            // service.refresh call or GPS movement is used to observe removal.
            func deactivate(_ collection: String, id: String, revision: String) async throws {
                let status = collection == "partners" ? "partnerStatus" : "perkStatus"
                let root = "projects/connectify-19dd8/databases/(default)/documents"
                try await request(":commit", method: "POST", body: ["writes": [
                    ["update": ["name": "\(root)/\(collection)/\(id)", "fields": fields(["active": false])], "updateMask": ["fieldPaths": ["active"]]],
                    ["update": ["name": "\(root)/\(status)/\(id)", "fields": fields(["available": false, "revision": revision])]]
                ]])
            }
            // A withdrawal written while the listeners are still attaching can be missed by the
            // emulator (initial "no document" snapshot, change never delivered); the scenario
            // under test is a withdrawal of a displayed offer the app is already watching.
            try await until("watching for withdrawals") { service.isWatchingForWithdrawals }
            try await deactivate("partnerPerks", id: perkID, revision: "fixture-deactivated")
            try await until("perk withdrawal") { service.offers.isEmpty && service.nearYou == nil }
            try await set("partnerPerks/\(perkID)", perk)
            try await set("perkStatus/\(perkID)", ["available": true, "revision": original.perkRevision!, "expiresAtMs": original.expiresAt!.timeIntervalSince1970 * 1000])
            service.beginSession(); await service.refresh(around: origin)
            XCTAssertEqual(service.nearYou?.id, perkID)
            // A withdrawal written while the listeners are still attaching can be missed by the
            // emulator (initial "no document" snapshot, change never delivered); the scenario
            // under test is a withdrawal of a displayed offer the app is already watching.
            try await until("watching for withdrawals") { service.isWatchingForWithdrawals }
            try await deactivate("partners", id: partnerID, revision: "fixture-partner-deactivated")
            try await until("partner withdrawal") { service.offers.isEmpty && service.nearYou == nil }
            try await set("partners/\(partnerID)", partner)
            try await set("partnerStatus/\(partnerID)", ["available": true, "revision": original.partnerRevision!])
            try await request("/perkStatus/\(perkID)", method: "DELETE")
            perk["expiresAt"] = Date().addingTimeInterval(4)
            try await set("partnerPerks/\(perkID)", perk)
            service.beginSession(); await service.refresh(around: origin)
            XCTAssertEqual(service.offers.first?.id, perkID)
            XCTAssertEqual(service.nearYou?.id, perkID)
            try await until("clock expiry") { service.offers.isEmpty && service.nearYou == nil }
            try Auth.auth().signOut()
            await service.refresh(around: origin)
            XCTAssertTrue(service.offers.isEmpty)
            XCTAssertNil(service.nearYou)
            await cleanup()
        } catch { await cleanup(); throw error }
    }
}
