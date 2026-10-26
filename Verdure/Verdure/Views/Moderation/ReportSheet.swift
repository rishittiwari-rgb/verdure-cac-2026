import SwiftUI

// MARK: - Report sheet
//
// One sheet for every reportable thing (post, event, organizer, member). The
// reason list mirrors the server's REPORT_REASONS; the copy tells the user what
// actually happens next (24-hour review, auto-hide at the threshold) and gives
// them the published contact address — because "we'll look into it" is not a
// moderation policy, and App Review reads this screen.

struct ReportSheet: View {
    let target: ReportTarget
    let targetID: String
    /// Human phrase for the thing being reported, e.g. "this post".
    let targetLabel: String
    /// When set, the confirmation offers to block the author as well.
    var blockCandidate: (uid: String, name: String)? = nil

    @Environment(ModerationService.self) private var moderation
    @Environment(\.dismiss) private var dismiss
    @State private var reason: ReportReason? = nil
    @State private var details = ""
    @State private var isSubmitting = false
    @State private var outcome: ModerationService.ReportOutcome? = nil
    @State private var didBlock = false

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    if outcome == .filed {
                        confirmation
                    } else {
                        intro
                        reasonList
                        detailsField
                        if case .failed(let message)? = outcome {
                            Text(message)
                                .font(VType.body(13, .medium)).foregroundStyle(Palette.danger)
                                .accessibilityLabel("Error: \(message)")
                        }
                        ClayButton(isSubmitting ? "Sending…" : "Send Report",
                                   systemImage: "flag.fill", kind: .spruce, fullWidth: true) { submit() }
                            .disabled(reason == nil || isSubmitting)
                            .opacity(reason == nil || isSubmitting ? 0.55 : 1)
                            .accessibilityHint(reason == nil ? "Choose a reason first." : "Files the report.")
                        policyNote
                    }
                }
                .padding(Spacing.md)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Report").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(outcome == .filed ? "Done" : "Cancel") { dismiss() }
                        .foregroundStyle(Palette.inkSoft)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Pieces

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            KickerLabel(text: "Report \(targetLabel)", color: Palette.terracotta.base, dot: Palette.terracotta.base)
            Text("What's wrong with it?")
                .font(VType.display(26, .semibold)).foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
            Text("Reports are anonymous to the person you're reporting.")
                .font(VType.scaledBody(13, relativeTo: .footnote)).foregroundStyle(Palette.inkSoft)
        }
    }

    private var reasonList: some View {
        VStack(spacing: 8) {
            ForEach(ReportReason.allCases) { r in
                Button {
                    Haptics.soft()
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { reason = r }
                } label: {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: r.icon).font(.system(size: 14, weight: .bold))
                            .foregroundStyle(reason == r ? Palette.spruce.onColor : Palette.inkSoft)
                            .frame(width: 30)
                        Text(r.title)
                            .font(VType.scaledBody(15, .medium, relativeTo: .body))
                            .foregroundStyle(reason == r ? Palette.spruce.onColor : Palette.ink)
                            .multilineTextAlignment(.leading)
                        Spacer()
                        if reason == r {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 16, weight: .bold))
                                .foregroundStyle(Palette.spruce.onColor)
                        }
                    }
                    .padding(.horizontal, Spacing.md).padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(ClayPressButtonStyle(style: reason == r ? .accent(.spruce) : .surface,
                                                  radius: Radius.md, elevation: reason == r ? 0.9 : 0.5))
                .accessibilityAddTraits(reason == r ? [.isSelected] : [])
            }
        }
    }

    private var detailsField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Anything else? (optional)")
                .font(VType.body(12, .semibold)).foregroundStyle(Palette.inkSoft)
            TextField("Tell us what happened", text: $details, axis: .vertical)
                .font(VType.body(15)).foregroundStyle(Palette.ink)
                .lineLimit(3...6).padding(14)
                .background(ClayBackground(style: .inset, radius: Radius.sm))
                .onChange(of: details) { _, new in
                    if new.count > 1000 { details = String(new.prefix(1000)) }
                }
        }
    }

    private var policyNote: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("A person reviews every report within 24 hours. Content reported by \(ModerationService.autoHideThreshold) or more people is hidden immediately while we look.")
            Text("Urgent concern? Email \(ModerationService.contactEmail).")
        }
        .font(VType.scaledBody(11, relativeTo: .caption2)).foregroundStyle(Palette.inkFaint)
        .lineSpacing(2)
    }

    private var confirmation: some View {
        VStack(spacing: Spacing.lg) {
            ClayIconTile(systemImage: "checkmark.shield.fill", kind: .teal, size: 72, radius: Radius.md)
                .padding(.top, Spacing.lg)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Thanks for speaking up")
                    .font(VType.display(24, .semibold)).foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Our team will review it within 24 hours. If several people report the same thing it's hidden right away. You won't hear from the person you reported.")
                    .font(VType.scaledBody(14, relativeTo: .subheadline)).foregroundStyle(Palette.inkSoft)
                    .multilineTextAlignment(.center).lineSpacing(3)
            }
            if let candidate = blockCandidate {
                VStack(spacing: 8) {
                    if didBlock {
                        Label("\(candidate.name) is blocked", systemImage: "hand.raised.fill")
                            .font(VType.body(14, .semibold)).foregroundStyle(Palette.spruce.base)
                    } else {
                        ClayButton("Block \(candidate.name)", systemImage: "hand.raised.fill",
                                   kind: .ghost, fullWidth: true) {
                            Task {
                                if await moderation.block(uid: candidate.uid, displayName: candidate.name) {
                                    withAnimation { didBlock = true }
                                    Haptics.success()
                                }
                            }
                        }
                        Text("You won't see each other's posts, events or RSVPs.")
                            .font(VType.body(12)).foregroundStyle(Palette.inkFaint)
                    }
                }
                .padding(.top, Spacing.sm)
            }
            Text("Questions about a decision? \(ModerationService.contactEmail)")
                .font(VType.body(12)).foregroundStyle(Palette.inkFaint)
                .multilineTextAlignment(.center)
            ClayButton("Done", kind: .spruce, fullWidth: true) { dismiss() }
        }
        .frame(maxWidth: .infinity)
    }

    private func submit() {
        guard let reason, !isSubmitting else { return }
        isSubmitting = true
        Task {
            let result = await moderation.report(target, id: targetID, reason: reason, details: details)
            isSubmitting = false
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { outcome = result }
            if result == .filed {
                Haptics.success()
                AccessibilityNotification.Announcement("Report sent. Reviewed within 24 hours.").post()
            }
        }
    }
}

// MARK: - Report / block menu
//
// The three-dot affordance every piece of user content carries. Dropping it on a
// view gives the content a Report action and, when we know the author, a Block
// action — and never shows either on the user's own content.

struct ContentActionsMenu: View {
    let target: ReportTarget
    let targetID: String
    let targetLabel: String
    var author: (uid: String, name: String)? = nil
    @Environment(ModerationService.self) private var moderation
    @Environment(AuthService.self) private var authService
    @State private var showReport = false
    @State private var showBlockConfirm = false

    private var isOwn: Bool { author?.uid != nil && author?.uid == authService.currentUser?.uid }

    var body: some View {
        if !isOwn {
            Menu {
                Button(role: .destructive) { showReport = true } label: {
                    Label("Report \(targetLabel)", systemImage: "flag")
                }
                if let author, !moderation.isBlocked(author.uid) {
                    Button(role: .destructive) { showBlockConfirm = true } label: {
                        Label("Block \(author.name)", systemImage: "hand.raised")
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Palette.inkFaint)
                    .frame(width: 44, height: 44)   // a11y hit target
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("More options")
            .accessibilityHint("Report or block.")
            .sheet(isPresented: $showReport) {
                ReportSheet(target: target, targetID: targetID, targetLabel: targetLabel, blockCandidate: author)
            }
            .confirmationDialog("Block \(author?.name ?? "this person")?",
                                isPresented: $showBlockConfirm, titleVisibility: .visible) {
                Button("Block", role: .destructive) {
                    guard let author else { return }
                    Task { _ = await moderation.block(uid: author.uid, displayName: author.name); Haptics.success() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You won't see each other's posts, events or RSVPs. You can unblock from Profile › Safety.")
            }
        }
    }
}

#Preview {
    ReportSheet(target: .post, targetID: "preview", targetLabel: "this post",
                blockCandidate: (uid: "u1", name: "Sam"))
        .environment(ModerationService())
}
