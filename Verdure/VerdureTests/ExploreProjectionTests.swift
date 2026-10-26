import XCTest
import CoreLocation
@testable import Verdure

final class ExploreProjectionTests: XCTestCase {
    func testCardinalDirectionsAndAntimeridian() throws {
        let origin = CLLocationCoordinate2D(latitude: 0, longitude: 0)
        XCTAssertEqual(try XCTUnwrap(ExploreProjection.bearing(from: origin, to: .init(latitude: 1, longitude: 0))), 0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(ExploreProjection.bearing(from: origin, to: .init(latitude: 0, longitude: 1))), 90, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(ExploreProjection.bearing(from: origin, to: .init(latitude: -1, longitude: 0))), 180, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(ExploreProjection.bearing(from: .init(latitude: 0, longitude: 179), to: .init(latitude: 0, longitude: -179))), 90, accuracy: 0.01)
    }
    func testHeadingWrapChoosesShortArcAndRejectsUnknownHeading() throws {
        XCTAssertEqual(try XCTUnwrap(ExploreProjection.relativeAngle(bearing: 2, heading: 358)), 4, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(ExploreProjection.relativeAngle(bearing: 358, heading: 2)), -4, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(ExploreProjection.relativeAngle(bearing: 180, heading: 0)), -180, accuracy: 0.01)
        XCTAssertNil(ExploreProjection.relativeAngle(bearing: 90, heading: -1))
        XCTAssertNil(ExploreProjection.relativeAngle(bearing: .nan, heading: 0))
        XCTAssertNil(ExploreProjection.bearing(from: .init(latitude: 91, longitude: 0), to: .init(latitude: 0, longitude: 0)))
    }
}
