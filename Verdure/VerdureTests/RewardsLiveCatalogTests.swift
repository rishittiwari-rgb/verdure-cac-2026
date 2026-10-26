import XCTest
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions
@testable import Verdure

@MainActor final class RewardsLiveCatalogTests: XCTestCase {
    /// The expiry timer calls refresh(); if it fired between sign-out and the auth
    /// listener's connect(nil), refresh() marked the signed-out catalog loaded, so the
    /// Rewards screen's gift-card section depended on which ran first. No network needed.
    func testRefreshWhileSignedOutLeavesTheSignedOutState() async throws {
        try? Auth.auth().signOut()
        let service = EconomyService()
        service.connect(nil)
        XCTAssertFalse(service.hasLoaded)
        await service.refresh()
        XCTAssertFalse(service.hasLoaded, "a signed-out refresh must not mark the catalog loaded")
        XCTAssertTrue(service.catalog.perks.isEmpty)
        XCTAssertTrue(service.myCodes.isEmpty)
    }

    // Actual server mutations, SDK status listeners and clock boundaries. No
    // client-side imitation of the server's status hash or eligibility policy.
    func testStaffChangesStockExpiryAndAccountClearCachedRewards() async throws {
        try LocalStack.require()
        guard Firestore.firestore().settings.host == "127.0.0.1:8899", !Firestore.firestore().settings.isSSLEnabled else {
            throw XCTSkip("Requires the explicitly local Firebase test host.")
        }
        let service = EconomyService()
        // Offer ids and codes are per run: a redeemed code can never be re-uploaded, so with fixed
        // ones every run after the first (without reseeding rewards-native-fixture.mjs) was refused
        // "At least one code already exists in this perk".
        let run = UUID().uuidString.prefix(8).lowercased()
        let partnerID = "qa-rewards-native-partner", stocked = "qa-rewards-native-stocked-\(run)"
        let soldout = "qa-rewards-native-soldout-\(run)", window = "qa-rewards-native-window-\(run)"
        let ids = Set([stocked, soldout, window])
        func call(_ name: String, _ data: [String: Any]) async throws {
            // Transfer a fresh JSON graph to the SDK, rather than transferring
            // dictionaries that the MainActor test intentionally edits/reuses.
            let bytes = try JSONSerialization.data(withJSONObject: data)
            _ = try await Functions.functions().httpsCallable(name).call(JSONSerialization.jsonObject(with: bytes))
        }
        func until(_ stage: String, _ predicate: () -> Bool) async throws {
            let end = Date().addingTimeInterval(12)
            while !predicate() && Date() < end { try await Task.sleep(for: .milliseconds(40)) }
            XCTAssertTrue(predicate(), "Native Rewards failed to observe \(stage) without manual refresh. " +
                "perks=\(service.catalog.perks.map(\.id)) codes=\(service.myCodes.count) hasLoaded=\(service.hasLoaded) auth=\(Auth.auth().currentUser?.uid ?? "nil")")
        }
        var partner: [String: Any] = ["partnerId": partnerID, "name": "Fictional Native Rewards Business",
            "category": "retail", "address": "42 Fictional Native Rewards Road", "contactName": "Fictional owner",
            "contactEmail": "fictional-owner@example.test", "active": true,
            "agreement": ["agreedBy": "Fictional owner", "agreedAtMs": Date().addingTimeInterval(-10).timeIntervalSince1970 * 1000,
                          "reference": "Local fictional QA agreement; no real business"], "reason": "Native local fixture"]
        func perk(_ id: String, title: String = "Fictional Native Discount", cost: Int = 500,
                  expires: Date = Date().addingTimeInterval(120), early: Date? = nil) -> [String: Any] {
            var data: [String: Any] = ["perkId": id, "partnerId": partnerID, "title": title,
                "description": "Disposable fictional local offer", "terms": "Fictional local QA only",
                "pointCost": cost, "expiresAtMs": expires.timeIntervalSince1970 * 1000,
                "active": true, "reason": "Native local fixture"]
            if let early { data["earlyAccessUntilMs"] = early.timeIntervalSince1970 * 1000 }
            return data
        }
        do {
            _ = try await Auth.auth().signIn(withEmail: "qa-rewards-native-staff@example.test", password: "local-rewards-native-only")
            await service.loadMyCodes()
            let codesBefore = service.myCodes.count   // codes issued by earlier runs stay issued
            try await call("savePartner", partner)
            var first = perk(stocked); first["codes"] = ["LOCAL-NATIVE-FIRST-\(run)", "LOCAL-NATIVE-SECOND-\(run)"]
            try await call("upsertPartnerPerk", first)
            try await call("upsertPartnerPerk", perk(soldout))
            // Simulate a persisted pre-v2 status document. Its hash used a
            // different field set; it must not fight a fresh canonical payload.
            var legacyRequest = URLRequest(url: URL(string: "http://127.0.0.1:8899/v1/projects/connectify-19dd8/databases/(default)/documents/perkStatus/\(stocked)")!)
            legacyRequest.httpMethod = "PATCH"
            legacyRequest.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
            legacyRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            legacyRequest.httpBody = try JSONSerialization.data(withJSONObject: ["fields": [
                "available": ["booleanValue": true], "revision": ["stringValue": "legacy-pre-v2-field-set"],
                "expiresAtMs": ["doubleValue": Date().addingTimeInterval(120).timeIntervalSince1970 * 1000]
            ]])
            let (_, legacyResponse) = try await URLSession.shared.data(for: legacyRequest)
            XCTAssertEqual((legacyResponse as? HTTPURLResponse)?.statusCode, 200)
            await service.refresh()
            XCTAssertEqual(service.catalog.perks.filter { ids.contains($0.id) }.count, 2)
            XCTAssertEqual(service.catalog.perks.first { $0.id == stocked }?.codesLeft, 2)
            XCTAssertEqual(service.catalog.perks.first { $0.id == soldout }?.isSoldOut, true)
            XCTAssertEqual(service.catalog.perks.first { $0.id == soldout }?.redeemable, false)
            XCTAssertNotNil(service.catalog.perks.first { $0.id == soldout }?.perkRevision)
            for _ in 0..<25 {
                try await Task.sleep(for: .milliseconds(40))
                XCTAssertTrue(service.catalog.perks.contains { $0.id == stocked }, "Legacy hashes must not repeatedly invalidate a fresh catalog.")
            }
            try await call("redeemReward", ["rewardId": stocked])
            try await until("partial stock decrement") { service.catalog.perks.first { $0.id == stocked }?.codesLeft == 1 }
            await service.loadMyCodes()
            XCTAssertEqual(service.myCodes.count, codesBefore + 1)
            try await call("deactivatePartnerOffer", ["kind": "perk", "targetId": soldout, "reason": "Withdraw fictional sold-out offer"])
            try await until("sold-out withdrawal") { !service.catalog.perks.contains { $0.id == soldout } }
            XCTAssertTrue(service.catalog.perks.contains { $0.id == stocked })
            try await call("upsertPartnerPerk", perk(stocked, title: "Updated Fictional Offer", cost: 600))
            try await until("offer price/title edit") {
                service.catalog.perks.contains { $0.id == stocked && $0.title == "Updated Fictional Offer" && $0.pointCost == 600 }
            }
            partner["name"] = "Revised Fictional Native Business"
            try await call("savePartner", partner)
            try await until("business label edit") {
                service.catalog.perks.contains { $0.id == stocked && $0.partner == "Revised Fictional Native Business" }
            }
            try await call("deactivatePartnerOffer", ["kind": "partner", "targetId": partnerID, "reason": "Withdraw fictional business"])
            try await until("partner withdrawal") { !service.catalog.perks.contains { $0.partnerID == partnerID } }
            XCTAssertEqual(service.myCodes.count, codesBefore + 1, "Withdrawal does not erase an already issued code.")
            try await call("savePartner", partner)
            var opening = perk(window, early: Date().addingTimeInterval(8)); opening["codes"] = ["LOCAL-NATIVE-WINDOW-\(run)"]
            try await call("upsertPartnerPerk", opening)
            // Explicitly hydrate newly created/restored offers, then let only
            // the service's clock/listeners update the already displayed rows. Restoring the
            // partner also triggers the service's own listener refresh, which supersedes this
            // one (requestID), so wait for the catalog to hold the new offer rather than
            // assuming this call's result is the one applied.
            await service.refresh()
            try await until("new offer hydrated") { service.catalog.perks.contains { $0.id == window } }
            XCTAssertEqual(service.catalog.perks.first { $0.id == window }?.plusOnlyUntilOpens, true)
            try await until("early-access opening") {
                service.catalog.perks.contains { $0.id == window && !$0.plusOnlyUntilOpens && $0.redeemable }
            }
            try await call("upsertPartnerPerk", perk(stocked, expires: Date().addingTimeInterval(6)))
            try await until("new expiry metadata") {
                service.catalog.perks.contains { $0.id == stocked && ($0.expiresAt ?? .distantFuture) < Date().addingTimeInterval(10) }
            }
            try await until("clock expiry") { !service.catalog.perks.contains { $0.id == stocked } }
            XCTAssertFalse(service.catalog.perks.isEmpty)
            try Auth.auth().signOut()
            try await until("sign-out clearing") { service.catalog.perks.isEmpty && service.myCodes.isEmpty && !service.hasLoaded }
        } catch {
            try? Auth.auth().signOut(); service.connect(nil)
            throw error
        }
    }
}
