import SwiftUI

/// Honest empty state.
///
/// Live screens used to fall back to `SampleData` when a source returned
/// nothing, which put fabricated parks and events in front of real users. That
/// fallback is now DEBUG-QA-only; every screen renders one of these instead and
/// says plainly why there is nothing to show.
struct EmptyStateCard: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: Spacing.sm) {
            ClayIconTile(systemImage: icon, kind: .teal, size: 48, radius: Radius.sm)
                .accessibilityHidden(true)
            Text(title)
                .font(VType.scaledDisplay(17, .semibold, relativeTo: .headline))
                .foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
            Text(message)
                .font(VType.scaledBody(13, relativeTo: .footnote))
                .foregroundStyle(Palette.inkSoft)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle, let action {
                ClayButton(actionTitle, kind: .ghost) { action() }
                    .padding(.top, 4)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity)
        .background(ClayBackground(style: .inset, radius: Radius.md))
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    EmptyStateCard(icon: "map", title: "No places loaded yet",
                   message: "Real parks and trails appear here once nearby places have loaded.")
        .padding()
}
