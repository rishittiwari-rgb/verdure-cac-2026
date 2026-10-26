import Foundation
import CoreLocation
import SwiftUI
import Observation

// MARK: - Places API Service (Overpass / OpenStreetMap)

@MainActor @Observable
final class PlacesAPIService {

    // MARK: - Published State

    var places: [Place] = []
    var collectiblePlaces: [CollectiblePlace] = []
    var isLoading = false
    var lastError: String? = nil
    /// When the OpenStreetMap data on screen was fetched (live, area cache or bundled
    /// snapshot); shown next to the "© OpenStreetMap contributors" credit.
    private(set) var osmDataDate: Date?

    // MARK: - Private

    private var cachedCenter: CLLocationCoordinate2D?
    private let maxPlaces = 30
    private let radiusMeters = 5000 // 5 km search radius
    private let cacheKey = "cachedPlacesJSON"
    private let cacheCenterKey = "cachedPlacesCenter"
    private let cacheTimestampKey = "cachedPlacesTimestamp"
    private let cacheOSMDateKey = "cachedPlacesOSMDataDate"
    private let cacheTTL: TimeInterval = 3600 // 1 hour
    private let overpass: OverpassClient
    private let areaCache: OSMAreaCache
    private let snapshot: OSMDataSet?
    private let defaults: UserDefaults
    private let keyedProviders: Bool
    /// After every mirror fails, wait this long before asking them again.
    private let liveRetryInterval: TimeInterval = 300
    private var lastLiveFailure: Date?

    // MARK: - Init

    /// Tests inject the Overpass transport, cache, snapshot and defaults, and turn the
    /// key-based providers (Recreation.gov, NPS) off so nothing reaches the network.
    init(overpass: OverpassClient = OverpassClient(), areaCache: OSMAreaCache = .shared,
         snapshot: OSMDataSet? = OSMSnapshot.bundled, defaults: UserDefaults = .standard,
         keyedProviders: Bool = true) {
        self.overpass = overpass
        self.areaCache = areaCache
        self.snapshot = snapshot
        self.defaults = defaults
        self.keyedProviders = keyedProviders
        loadCachedPlaces()
        if places.isEmpty {
            useSampleFallback()
        }
    }

    // MARK: - Public API

    /// Fetch nearby places from OpenStreetMap around a coordinate. While the mirrors are
    /// asked, the last good answer for this area (or the bundled snapshot) is shown; a live
    /// answer replaces it. With no mirror answering, the cached/snapshot data stays.
    func fetchNearbyPlaces(around center: CLLocationCoordinate2D) async {
        if QAData.offline { return }   // QA: cached/sample data only
        // Skip if we already fetched for a nearby coordinate recently
        if let cached = cachedCenter, isCacheValid(),
           distance(cached, center) < 500 { // within 500m of cached center
            return
        }

        isLoading = true
        lastError = nil
        if places.isEmpty, let stored = storedOSM(around: center) {
            show(mapToPlaces(stored.elements, center: center), dataDate: stored.date, center: center)
        }

        // Unstructured task so a cancelled SwiftUI .task can't kill the fetch.
        await Task { @MainActor in
            // Primary source: OpenStreetMap (free, no key, global).
            var merged: [Place] = []
            var dataDate: Date?
            var live = false
            if let failed = self.lastLiveFailure, Date().timeIntervalSince(failed) < self.liveRetryInterval {
                // Mirrors failed moments ago; keep the stored data rather than wait on them again.
            } else {
                do {
                    let elements = try await self.overpass.fetch(query: self.overpassQuery(center: center))
                    let set = OSMDataSet(fetchedAt: Date(), center: OSMCenter(lat: center.latitude, lon: center.longitude),
                                         radiusMeters: Double(self.radiusMeters), elements: elements)
                    self.areaCache.save(set)
                    merged = self.mapToPlaces(set.elements(near: center, within: Double(self.radiusMeters)), center: center)
                    dataDate = set.fetchedAt
                    live = true
                    self.lastLiveFailure = nil
                } catch {
                    self.lastLiveFailure = Date()
                }
            }
            if !live {
                if let stored = self.storedOSM(around: center) {
                    merged = self.mapToPlaces(stored.elements, center: center)
                    dataDate = stored.date
                } else {
                    self.lastError = PlacesAPIError.serverError.localizedDescription
                }
            }

            // Additional free sources — no-ops unless their keys are configured.
            var extra: [Place] = []
            if self.keyedProviders {
                async let recreation = self.fetchRecreationFacilities(center: center)
                async let nationalParks = self.fetchNPSParks(center: center)
                extra = await recreation + (await nationalParks)
            }

            var seen = Set(merged.map { $0.name.lowercased() })
            for place in extra where !seen.contains(place.name.lowercased()) {
                merged.append(place)
                seen.insert(place.name.lowercased())
            }
            merged.sort { $0.distanceValue < $1.distanceValue }

            if merged.isEmpty {
                if self.places.isEmpty { self.useSampleFallback() }
            } else {
                self.show(merged, dataDate: dataDate, center: center)
                // Only a live answer starts the one-hour "fresh" window; stored data is retried.
                if live {
                    self.cachedCenter = center
                    self.persistCache(center: center)
                }
            }
            self.isLoading = false
        }.value
    }

    private func show(_ list: [Place], dataDate: Date?, center: CLLocationCoordinate2D) {
        places = Array(list.prefix(maxPlaces + 15))
        collectiblePlaces = Self.buildCollectibles(from: places, center: center)
        osmDataDate = places.contains { $0.id.hasPrefix("osm-") } ? dataDate : nil
    }

    /// The last good answer for this area, else the bundled snapshot when it covers the search.
    private func storedOSM(around center: CLLocationCoordinate2D) -> (elements: [OSMElement], date: Date)? {
        let radius = Double(radiusMeters)
        if let cached = areaCache.load(center) {
            let near = cached.elements(near: center, within: radius)
            if !near.isEmpty { return (near, cached.fetchedAt) }
        }
        if let snapshot, snapshot.covers(center, searchRadius: radius) {
            return (snapshot.elements(near: center, within: radius), snapshot.fetchedAt)
        }
        return nil
    }

    /// Find the CollectiblePlace wrapper for a given Place
    func collectible(for place: Place) -> CollectiblePlace? {
        collectiblePlaces.first { $0.place.id == place.id }
    }

    // MARK: - Overpass Query

    /// The app's feature query: parks, trails, gardens, playgrounds, waterfront, sports,
    /// scenic and community spaces within the search radius.
    func overpassQuery(center: CLLocationCoordinate2D) -> String {
        let lat = center.latitude
        let lon = center.longitude
        let r = radiusMeters

        return """
        [out:json][timeout:15];
        (
          node["leisure"="park"](around:\(r),\(lat),\(lon));
          way["leisure"="park"](around:\(r),\(lat),\(lon));
          node["highway"="path"]["name"](around:\(r),\(lat),\(lon));
          way["highway"="path"]["name"](around:\(r),\(lat),\(lon));
          node["leisure"="garden"](around:\(r),\(lat),\(lon));
          way["leisure"="garden"](around:\(r),\(lat),\(lon));
          node["leisure"="playground"](around:\(r),\(lat),\(lon));
          node["natural"="water"]["name"](around:\(r),\(lat),\(lon));
          way["natural"="water"]["name"](around:\(r),\(lat),\(lon));
          node["leisure"="sports_centre"](around:\(r),\(lat),\(lon));
          node["leisure"="pitch"](around:\(r),\(lat),\(lon));
          node["tourism"="viewpoint"](around:\(r),\(lat),\(lon));
          node["amenity"="community_centre"](around:\(r),\(lat),\(lon));
          way["leisure"="nature_reserve"](around:\(r),\(lat),\(lon));
          node["natural"="beach"](around:\(r),\(lat),\(lon));
        );
        out center body qt \(maxPlaces * 2);
        """
    }

    // MARK: - Mapping OSM -> Place

    private func mapToPlaces(_ elements: [OSMElement], center: CLLocationCoordinate2D) -> [Place] {
        var seen = Set<String>() // deduplicate by name
        var results: [Place] = []

        for element in elements {
            let name = Sanitize.text(element.tags?["name"], max: 100)
            guard !name.isEmpty else { continue }

            let normalizedName = name.lowercased()
            guard !seen.contains(normalizedName) else { continue }
            seen.insert(normalizedName)

            let lat = element.lat ?? element.center?.lat ?? 0
            let lon = element.lon ?? element.center?.lon ?? 0
            guard lat != 0 && lon != 0 else { continue }

            let category = Self.categorize(element.tags ?? [:])
            let dist = Self.haversineDistance(
                lat1: center.latitude, lon1: center.longitude,
                lat2: lat, lon2: lon
            )
            let distMiles = dist / 1609.34

            let tags = element.tags ?? [:]
            let place = Place(
                id: "osm-\(element.id)",
                name: name,
                category: category,
                shortDescription: Sanitize.text(Self.buildDescription(tags: tags, category: category, name: name), max: 180),
                distance: String(format: "%.1f mi", distMiles),
                distanceValue: distMiles,
                rating: nil,          // OSM has no ratings — never fabricate one
                reviewCount: nil,
                imagePlaceholder: category.icon,
                accentColor: category.tint,
                isFeatured: distMiles < 0.5,
                latitude: lat,        // REAL coordinates → map pins + collect proximity
                longitude: lon,
                photoURL: Sanitize.url(tags["image"]),
                openHoursReal: Sanitize.text(tags["opening_hours"], max: 80).isEmpty ? nil
                    : Sanitize.text(tags["opening_hours"], max: 80)
            )

            results.append(place)
            if results.count >= maxPlaces { break }
        }

        // Sort by distance
        return results.sorted { $0.distanceValue < $1.distanceValue }
    }

    // MARK: - Category Mapping

    private static func categorize(_ tags: [String: String]) -> PlaceCategory {
        let leisure = tags["leisure"] ?? ""
        let highway = tags["highway"] ?? ""
        let natural = tags["natural"] ?? ""
        let tourism = tags["tourism"] ?? ""
        let amenity = tags["amenity"] ?? ""

        if leisure == "garden" { return .gardens }
        if leisure == "playground" { return .playgrounds }
        if leisure == "sports_centre" || leisure == "pitch" { return .sports }
        if leisure == "nature_reserve" { return .scenic }
        if highway == "path" || highway == "footway" { return .trails }
        if natural == "water" || natural == "beach" { return .waterfront }
        if tourism == "viewpoint" { return .scenic }
        if amenity == "community_centre" { return .community }
        if leisure == "park" { return .parks }

        return .parks // default
    }

    // MARK: - Synthetic Metadata

    private static func buildDescription(tags: [String: String], category: PlaceCategory, name: String) -> String {
        var parts: [String] = []

        if let surface = tags["surface"] {
            parts.append("Surface: \(surface).")
        }
        if tags["wheelchair"] == "yes" {
            parts.append("Wheelchair accessible.")
        }
        if tags["dog"] == "yes" {
            parts.append("Dog friendly.")
        }
        if let sport = tags["sport"] {
            parts.append("Sports: \(sport).")
        }

        if parts.isEmpty {
            switch category {
            case .parks: return "A local park in your area. Visit to discover what makes it special."
            case .trails: return "A trail nearby. Explore it to add it to your collection."
            case .gardens: return "A garden in your neighborhood. Worth a visit to see what's blooming."
            case .playgrounds: return "A playground nearby. Great for families and active fun."
            case .waterfront: return "A waterfront spot near you. Check it out for scenic views."
            case .sports: return "A sports facility in your area. Perfect for staying active."
            case .scenic: return "A scenic viewpoint nearby. Collect it for bonus points."
            case .community: return "A community gathering space. Connect with your neighbors here."
            }
        }

        return parts.joined(separator: " ")
    }

    // MARK: - Additional free place sources (Recreation.gov + NPS)

    /// Recreation.gov RIDB facilities near a point (free key, true geo-radius search).
    /// Docs: https://ridb.recreation.gov/docs
    private func fetchRecreationFacilities(center: CLLocationCoordinate2D) async -> [Place] {
        let key = ProviderConfig.value("RecreationGovKey", env: "RECREATION_GOV_KEY")
        guard !key.isEmpty else { return [] }
        var comps = URLComponents(string: "https://ridb.recreation.gov/api/v1/facilities")!
        comps.queryItems = [
            .init(name: "latitude", value: "\(center.latitude)"),
            .init(name: "longitude", value: "\(center.longitude)"),
            .init(name: "radius", value: "25"),
            .init(name: "limit", value: "20")
        ]
        guard let url = comps.url, let data = await fetchJSON(url, headers: ["apikey": key]) else { return [] }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rec = root["RECDATA"] as? [[String: Any]] else { return [] }

        return rec.compactMap { f -> Place? in
            let name = Sanitize.text(f["FacilityName"] as? String, max: 100)
            guard !name.isEmpty else { return nil }
            let lat = (f["FacilityLatitude"] as? Double) ?? Double((f["FacilityLatitude"] as? String) ?? "") ?? 0
            let lon = (f["FacilityLongitude"] as? Double) ?? Double((f["FacilityLongitude"] as? String) ?? "") ?? 0
            guard lat != 0, lon != 0 else { return nil }
            let distMiles = Self.haversineDistance(lat1: center.latitude, lon1: center.longitude, lat2: lat, lon2: lon) / 1609.34
            let category = Self.categorizeRecreation((f["FacilityTypeDescription"] as? String ?? "") + " " + name)
            // FacilityID is numeric/opaque — keep only safe URL/ID characters.
            let rawID = (f["FacilityID"] as? String) ?? (f["FacilityID"] as? Int).map(String.init) ?? UUID().uuidString
            let id = String(rawID.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" })
            let desc = Sanitize.text(f["FacilityDescription"] as? String, max: 180)
            // RIDB facilities can include a MEDIA array with real photos.
            let media = (f["MEDIA"] as? [[String: Any]])?.first { ($0["MediaType"] as? String) == "Image" }
                ?? (f["MEDIA"] as? [[String: Any]])?.first
            return Place(
                id: "rec-\(id)", name: name, category: category,
                shortDescription: desc.isEmpty ? "A federal recreation area — explore it to add it to your collection." : desc,
                distance: String(format: "%.1f mi", distMiles), distanceValue: distMiles,
                rating: nil, reviewCount: nil,   // RIDB has no ratings — never fabricate
                imagePlaceholder: category.icon, accentColor: category.tint, isFeatured: distMiles < 1.0,
                latitude: lat, longitude: lon,
                photoURL: Sanitize.url(media?["URL"] as? String)
            )
        }
    }

    /// National Park Service sites in the user's state (free key; filtered by stateCode).
    /// Docs: https://www.nps.gov/subjects/developer/api-documentation.htm
    private func fetchNPSParks(center: CLLocationCoordinate2D) async -> [Place] {
        let key = ProviderConfig.value("NpsApiKey", env: "NPS_API_KEY")
        guard !key.isEmpty, let state = await Self.reverseStateCode(center) else { return [] }
        var comps = URLComponents(string: "https://developer.nps.gov/api/v1/parks")!
        comps.queryItems = [
            .init(name: "stateCode", value: state),
            .init(name: "limit", value: "15"),
            .init(name: "api_key", value: key)
        ]
        guard let url = comps.url, let data = await fetchJSON(url) else { return [] }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let parks = root["data"] as? [[String: Any]] else { return [] }

        return parks.compactMap { p -> Place? in
            let name = Sanitize.text(p["fullName"] as? String, max: 100)
            guard !name.isEmpty else { return nil }
            let (lat, lon) = Self.parseLatLong(p["latLong"] as? String)
            guard lat != 0 else { return nil }
            let distMiles = Self.haversineDistance(lat1: center.latitude, lon1: center.longitude, lat2: lat, lon2: lon) / 1609.34
            let rawID = (p["id"] as? String) ?? UUID().uuidString
            let id = String(rawID.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" })
            let desc = Sanitize.text(p["description"] as? String, max: 180)
            // NPS returns real photography for nearly every site.
            let firstImage = (p["images"] as? [[String: Any]])?.first?["url"] as? String
            return Place(
                id: "nps-\(id)", name: name, category: .scenic,
                shortDescription: desc.isEmpty ? "A national park site — a rare find for your collection." : desc,
                distance: String(format: "%.0f mi", distMiles), distanceValue: distMiles,
                rating: nil, reviewCount: nil,   // NPS has no ratings — never fabricate
                imagePlaceholder: PlaceCategory.scenic.icon, accentColor: PlaceCategory.scenic.tint, isFeatured: false,
                latitude: lat, longitude: lon,
                photoURL: Sanitize.url(firstImage)
            )
        }
    }

    private static func categorizeRecreation(_ text: String) -> PlaceCategory {
        let t = text.lowercased()
        if t.contains("trail") { return .trails }
        if t.contains("water") || t.contains("lake") || t.contains("beach") || t.contains("marina") || t.contains("river") { return .waterfront }
        if t.contains("garden") || t.contains("botanic") { return .gardens }
        if t.contains("visitor") || t.contains("center") || t.contains("centre") { return .community }
        if t.contains("camp") || t.contains("overlook") || t.contains("scenic") { return .scenic }
        return .parks
    }

    /// Parse NPS "latLong" string: "lat:37.8651, long:-119.5383" → (37.8651, -119.5383)
    private static func parseLatLong(_ s: String?) -> (Double, Double) {
        guard let s else { return (0, 0) }
        var lat = 0.0, lon = 0.0
        for part in s.split(separator: ",") {
            let kv = part.split(separator: ":")
            guard kv.count == 2 else { continue }
            let k = kv[0].trimmingCharacters(in: .whitespaces).lowercased()
            let v = Double(kv[1].trimmingCharacters(in: .whitespaces)) ?? 0
            if k == "lat" { lat = v } else if k == "long" || k == "lon" || k == "lng" { lon = v }
        }
        return (lat, lon)
    }

    /// Reverse-geocode a coordinate to a 2-letter US state code for the NPS query.
    private static func reverseStateCode(_ c: CLLocationCoordinate2D) async -> String? {
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(
            CLLocation(latitude: c.latitude, longitude: c.longitude))
        guard let area = placemarks?.first?.administrativeArea else { return nil }
        if area.count == 2 { return area.uppercased() }
        return usStateCodes[area.lowercased()]
    }

    private static let usStateCodes: [String: String] = [
        "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
        "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
        "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
        "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
        "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
        "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
        "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
        "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
        "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
        "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY"
    ]

    // MARK: - Collectible Building

    static func buildCollectibles(from places: [Place], center: CLLocationCoordinate2D) -> [CollectiblePlace] {
        places.map { place in
            // REAL venue coordinates whenever the source provided them — this is
            // what makes map pins and the collect-proximity check truthful.
            let coordinate: CLLocationCoordinate2D
            if let real = place.coordinate {
                coordinate = real
            } else {
                // Legacy fallback (cached places from before coords were stored):
                // deterministic ring placement at the right distance.
                let distKm = place.distanceValue * 1.60934
                let latOffset = distKm / 111.0
                let lonOffset = distKm / (111.0 * cos(center.latitude * .pi / 180))
                let angle = Double(abs(place.id.hashValue) % 360) * .pi / 180.0
                coordinate = CLLocationCoordinate2D(
                    latitude: center.latitude + latOffset * cos(angle),
                    longitude: center.longitude + lonOffset * sin(angle)
                )
            }

            return CollectiblePlace(
                id: place.id,
                place: place,
                rarity: CollectiblePlace.rarityFor(place.category),
                coordinate: coordinate
            )
        }
    }

    // MARK: - Cache

    private func persistCache(center: CLLocationCoordinate2D) {
        let encodable = places.map { CachedPlace(from: $0) }
        if let data = try? JSONEncoder().encode(encodable) {
            defaults.set(data, forKey: cacheKey)
        }
        defaults.set([center.latitude, center.longitude], forKey: cacheCenterKey)
        defaults.set(Date().timeIntervalSince1970, forKey: cacheTimestampKey)
        if let osmDataDate { defaults.set(osmDataDate.timeIntervalSince1970, forKey: cacheOSMDateKey) }
        else { defaults.removeObject(forKey: cacheOSMDateKey) }
    }

    private func loadCachedPlaces() {
        guard let data = defaults.data(forKey: cacheKey),
              let cached = try? JSONDecoder().decode([CachedPlace].self, from: data),
              let centerArr = defaults.array(forKey: cacheCenterKey) as? [Double],
              centerArr.count == 2,
              isCacheValid() else { return }

        let center = CLLocationCoordinate2D(latitude: centerArr[0], longitude: centerArr[1])
        cachedCenter = center
        places = cached.map { $0.toPlace() }
        collectiblePlaces = Self.buildCollectibles(from: places, center: center)
        let osmDate = defaults.double(forKey: cacheOSMDateKey)
        osmDataDate = osmDate > 0 && places.contains { $0.id.hasPrefix("osm-") } ? Date(timeIntervalSince1970: osmDate) : nil
    }

    private func isCacheValid() -> Bool {
        let ts = defaults.double(forKey: cacheTimestampKey)
        guard ts > 0 else { return false }
        return Date().timeIntervalSince1970 - ts < cacheTTL
    }

    /// QA harness only (DEBUG + `-QAOfflineData YES`). In every other build this
    /// is a no-op and the screens render their honest empty states.
    private func useSampleFallback() {
        guard SampleData.isEnabled else { return }
        places = SampleData.places
        collectiblePlaces = SampleData.collectiblePlaces
    }

    // MARK: - Helpers

    private func distance(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let locA = CLLocation(latitude: a.latitude, longitude: a.longitude)
        let locB = CLLocation(latitude: b.latitude, longitude: b.longitude)
        return locA.distance(from: locB) // meters
    }

    private static func haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let R = 6371000.0 // Earth radius in meters
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat/2) * sin(dLat/2) +
                cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) *
                sin(dLon/2) * sin(dLon/2)
        let c = 2 * atan2(sqrt(a), sqrt(1-a))
        return R * c
    }
}

// MARK: - Cache Model

private struct CachedPlace: Codable {
    let id: String
    let name: String
    let categoryRaw: String
    let shortDescription: String
    let distance: String
    let distanceValue: Double
    let rating: Double?      // optional → caches from the fabricated-rating era still decode
    let reviewCount: Int?
    let imagePlaceholder: String
    let isFeatured: Bool
    let latitude: Double?
    let longitude: Double?
    let photoURL: String?
    let openHoursReal: String?

    init(from place: Place) {
        self.id = place.id
        self.name = place.name
        self.categoryRaw = place.category.rawValue
        self.shortDescription = place.shortDescription
        self.distance = place.distance
        self.distanceValue = place.distanceValue
        self.rating = place.rating
        self.reviewCount = place.reviewCount
        self.imagePlaceholder = place.imagePlaceholder
        self.isFeatured = place.isFeatured
        self.latitude = place.latitude
        self.longitude = place.longitude
        self.photoURL = place.photoURL
        self.openHoursReal = place.openHoursReal
    }

    func toPlace() -> Place {
        let category = PlaceCategory(rawValue: categoryRaw) ?? .parks
        return Place(
            id: id,
            name: name,
            category: category,
            shortDescription: shortDescription,
            distance: distance,
            distanceValue: distanceValue,
            rating: rating,
            reviewCount: reviewCount,
            imagePlaceholder: imagePlaceholder,
            accentColor: category.tint,
            isFeatured: isFeatured,
            latitude: latitude,
            longitude: longitude,
            photoURL: photoURL,
            openHoursReal: openHoursReal
        )
    }
}

// MARK: - Errors

enum PlacesAPIError: LocalizedError {
    case invalidURL
    case serverError
    case decodingError

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid API URL"
        case .serverError: return "Server returned an error"
        case .decodingError: return "Could not parse response"
        }
    }
}
