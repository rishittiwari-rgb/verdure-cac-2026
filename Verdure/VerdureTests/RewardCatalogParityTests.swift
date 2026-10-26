import XCTest
@testable import Verdure

// MARK: - Reward catalog parity
//
// WHY THIS TEST IS UNUSUAL. It reads `functions/src/economy.ts` off disk and
// compares it to the Swift fallback catalog.
//
// A test that only checked Swift against itself would not have caught the bug
// it exists to prevent: the client priced a $5 card at 1,000 points while the
// server charged 35,000, and a comment claiming the two were "mirrored" is what
// let a 35x drift pass review. Parity between two files can only be enforced by
// a check that reads both. So this fails if EITHER side changes alone.
//
// If the repo isn't present (an archived build, a detached test bundle) the
// source-reading assertions skip rather than fail — the arithmetic assertions
// below still run, and CI always has the repo.

final class RewardCatalogParityTests: XCTestCase {

    /// functions/src/economy.ts, located relative to this test file.
    private var economyTS: String? {
        let here = URL(fileURLWithPath: #filePath)              // …/Verdure/VerdureTests/<this>
        let repo = here.deletingLastPathComponent()             // VerdureTests
            .deletingLastPathComponent()                        // Verdure
            .deletingLastPathComponent()                        // repo root
        let url = repo.appendingPathComponent("functions/src/economy.ts")
        return try? String(contentsOf: url, encoding: .utf8)
    }

    // MARK: Arithmetic (always runs)

    func testEveryClientCostIsUsdTimesPointsPerDollar() {
        XCTAssertFalse(SampleData.rewards.isEmpty, "fallback catalog should not be empty")
        for reward in SampleData.rewards {
            guard let usd = SampleData.rewardUSD[reward.id] else {
                return XCTFail("\(reward.id) has no USD face value recorded")
            }
            XCTAssertEqual(reward.pointCost, usd * SampleData.pointsPerDollar,
                           "\(reward.id) must cost usd x pointsPerDollar")
        }
    }

    /// The specific regression: a $5 card must not be purchasable for 1,000.
    func testFiveDollarCardCostsThirtyFiveThousand() {
        let starbucks = SampleData.rewards.first { $0.id == "starbucks-5" }
        XCTAssertEqual(starbucks?.pointCost, 35_000)
    }

    /// Deactivated tiers must not be browsable at any balance.
    func testInactiveRewardsAreAbsentFromTheClientCatalog() {
        let deactivatedServerSide = [
            "amazon-25", "nike-25", "apple-50", "rei-50",
            "rei-15-trail-season", "patagonia-30-earth",
        ]
        let clientIDs = Set(SampleData.rewards.map(\.id))
        for id in deactivatedServerSide {
            XCTAssertFalse(clientIDs.contains(id),
                           "\(id) is active:false server-side and must not be browsable")
        }
    }

    // MARK: Cross-file parity (skips if the repo isn't reachable)

    func testPointsPerDollarMatchesTheServer() throws {
        let source = try XCTUnwrap(economyTS, "economy.ts unreadable — skipping cross-file check")
        let value = try XCTUnwrap(Self.firstInt(in: source,
            pattern: #"export\s+const\s+POINTS_PER_DOLLAR\s*=\s*(\d+)"#),
            "couldn't find POINTS_PER_DOLLAR in economy.ts")
        XCTAssertEqual(SampleData.pointsPerDollar, value,
                       "SampleData.pointsPerDollar drifted from the server's POINTS_PER_DOLLAR")
    }

    func testClientCatalogMatchesTheServerActiveSet() throws {
        let source = try XCTUnwrap(economyTS, "economy.ts unreadable — skipping cross-file check")
        let serverActive = Self.activeCashIDs(in: source)
        XCTAssertFalse(serverActive.isEmpty, "parsed no active cash rewards from economy.ts")

        let clientIDs = Set(SampleData.rewards.map(\.id))
        XCTAssertEqual(clientIDs, serverActive,
            """
            Client fallback catalog and server active set disagree.
              client only: \(clientIDs.subtracting(serverActive).sorted())
              server only: \(serverActive.subtracting(clientIDs).sorted())
            Update both, or delete the reward from both.
            """)
    }

    func testClientCostsMatchTheServerCosts() throws {
        let source = try XCTUnwrap(economyTS, "economy.ts unreadable — skipping cross-file check")
        let serverUSD = Self.activeCashUSD(in: source)
        let ppd = Self.firstInt(in: source, pattern: #"export\s+const\s+POINTS_PER_DOLLAR\s*=\s*(\d+)"#) ?? 7000
        for reward in SampleData.rewards {
            guard let usd = serverUSD[reward.id] else { continue }   // set mismatch is its own test
            XCTAssertEqual(reward.pointCost, usd * ppd,
                           "\(reward.id): client charges \(reward.pointCost), server charges \(usd * ppd)")
        }
    }

    // MARK: Tiny parser

    private static func firstInt(in source: String, pattern: String) -> Int? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
              let r = Range(m.range(at: 1), in: source) else { return nil }
        return Int(source[r])
    }

    /// Entries shaped: "id": { usd: N, cost: N * POINTS_PER_DOLLAR, name: "…", active: true }
    private static func cashEntries(in source: String) -> [(id: String, usd: Int, active: Bool)] {
        let pattern = #""([a-z0-9\-]+)":\s*\{\s*usd:\s*(\d+),[^}]*?active:\s*(true|false)\s*\}"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(source.startIndex..., in: source)
        return re.matches(in: source, range: range).compactMap { m in
            guard let idR = Range(m.range(at: 1), in: source),
                  let usdR = Range(m.range(at: 2), in: source),
                  let actR = Range(m.range(at: 3), in: source),
                  let usd = Int(source[usdR]) else { return nil }
            return (String(source[idR]), usd, source[actR] == "true")
        }
    }

    private static func activeCashIDs(in source: String) -> Set<String> {
        Set(cashEntries(in: source).filter(\.active).map(\.id))
    }

    private static func activeCashUSD(in source: String) -> [String: Int] {
        Dictionary(uniqueKeysWithValues: cashEntries(in: source).filter(\.active).map { ($0.id, $0.usd) })
    }
}
