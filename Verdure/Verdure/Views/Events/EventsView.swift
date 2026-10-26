import SwiftUI
import PhotosUI
import CoreLocation
@preconcurrency import FirebaseFunctions
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseAuth

struct EventsView: View {
    private enum FeedMode: String, CaseIterable { case forYou = "For You", everything = "Everything" }
    @State private var feedMode: FeedMode = .forYou
    @Environment(GameStateManager.self) private var gameState
    @Environment(LocationManager.self) private var locationManager
    @Environment(EventsAPIService.self) private var eventsService
    @Environment(ModerationService.self) private var moderation
    @Environment(SocialService.self) private var social
    @Environment(StoreService.self) private var store
    @Environment(DiscoveryFilters.self) private var filters
    @State private var search = SearchDebouncer()
    @State private var eligibilityClock = Date()
    @State private var selectedEvent: Event? = nil
    @State private var showCreateEvent = false
    @State private var showSaved = false
    @State private var showCalendar = false
    @State private var showInterestPicker = false
    @State private var showProfiles = false
    /// Single-select chips write into the shared, persisted filter state.
    private var selectedCategory: EventCategory? { filters.state.eventCategories.count == 1 ? filters.state.eventCategories.first : nil }
    private var searchText: String { search.debounced }
    @AppStorage("interestCategories") private var interestCategoriesRaw = ""

    private var sourceEvents: [Event] {
        // The service already holds QA fixtures under the DEBUG harness; a live
        // build with nothing nearby shows the honest empty deck instead.
        // Events from blocked organizers never render (mutual block, App Review 1.2).
        eventsService.events.filter { !moderation.isBlocked($0.creatorID) && eventsService.isEligible($0, now: eligibilityClock) }
    }
    private var visibleCategoryChoices: [EventCategory] {
        DiscoveryFilters.opportunityCategories(sourceEvents, origin: locationManager.browsingLocation, radiusMiles: filters.state.radiusMiles, now: eligibilityClock)
    }

    // MARK: Personalization ("For You")

    /// The user's chosen interests (set in onboarding, editable here).
    private var interests: Set<PlaceCategory> {
        Set(interestCategoriesRaw.split(separator: ",").compactMap { PlaceCategory(rawValue: String($0)) })
    }
    /// Event categories those interests map to (see PlaceCategory.relatedEventCategories).
    private var preferredEventCategories: Set<EventCategory> {
        Set(interests.flatMap(\.relatedEventCategories))
    }
    /// Upcoming events matching the user's interests — soonest first, not yet attended.
    private var forYouEvents: [Event] {
        if !eventsService.rankedEventIDs.isEmpty {
            let byID = Dictionary(sourceEvents.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            return Array(eventsService.rankedEventIDs.compactMap { byID[$0] }.prefix(6))
        }
        guard !preferredEventCategories.isEmpty else { return [] }
        let cutoff = Date().addingTimeInterval(-3600)
        return sourceEvents
            .filter { $0.date > cutoff && preferredEventCategories.contains($0.category) && !gameState.isCheckedIn($0.id) }
            .sorted { $0.date < $1.date }
            .prefix(6)
            .map { $0 }
    }
    /// Category, date range, free/paid, radius, search and sort — all local, all
    /// persisted. A cold-cache search never triggers a network call.
    private var filteredEvents: [Event] {
        filters.apply(to: sourceEvents, query: searchText, userLocation: locationManager.browsingLocation)
    }
    private var hasActiveSearch: Bool { !searchText.trimmingCharacters(in: .whitespaces).isEmpty }
    /// A lone category shortcut can show the wider deck when empty. Other
    /// explicit constraints must stay in force, including organizer details.
    private var categoryFallbackEligible: Bool {
        selectedCategory != nil && !hasActiveSearch && filters.state.activeEventFilterCount == 1
    }
    private var displayEvents: [Event] {
        let base = (filteredEvents.isEmpty && categoryFallbackEligible) ? sourceEvents : filteredEvents
        guard !eventsService.rankedEventIDs.isEmpty else { return base }
        let order = Dictionary(eventsService.rankedEventIDs.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: { first, _ in first })
        // Keep local cards outside the server's top 50 reachable. Ranking is
        // an order, not a hidden filter; Everything remains chronological.
        return base.sorted { left, right in
            let a = order[left.id] ?? Int.max
            let b = order[right.id] ?? Int.max
            return a == b ? left.date < right.date : a < b
        }
    }
    private var everythingFiltered: [Event] {
        var state = filters.state
        state.eventSort = .soonest
        return DiscoveryFilters.filterEvents(eventsService.everythingEvents, state: state,
                                             query: searchText, userLocation: locationManager.userLocation)
    }
    /// True when the selected category had no events and we fell back to showing all.
    private var categoryFellBack: Bool {
        categoryFallbackEligible && filteredEvents.isEmpty
    }
    private let dateFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE, MMM d"; return f
    }()

    var body: some View {
        TimelineView(.periodic(from: Date(timeIntervalSince1970: 0), by: 30)) { tick in
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    feedModePicker
                    if let notice = eventsService.coverageNotice { coverageBanner(notice) }
                    if feedMode == .forYou {
                        kineticHero.dramaticRise(index: 0)
                        if store.isPlus {
                            Button { showProfiles = true } label: {
                                Label("Your interest profiles", systemImage: "square.stack.3d.up")
                                    .font(VType.body(13, .semibold)).foregroundStyle(Palette.spruce.base)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, Spacing.md)
                            }.buttonStyle(.plain)
                        }
                        if !sourceEvents.isEmpty { forYouSection.dramaticRise(index: 1) }
                        posterDeck.dramaticRise(index: 2)
                        upcomingTimeline.dramaticRise(index: 3)
                    } else {
                        everythingSection
                    }
                }
                .padding(.top, Spacing.sm)
                .padding(.bottom, 110)
            }
            .background(VerdureBackground())
            .searchable(text: Bindable(search).text, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search events, hosts, places")
            .onSubmit(of: .search) { search.commit(into: filters) }
            .onChange(of: displayEvents.count) { _, count in
                // VoiceOver hears the result count whenever a filter or search changes it.
                AccessibilityNotification.Announcement("\(count) \(count == 1 ? "event" : "events")").post()
            }
            .refreshable {
                if feedMode == .everything {
                    await eventsService.loadEverythingPage(around: locationManager.userCoordinate, reset: true)
                } else {
                    await eventsService.refresh(around: locationManager.userCoordinate)
                    await social.loadFriendsGoing(for: displayEvents.prefix(50).map(\.id), force: true)
                }
            }
            .task {
                await eventsService.fetchNearbyEvents(around: locationManager.userCoordinate,
                                                      followedOrganizerIDs: social.followedOrganizerIDs)
                await social.loadFriendsGoing(for: displayEvents.prefix(50).map(\.id))
                if feedMode == .everything {
                    await eventsService.loadEverythingPage(around: locationManager.userCoordinate)
                }
            }
            .onChange(of: feedMode) { _, mode in
                if mode == .everything {
                    Task { await eventsService.loadEverythingPage(around: locationManager.userCoordinate) }
                }
            }
            .sheet(item: $selectedEvent) { event in
                EventDetailSheet(event: event, dateFormatter: dateFormatter)
                    .environment(gameState).environment(locationManager)
                    .presentationDetents([.large]).presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showCreateEvent) {
                CreateEventSheet().environment(eventsService)
                    .presentationDetents([.large]).presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showSaved) {
                SavedEventsView(allEvents: sourceEvents, dateFormatter: dateFormatter)
                    .environment(gameState).environment(locationManager)
            }
            .sheet(isPresented: $showCalendar) {
                EventCalendarView(allEvents: sourceEvents, dateFormatter: dateFormatter)
                    .environment(gameState).environment(locationManager)
            }
            .sheet(isPresented: $showInterestPicker) {
                InterestPickerSheet()
                    .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showProfiles) { InterestProfilesSheet() }
        }
        .onChange(of: tick.date) { _, now in eligibilityClock = now }
        }
    }

    private var feedModePicker: some View {
        Picker("Discovery mode", selection: $feedMode) {
            ForEach(FeedMode.allCases, id: \.self) { mode in Text(mode.rawValue).tag(mode) }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Spacing.md)
        .padding(.top, Spacing.sm)
        .accessibilityLabel("Choose ranked recommendations or all indexed events")
    }

    private var everythingSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Everything nearby")
                        .font(VType.display(28, .semibold)).foregroundStyle(Palette.ink)
                    Text("All indexed public events, in time order. Load more to keep browsing.")
                        .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                }
                Spacer()
                FilterButton(mode: .events)
            }
            Text("\(everythingFiltered.count) shown from \(eventsService.everythingEvents.count) loaded")
                .font(VType.body(12, .medium)).foregroundStyle(Palette.inkSoft)
            if everythingFiltered.isEmpty && !eventsService.everythingLoading {
                EmptyStateCard(icon: "calendar.badge.exclamationmark", title: "No events on this page",
                               message: eventsService.everythingHasMore
                               ? "Try loading more or widening your filters."
                               : "There are no more matching public events in this launch area.")
            }
            LazyVStack(spacing: Spacing.sm) {
                ForEach(everythingFiltered) { event in
                    Button { selectedEvent = event } label: {
                        HStack(alignment: .top, spacing: Spacing.md) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(event.whenText)
                                    .font(VType.body(11, .bold)).foregroundStyle(Palette.spruce.base)
                                Text(event.title).font(VType.display(19, .semibold)).foregroundStyle(Palette.ink)
                                Text("\(event.locationName) · \(event.sourceLabel)")
                                    .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right").foregroundStyle(Palette.spruce.base)
                        }
                        .padding(Spacing.md)
                        .claySurface(.surface, radius: Radius.md, elevation: 0.4)
                    }
                    .buttonStyle(.plain)
                }
            }
            if let error = eventsService.everythingError {
                Text(error).font(VType.body(12)).foregroundStyle(Palette.danger)
            }
            if eventsService.everythingHasMore {
                Button {
                    Task { await eventsService.loadEverythingPage(around: locationManager.userCoordinate) }
                } label: {
                    Text(eventsService.everythingLoading ? "Loading…" : "Load more events")
                        .font(VType.body(14, .semibold)).foregroundStyle(Palette.spruce.base)
                        .frame(maxWidth: .infinity).padding(Spacing.md)
                        .claySurface(.surface, radius: Radius.sm, elevation: 0.4)
                }
                .disabled(eventsService.everythingLoading)
            }
        }
        .padding(.horizontal, Spacing.md)
    }

    // MARK: - Coverage (launch areas)

    /// Events are ingested only for launch areas. Someone opening the app
    /// elsewhere gets the truth, not an empty screen with no explanation.
    private func coverageBanner(_ notice: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Image(systemName: "mappin.and.ellipse").font(.system(size: 14, weight: .bold))
                .foregroundStyle(Palette.gold.base).padding(.top, 2)
            Text(notice)
                .font(VType.scaledBody(13, .medium, relativeTo: .footnote)).foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .background(ClayBackground(style: .inset, radius: Radius.md))
        .padding(.horizontal, Spacing.md)
        .accessibilityElement(children: .combine)
    }

    // MARK: - For You (personalized recommendations)

    @ViewBuilder
    private var forYouSection: some View {
        if interests.isEmpty && eventsService.rankedEventIDs.isEmpty {
            // No interests picked yet → invite personalization.
            Button { Haptics.tap(); showInterestPicker = true } label: {
                HStack(spacing: Spacing.md) {
                    ClayIconTile(systemImage: "sparkles", kind: .gold, size: 46, radius: Radius.chip)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Get event picks for you")
                            .font(VType.display(16, .semibold)).foregroundStyle(Palette.ink)
                        Text("Tell us what you love and we'll surface matching events.")
                            .font(VType.body(12.5)).foregroundStyle(Palette.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    Image(systemName: "arrow.right").font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Palette.spruce.base)
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .claySurface(.surface, radius: Radius.lg, elevation: 1.0)
            }
            .buttonStyle(Card3DButtonStyle())
            .padding(.horizontal, Spacing.md)
            .accessibilityLabel("Get event picks for you")
            .accessibilityHint("Opens interest selection to personalize event recommendations.")
        } else if !forYouEvents.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack(spacing: 6) {
                    KickerLabel(text: "For you", color: Palette.gold.base, dot: Palette.gold.base)
                    Spacer()
                    Button { Haptics.tap(); showInterestPicker = true } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "slider.horizontal.3").font(.system(size: 11, weight: .bold))
                            Text("Tune").font(VType.body(12, .bold))
                        }
                        .foregroundStyle(Palette.spruce.base)
                        .padding(.horizontal, 11).padding(.vertical, 7)
                        .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Tune recommendations")
                    .accessibilityHint("Edit the interests used for your event picks.")
                }
                .padding(.horizontal, Spacing.md)

                Text("Picked for your plans")
                    .font(VType.body(12, .medium)).foregroundStyle(Palette.inkFaint)
                    .padding(.horizontal, Spacing.md)

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 14) {
                        ForEach(forYouEvents) { event in
                            ForYouEventCard(event: event, dateFormatter: dateFormatter)
                                .onAppear { Task { await eventsService.recordFeedEvent(for: event.id, action: "impression") } }
                                .onTapGesture {
                                    Haptics.soft(); selectedEvent = event
                                    Task { await eventsService.recordFeedEvent(for: event.id, action: "tap") }
                                }
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, 4)
                }
            }
        } else {
            // Interests are set but nothing nearby matches right now — say so
            // instead of silently vanishing (and keep the tune entry point).
            Button { Haptics.tap(); showInterestPicker = true } label: {
                HStack(spacing: Spacing.md) {
                    ClayIconTile(systemImage: "sparkles", kind: .gold, size: 40, radius: Radius.chip)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("No picks for your interests yet")
                            .font(VType.display(14, .semibold)).foregroundStyle(Palette.ink)
                        Text("We'll surface matches as new events appear — or tune your interests.")
                            .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    Image(systemName: "slider.horizontal.3").font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Palette.spruce.base)
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(ClayBackground(style: .inset, radius: Radius.md))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, Spacing.md)
            .accessibilityLabel("No event picks for your interests yet")
            .accessibilityHint("Opens interest selection.")
        }
    }

    // MARK: - Kinetic hero (giant count-up + marquee)

    private var kineticHero: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    KickerLabel(text: "Happening near you", dot: Palette.gold.base)
                    Text("Events").font(VType.display(40, .bold)).foregroundStyle(Palette.ink)
                }
                Spacer()
                HStack(spacing: 10) {
                    // Calendar view
                    Button { Haptics.tap(); showCalendar = true } label: {
                        Image(systemName: "calendar").font(.system(size: 17, weight: .bold))
                            .foregroundStyle(Palette.teal.base)
                            .frame(width: 48, height: 48)
                            .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.6))
                    }
                    .buttonStyle(.plain)

                    // Saved / bookmarked events
                    Button { Haptics.tap(); showSaved = true } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bookmark.fill").font(.system(size: 17, weight: .bold))
                                .foregroundStyle(Palette.gold.base)
                                .frame(width: 48, height: 48)
                                .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.6))
                            if !gameState.savedEventIDs.isEmpty {
                                Text("\(gameState.savedEventIDs.count)")
                                    .font(VType.num(10, .bold)).foregroundStyle(Palette.gold.onColor)
                                    .padding(4).background(Circle().fill(Palette.gold.base))
                                    .offset(x: 5, y: -5)
                            }
                        }
                    }
                    .buttonStyle(.plain)

                    // Only organizers can publish events — status comes from the
                    // server (pending organizers publish to their followers only).
                    if social.organizer?.canPublish == true {
                        Button { Haptics.tap(); showCreateEvent = true } label: {
                            Image(systemName: "plus").font(.system(size: 19, weight: .bold))
                                .foregroundStyle(Palette.spruce.onColor)
                                .frame(width: 48, height: 48)
                                .background(ClayBackground(style: .accent(.spruce), radius: Radius.chip, elevation: 0.6))
                        }
                        .buttonStyle(.plain)
                        .breathing(scale: 1.06, duration: 2.2)
                    }
                }
            }

            // Recent searches (local only) + filter/sort entry + live result count.
            RecentSearchesRow { q in search.text = q; search.commit(into: filters) }
                .padding(.horizontal, -Spacing.md)
            HStack(spacing: 10) {
                Text("\(displayEvents.count) \(displayEvents.count == 1 ? "event" : "events")\(filters.state.eventSort == .soonest ? "" : " · \(filters.state.eventSort.label.lowercased())")")
                    .font(VType.body(12, .semibold)).foregroundStyle(Palette.inkSoft)
                    .accessibilityHidden(true)   // announced on change instead
                Spacer()
                FilterButton(mode: .events)
            }

            // Tappable category filter row (single-select shortcut into the same filter state)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    CategoryPill(label: "All", icon: "square.grid.2x2.fill",
                                 tint: Palette.spruce.base, isSelected: filters.state.eventCategories.isEmpty) {
                        withAnimation(.spring(response: 0.35)) { filters.state.eventCategories = [] }
                    }
                    ForEach(visibleCategoryChoices) { cat in
                        CategoryPill(label: cat.displayName, icon: cat.icon, tint: cat.accent.base,
                                     isSelected: selectedCategory == cat) {
                            withAnimation(.spring(response: 0.35)) { filters.state.eventCategories = [cat] }
                        }
                        .accessibilityIdentifier("event-category:\(cat.rawValue)")
                    }
                }
                .padding(.vertical, 2)
            }
            .accessibilityIdentifier("eventCategories")
        }
        .padding(.horizontal, Spacing.md)
    }

    // MARK: - Poster deck (horizontal paging, scroll-driven tilt)

    private var posterDeck: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: 6) {
                KickerLabel(text: "Events near you", color: Palette.spruce.base)
                Spacer()
                Image(systemName: "bookmark").font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Palette.inkFaint)
                Text("tap to save").font(VType.body(11, .medium)).foregroundStyle(Palette.inkFaint)
            }
            .padding(.horizontal, Spacing.md)

            if categoryFellBack {
                Text("No \(selectedCategory?.rawValue ?? "") events right now — showing all.")
                    .font(VType.body(12, .medium)).foregroundStyle(Palette.inkSoft)
                    .padding(.horizontal, Spacing.md)
            }

            if eventsService.isLoading && sourceEvents.isEmpty {
                loadingRow
            } else if displayEvents.isEmpty {
                emptyDeck
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    // Lazy: the deck shows one poster at a time but can hold hundreds of events.
                    LazyHStack(spacing: 16) {
                        ForEach(displayEvents) { event in
                            EventPoster(event: event, isCheckedIn: gameState.isCheckedIn(event.id))
                                .containerRelativeFrame(.horizontal, count: 1, span: 1, spacing: 16)
                                .scrollTransition(.interactive) { content, phase in
                                    content
                                        .scaleEffect(phase.isIdentity ? 1 : 0.86)
                                        .rotation3DEffect(.degrees(phase.value * 10),
                                                          axis: (x: 0, y: 1, z: 0), perspective: 0.6)
                                        .opacity(phase.isIdentity ? 1 : 0.55)
                                }
                                .onTapGesture { Haptics.soft(); selectedEvent = event }
                                .contentShape(Rectangle())
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel("\(event.title), \(event.category.displayName), \(dateFormatter.string(from: event.date))")
                                .accessibilityHint("Opens event details.")
                                .accessibilityAddTraits(.isButton)
                                .accessibilityIdentifier("event-poster")
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal, Spacing.md)
                }
                .scrollTargetBehavior(.viewAligned)
                .frame(height: 430)
            }
        }
    }

    private var loadingRow: some View {
        HStack {
            Spacer()
            ProgressView().tint(Palette.teal.base)
            Text("Finding community events…").font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
            Spacer()
        }
        .frame(height: 430)
    }

    /// Honest empty state. Distinguishes "nothing loaded" (a real-data gap — we
    /// never paper over it with fixtures) from "your filter matched nothing".
    private var emptyDeck: some View {
        VStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: "calendar.badge.exclamationmark", kind: .gold, size: 60, radius: Radius.md)
            Text(sourceEvents.isEmpty ? "No events loaded yet" : "No events match")
                .font(VType.scaledDisplay(18, .semibold, relativeTo: .headline))
                .foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text(sourceEvents.isEmpty
                 ? (eventsService.lastError ?? "We only show real events from real sources. Pull to refresh, or check back soon — new events are ingested every hour.")
                 : (searchText.isEmpty ? "Try changing a filter or widening your distance." : "Try a different search or filter."))
                .font(VType.scaledBody(13, relativeTo: .footnote))
                .foregroundStyle(Palette.inkSoft).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity).frame(minHeight: 300)
        .padding(.horizontal, Spacing.lg)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Upcoming timeline (glowing vertical line)

    @ViewBuilder
    private var upcomingTimeline: some View {
        if !displayEvents.isEmpty {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ClaySectionHeader(index: "↓", kicker: "On the calendar", title: "Upcoming",
                              accent: Palette.gold.base)
                .padding(.horizontal, Spacing.md)
            VStack(spacing: 0) {
                ForEach(Array(displayEvents.prefix(5).enumerated()), id: \.element.id) { i, event in
                    TimelineRow(event: event, isCheckedIn: gameState.isCheckedIn(event.id),
                                isLast: i == min(5, displayEvents.count) - 1)
                        .onTapGesture { Haptics.soft(); selectedEvent = event }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(event.title), \(dateFormatter.string(from: event.date)) at \(event.locationName)")
                        .accessibilityHint("Opens event details.")
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("event-row-\(i)")
                }
            }
            .padding(.horizontal, Spacing.md)
        }
        }
    }
}

// MARK: - Event poster (full-bleed accent, oversized date)

private struct EventPoster: View {
    let event: Event
    let isCheckedIn: Bool
    @Environment(GameStateManager.self) private var gameState
    @Environment(EventsAPIService.self) private var eventsService
    private var kind: ClayStyle.ClayAccentKind { event.category.clayKind }
    private var on: Color { kind.accent.onColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: -6) {
                    Text(month).font(VType.display(18, .bold)).foregroundStyle(on.opacity(0.85))
                    Text(day).font(VType.num(72, .bold)).foregroundStyle(on)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 8) {
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) { gameState.toggleSaved(event) }
                        if gameState.isSaved(event.id) {
                            Task { await eventsService.recordFeedEvent(for: event.id, action: "save") }
                        }
                    } label: {
                        Image(systemName: gameState.isSaved(event.id) ? "bookmark.fill" : "bookmark")
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(on)
                            .symbolEffect(.bounce, value: gameState.isSaved(event.id))
                            .frame(width: 34, height: 34)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                    HStack(spacing: 5) {
                        Image(systemName: event.category.icon).font(.system(size: 11, weight: .bold))
                        Text(event.category.displayName.uppercased()).font(VType.body(10, .bold)).tracking(0.6)
                    }
                    .foregroundStyle(on)
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Radius.chip))
                    if isCheckedIn {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.seal.fill").font(.system(size: 10, weight: .bold))
                            Text("ATTENDED").font(VType.body(9, .bold)).tracking(0.4)
                        }
                        .foregroundStyle(on)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Radius.chip))
                    }
                }
            }

            Spacer()

            Text(event.title)
                .font(VType.display(30, .bold)).foregroundStyle(on)
                .lineLimit(2).minimumScaleFactor(0.7)
                .shadow(color: kind.accent.depth.opacity(0.4), radius: 4, x: 0, y: 2)
            Text(event.organizer).font(VType.body(14, .medium)).foregroundStyle(on.opacity(0.85))
                .padding(.top, 4)

            HStack(spacing: 12) {
                Label(event.displayTime, systemImage: "clock.fill")
                Label(event.locationName, systemImage: "mappin")
            }
            .font(VType.body(12, .semibold)).foregroundStyle(on.opacity(0.85)).lineLimit(1).padding(.top, 10)

            if event.isProgram {
                Label("Apply by \(event.date.formatted(date: .abbreviated, time: .omitted))", systemImage: "calendar")
                    .font(VType.body(14, .semibold)).foregroundStyle(on)
            } else {
            HStack(spacing: 10) {
                HStack(spacing: -9) {
                    ForEach(0..<min(4, max(1, event.attendeeCount)), id: \.self) { _ in
                        Circle().fill(on.opacity(0.25))
                            .frame(width: 26, height: 26)
                            .overlay(Image(systemName: "person.fill").font(.system(size: 11)).foregroundStyle(on.opacity(0.8)))
                            .overlay(Circle().strokeBorder(on.opacity(0.4), lineWidth: 1.5))
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.maxAttendees.map { "\(event.attendeeCount)/\($0)" } ?? "\(event.attendeeCount) going")
                        .font(VType.body(12, .semibold)).foregroundStyle(on.opacity(0.85))
                    FriendsGoingStack(eventId: event.id, compact: true)
                }
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "leaf.circle.fill").font(.system(size: 13, weight: .bold))
                    Text("+\(event.pointValue)").font(VType.num(16, .bold))
                }
                .foregroundStyle(on)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Radius.chip))
            }
            .padding(.top, 16)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            ZStack {
                kind.accent.faceGradient
                Image(systemName: event.imagePlaceholder)
                    .font(.system(size: 230, weight: .bold))
                    .foregroundStyle(on.opacity(0.10))
                    .rotationEffect(.degrees(-12)).offset(x: 90, y: 60)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
            .strokeBorder(.white.opacity(0.18), lineWidth: 1))
        .shadow(color: kind.accent.depth.opacity(0.5), radius: 26, x: 8, y: 16)
        .parallaxTilt(magnitude: 6, shadow: false)
    }

    private var day: String { let f = DateFormatter(); f.dateFormat = "d"; return f.string(from: event.date) }
    private var month: String { let f = DateFormatter(); f.dateFormat = "MMM"; return f.string(from: event.date).uppercased() }
}

// MARK: - Timeline row (glowing connector line)

private struct TimelineRow: View {
    let event: Event
    let isCheckedIn: Bool
    let isLast: Bool
    private var kind: ClayStyle.ClayAccentKind { event.category.clayKind }

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(spacing: 0) {
                ZStack {
                    Circle().fill(kind.accent.faceGradient).frame(width: 16, height: 16)
                        .shadow(color: kind.accent.base.opacity(0.6), radius: 5)
                    if isCheckedIn {
                        Image(systemName: "checkmark").font(.system(size: 8, weight: .black))
                            .foregroundStyle(kind.accent.onColor)
                    }
                }
                if !isLast {
                    Rectangle()
                        .fill(LinearGradient(colors: [kind.accent.base.opacity(0.5), Palette.hairline],
                                             startPoint: .top, endPoint: .bottom))
                        .frame(width: 2.5)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: 16)

            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                HStack(spacing: 8) {
                    Text(dateStr).font(VType.num(11, .bold)).foregroundStyle(kind.accent.base)
                    Text(event.locationName).font(VType.body(11, .medium)).foregroundStyle(Palette.inkFaint).lineLimit(1)
                }
                FriendsGoingStack(eventId: event.id, compact: true)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.inkFaint)
                .padding(.top, 2)
        }
        .padding(.bottom, isLast ? 0 : Spacing.md)
        .contentShape(Rectangle())
    }
    private var dateStr: String { let f = DateFormatter(); f.dateFormat = "EEE, MMM d"; return f.string(from: event.date) }
}

// MARK: - Create event sheet

private struct CreateEventSheet: View {
    private struct AccessOption: Identifiable {
        let id: String
        let title: String
    }
    private let accessOptions = [
        AccessOption(id: "stepFree", title: "Step-free access"),
        AccessOption(id: "accessibleRestroom", title: "Accessible restroom"),
        AccessOption(id: "seating", title: "Seating"),
        AccessOption(id: "quietSpace", title: "Quiet space"),
        AccessOption(id: "asl", title: "ASL"),
        AccessOption(id: "captions", title: "Captions"),
    ]
    @Environment(EventsAPIService.self) private var eventsService
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var locationName = ""
    @State private var website = ""
    @State private var isFree = true
    @Environment(SocialService.self) private var social
    @Environment(LocationManager.self) private var locationManager
    @State private var date = Date()
    @State private var startTime = Date()
    @State private var endTime = Calendar.current.date(byAdding: .hour, value: 2, to: Date())!
    @State private var category: EventCategory = .meetup
    @State private var maxAttendees = ""
    @State private var expectedSize = ""
    @State private var indoorOutdoor = "unknown"
    @State private var ageSuitability = "unknown"
    @State private var minimumAge = ""
    @State private var maximumAge = ""
    @State private var accessibilityFeatures: Set<String> = []
    @State private var publicVenue = false
    @State private var recurring = false
    @State private var virtual = false
    @State private var hasDeadline = false
    @State private var applicationDeadline = Date()
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var isValid: Bool {
        title.trimmingCharacters(in: .whitespaces).count >= 3 &&
        !locationName.trimmingCharacters(in: .whitespaces).isEmpty &&
        social.organizer?.canPublish == true
    }
    private var timeString: String {
        let f = DateFormatter(); f.dateFormat = "h:mm a"
        return "\(f.string(from: startTime)) – \(f.string(from: endTime))"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    categoryPicker
                    labeled("EVENT TITLE") { ClayField(placeholder: "e.g. Spring Hackathon", text: $title) }
                    labeled("DESCRIPTION") {
                        TextEditor(text: $description)
                            .font(VType.body(15)).foregroundStyle(Palette.ink).scrollContentBackground(.hidden)
                            .frame(minHeight: 90).padding(10)
                            .background(ClayBackground(style: .inset, radius: Radius.sm))
                    }
                    if let org = social.organizer {
                        HStack(spacing: 8) {
                            Image(systemName: org.isApproved ? "checkmark.seal.fill" : "clock.badge.checkmark.fill")
                                .foregroundStyle(org.isApproved ? Palette.spruce.base : Palette.gold.base)
                            Text(org.isApproved
                                 ? "Publishing as \(org.displayName) — public to everyone nearby."
                                 : "Publishing as \(org.displayName) — until you're approved, only your followers see it.")
                                .font(VType.body(12, .medium)).foregroundStyle(Palette.inkSoft)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
                        .background(ClayBackground(style: .inset, radius: Radius.sm))
                        .accessibilityElement(children: .combine)
                    }
                    labeled("LOCATION") { ClayField(placeholder: "e.g. Downtown Library, 325 Superior Ave", text: $locationName) }
                    labeled("WEBSITE (OPTIONAL)") { ClayField(placeholder: "https://…", text: $website, keyboard: .URL, autocap: false) }
                    Toggle(isOn: $isFree) {
                        Text("Free to attend").font(VType.body(14, .medium)).foregroundStyle(Palette.ink)
                    }
                    .tint(Palette.spruce.base)
                    .padding(.horizontal, 4)
                    dateTimeSection
                    labeled("MAX ATTENDEES (OPTIONAL)") {
                        ClayField(placeholder: "Leave empty for unlimited", text: $maxAttendees, keyboard: .numberPad)
                    }
                    eventDetailsFields
                    pointsInfo
                    if let error = errorMessage {
                        Text(error).font(VType.body(12, .medium)).foregroundStyle(Palette.danger)
                    }
                    ClayButton(isSubmitting ? "Creating…" : "Create Event", systemImage: "plus.circle.fill",
                               kind: .spruce, fullWidth: true) { Task { await submit() } }
                        .disabled(!isValid || isSubmitting).opacity(isValid ? 1 : 0.5)
                }
                .padding(Spacing.md)
            }
            .background(VerdureBackground())
            .navigationTitle("New Event").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Palette.inkSoft)
                }
            }
        }
    }

    private var eventDetailsFields: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Good to know before going")
                .font(VType.display(21, .semibold)).foregroundStyle(Palette.ink)
            labeled("EXPECTED GROUP SIZE (OPTIONAL)") {
                ClayField(placeholder: "About how many people?", text: $expectedSize, keyboard: .numberPad)
            }
            Picker("Setting", selection: $indoorOutdoor) {
                Text("Not sure").tag("unknown")
                Text("Indoors").tag("indoor")
                Text("Outdoors").tag("outdoor")
                Text("Both").tag("mixed")
            }.pickerStyle(.menu)
            Picker("Age suitability", selection: $ageSuitability) {
                Text("Not specified").tag("unknown")
                Text("All ages").tag("all")
                Text("Children").tag("children")
                Text("Teens").tag("teens")
                Text("Adults").tag("adults")
            }.pickerStyle(.menu)
            HStack(spacing: Spacing.sm) {
                ClayField(placeholder: "Min age", text: $minimumAge, keyboard: .numberPad)
                ClayField(placeholder: "Max age", text: $maximumAge, keyboard: .numberPad)
            }
            Toggle("At a public venue", isOn: $publicVenue)
            Toggle("Virtual option", isOn: $virtual)
            Toggle("Recurring event", isOn: $recurring)
            Text("Accessibility available")
                .font(VType.body(13, .semibold)).foregroundStyle(Palette.ink)
            ForEach(accessOptions) { option in
                Toggle(option.title, isOn: Binding(
                    get: { accessibilityFeatures.contains(option.id) },
                    set: { on in if on { accessibilityFeatures.insert(option.id) } else { accessibilityFeatures.remove(option.id) } }
                ))
            }
            if category == .volunteer || category == .workshop {
                Toggle("Applications close before the event", isOn: $hasDeadline)
                if hasDeadline {
                    DatePicker("Application deadline", selection: $applicationDeadline,
                               in: ...startDate, displayedComponents: [.date, .hourAndMinute])
                }
            }
        }
        .font(VType.body(14))
        .tint(Palette.spruce.base)
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.35)
    }

    private func labeled<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(VType.body(10, .bold)).tracking(0.8).foregroundStyle(Palette.inkSoft)
            content()
        }
    }

    private var categoryPicker: some View {
        labeled("CATEGORY") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 9) {
                    ForEach(EventCategory.allCases.filter { $0 != .program }) { cat in
                        CategoryPill(label: cat.displayName, icon: cat.icon, tint: cat.accent.base,
                                     isSelected: category == cat) { category = cat }
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var dateTimeSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            labeled("DATE") {
                DatePicker("", selection: $date, in: Date()..., displayedComponents: .date)
                    .labelsHidden().tint(Palette.spruce.base)
            }
            HStack(spacing: Spacing.lg) {
                labeled("START") {
                    DatePicker("", selection: $startTime, displayedComponents: .hourAndMinute)
                        .labelsHidden().tint(Palette.spruce.base)
                }
                labeled("END") {
                    DatePicker("", selection: $endTime, displayedComponents: .hourAndMinute)
                        .labelsHidden().tint(Palette.spruce.base)
                }
                Spacer()
            }
        }
    }

    private var pointsInfo: some View {
        HStack(spacing: 8) {
            Image(systemName: "leaf.circle.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(Palette.gold.base)
            Text("Attendees earn +\(category.defaultPoints) pts for checking in")
                .font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
        }
        .padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
        .background(ClayBackground(style: .inset, radius: Radius.sm))
    }

    /// Combine the picked day with the picked start clock.
    private var startDate: Date {
        let cal = Calendar.current
        let day = cal.dateComponents([.year, .month, .day], from: date)
        let clock = cal.dateComponents([.hour, .minute], from: startTime)
        var c = DateComponents(); c.year = day.year; c.month = day.month; c.day = day.day
        c.hour = clock.hour; c.minute = clock.minute
        return cal.date(from: c) ?? date
    }

    private func submit() async {
        isSubmitting = true; errorMessage = nil
        // Best-effort venue geocode so the server can gate check-ins by proximity.
        let coord = await EventsAPIService.geocode(locationName)
        let result = await social.createEvent(
            title: title, description: description, locationName: locationName, time: timeString,
            start: startDate, category: category, maxAttendees: Int(maxAttendees), isFree: isFree,
            latitude: coord?.latitude, longitude: coord?.longitude, website: website,
            expectedSize: Int(expectedSize), indoorOutdoor: indoorOutdoor, ageSuitability: ageSuitability,
            accessibilityFeatures: Array(accessibilityFeatures), publicVenue: publicVenue,
            minimumAge: Int(minimumAge), maximumAge: Int(maximumAge),
            applicationDeadline: hasDeadline ? applicationDeadline : nil,
            recurring: recurring, virtual: virtual,
            opportunitySubtype: category == .volunteer ? "volunteer" : category == .workshop ? "workshop" : nil)
        isSubmitting = false
        if let result {
            Haptics.success()
            AccessibilityNotification.Announcement(result.broadcast ? "Event published." : "Event published to your followers.").post()
            // Pull the store so the new event appears at once.
            await eventsService.refresh(around: locationManager.userCoordinate)
            dismiss()
        } else {
            errorMessage = social.lastError ?? "Couldn't publish the event."
        }
    }
}

// MARK: - Event detail sheet

// Internal (was private) so a notification deep link can present the same
// detail view the list does. A second, parallel detail screen for deep links
// would drift from this one — different check-in gating, different copy.
struct EventDetailSheet: View {
    let event: Event
    let dateFormatter: DateFormatter
    @Environment(EventsAPIService.self) private var eventsService
    @Environment(GameStateManager.self) private var gameState
    @Environment(LocationManager.self) private var locationManager
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var showSeriesDates = false
    @State private var showPhotoPicker = false
    @State private var selectedPhotoItem: PhotosPickerItem? = nil
    @State private var proofPhotoData: Data? = nil
    @State private var showCelebration = false
    @State private var earnedPoints = 0
    @State private var isCheckingIn = false
    @State private var checkInError: String?
    private let network = NetworkStatus.shared
    /// Venue coordinate: from the event when its source provided one, else a
    /// best-effort geocode of the location name (nil → proximity can't be verified).
    @State private var venueCoordinate: CLLocationCoordinate2D? = nil
    @State private var geocodeFinished = false
    @State private var feedbackChoice: String? = nil
    @State private var householdYoungestAge: Int?
    @State private var householdAccessibilityNeeds: [String] = []

    private var householdWarning: String? {
        guard let age = householdYoungestAge, age < 13 else { return nil }
        if event.ageSuitability == "adults" || (event.minimumAge ?? 0) > age {
            return "This listing may not suit a child age \(age). Check the organizer's age rules."
        }
        if let end = event.endDate, Calendar.current.component(.hour, from: end) >= 21 {
            return "This event ends late for a household with a young child."
        }
        return nil
    }

    private var accessibilityWarning: String? {
        let unconfirmed = householdAccessibilityNeeds.filter { !event.accessibilityFeatures.contains($0) }
        guard !unconfirmed.isEmpty else { return nil }
        return "This listing has not confirmed every accessibility feature you selected. Check with the organizer before you go."
    }

    private var isCheckedIn: Bool { gameState.isCheckedIn(event.id) }
    private var kind: ClayStyle.ClayAccentKind { event.category.clayKind }

    // MARK: GPS proximity gate (500 ft, same radius as place collection)

    /// nil while we genuinely can't judge (no GPS fix yet, or venue unknown).
    private var isWithinRange: Bool? {
        guard locationManager.userLocation != nil else { return nil }
        guard let venueCoordinate else { return nil }
        return locationManager.isNearby(venueCoordinate)
    }

    private var distanceLabel: String {
        guard let venueCoordinate else { return "—" }
        return locationManager.formattedDistance(to: venueCoordinate)
    }

    /// Open Apple Maps in turn-by-turn directions mode, routing from the user's
    /// current location to the event address (daddr = destination, not a search).
    private func openDirections() {
        Haptics.tap()
        let dest = event.locationName
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        if let url = URL(string: "http://maps.apple.com/?daddr=\(dest)&dirflg=d") { openURL(url) }
    }

    /// Open the event's website if it has one, else a web search for more info.
    private func openMoreInfo() {
        Haptics.tap()
        if let site = event.website, let url = URL(string: site.hasPrefix("http") ? site : "https://\(site)") {
            openURL(url); return
        }
        let q = "\(event.title) \(event.organizer) \(event.locationName)"
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        if let url = URL(string: "https://www.google.com/search?q=\(q)") { openURL(url) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                VerdureBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        hero
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            Text(event.title).font(VType.display(24, .semibold)).foregroundStyle(Palette.ink)
                            Text("Organized by \(event.organizer)").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                            if let householdWarning {
                                Label(householdWarning, systemImage: "exclamationmark.triangle")
                                    .font(VType.body(12)).foregroundStyle(Palette.terracotta.base)
                                    .padding(Spacing.sm)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .claySurface(.surface, radius: Radius.sm)
                            }
                            if let accessibilityWarning {
                                Label(accessibilityWarning, systemImage: "accessibility")
                                    .font(VType.body(12)).foregroundStyle(Palette.terracotta.base)
                                    .padding(Spacing.sm)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .claySurface(.surface, radius: Radius.sm)
                            }
                            if let desc = event.description, !desc.isEmpty {
                                Text(desc).font(VType.body(14)).foregroundStyle(Palette.ink).lineSpacing(3)
                                    .padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
                                    .claySurface(.surface, radius: Radius.md)
                            }
                            detailGrid
                            practicalDetails
                            whySection
                            seriesSection
                            feedbackControls
                            if event.isProgram {
                                Text("Read the official listing and apply on the organization’s site.")
                                    .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                                ClayButton("Read official listing", systemImage: "arrow.up.right.square", kind: .spruce, fullWidth: true) { openMoreInfo() }
                                    .accessibilityIdentifier("programOfficialListing")
                            } else {
                                goingSection
                                checkInSection
                                ClayButton("Get Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill",
                                           kind: .teal, fullWidth: true) { openDirections() }
                            }
                            if !event.isProgram {
                                ClayButton(event.website != nil ? "Visit Website" : "More Info",
                                           systemImage: "safari.fill", kind: .ghost, fullWidth: true) { openMoreInfo() }
                            }
                        }
                        .padding(.horizontal, Spacing.md)
                    }
                    .padding(.bottom, Spacing.xl)
                }
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        HStack(spacing: 0) {
                            Button {
                                withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) {
                                    gameState.toggleSaved(event)
                                }
                                if gameState.isSaved(event.id) {
                                    Task { await eventsService.recordFeedEvent(for: event.id, action: "save") }
                                }
                            } label: {
                                Image(systemName: gameState.isSaved(event.id) ? "bookmark.fill" : "bookmark")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(gameState.isSaved(event.id) ? Palette.gold.base : Palette.inkSoft)
                                    .symbolEffect(.bounce, value: gameState.isSaved(event.id))
                            }
                            .accessibilityLabel(gameState.isSaved(event.id) ? "Saved" : "Save event")
                            // Report this event / block its organizer (App Review 1.2).
                            ContentActionsMenu(target: .event, targetID: event.id, targetLabel: "this event",
                                               author: event.creatorID.map { (uid: $0, name: event.organizer) })
                        }
                    }
                }

                if showCelebration { checkInCelebration.transition(.opacity) }
            }
            .task {
                // Resolve the venue coordinate once: prefer source-provided coords,
                // else geocode the venue string so the proximity gate has teeth.
                if let coord = event.coordinate {
                    venueCoordinate = coord
                } else if !event.isProgram {
                    venueCoordinate = await EventsAPIService.geocode(event.locationName)
                }
                geocodeFinished = true
                locationManager.startUpdating()
                await eventsService.recordFeedback(for: event.id, kind: "view")
                await eventsService.recordFeedEvent(for: event.id, action: "tap")
                if let uid = Auth.auth().currentUser?.uid,
                   let snapshot = try? await Firestore.firestore().collection("users").document(uid).getDocument() {
                    householdYoungestAge = (snapshot.data()?["householdChildAges"] as? [Int])?.min()
                        ?? snapshot.data()?["householdYoungestAge"] as? Int
                    householdAccessibilityNeeds = snapshot.data()?["householdAccessibilityNeeds"] as? [String] ?? []
                }
            }
        }
    }

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 0)
                .fill(kind.accent.faceGradient)
                .frame(height: 170)
                .overlay {
                    Image(systemName: event.imagePlaceholder).font(.system(size: 90, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.16)).rotationEffect(.degrees(-8)).offset(x: 90)
                }
                .clipped()
            HStack {
                Text(event.category.displayName).font(VType.body(11, .bold))
                    .foregroundStyle(kind.accent.onColor)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Radius.chip))
                Spacer()
                if !event.isProgram {
                HStack(spacing: 4) {
                    Image(systemName: "leaf.circle.fill").font(.system(size: 11, weight: .bold))
                    Text("+\(event.pointValue) pts").font(VType.num(12, .bold))
                }
                .foregroundStyle(kind.accent.onColor)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Radius.chip))
                }
            }
            .padding(12)
        }
    }

    /// "More" / "Show less" are learning signals (`recordEventFeedback` kinds
    /// "more" and "less"); "Hide this event" (kind "hide") removes the card now
    /// and the server never ranks it for this user again.
    private var feedbackControls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                ForEach(0..<2, id: \.self) { index in
                    let kind = index == 0 ? "more" : "less"
                    let title = index == 0 ? "More like this" : "Show less like this"
                    let icon = index == 0 ? "hand.thumbsup" : "hand.thumbsdown"
                    Button {
                        feedbackChoice = kind
                        Task { await eventsService.recordFeedback(for: event.id, kind: kind) }
                    } label: {
                        Label(title, systemImage: feedbackChoice == kind ? "\(icon).fill" : icon)
                            .font(VType.body(12, .semibold))
                            .foregroundStyle(feedbackChoice == kind ? Palette.spruce.base : Palette.inkSoft)
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(ClayBackground(style: .surface, radius: Radius.sm, elevation: 0.35))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(index == 0 ? "feedbackMore" : "feedbackLess")
                    .accessibilityHint(index == 0 ? "Recommends more events like this one." : "Recommends fewer events like this one.")
                }
            }
            Button {
                Haptics.tap()
                feedbackChoice = "hide"
                Task { await eventsService.hideEvent(event.id) }
                dismiss()
            } label: {
                Label("Hide this event", systemImage: "eye.slash")
                    .font(VType.body(12, .semibold))
                    .foregroundStyle(Palette.terracotta.base)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(ClayBackground(style: .surface, radius: Radius.sm, elevation: 0.35))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("hideEvent")
            .accessibilityHint("Removes this event from your feed. It will not be shown to you again.")
        }
    }

    // MARK: Why you're seeing this (W5)

    /// Every line is a server reason, verbatim; nothing is added on the client.
    @ViewBuilder
    private var whySection: some View {
        if !event.feedReasons.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Why you're seeing this").font(VType.display(18, .semibold)).foregroundStyle(Palette.ink)
                ForEach(Array(event.feedReasons.enumerated()), id: \.offset) { _, reason in
                    Label(reason, systemImage: "sparkles")
                        .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .claySurface(.surface, radius: Radius.md, elevation: 0.35)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("whySeeingThis")
        }
    }

    /// A collapsed series: the card is shown once; this opens the other dates.
    @ViewBuilder
    private var seriesSection: some View {
        if let seriesLabel = event.seriesLabel {
            Button { Haptics.tap(); showSeriesDates = true } label: {
                HStack(spacing: 8) {
                    Label(seriesLabel, systemImage: "repeat")
                        .font(VType.body(13, .semibold)).foregroundStyle(Palette.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Palette.inkFaint)
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(ClayBackground(style: .surface, radius: Radius.md, elevation: 0.35))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("seriesMoreDates")
            .accessibilityHint("Shows the other dates in this series.")
            .sheet(isPresented: $showSeriesDates) { SeriesDatesSheet(event: event) }
        }
    }

    @ViewBuilder
    private var practicalDetails: some View {
        let details: [String] = [
            event.expectedSize.map { "Around \($0) people expected" },
            event.indoorOutdoor.flatMap { $0 == "unknown" ? nil : $0.capitalized },
            event.ageSuitability.flatMap { $0 == "unknown" ? nil : "Suitable for \($0 == "all" ? "all ages" : $0)" },
            event.minimumAge.map { "Minimum age \($0)" },
            event.maximumAge.map { "Maximum age \($0)" },
            event.publicVenue == true ? "Public venue" : nil,
            event.recurring == true ? "Recurring" : nil,
            event.virtual == true ? "Virtual option" : nil,
            event.applicationDeadline.map { "Apply by \($0.formatted(date: .abbreviated, time: .shortened))" },
        ].compactMap { $0 }
        if !details.isEmpty || !event.accessibilityFeatures.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Before you go").font(VType.display(18, .semibold)).foregroundStyle(Palette.ink)
                ForEach(details, id: \.self) { detail in
                    Label(detail, systemImage: "checkmark.circle")
                        .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                }
                if !event.accessibilityFeatures.isEmpty {
                    Text("Accessibility: \(event.accessibilityFeatures.map { $0 == "stepFree" ? "step-free" : $0 == "accessibleRestroom" ? "accessible restroom" : $0 == "quietSpace" ? "quiet space" : $0 }.joined(separator: ", "))")
                        .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .claySurface(.surface, radius: Radius.md, elevation: 0.35)
        }
    }

    // MARK: Going / friends / invite

    @State private var showInvite = false

    private var goingSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            FriendsGoingStack(eventId: event.id)
            HStack(spacing: 10) {
                GoingButton(event: event)
                Button { Haptics.tap(); showInvite = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "paperplane.fill").font(.system(size: 14, weight: .bold))
                        Text("Invite").font(VType.body(15, .bold))
                    }
                    .foregroundStyle(Palette.ink)
                    .padding(.vertical, 14).padding(.horizontal, 18)
                }
                .buttonStyle(ClayPressButtonStyle(style: .surface, radius: Radius.md, elevation: 0.6))
                .accessibilityLabel("Invite friends to \(event.title)")
            }
            if let orgId = event.organizerId {
                FollowOrganizerButton(organizerId: orgId, organizerName: event.organizer)
            }
            if !event.isBroadcast {
                Text("Visible to you because you follow \(event.organizer). It goes public once the organizer is approved.")
                    .font(VType.body(12)).foregroundStyle(Palette.inkFaint)
            }
        }
        .sheet(isPresented: $showInvite) { InviteFriendsSheet(event: event) }
    }

    private var detailGrid: some View {
        VStack(spacing: Spacing.sm) {
            detailRow("calendar", event.isProgram ? "Deadline" : "Date", dateFormatter.string(from: event.date))
            detailRow("clock.fill", "Time", event.displayTime)
            detailRow("mappin.circle.fill", "Location", event.locationName)
            if !event.isProgram {
            if let max = event.maxAttendees { detailRow("person.2.fill", "Capacity", "\(event.attendeeCount) / \(max)") }
            else { detailRow("person.2.fill", "Attending", "\(event.attendeeCount) people") }
            }
            if let price = event.priceLabel { detailRow("tag.fill", "Price", price) }
            detailRow("tray.full.fill", "Listed by", event.sourceCount > 1
                      ? "\(event.sourceLabel) · \(event.sourceCount) sources agree"
                      : event.sourceLabel)
            if !event.isProgram { detailRow("leaf.circle.fill", "Points", "+\(event.pointValue) for attending") }
        }
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md)
    }

    @ViewBuilder
    private var checkInSection: some View {
        if isCheckedIn {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.teal.base).font(.system(size: 18, weight: .bold))
                Text("Checked In").font(VType.body(16, .bold)).foregroundStyle(Palette.ink)
                Spacer()
                Text("\(event.pointValue) pts earned").font(VType.num(13, .bold)).foregroundStyle(Palette.teal.base)
            }
            .padding(Spacing.md).claySurface(.surface, radius: Radius.md)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Checked in. \(event.pointValue) points earned.")
        } else {
            VStack(spacing: Spacing.sm) {
                HStack(spacing: 8) {
                    Image(systemName: "info.circle.fill").foregroundStyle(Palette.gold.base)
                    Text("Be within 500 ft and upload proof of attendance to check in.")
                        .font(VType.scaledBody(12.5, .medium, relativeTo: .footnote)).foregroundStyle(Palette.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
                .background(ClayBackground(style: .inset, radius: Radius.sm))
                .accessibilityElement(children: .combine)

                if let checkInError {
                    Text(checkInError).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                }
                if !network.isOnline {
                    gateRow(icon: "wifi.slash", text: "Check-in is available when you're back online. Attendance cannot be saved for later.")
                } else if proofPhotoData != nil {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.teal.base)
                        Text("Proof photo attached").font(VType.scaledBody(13, .medium, relativeTo: .footnote)).foregroundStyle(Palette.ink)
                        Spacer()
                        Button("Change") { showPhotoPicker = true }
                            .font(VType.scaledBody(12, .bold, relativeTo: .caption)).foregroundStyle(Palette.spruce.base)
                            .accessibilityLabel("Change proof photo")
                    }
                    .padding(Spacing.md).background(ClayBackground(style: .inset, radius: Radius.sm))

                    // The proximity gate is REAL now: GPS fix + venue coordinate
                    // compared via CoreLocation, and the server re-checks distance
                    // for events with stored coordinates.
                    switch isWithinRange {
                    case .some(true):
                        checkInButton
                    case .some(false):
                        gateRow(icon: "location.slash.fill",
                                text: "Too far to check in — you're \(distanceLabel) away. Get within 500 ft of \(event.locationName).")
                    case .none:
                        if locationManager.userLocation == nil {
                            gateRow(icon: locationManager.isAuthorized ? "location.viewfinder" : "location.slash.fill",
                                    text: locationManager.isAuthorized
                                        ? "Waiting for a GPS fix — check-in unlocks once your location is found."
                                        : "Location access is required to check in. Enable it in Settings.")
                        } else if !geocodeFinished {
                            gateRow(icon: "location.viewfinder", text: "Locating the venue…")
                        } else {
                            // Venue has no resolvable coordinate — allow, but the
                            // check-in still records the user's GPS for spot-checks.
                            checkInButton
                        }
                    }
                } else {
                    ClayButton("Upload Proof of Attendance", systemImage: "camera.viewfinder",
                               kind: .spruce, fullWidth: true) { showPhotoPicker = true }
                        .accessibilityHint("Opens your photo library to attach a photo taken at the event.")
                }
            }
            .photosPicker(isPresented: $showPhotoPicker, selection: $selectedPhotoItem, matching: .images)
            .onChange(of: selectedPhotoItem) { _, newItem in
                Task {
                    if let data = try? await newItem?.loadTransferable(type: Data.self) { proofPhotoData = data }
                }
            }
        }
    }

    private var checkInButton: some View {
        ClayButton(isCheckingIn ? "Verifying attendance…" : "Check In  ·  +\(event.pointValue) pts",
                   systemImage: "checkmark.circle.fill", kind: .spruce, fullWidth: true) {
            guard !isCheckingIn else { return }
            isCheckingIn = true; checkInError = nil
            Task {
                defer { isCheckingIn = false }
                do {
                    earnedPoints = try await gameState.checkInEvent(event, proofPhoto: proofPhotoData,
                                                                    userLocation: locationManager.userLocation)
                    if earnedPoints > 0 {
                        Haptics.success()
                        AccessibilityNotification.Announcement("Checked in to \(event.title). Earned \(earnedPoints) points.").post()
                        withAnimation(.spring(response: 0.4)) { showCelebration = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { withAnimation { showCelebration = false } }
                    }
                } catch { checkInError = error.localizedDescription }
            }
        }
        .disabled(isCheckingIn || !network.isOnline)
        .accessibilityLabel("Check in to \(event.title)")
        .accessibilityHint("Requires an online connection, fresh location and proof photo. Points appear after verification.")
    }

    /// Inset row explaining why check-in is currently locked.
    private func gateRow(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(Palette.inkFaint)
            Text(text)
                .font(VType.scaledBody(13, .semibold, relativeTo: .footnote))
                .foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ClayBackground(style: .inset, radius: Radius.md))
        .accessibilityElement(children: .combine)
    }

    private var checkInCelebration: some View {
        ZStack {
            Color(hex: 0x0A140F).opacity(0.78).ignoresSafeArea()
            VStack(spacing: Spacing.lg) {
                ClayIconTile(systemImage: "checkmark.circle.fill", kind: .teal, size: 96, radius: Radius.md)
                Text("CHECKED IN!").font(VType.display(28, .bold)).foregroundStyle(.white)
                HStack(spacing: 6) {
                    Image(systemName: "leaf.circle.fill").font(.system(size: 18, weight: .bold))
                    Text("+\(earnedPoints) pts").font(VType.num(24, .bold))
                }
                .foregroundStyle(Palette.gold.onColor)
                .padding(.horizontal, 16).padding(.vertical, 9)
                .background(ClayBackground(style: .accent(.gold), radius: Radius.chip, elevation: 0.5))
                Text(event.title).font(VType.body(15)).foregroundStyle(.white.opacity(0.7))
            }
        }
        .onTapGesture { withAnimation { showCelebration = false } }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Checked in to \(event.title). Earned \(earnedPoints) points.")
        .accessibilityHint("Double tap to dismiss.")
    }

    private func detailRow(_ icon: String, _ label: String, _ value: String) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.spruce.base).frame(width: 24)
                .accessibilityHidden(true)
            Text(label).font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft).frame(width: 72, alignment: .leading)
            Text(value).font(VType.body(14, .medium)).foregroundStyle(Palette.ink)
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - For You event card (compact clay poster)

private struct ForYouEventCard: View {
    let event: Event
    let dateFormatter: DateFormatter
    @State private var showSeriesDates = false
    private var kind: ClayStyle.ClayAccentKind { event.category.clayKind }

    /// The combined VoiceOver label: facts, then the server reasons, then the series.
    private var cardLabel: String {
        var label = event.isProgram
            ? "\(event.title), Program, apply by \(dateFormatter.string(from: event.date)), \(event.locationName)"
            : "\(event.title), \(event.category.displayName), \(dateFormatter.string(from: event.date)) at \(event.locationName), earns \(event.pointValue) points"
        if let why = event.whyLine { label += ", Why: \(why)" }
        if let series = event.seriesLabel { label += ", \(series)" }
        return label
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                ClayIconTile(systemImage: event.imagePlaceholder, kind: kind, size: 44, radius: Radius.chip)
                Spacer()
                if !event.isProgram {
                HStack(spacing: 4) {
                    Image(systemName: "leaf.circle.fill").font(.system(size: 10, weight: .bold))
                    Text("+\(event.pointValue)").font(VType.num(11, .bold))
                }
                .foregroundStyle(Palette.gold.base)
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(ClayBackground(style: .inset, radius: Radius.chip))
                }
            }
            Text(event.title)
                .font(VType.display(15, .semibold)).foregroundStyle(Palette.ink)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 3) {
                Label(dateFormatter.string(from: event.date), systemImage: "calendar")
                Label(event.locationName, systemImage: "mappin.circle.fill").lineLimit(1)
            }
            .font(VType.num(11, .semibold)).foregroundStyle(Palette.inkSoft)
            // W5: the top two server reasons on one line. No fixed height — it
            // tightens and scales at the largest Dynamic Type sizes instead.
            if let why = event.whyLine {
                Text(why)
                    .font(VType.body(11, .medium)).foregroundStyle(Palette.spruce.base)
                    .lineLimit(1).minimumScaleFactor(0.75).allowsTightening(true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel("Why: \(why)")
            }
            if let series = event.seriesLabel {
                Button { Haptics.soft(); showSeriesDates = true } label: {
                    Label(series, systemImage: "repeat")
                        .font(VType.body(10, .bold)).foregroundStyle(Palette.inkSoft)
                        .lineLimit(1).minimumScaleFactor(0.75).allowsTightening(true)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 5) {
                Circle().fill(kind.accent.base).frame(width: 6, height: 6)
                Text(event.category.displayName).font(VType.body(10, .bold))
                    .foregroundStyle(kind.accent.base)
            }
        }
        .padding(Spacing.md)
        // Content-hugging with a 190pt floor (the QA.md card pattern), so the
        // reasons line never pushes the footer out of a pinned frame.
        .frame(width: 210, alignment: .topLeading)
        .frame(minHeight: 190, alignment: .topLeading)
        .claySurface(.surface, radius: Radius.md, elevation: 0.9)
        .contentShape(Rectangle())
        .overlay(alignment: .top) {
            Capsule().fill(kind.accent.faceGradient).frame(height: 5)
                .padding(.horizontal, 22).offset(y: 2)
        }
        .sheet(isPresented: $showSeriesDates) { SeriesDatesSheet(event: event) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(cardLabel)
        .accessibilityHint("Opens event details.")
        .accessibilityAddTraits(.isButton)
        .accessibilityActions {
            if let series = event.seriesLabel {
                Button(series) { showSeriesDates = true }
            }
        }
    }
}

// MARK: - Series dates (W5)

/// The other occurrences the server collapsed into one card. Dates only — the
/// occurrences share the listing's title, venue and organizer.
private struct SeriesDatesSheet: View {
    let event: Event
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                VerdureBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(event.title).font(VType.display(18, .semibold)).foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("This listing repeats. Your feed shows the next date once; it also happens on:")
                            .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(Array(event.moreDates.enumerated()), id: \.offset) { _, date in
                            Label(date.formatted(date: .complete, time: .shortened), systemImage: "calendar")
                                .font(VType.body(14)).foregroundStyle(Palette.ink)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(Spacing.sm)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .claySurface(.surface, radius: Radius.sm)
                        }
                    }
                    .padding(Spacing.md)
                }
            }
            .navigationTitle("More dates")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("seriesDatesDone")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Interest picker (personalizes the For You section)

/// Plus members can keep distinct sets without replacing the free account's
/// onboarding interests. The server owns all writes and checks entitlement.
struct InterestProfilesSheet: View {
    private struct ProfileRow: Identifiable {
        let id: String
        let name: String
        let interests: [String]
        let radiusMiles: Double
    }
    private struct FilterRow: Identifiable {
        let id: String
        let name: String
        let categories: [String]
        let radiusMiles: Double
        let cost: String
        let dateRange: String
    }

    @Environment(EventsAPIService.self) private var eventsService
    @Environment(LocationManager.self) private var locationManager
    @Environment(DiscoveryFilters.self) private var discoveryFilters
    @Environment(\.dismiss) private var dismiss
    @AppStorage("interestCategories") private var interestCategoriesRaw = ""
    @State private var profiles: [ProfileRow] = []
    @State private var savedFilters: [FilterRow] = []
    @State private var activeProfileId: String?
    @State private var serverPlus = false
    @State private var name = ""
    @State private var filterName = ""
    @State private var selectedInterests: Set<PlaceCategory> = []
    @State private var excludedCategories: Set<EventCategory> = []
    @State private var radius = 25.0
    @State private var preset = "balanced"
    @State private var working = false
    @State private var errorMessage: String?

    private func call(_ data: [String: any Sendable]) async throws -> [String: Any] {
        let result = try await Functions.functions().httpsCallable("manageInterestProfiles").call(data)
        return result.data as? [String: Any] ?? [:]
    }

    private func load() async {
        do {
            let result = try await call(["action": "list"])
            serverPlus = result["plus"] as? Bool ?? false
            activeProfileId = result["activeProfileId"] as? String
            let profileMap = result["profiles"] as? [String: [String: Any]] ?? [:]
            profiles = profileMap.map { id, raw in
                ProfileRow(id: id, name: raw["name"] as? String ?? "Profile",
                           interests: raw["interests"] as? [String] ?? [],
                           radiusMiles: raw["radiusMiles"] as? Double ?? 25)
            }.sorted { $0.name < $1.name }
            let filterMap = result["savedFilters"] as? [String: [String: Any]] ?? [:]
            savedFilters = filterMap.map { id, raw in
                FilterRow(id: id, name: raw["name"] as? String ?? "Filters",
                          categories: raw["categories"] as? [String] ?? [],
                          radiusMiles: raw["radiusMiles"] as? Double ?? 25,
                          cost: raw["cost"] as? String ?? "any",
                          dateRange: raw["dateRange"] as? String ?? "any")
            }.sorted { $0.name < $1.name }
        } catch { errorMessage = error.localizedDescription }
    }

    private func createProfile() async {
        guard !working else { return }
        working = true; defer { working = false }
        do {
            let profile: [String: any Sendable] = [
                "name": name, "interests": selectedInterests.map(\.rawValue),
                "radiusMiles": radius, "categories": [String](),
                "exclusions": excludedCategories.map(\.rawValue), "distancePreset": preset,
            ]
            _ = try await call(["action": "save", "profile": profile])
            name = ""
            await load()
            await eventsService.refresh(around: locationManager.userCoordinate)
        } catch { errorMessage = error.localizedDescription }
    }

    private func switchProfile(_ row: ProfileRow) async {
        do {
            _ = try await call(["action": "switch", "id": row.id])
            interestCategoriesRaw = row.interests.joined(separator: ",")
            await load()
            await eventsService.refresh(around: locationManager.userCoordinate)
        } catch { errorMessage = error.localizedDescription }
    }

    private func deleteProfile(_ id: String) async {
        do {
            _ = try await call(["action": "delete", "id": id])
            await load()
            await eventsService.refresh(around: locationManager.userCoordinate)
        } catch { errorMessage = error.localizedDescription }
    }

    private func saveFilters() async {
        do {
            let state = discoveryFilters.state
            _ = try await call(["action": "saveFilter", "name": filterName,
                "categories": state.eventCategories.map(\.rawValue), "radiusMiles": state.radiusMiles,
                "cost": state.price == .free ? "free" : "any",
                "dateRange": state.dateRange == .thisWeekend ? "weekend" :
                    state.dateRange == .thisWeek ? "week" : state.dateRange == .thisMonth ? "month" : "any"])
            filterName = ""
            await load()
        } catch { errorMessage = error.localizedDescription }
    }

    private func applyFilter(_ row: FilterRow) {
        discoveryFilters.state.eventCategories = Set(row.categories.compactMap(EventCategory.init(rawValue:)))
        discoveryFilters.state.radiusMiles = row.radiusMiles
        discoveryFilters.state.price = row.cost == "free" ? .free : .any
        discoveryFilters.state.dateRange = row.dateRange == "weekend" ? .thisWeekend :
            row.dateRange == "week" ? .thisWeek : row.dateRange == "month" ? .thisMonth : .any
        dismiss()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if let errorMessage {
                        Text(errorMessage).font(VType.body(12)).foregroundStyle(.red)
                    }
                    if !serverPlus {
                        EmptyStateCard(icon: "lock.fill", title: "Verdure+ profiles",
                                       message: "Your subscription must be active on your account to use extra profiles.")
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Your profiles").font(VType.display(24, .semibold))
                            ForEach(profiles) { row in
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(row.name).font(VType.body(15, .semibold))
                                        Text("\(row.interests.joined(separator: ", ")) · \(Int(row.radiusMiles)) mi")
                                            .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                                    }
                                    Spacer()
                                    if row.id == activeProfileId {
                                        Text("Active").font(VType.body(12, .semibold)).foregroundStyle(Palette.spruce.base)
                                    } else {
                                        Button("Use") { Task { await switchProfile(row) } }
                                    }
                                    Menu {
                                        Button("Delete profile", role: .destructive) { Task { await deleteProfile(row.id) } }
                                    } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }
                                }.padding(Spacing.md).claySurface(.surface, radius: Radius.md, elevation: 0.4)
                            }
                        }
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Create a profile").font(VType.display(22, .semibold))
                            TextField("Name, like Solo weekend", text: $name)
                                .textInputAutocapitalization(.words).padding(12)
                                .background(ClayBackground(style: .inset, radius: Radius.sm))
                            Text("Interests").font(VType.body(13, .semibold))
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack {
                                    ForEach(PlaceCategory.allCases) { interest in
                                        Button(interest.rawValue) {
                                            if selectedInterests.contains(interest) { selectedInterests.remove(interest) }
                                            else { selectedInterests.insert(interest) }
                                        }
                                        .font(VType.body(12, .medium))
                                        .padding(10)
                                        .background(selectedInterests.contains(interest) ? Palette.spruce.base : Palette.surface,
                                                    in: RoundedRectangle(cornerRadius: Radius.sm))
                                        .foregroundStyle(selectedInterests.contains(interest) ? Palette.spruce.onColor : Palette.ink)
                                    }
                                }
                            }
                            Text("Typical radius: \(Int(radius)) miles").font(VType.body(13))
                            Slider(value: $radius, in: 1...100, step: 1)
                            Picker("Travel preference", selection: $preset) {
                                Text("Close to home").tag("close")
                                Text("Balanced").tag("balanced")
                                Text("Worth the drive").tag("drive")
                            }.pickerStyle(.segmented)
                            Text("Never show these categories").font(VType.body(13, .semibold))
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack {
                                    ForEach(EventCategory.allCases) { category in
                                        Button(category.displayName) {
                                            if excludedCategories.contains(category) { excludedCategories.remove(category) }
                                            else { excludedCategories.insert(category) }
                                        }
                                        .font(VType.body(12, .medium)).padding(10)
                                        .background(excludedCategories.contains(category) ? Palette.spruce.base : Palette.surface,
                                                    in: RoundedRectangle(cornerRadius: Radius.sm))
                                        .foregroundStyle(excludedCategories.contains(category) ? Palette.spruce.onColor : Palette.ink)
                                    }
                                }
                            }
                            Button("Save profile") { Task { await createProfile() } }
                                .font(VType.body(15, .semibold)).foregroundStyle(Palette.spruce.base)
                                .disabled(name.trimmingCharacters(in: .whitespaces).count < 2 || working)
                        }
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Saved event filters").font(VType.display(22, .semibold))
                            ForEach(savedFilters) { row in
                                HStack {
                                    Button(row.name) { applyFilter(row) }
                                    Spacer()
                                    Button(role: .destructive) {
                                        Task {
                                            _ = try? await call(["action": "deleteFilter", "id": row.id])
                                            await load()
                                        }
                                    } label: { Image(systemName: "trash") }
                                }.font(VType.body(14)).padding(Spacing.md)
                                    .claySurface(.surface, radius: Radius.md, elevation: 0.4)
                            }
                            TextField("Name current filters", text: $filterName)
                                .padding(12).background(ClayBackground(style: .inset, radius: Radius.sm))
                            Button("Save current filters") { Task { await saveFilters() } }
                                .font(VType.body(14, .semibold)).foregroundStyle(Palette.spruce.base)
                                .disabled(filterName.trimmingCharacters(in: .whitespaces).count < 2)
                        }
                    }
                }
                .padding(Spacing.md).padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Interest profiles")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .task {
                selectedInterests = Set(interestCategoriesRaw.split(separator: ",")
                    .compactMap { PlaceCategory(rawValue: String($0)) })
                await load()
            }
        }
    }
}

private struct InterestPickerSheet: View {
    @AppStorage("interestCategories") private var interestCategoriesRaw = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(EventsAPIService.self) private var eventsService

    private var selected: Set<PlaceCategory> {
        Set(interestCategoriesRaw.split(separator: ",").compactMap { PlaceCategory(rawValue: String($0)) })
    }

    private func toggle(_ category: PlaceCategory) {
        var current = selected
        if current.contains(category) { current.remove(category) } else { current.insert(category) }
        interestCategoriesRaw = current.map(\.rawValue).joined(separator: ",")
        Task { await eventsService.updateInterests(current.map(\.rawValue)) }
        Haptics.tap()
    }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    Text("Pick what draws you outdoors — your event recommendations follow.")
                        .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        .padding(.horizontal, Spacing.md)

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        ForEach(PlaceCategory.allCases) { category in
                            let isSelected = selected.contains(category)
                            Button { toggle(category) } label: {
                                VStack(spacing: 10) {
                                    ClayIconTile(systemImage: category.icon, kind: category.clayKind,
                                                 size: 44, radius: Radius.chip)
                                    Text(category.rawValue)
                                        .font(VType.body(13, .semibold))
                                        .foregroundStyle(isSelected ? category.accent.onColor : Palette.ink)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                            }
                            .buttonStyle(ClayPressButtonStyle(
                                style: isSelected ? .accent(category.clayKind) : .surface,
                                radius: Radius.md, elevation: 0.7))
                            .accessibilityLabel(category.rawValue)
                            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                            .accessibilityHint(isSelected ? "Double tap to remove from your interests." : "Double tap to add to your interests.")
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                }
                .padding(.top, Spacing.sm)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Your Interests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(VType.body(15, .semibold)).foregroundStyle(Palette.spruce.base)
                }
            }
        }
    }
}

#Preview {
    EventsView()
        .environment(GameStateManager())
        .environment(LocationManager())
        .environment(EventsAPIService())
        .environment(ModerationService())
        .environment(AuthService())
        .environment(SocialService())
        .environment(StoreService())
        .environment(DiscoveryFilters())
}

// MARK: - Saved / bookmarked events

private struct SavedEventsView: View {
    let allEvents: [Event]
    let dateFormatter: DateFormatter
    @Environment(GameStateManager.self) private var gameState
    @Environment(LocationManager.self) private var locationManager
    @Environment(\.dismiss) private var dismiss
    @State private var selectedEvent: Event?

    private var savedEvents: [Event] {
        allEvents.filter { gameState.isSaved($0.id) }.sorted { $0.date < $1.date }
    }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                if savedEvents.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(savedEvents.enumerated()), id: \.element.id) { i, event in
                            TimelineRow(event: event, isCheckedIn: gameState.isCheckedIn(event.id),
                                        isLast: i == savedEvents.count - 1)
                                .onTapGesture { Haptics.soft(); selectedEvent = event }
                        }
                    }
                    .padding(Spacing.md)
                    .padding(.bottom, Spacing.xl)
                }
            }
            .background(VerdureBackground())
            .navigationTitle("Saved Events")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                }
            }
        }
        .sheet(item: $selectedEvent) { event in
            EventDetailSheet(event: event, dateFormatter: dateFormatter)
                .environment(gameState).environment(locationManager)
                .presentationDetents([.large]).presentationDragIndicator(.visible)
        }
    }

    private var emptyState: some View {
        VStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: "bookmark.slash", kind: .gold, size: 66, radius: Radius.md)
            Text("No saved events yet").font(VType.display(19, .semibold)).foregroundStyle(Palette.ink)
            Text("Tap the bookmark on any event to save it here for later.")
                .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.top, 80).padding(.horizontal, Spacing.xl)
    }
}

// MARK: - Events calendar (month grid with event dots)

private struct EventCalendarView: View {
    let allEvents: [Event]
    let dateFormatter: DateFormatter
    @Environment(GameStateManager.self) private var gameState
    @Environment(LocationManager.self) private var locationManager
    @Environment(\.dismiss) private var dismiss
    @State private var monthAnchor = Date()
    @State private var selectedDay: Date?
    @State private var selectedEvent: Event?

    private let cal = Calendar.current
    private let weekdaySymbols = ["S", "M", "T", "W", "T", "F", "S"]

    private var eventsByDay: [Date: [Event]] {
        Dictionary(grouping: allEvents) { cal.startOfDay(for: $0.date) }
    }

    private var monthTitle: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; return f.string(from: monthAnchor)
    }

    /// Calendar cells for the anchored month, padded with nils to full weeks.
    private var monthCells: [Date?] {
        guard let interval = cal.dateInterval(of: .month, for: monthAnchor),
              let firstWeekday = cal.dateComponents([.weekday], from: interval.start).weekday else { return [] }
        let daysInMonth = cal.range(of: .day, in: .month, for: monthAnchor)?.count ?? 30
        let leading = (firstWeekday - cal.firstWeekday + 7) % 7
        var cells: [Date?] = Array(repeating: nil, count: leading)
        for d in 0..<daysInMonth {
            cells.append(cal.date(byAdding: .day, value: d, to: interval.start))
        }
        while cells.count % 7 != 0 { cells.append(nil) }
        return cells
    }

    private func events(on day: Date) -> [Event] {
        eventsByDay[cal.startOfDay(for: day)] ?? []
    }

    private var selectedDayEvents: [Event] {
        guard let day = selectedDay else { return [] }
        return events(on: day).sorted { $0.time < $1.time }
    }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: Spacing.lg) {
                    monthHeader
                    weekdayRow
                    grid
                    selectedList
                }
                .padding(Spacing.lg)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Calendar").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                }
            }
        }
        .sheet(item: $selectedEvent) { event in
            EventDetailSheet(event: event, dateFormatter: dateFormatter)
                .environment(gameState).environment(locationManager)
                .presentationDetents([.large]).presentationDragIndicator(.visible)
        }
    }

    private var monthHeader: some View {
        HStack {
            Button { stepMonth(-1) } label: {
                Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.ink).frame(width: 40, height: 40)
                    .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
            }.buttonStyle(.plain)
            Spacer()
            Text(monthTitle).font(VType.display(22, .semibold)).foregroundStyle(Palette.ink)
            Spacer()
            Button { stepMonth(1) } label: {
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.ink).frame(width: 40, height: 40)
                    .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
            }.buttonStyle(.plain)
        }
    }

    private var weekdayRow: some View {
        HStack(spacing: 0) {
            ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, s in
                Text(s).font(VType.body(11, .bold)).foregroundStyle(Palette.inkFaint)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var grid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 6) {
            ForEach(Array(monthCells.enumerated()), id: \.offset) { _, cell in
                if let day = cell { dayCell(day) } else { Color.clear.frame(height: 44) }
            }
        }
    }

    private func dayCell(_ day: Date) -> some View {
        let dayEvents = events(on: day)
        let isToday = cal.isDateInToday(day)
        let isSelected = selectedDay.map { cal.isDate($0, inSameDayAs: day) } ?? false
        let accent = dayEvents.first?.category.accent.base ?? Palette.teal.base
        return Button {
            Haptics.soft()
            withAnimation(.spring(response: 0.3)) { selectedDay = day }
        } label: {
            VStack(spacing: 3) {
                Text("\(cal.component(.day, from: day))")
                    .font(VType.num(14, isSelected ? .bold : .medium))
                    .foregroundStyle(isSelected ? Palette.spruce.onColor : Palette.ink)
                HStack(spacing: 2) {
                    ForEach(0..<min(dayEvents.count, 3), id: \.self) { i in
                        Circle()
                            .fill(isSelected ? Palette.spruce.onColor : dayEvents[i].category.accent.base)
                            .frame(width: 4, height: 4)
                    }
                }
                .frame(height: 4)
            }
            .frame(maxWidth: .infinity).frame(height: 44)
            .background(
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .fill(isSelected ? Palette.spruce.base : (dayEvents.isEmpty ? Color.clear : accent.opacity(0.12)))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .strokeBorder(isToday && !isSelected ? Palette.gold.base : Color.clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var selectedList: some View {
        if let day = selectedDay {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(longDate(day)).font(VType.display(17, .semibold)).foregroundStyle(Palette.ink)
                if selectedDayEvents.isEmpty {
                    Text("No events this day.").font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                        .padding(.vertical, Spacing.sm)
                } else {
                    ForEach(selectedDayEvents) { event in
                        Button { Haptics.soft(); selectedEvent = event } label: {
                            calendarEventRow(event)
                        }.buttonStyle(.plain)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .transition(.opacity)
        } else {
            Text("Tap a highlighted day to see its events.")
                .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                .frame(maxWidth: .infinity).padding(.top, Spacing.md)
        }
    }

    private func calendarEventRow(_ event: Event) -> some View {
        HStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: event.imagePlaceholder, kind: event.category.clayKind, size: 44, radius: Radius.chip)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                Text("\(event.displayTime) · \(event.locationName)")
                    .font(VType.body(12, .medium)).foregroundStyle(Palette.inkSoft).lineLimit(1)
            }
            Spacer(minLength: Spacing.sm)
            if !event.isProgram { PointsBadge(points: event.pointValue, kind: event.category.clayKind) }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity)
        .claySurface(.surface, radius: Radius.md, elevation: 0.8)
    }

    private func stepMonth(_ delta: Int) {
        Haptics.soft()
        if let d = cal.date(byAdding: .month, value: delta, to: monthAnchor) {
            withAnimation(.spring(response: 0.35)) { monthAnchor = d; selectedDay = nil }
        }
    }

    private func longDate(_ day: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "EEEE, MMM d"; return f.string(from: day)
    }
}
