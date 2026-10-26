import Foundation
import CoreLocation
@testable import Verdure

/// Test-only content with its OWN ids.
///
/// `SampleData` ids are refused at the earn boundary (fabricated content can
/// never earn points — see `GameStateManager.checkInEvent/collectPlace`), so any
/// test of the earn pipeline that used a sample fixture would silently prove
/// nothing. These mirror the shape of the old fixtures with distinct ids.
enum TestFixtures {
    static let event = Event(
        id: "test-event-hackathon", title: "Test Community Hackathon", organizer: "Test Dev Collective",
        date: Calendar.current.date(byAdding: .day, value: 2, to: .now)!, time: "9:00 AM – 9:00 PM",
        locationName: "Downtown Library", attendeeCount: 42, maxAttendees: 80, category: .hackathon,
        imagePlaceholder: "laptopcomputer", pointValue: 200,
        description: "Fixture event for unit tests.", latitude: 44.979, longitude: -93.268)

    static let place = Place(
        id: "test-riverside-park", name: "Test Riverside Park", category: .parks,
        shortDescription: "Fixture place for unit tests.", distance: "0.3 mi", distanceValue: 0.3,
        rating: nil, reviewCount: nil, imagePlaceholder: "leaf.fill", accentColor: .verdureGreen,
        isFeatured: true, latitude: 44.9808, longitude: -93.261)

    static let collectible = CollectiblePlace(
        id: "test-riverside-park", place: place, rarity: .common,
        coordinate: CLLocationCoordinate2D(latitude: 44.9808, longitude: -93.261))
}
