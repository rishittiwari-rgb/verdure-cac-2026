import SwiftUI

// MARK: - Event opened from a notification
//
// A deep link arrives as an event ID, not an Event — the push was composed on a
// server that has no idea what the device has cached. So this looks the event
// up and is honest about all three outcomes: loading, found, and gone.
//
// "Gone" is a real case, not a defensive nicety: the digest is sent up to ten
// days ahead, and an event can be cancelled, hidden by moderation, or fall out
// of the ingest window between the send and the tap.

struct EventDeepLinkSheet: View {
    let eventId: String

    @Environment(EventsAPIService.self) private var eventsService
    @State private var event: Event?
    @State private var state: LoadState = .loading
    @Environment(\.dismiss) private var dismiss

    enum LoadState { case loading, loaded, missing }

    private static let formatter: DateFormatter = {
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short; return f
    }()

    var body: some View {
        NavigationStack {
            ZStack {
                VerdureBackground()
                switch state {
                case .loading:
                    ProgressView().tint(Palette.spruce.base)
                        .accessibilityLabel("Loading event")
                case .loaded:
                    if let event {
                        EventDetailSheet(event: event, dateFormatter: Self.formatter)
                    } else {
                        missingCard
                    }
                case .missing:
                    missingCard
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.font(VType.scaledBody(16, .medium))
                }
            }
            .task { await load() }
        }
    }

    private var missingCard: some View {
        VStack(spacing: Spacing.md) {
            ClayIconTile(systemImage: "calendar.badge.exclamationmark", kind: .terracotta, size: 56, radius: Radius.md)
            Text("This event isn't available anymore")
                .font(VType.scaledDisplay(20))
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.ink)
            Text("It may have been cancelled or removed since we sent that notification.")
                .font(VType.scaledBody(14))
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.inkSoft)
            VerdureButton(title: "Browse events", style: .primary) { dismiss() }
                .padding(.top, Spacing.sm)
        }
        .padding(Spacing.lg)
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        let found = await eventsService.event(withID: eventId)
        event = found
        state = found == nil ? .missing : .loaded
    }
}
