import SwiftUI

// MARK: - Legal (Terms of Use / Privacy Policy)
//
// Reachable from the paywall (3.1.2), the sign-up screen, and Profile › Settings.
// The full text ships in the binary so these links work with no network and
// before the website's domain resolves; the web versions are one tap away.

struct LegalView: View {
    enum Document: String, CaseIterable, Identifiable {
        case terms = "Terms of Use"
        case privacy = "Privacy Policy"
        var id: String { rawValue }
    }

    @State var document: Document = .terms
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private var sections: [Legal.Section] {
        document == .terms ? Legal.termsSections : Legal.privacySections
    }

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    picker
                    header
                    ForEach(sections) { section in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(section.title)
                                .font(VType.scaledDisplay(17, .semibold, relativeTo: .headline))
                                .foregroundStyle(Palette.ink)
                                .accessibilityAddTraits(.isHeader)
                            Text(section.body)
                                .font(VType.scaledBody(14, relativeTo: .body))
                                .foregroundStyle(Palette.inkSoft)
                                .lineSpacing(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    webLinks
                }
                .padding(Spacing.md)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Legal").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var picker: some View {
        HStack(spacing: 8) {
            ForEach(Document.allCases) { d in
                Button {
                    Haptics.soft()
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { document = d }
                } label: {
                    Text(d.rawValue)
                        .font(VType.body(13, .semibold))
                        .foregroundStyle(document == d ? Palette.spruce.onColor : Palette.inkSoft)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                }
                .buttonStyle(ClayPressButtonStyle(style: document == d ? .accent(.spruce) : .surface,
                                                  radius: Radius.chip, elevation: 0.5))
                .accessibilityAddTraits(document == d ? [.isSelected] : [])
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            KickerLabel(text: "Last updated \(Legal.lastUpdated)", dot: Palette.teal.base)
            Text(document.rawValue)
                .font(VType.display(28, .semibold)).foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var webLinks: some View {
        VStack(spacing: 10) {
            if document == .terms {
                ClayButton("Apple's Standard EULA", systemImage: "doc.text", kind: .ghost, fullWidth: true) {
                    openURL(Legal.appleStandardEULAURL)
                }
                ClayButton("Terms of Service on the web", systemImage: "safari", kind: .ghost, fullWidth: true) {
                    openURL(Legal.termsOfServiceURL)
                }
            } else {
                ClayButton("Privacy Policy on the web", systemImage: "safari", kind: .ghost, fullWidth: true) {
                    openURL(Legal.privacyPolicyURL)
                }
            }
            ClayButton("Contact support", systemImage: "questionmark.circle", kind: .ghost, fullWidth: true) {
                openURL(Legal.supportURL)
            }
        }
        .padding(.top, Spacing.sm)
    }
}

/// The compact "Terms of Use · Privacy Policy" line used under purchase buttons
/// and the sign-up form. Each half is its own tappable link (Apple checks this).
struct LegalLinksRow: View {
    var prefix: String? = nil
    @State private var showing: LegalView.Document? = nil

    var body: some View {
        VStack(spacing: 4) {
            if let prefix {
                Text(prefix).font(VType.body(11)).foregroundStyle(Palette.inkFaint)
                    .multilineTextAlignment(.center)
            }
            HStack(spacing: 6) {
                link(.terms)
                Text("·").font(VType.body(11)).foregroundStyle(Palette.inkFaint)
                link(.privacy)
            }
        }
        .sheet(item: $showing) { doc in LegalView(document: doc) }
    }

    private func link(_ doc: LegalView.Document) -> some View {
        Button { Haptics.soft(); showing = doc } label: {
            Text(doc.rawValue)
                .font(VType.body(11, .semibold)).foregroundStyle(Palette.spruce.base)
                .underline()
                .frame(minHeight: 30)   // comfortable hit target without visual bulk
        }
        .buttonStyle(.plain)
        .accessibilityLabel(doc.rawValue)
        .accessibilityHint("Opens the \(doc.rawValue).")
    }
}

#Preview {
    LegalView()
}
