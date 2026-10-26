import SwiftUI

private struct StoryVisibility: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

struct PlaceStorySection: View {
    let placeID: String
    var offlineStory: PlaceStory? = nil
    @Environment(AuthService.self) private var auth
    @Environment(ModerationService.self) private var moderation
    @Environment(\.scenePhase) private var scenePhase
    @State private var service = PlaceStoryService()
    @State private var expanded = false
    @State private var reporting = false
    @State private var exposure = UUID().uuidString
    @State private var stages: Set<String> = []
    @State private var exposureKey = ""
    private var online: Bool { NetworkStatus.shared.isOnline }
    private var story: PlaceStory? {
        let value = online ? service.visibleStory(account: auth.currentUser?.uid) : offlineStory
        guard let value, !moderation.isBlocked(value.ownerUid), !moderation.isBlocked(value.organizerId) else { return nil }
        return value
    }
    private var loadKey: String { "\(placeID):\(auth.currentUser?.uid ?? "guest"):\(online)" }

    var body: some View {
        Group {
            if let story {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("About this place").font(VType.display(22, .semibold)).accessibilityAddTraits(.isHeader)
                        .background(visibilityMarker("shown"))
                    Text("By \(story.organizerName)").font(VType.body(13, .semibold)).foregroundStyle(Palette.inkSoft)
                    Text(story.content).font(VType.scaledBody(16, relativeTo: .body)).lineSpacing(4)
                        .lineLimit(expanded ? nil : 3).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("placeStoryText")
                    if expanded { Color.clear.frame(height: 1).background(visibilityMarker("read_through")) }
                    Button {
                        expanded.toggle()
                        if expanded { record("expanded", story: story) }
                    } label: { Text(expanded ? "Show less" : "Read story").frame(minHeight: 44) }
                        .accessibilityIdentifier("expandPlaceStory")
                    if !online {
                        Text("Downloaded story. Ownership and moderation may have changed; connect to see the current story.")
                            .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                    } else if auth.isAuthenticated, auth.currentUser?.uid != story.ownerUid {
                        Button { reporting = true } label: { Label("Report this story", systemImage: "flag").frame(minHeight: 44) }.accessibilityIdentifier("reportPlaceStory")
                    } else if !auth.isAuthenticated {
                        Text("Sign in to report a concern, or use the support form.")
                            .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                        Link("Contact Verdure support", destination: Legal.supportURL).frame(minHeight: 44)
                    }
                }
                .foregroundStyle(Palette.ink).padding(Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
                .claySurface(.surface, radius: Radius.md)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("placeStoryCard")
                .sheet(isPresented: $reporting) {
                    ReportSheet(target: .placeStory, targetID: story.id, targetLabel: "this place story",
                                blockCandidate: (uid: story.ownerUid, name: story.organizerName))
                }
            } else if online, let error = service.error, PlaceStoryAPI.supported(placeID) {
                VStack(alignment: .leading) {
                    Text(error).font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                    Button("Retry story") { Task { await service.refresh() } }.frame(minHeight: 44)
                }
            }
        }
        .task(id: loadKey) { await service.begin(placeID: placeID) }
        .onDisappear { service.stop() }
        .onChange(of: scenePhase) { _, phase in if phase == .active, online { Task { await service.refresh() } } }
        .onChange(of: moderation.blockedUserIDs) { _, _ in Task { await service.refresh() } }
        .onChange(of: story?.id.description.appending(":\(story?.version ?? 0)")) { _, _ in
            expanded = false; reporting = false
        }
        .onPreferenceChange(StoryVisibility.self) { frames in
            guard let story else { return }
            let screen = UIScreen.main.bounds
            for (stage, frame) in frames where frame.maxY > 110 && frame.minY < screen.height - 100 && frame.maxX > 0 && frame.minX < screen.width {
                if stage == "shown" || expanded { record(stage, story: story) }
            }
        }
    }
    private func visibilityMarker(_ stage: String) -> some View {
        GeometryReader { proxy in Color.clear.preference(key: StoryVisibility.self, value: [stage: proxy.frame(in: .global)]) }
    }
    private func record(_ stage: String, story: PlaceStory) {
        guard online else { return }
        let key = "\(story.id):\(story.version)"
        if exposureKey != key { exposureKey = key; exposure = UUID().uuidString; stages = [] }
        guard stages.insert(stage).inserted else { return }
        // "Read through" means the expanded text's end entered the viewport,
        // not a claim about attention or comprehension.
        PlaceStoryAPI.engagement(story, stage: stage, exposure: exposure)
    }
}

struct MyPlaceStoriesView: View {
    @Environment(AuthService.self) private var auth
    @State private var places: [OwnedStoryPlace] = []
    @State private var cursor: String?
    @State private var loading = false
    @State private var error: String?
    @State private var request = UUID()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Write your place's story in your own words, up to 400 characters. The Verdure team must verify ownership first.")
                    .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                if !NetworkStatus.shared.isOnline { Text("Connect to edit your place stories.") }
                else if places.isEmpty && !loading {
                    Text("No verified places yet. Send written ownership confirmation through the support form.")
                        .font(VType.body(15))
                    Link("Contact Verdure support", destination: Legal.supportURL).frame(minHeight: 44)
                }
                ForEach(places) { place in
                    NavigationLink { PlaceStoryEditor(place: place) } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(place.placeName).font(VType.body(17, .semibold))
                            Text(place.canEdit ? "Write or edit story" : place.moderated ? "Awaiting moderation review" : "Ownership inactive")
                                .font(VType.body(13)).foregroundStyle(Palette.inkSoft)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(Spacing.md).claySurface(.surface, radius: Radius.md)
                    }.buttonStyle(.plain).accessibilityIdentifier("ownedStory:\(place.id)")
                }
                if loading { ProgressView() }
                if cursor != nil { Button("Load more places") { Task { await load(more: true) } }.disabled(loading).frame(minHeight: 44) }
                if let error { Text(error).foregroundStyle(Palette.danger); Button("Try again") { Task { await load() } } }
            }.padding(Spacing.md)
        }.background(VerdureBackground()).navigationTitle("My place stories")
            .task(id: auth.currentUser?.uid) { await load() }.refreshable { await load() }
    }
    private func load(more: Bool = false) async {
        guard NetworkStatus.shared.isOnline, let uid = auth.currentUser?.uid else { places = []; return }
        let token = UUID(); request = token; loading = true; error = nil
        if !more { places = []; cursor = nil }
        do {
            let page = try await PlaceStoryAPI.owned(cursor: more ? cursor : nil)
            guard !Task.isCancelled, request == token, auth.currentUser?.uid == uid else { return }
            let existing = Set(places.map(\.id)); places += page.places.filter { !existing.contains($0.id) }; cursor = page.nextCursor
        } catch { if request == token, auth.currentUser?.uid == uid { self.error = error.localizedDescription } }
        if request == token { loading = false }
    }
}

struct PlaceStoryEditor: View {
    let place: OwnedStoryPlace
    @Environment(AuthService.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var content = ""
    @State private var account: String?
    @State private var saving = false
    @State private var currentPlace: OwnedStoryPlace?
    @State private var error: String?
    private var editingPlace: OwnedStoryPlace { currentPlace ?? place }
    private var count: Int { content.unicodeScalars.count }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(place.placeName).font(VType.display(25, .semibold))
                if let url = URL(string: place.officialURL), url.scheme == "https" { Link("Official place listing", destination: url).frame(minHeight: 44) }
                Text("Tell visitors about this place in your own words. Use plain text; leave it blank to remove the public story.")
                    .font(VType.body(15)).foregroundStyle(Palette.inkSoft)
                TextEditor(text: $content).frame(minHeight: 180).padding(8).claySurface(.surface, radius: Radius.md)
                    .accessibilityLabel("Place story").accessibilityIdentifier("placeStoryEditor")
                    .disabled(!editingPlace.canEdit || saving || account != auth.currentUser?.uid)
                Text("\(count) / 400 characters").font(VType.body(13)).foregroundStyle(count > 400 ? Palette.danger : Palette.inkSoft)
                if !editingPlace.canEdit { Text(editingPlace.moderated ? "Staff must review this story before it can be edited." : "Your ownership or organizer approval is inactive.") }
                if !NetworkStatus.shared.isOnline { Text("Connect to save. Your text stays on this screen while you reconnect.") }
                if let error {
                    Text(error).foregroundStyle(Palette.danger)
                    Button("Reload current story") { Task { await reload() } }.frame(minHeight: 44)
                }
                NavigationLink {
                    ScrollView { PlaceStorySection(placeID: place.id).padding(Spacing.md) }
                        .background(VerdureBackground()).navigationTitle("Published story")
                } label: { Label("View public story", systemImage: "book").frame(minHeight: 44) }
                    .accessibilityIdentifier("viewPublishedStory")
                ClayButton(saving ? "Saving…" : "Save story", systemImage: "checkmark", kind: .spruce, fullWidth: true) { Task { await save() } }
                    .disabled(saving || count > 400 || !editingPlace.canEdit || !NetworkStatus.shared.isOnline || account == nil || account != auth.currentUser?.uid)
                    .accessibilityIdentifier("savePlaceStory")
            }.padding(Spacing.md)
        }.background(VerdureBackground()).navigationTitle("Edit story").navigationBarTitleDisplayMode(.inline)
            .onAppear { if account == nil { content = place.content; account = auth.currentUser?.uid } }
            .onChange(of: auth.currentUser?.uid) { _, _ in content = ""; dismiss() }
    }
    private func reload() async {
        guard let account, account == auth.currentUser?.uid, NetworkStatus.shared.isOnline else { return }
        saving = true
        defer { saving = false }
        do {
            var cursor: String?
            repeat {
                let page = try await PlaceStoryAPI.owned(cursor: cursor)
                guard account == auth.currentUser?.uid else { return }
                if let updated = page.places.first(where: { $0.id == place.id }) {
                    currentPlace = updated; content = updated.content; error = nil; return
                }
                cursor = page.nextCursor
            } while cursor != nil
            error = "Ownership has changed. This place is no longer in your account."
        } catch { if account == auth.currentUser?.uid { self.error = error.localizedDescription } }
    }
    private func save() async {
        guard let account, account == auth.currentUser?.uid, NetworkStatus.shared.isOnline else { return }
        saving = true; error = nil
        do {
            try await PlaceStoryAPI.save(editingPlace, content: content)
            if account == auth.currentUser?.uid { dismiss() }
        } catch { if account == auth.currentUser?.uid { self.error = error.localizedDescription } }
        saving = false
    }
}
