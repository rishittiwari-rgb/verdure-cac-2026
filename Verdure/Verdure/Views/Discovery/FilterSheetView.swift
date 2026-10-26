import SwiftUI
import CoreLocation

// MARK: - Filter sheet (shared by Events / Explore / Map / Collection)
//
// Radius, category, rarity (places), date range + free/paid (events), and sort.
// Every change writes straight into the persisted DiscoveryFilters state, so
// the choice is live behind the sheet and still there after a relaunch.

struct FilterSheetView: View {
    enum Mode { case events, places }
    let mode: Mode
    @Environment(DiscoveryFilters.self) private var filters
    @Environment(EventsAPIService.self) private var eventsService
    @Environment(LocationManager.self) private var locationManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    radiusSection
                    if mode == .events {
                        eventCategorySection
                        dateSection
                        priceSection
                        organizerDetailSection
                    } else {
                        placeCategorySection
                        parkAmenitySection
                        raritySection
                    }
                    sortSection
                    Button {
                        Haptics.soft()
                        withAnimation { mode == .events ? filters.resetEventFilters() : filters.resetPlaceFilters() }
                    } label: {
                        Text("Reset filters").font(VType.body(14, .semibold)).foregroundStyle(Palette.spruce.base)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.plain)
                }
                .padding(Spacing.md).padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Filter & sort").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.font(VType.body(15, .bold)).tint(Palette.spruce.base)
                }
            }
        }
        .presentationDetents([.large]).presentationDragIndicator(.visible)
    }

    // MARK: Sections

    private func section<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased()).font(VType.body(10, .bold)).tracking(0.8).foregroundStyle(Palette.inkSoft)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    private var radiusSection: some View {
        return section("How far will you go") {
            HStack(spacing: 8) {
                ForEach(DiscoveryFilterState.radiusChoices, id: \.self) { miles in
                    chip("\(Int(miles)) mi", selected: filters.state.radiusMiles == miles) {
                        filters.state.radiusMiles = miles
                    }
                }
            }
            Text("Applies to places and events with a known location; listings without one always show.")
                .font(VType.body(11)).foregroundStyle(Palette.inkFaint)
        }
    }

    private var eventCategorySection: some View {
        let choices = DiscoveryFilters.opportunityCategories(eventsService.events,
            origin: locationManager.browsingLocation, radiusMiles: filters.state.radiusMiles)
        return section("Category") {
            FlowChips(items: choices.map { ($0.displayName, $0.icon) },
                      isSelected: { label in
                          choices.contains { $0.displayName == label && filters.state.eventCategories.contains($0) }
                      }) { label in
                guard let cat = choices.first(where: { $0.displayName == label }) else { return }
                if filters.state.eventCategories.contains(cat) { filters.state.eventCategories.remove(cat) }
                else { filters.state.eventCategories.insert(cat) }
            }
        }
    }

    private var placeCategorySection: some View {
        return section("Category") {
            FlowChips(items: PlaceCategory.allCases.map { ($0.rawValue, $0.icon) },
                      isSelected: { filters.state.placeCategories.contains(PlaceCategory(rawValue: $0)!) }) { raw in
                let cat = PlaceCategory(rawValue: raw)!
                if filters.state.placeCategories.contains(cat) { filters.state.placeCategories.remove(cat) }
                else { filters.state.placeCategories.insert(cat) }
            }
        }
    }

    private var raritySection: some View {
        return section("Rarity") {
            HStack(spacing: 8) {
                ForEach(PlaceRarity.allCases) { r in
                    chip(r.rawValue, icon: r.icon, selected: filters.state.rarities.contains(r)) {
                        if filters.state.rarities.contains(r) { filters.state.rarities.remove(r) } else { filters.state.rarities.insert(r) }
                    }
                }
            }
        }
    }

    private var parkAmenitySection: some View {
        @Bindable var bound = filters
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Confirmed park amenities").font(VType.body(16, .semibold))
                .accessibilityAddTraits(.isHeader)
            Toggle("Playground for toddlers (ages 2–5)", isOn: $bound.state.toddlerPlayground)
            Toggle("Dog area or dogs-on-leash trail", isOn: $bound.state.dogFriendly)
            Toggle("Restrooms", isOn: $bound.state.parkRestrooms)
            Toggle("Drinking water", isOn: $bound.state.drinkingWater)
            Text("Uses published park data. Unconfirmed amenities and parks not listed open are excluded. Check the official site for current availability.")
                .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }.font(VType.body(14)).tint(Palette.spruce.base)
    }

    private var dateSection: some View {
        return section("When") {
            FlowChips(items: DateRangeOption.allCases.map { ($0.rawValue, "calendar") },
                      isSelected: { filters.state.dateRange.rawValue == $0 },
                      label: { DateRangeOption(rawValue: $0)?.label ?? $0 }) { raw in
                filters.state.dateRange = DateRangeOption(rawValue: raw) ?? .any
            }
        }
    }

    private var priceSection: some View {
        return section("Price") {
            HStack(spacing: 8) {
                ForEach(PriceOption.allCases) { p in
                    chip(p.label, selected: filters.state.price == p) { filters.state.price = p }
                }
            }
        }
    }

    private var organizerDetailSection: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            section("Setting") {
                FlowChips(items: [("indoor", "house"), ("outdoor", "tree"), ("virtual", "video")],
                          isSelected: { filters.state.eventSetting == $0 },
                          label: { $0.capitalized }) { value in
                    filters.state.eventSetting = filters.state.eventSetting == value ? nil : value
                }
            }
            section("Suitable for") {
                FlowChips(items: [("children", "figure.and.child.holdinghands"),
                                  ("teens", "person.2"), ("adults", "person")],
                          isSelected: { filters.state.eventAudience == $0 },
                          label: { $0 == "children" ? "Kids" : $0.capitalized }) { value in
                    filters.state.eventAudience = filters.state.eventAudience == value ? nil : value
                }
            }
            section("Group size") {
                chip("20 people or fewer", icon: "person.3", selected: filters.state.maxExpectedSize == 20) {
                    filters.state.maxExpectedSize = filters.state.maxExpectedSize == 20 ? nil : 20
                }
            }
            section("Accessibility") {
                FlowChips(items: [("stepFree", "figure.roll"),
                                  ("accessibleRestroom", "door.left.hand.open"),
                                  ("quietSpace", "speaker.slash")],
                          isSelected: { filters.state.requiredAccessibility == $0 },
                          label: { value in
                              switch value {
                              case "stepFree": "Step-free"
                              case "accessibleRestroom": "Accessible restroom"
                              default: "Quiet space"
                              }
                          }) { value in
                    filters.state.requiredAccessibility = filters.state.requiredAccessibility == value ? nil : value
                }
            }
            Toggle("Public venue only", isOn: Binding(
                get: { filters.state.publicVenueOnly },
                set: { filters.state.publicVenueOnly = $0 }))
                .font(VType.body(14, .medium)).tint(Palette.spruce.base)
            Text("These choices show listings with confirmed details from the organizer or source.")
                .font(VType.body(11)).foregroundStyle(Palette.inkFaint)
        }
    }

    private var sortSection: some View {
        let options = mode == .events ? SortOption.forEvents : SortOption.forPlaces
        return section("Sort by") {
            VStack(spacing: 0) {
                ForEach(Array(options.enumerated()), id: \.element) { i, opt in
                    let selected = (mode == .events ? filters.state.eventSort : filters.state.placeSort) == opt
                    Button {
                        Haptics.soft()
                        if mode == .events { filters.state.eventSort = opt } else { filters.state.placeSort = opt }
                    } label: {
                        HStack(spacing: Spacing.md) {
                            Image(systemName: opt.icon).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Palette.spruce.base).frame(width: 24)
                            Text(opt.label).font(VType.body(15, .medium)).foregroundStyle(Palette.ink)
                            Spacer()
                            if selected { Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Palette.spruce.base) }
                        }
                        .padding(.horizontal, Spacing.md).padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                    if i < options.count - 1 { ClayHairline().padding(.leading, 56) }
                }
            }
            .padding(.vertical, 4)
            .claySurface(.surface, radius: Radius.md)
        }
    }

    private func chip(_ text: String, icon: String? = nil, selected: Bool, action: @escaping () -> Void) -> some View {
        Button { Haptics.soft(); withAnimation(.spring(response: 0.3)) { action() } } label: {
            ClayChip(text: text, systemImage: icon, selected: selected, accent: Palette.spruce)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// Wrapping row of chips.
private struct FlowChips: View {
    let items: [(String, String)]
    let isSelected: (String) -> Bool
    var label: (String) -> String = { $0 }
    let onTap: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.0) { raw, icon in
                Button { Haptics.soft(); withAnimation(.spring(response: 0.3)) { onTap(raw) } } label: {
                    ClayChip(text: label(raw), systemImage: icon, selected: isSelected(raw), accent: Palette.spruce)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected(raw) ? [.isSelected] : [])
            }
        }
    }
}

// MARK: - Filter button (toolbar) with active-count badge

struct FilterButton: View {
    let mode: FilterSheetView.Mode
    @Environment(DiscoveryFilters.self) private var filters
    @State private var showing = false

    private var count: Int { mode == .events ? filters.state.activeEventFilterCount : filters.state.activePlaceFilterCount }

    var body: some View {
        Button { Haptics.tap(); showing = true } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "line.3.horizontal.decrease.circle")
                    .font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.ink)
                    .frame(width: 44, height: 44)
                    .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
                if count > 0 {
                    Text("\(count)").font(VType.num(10, .bold)).foregroundStyle(Palette.spruce.onColor)
                        .padding(4).background(Circle().fill(Palette.spruce.base)).offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(count > 0 ? "Filters, \(count) active" : "Filters")
        .sheet(isPresented: $showing) { FilterSheetView(mode: mode) }
    }
}

// MARK: - Recent searches strip

struct RecentSearchesRow: View {
    @Environment(DiscoveryFilters.self) private var filters
    let onPick: (String) -> Void

    var body: some View {
        if !filters.state.recentSearches.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.inkFaint)
                    ForEach(filters.state.recentSearches, id: \.self) { q in
                        Button { Haptics.soft(); onPick(q) } label: {
                            ClayChip(text: q, selected: false)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Search again for \(q)")
                    }
                    Button { Haptics.soft(); filters.clearRecentSearches() } label: {
                        Text("Clear").font(VType.body(12, .semibold)).foregroundStyle(Palette.inkFaint)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Spacing.md).padding(.vertical, 2)
            }
        }
    }
}
