import XCTest
@testable import Verdure

/// Licence credits that must ship: OpenStreetMap (ODbL) on every surface that lists
/// `osm-` places, Open-Meteo (CC BY 4.0) wherever the planner shows weather, and the
/// "Data and acknowledgements" section in Terms.
final class DataCreditTests: XCTestCase {
    private func source(_ relative: String) throws -> String {
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // VerdureTests
            .deletingLastPathComponent()   // Verdure
            .deletingLastPathComponent()   // repo root
        let url = repo.appendingPathComponent(relative)
        return try XCTUnwrap(try? String(contentsOf: url, encoding: .utf8), "missing \(relative)")
    }

    func testTermsCarryDataAndAcknowledgements() throws {
        let section = try XCTUnwrap(Legal.termsSections.first { $0.title == "Data and acknowledgements" })
        XCTAssertTrue(section.body.contains("© OpenStreetMap contributors"))
        XCTAssertTrue(section.body.contains("openstreetmap.org/copyright"))
        XCTAssertTrue(section.body.contains("Open-Meteo.com"))
    }

    func testOpenStreetMapCreditLinksToCopyrightPage() throws {
        let shared = try source("Verdure/Verdure/Components/SharedComponents.swift")
        XCTAssertTrue(shared.contains("Link(\"© OpenStreetMap contributors\", destination: URL(string: \"https://www.openstreetmap.org/copyright\")!)"))
    }

    func testEveryPlaceSurfaceShowsTheCreditForOSMPlaces() throws {
        for file in ["Views/Explore/PlaceDetailView.swift", "Views/Explore/ExploreView.swift",
                     "Views/Map/MapExploreView.swift", "Views/Map/ExploreBetaView.swift"] {
            let text = try source("Verdure/Verdure/" + file)
            XCTAssertTrue(text.contains("hasPrefix(\"osm-\")"), "\(file) must gate on osm- ids")
            XCTAssertTrue(text.contains("OpenStreetMapCredit("), "\(file) must show OpenStreetMapCredit")
        }
    }

    func testPlannerWeatherShowsOpenMeteoCredit() throws {
        let planner = try source("Verdure/Verdure/Views/Explore/AdventurePlannerView.swift")
        XCTAssertTrue(planner.contains("Link(\"Weather data by Open-Meteo.com\", destination: URL(string: \"https://open-meteo.com/\")!)"))
        // Shown exactly when weather is shown.
        XCTAssertTrue(planner.contains("if plan.weatherSummary != nil, plan.temperatureF != nil {"))
    }
}
