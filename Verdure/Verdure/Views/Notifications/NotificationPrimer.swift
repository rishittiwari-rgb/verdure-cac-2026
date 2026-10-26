import SwiftUI

// MARK: - Permission priming
//
// iOS gives an app ONE system notification prompt, ever. A denial cannot be
// reversed in-app; the user has to find it in Settings, which effectively
// nobody does. So the system prompt is a resource you get to spend once.
//
// This sheet is what gets spent first. It costs nothing to show, it can be
// declined without consequence, and it is only presented after a moment that
// has already demonstrated why push would be useful — never at first launch,
// where the honest answer to "allow notifications?" is "from whom, about what?"
//
// The rule enforced here: the system prompt is requested ONLY from the primary
// button of this sheet. "Not now" never touches it, so a user who declines
// keeps the prompt available for later.

struct NotificationPrimer: View {

    enum Trigger: String, Identifiable {
        var id: String { rawValue }

        case firstSave = "first_save"
        case firstCheckIn = "first_checkin"
        case firstRSVP = "first_rsvp"

        var headline: String {
            switch self {
            case .firstSave:    return "Want to know when friends are going?"
            case .firstCheckIn: return "Nice one. Want the next one found for you?"
            case .firstRSVP:    return "We'll remind you — if you want."
            }
        }
        var detail: String {
            switch self {
            case .firstSave:
                return "We'll tell you when someone you follow RSVPs to an event you saved. That's it."
            case .firstCheckIn:
                return "A couple of times a week we'll send a short list of things near you worth going to."
            case .firstRSVP:
                return "A nudge before it starts, and a heads-up if a friend is going too."
            }
        }
    }

    let trigger: Trigger
    var onDecision: (Bool) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var working = false

    var body: some View {
        VStack(spacing: Spacing.lg) {
            ClayIconTile(systemImage: "bell.badge.fill", kind: .teal, size: 64, radius: Radius.md)
                .padding(.top, Spacing.xl)

            VStack(spacing: Spacing.sm) {
                Text(trigger.headline)
                    .font(VType.scaledDisplay(24))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.ink)
                Text(trigger.detail)
                    .font(VType.scaledBody(15))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.inkSoft)
            }
            .padding(.horizontal, Spacing.lg)

            // The promise has to be specific, and it has to be one we keep. The
            // server enforces this cap — see MAX_PUSH_PER_WEEK.
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.spruce.base)
                Text("Never more than twice a week. Quiet overnight.")
                    .font(VType.scaledBody(13, .medium))
                    .foregroundStyle(Palette.inkSoft)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(ClayBackground(style: .inset, radius: Radius.chip))
            .accessibilityElement(children: .combine)

            Spacer(minLength: 0)

            VStack(spacing: Spacing.sm) {
                VerdureButton(title: working ? "Opening…" : "Turn on notifications", style: .primary) {
                    guard !working else { return }
                    working = true
                    Task {
                        // The ONLY place the app asks iOS. See the note above.
                        await NotificationManager.shared.requestPermission()
                        Analytics.log(event: .pushPrimerAccepted, params: [
                            "trigger": trigger.rawValue,
                            "granted": NotificationManager.shared.permissionGranted,
                        ])
                        Self.markPrimed()
                        onDecision(NotificationManager.shared.permissionGranted)
                        dismiss()
                    }
                }
                .disabled(working)

                Button {
                    // Deliberately does NOT consume the system prompt. The user
                    // can be asked again from Settings whenever they're ready.
                    Self.markPrimed()
                    onDecision(false)
                    dismiss()
                } label: {
                    Text("Not now")
                        .font(VType.scaledBody(15, .medium))
                        .foregroundStyle(Palette.inkSoft)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .accessibilityHint("Keeps notifications off. You can turn them on later in Settings.")
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(VerdureBackground())
    }

    // MARK: Showing it at most once

    private static let primedKey = "notificationPrimerShown"

    static func markPrimed() {
        UserDefaults.standard.set(true, forKey: primedKey)
    }

    /// Should we prime now?
    ///
    /// Only when we have never primed before AND iOS has not already been asked
    /// — re-priming someone who already granted is noise, and re-priming
    /// someone who already denied cannot help, because the second
    /// `requestAuthorization` call returns instantly without showing anything.
    static func shouldPrime(authorizationDetermined: Bool) -> Bool {
        !UserDefaults.standard.bool(forKey: primedKey) && !authorizationDetermined
    }
}
