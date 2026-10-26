import SwiftUI

/// Dedicated, dramatic sign-in / sign-up screen. 3D medallion hero, an
/// animated aurora, a clay form with staggered entrance. Used as the
/// onboarding finale and reachable on its own.
struct AuthView: View {
    @Environment(AuthService.self) private var authService
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var initialInterests: [String] = []
    var onSignupRejected: () -> Void = {}
    var onComplete: () -> Void

    @State private var isSignUp = false   // default to Sign In
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var birthYearText = ""
    @State private var acceptedBirthYear: Int?
    @State private var signupEnded = false
    @State private var ageError: String?
    @State private var isStudent = false
    @State private var school = ""
    @AppStorage("interestCategories") private var interestCategoriesRaw = ""
    @State private var isSubmitting = false
    @State private var appear = false
    @State private var auroraPhase: CGFloat = 0
    @State private var accountTypeRaw = AccountType.visitor.rawValue
    @State private var showVerification = false

    var body: some View {
        ZStack {
            aurora
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: Spacing.lg) {
                    hero
                    modeSwitch
                        .disabled(isSubmitting)
                    if isSignUp {
                        if signupEnded { signupEndedCard }
                        else if acceptedBirthYear == nil { ageCard }
                        else { accountTypeChooser.disabled(isSubmitting); formCard; guestRow }
                    } else { formCard; guestRow }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.top, 56)
                .padding(.bottom, Spacing.xxl)
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.8, dampingFraction: 0.78)) { appear = true }
            if !reduceMotion {
                withAnimation(.easeInOut(duration: 9).repeatForever(autoreverses: true)) { auroraPhase = 1 }
            }
        }
        // Organizer sign-up → verify, then proceed into the app regardless of outcome.
        .fullScreenCover(isPresented: $showVerification, onDismiss: { onComplete() }) {
            OrganizerVerificationView()
        }
    }

    // MARK: - Animated aurora background

    private var aurora: some View {
        ZStack {
            Palette.canvas
            AmbientGlow(color: Palette.teal.base.opacity(0.5), size: 420, opacity: 0.7)
                .offset(x: -150 + auroraPhase * 80, y: -300 + auroraPhase * 60)
            AmbientGlow(color: Palette.spruce.base.opacity(0.45), size: 380, opacity: 0.6)
                .offset(x: 160 - auroraPhase * 70, y: -180 + auroraPhase * 50)
            AmbientGlow(color: Palette.gold.base.opacity(0.3), size: 300, opacity: 0.5)
                .offset(x: 120 + auroraPhase * 60, y: 360 - auroraPhase * 40)
            SoftGrain()
        }
        .ignoresSafeArea()
    }

    // MARK: - Hero

    private var hero: some View {
        VStack(spacing: Spacing.md) {
            MedallionHero(size: 188, interactive: true)
                .scaleEffect(appear ? 1 : 0.6)
                .opacity(appear ? 1 : 0)
            VStack(spacing: 8) {
                Text("Verdure")
                    .font(VType.display(46, .bold))
                    .foregroundStyle(Palette.ink)
                Text(isSignUp ? "Create your account to start exploring."
                              : "Welcome back, explorer.")
                    .font(VType.body(15))
                    .foregroundStyle(Palette.inkSoft)
                    .animation(.easeInOut, value: isSignUp)
            }
            .opacity(appear ? 1 : 0)
            .offset(y: appear ? 0 : 14)
        }
    }

    // Birth year is held in view memory only. Account fields and preferences
    // are not shown or persisted until this neutral screen accepts the answer.
    private var ageCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("What year were you born?")
                .font(VType.display(24, .semibold)).foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
            Text("We use your birth year to apply age safeguards.")
                .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
            field(icon: "calendar", placeholder: "Birth year", text: $birthYearText, keyboard: .numberPad, autocap: false)
                .accessibilityIdentifier("signupBirthYear")
            if let ageError { Text(ageError).font(VType.body(13)).foregroundStyle(Palette.danger) }
            ClayButton("Continue", systemImage: "arrow.right", kind: .spruce, fullWidth: true) {
                switch AuthService.signupAgeDecision(birthYear: Int(birthYearText.trimmingCharacters(in: .whitespaces))) {
                case .invalid:
                    ageError = "Enter a valid birth year."
                case .under13:
                    birthYearText = ""; acceptedBirthYear = nil; ageError = nil
                    name = ""; email = ""; password = ""; school = ""; isStudent = false
                    signupEnded = true
                    onSignupRejected()
                case .eligible(let year):
                    acceptedBirthYear = year; birthYearText = ""; ageError = nil
                }
            }
            .accessibilityIdentifier("signupAgeContinue")
        }
        .padding(Spacing.lg)
        .background(ClayBackground(style: .surface, radius: Radius.lg, elevation: 1.2))
    }

    private var signupEndedCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Sign-up is unavailable.").font(VType.display(24, .semibold)).foregroundStyle(Palette.ink)
                .accessibilityIdentifier("signupEnded")
            Text("We haven’t created an account or saved your answer.")
                .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
        }
        .padding(Spacing.lg)
        .background(ClayBackground(style: .surface, radius: Radius.lg, elevation: 1.2))
    }

    // MARK: - Account type chooser (sign-up only)

    private var accountTypeChooser: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("I'M JOINING AS").font(VType.body(10, .bold)).tracking(1.4)
                .foregroundStyle(Palette.inkSoft).padding(.leading, 4)
            HStack(spacing: 12) {
                ForEach(AccountType.allCases) { type in
                    accountTypeCard(type)
                }
            }
        }
        .opacity(appear ? 1 : 0)
        .offset(y: appear ? 0 : 18)
    }

    private func accountTypeCard(_ type: AccountType) -> some View {
        let on = accountTypeRaw == type.rawValue
        return Button {
            Haptics.soft()
            withAnimation(.spring(response: 0.35)) { accountTypeRaw = type.rawValue }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: type.icon).font(.system(size: 20, weight: .bold))
                    .foregroundStyle(on ? Palette.spruce.onColor : Palette.spruce.base)
                Text(type.title).font(VType.display(16, .semibold))
                    .foregroundStyle(on ? Palette.spruce.onColor : Palette.ink)
                Text(type == .organizer ? "Host & create events" : "Discover & attend")
                    .font(VType.body(11, .medium))
                    .foregroundStyle(on ? Palette.spruce.onColor.opacity(0.8) : Palette.inkSoft)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
        }
        .buttonStyle(ClayPressButtonStyle(style: on ? .accent(.spruce) : .surface,
                                          radius: Radius.md, elevation: 0.6))
    }

    // MARK: - Sign in / up segmented switch (clay)

    private var modeSwitch: some View {
        HStack(spacing: 6) {
            segment("Sign In", on: !isSignUp) { withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { isSignUp = false; authService.clearError() } }
            segment("Sign Up", on: isSignUp) { withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { isSignUp = true; name = ""; email = ""; password = ""; authService.clearError() } }
        }
        .padding(5)
        .background(ClayBackground(style: .inset, radius: Radius.chip + 4))
        .opacity(appear ? 1 : 0)
        .offset(y: appear ? 0 : 18)
    }

    private func segment(_ title: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: { Haptics.soft(); action() }) {
            Text(title)
                .font(VType.body(14, .bold))
                .foregroundStyle(on ? Palette.spruce.onColor : Palette.inkSoft)
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .background(
                    Group {
                        if on { ClayBackground(style: .accent(.spruce), radius: Radius.chip, elevation: 0.5) }
                    }
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Form card

    private var formCard: some View {
        VStack(spacing: 14) {
            if isSignUp {
                field(icon: "person.fill", placeholder: "Your name", text: $name, content: .name)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            field(icon: "envelope.fill", placeholder: "Email address", text: $email,
                  content: .emailAddress, keyboard: .emailAddress, autocap: false)
            field(icon: "lock.fill", placeholder: "Password", text: $password, secure: true,
                  content: isSignUp ? .newPassword : .password)
            if isSignUp {
                Text("Birth year: \(acceptedBirthYear.map(String.init) ?? "")")
                    .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                Toggle("I'm a student", isOn: $isStudent)
                    .font(VType.body(14)).tint(Palette.spruce.base)
                if isStudent {
                    field(icon: "graduationcap.fill", placeholder: "School (optional)", text: $school)
                }
            }

            if let error = authService.errorMessage {
                Text(error).font(VType.body(12.5, .medium)).foregroundStyle(Palette.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            ClayButton(submitTitle, systemImage: isSubmitting ? nil : "arrow.right",
                       kind: .spruce, fullWidth: true) { submit() }
                .accessibilityIdentifier("authSubmit")
                .disabled(isSubmitting)
                .opacity(isSubmitting ? 0.6 : 1)
                .overlay { if isSubmitting { ProgressView().tint(Palette.spruce.onColor) } }

            LegalLinksRow(prefix: "By continuing you agree to Verdure's")
        }
        .padding(Spacing.lg)
        .background(ClayBackground(style: .surface, radius: Radius.lg, elevation: 1.2))
        .opacity(appear ? 1 : 0)
        .offset(y: appear ? 0 : 28)
        .blur(radius: appear ? 0 : 6)
    }

    private func field(icon: String, placeholder: String, text: Binding<String>, secure: Bool = false,
                       content: UITextContentType? = nil, keyboard: UIKeyboardType = .default,
                       autocap: Bool = true) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.spruce.base).frame(width: 22)
            Group {
                if secure { SecureField(placeholder, text: text) }
                else { TextField(placeholder, text: text) }
            }
            .font(VType.body(16)).foregroundStyle(Palette.ink)
            .textContentType(content).keyboardType(keyboard)
            .textInputAutocapitalization(autocap ? .sentences : .never)
            .autocorrectionDisabled(!autocap)
        }
        .padding(.vertical, 15).padding(.horizontal, 16)
        .background(ClayBackground(style: .inset, radius: Radius.sm))
    }

    // MARK: - Guest

    private var guestRow: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                Rectangle().fill(Palette.hairline).frame(height: 1)
                Text("or").font(VType.body(12, .medium)).foregroundStyle(Palette.inkFaint)
                Rectangle().fill(Palette.hairline).frame(height: 1)
            }
            Button(action: { Haptics.tap(); onComplete() }) {
                Text("Continue as guest")
                    .font(VType.body(15, .semibold)).foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity).padding(.vertical, 15)
            }
            .buttonStyle(ClayPressButtonStyle(style: .surface, radius: Radius.md))
        }
        .opacity(appear ? 1 : 0)
    }

    private var submitTitle: String {
        if isSubmitting { return isSignUp ? "Creating account…" : "Signing in…" }
        return isSignUp ? "Create Account" : "Sign In"
    }

    private func submit() {
        Haptics.tap()
        if isSignUp && (acceptedBirthYear == nil || signupEnded) { return }
        isSubmitting = true
        Task {
            do {
                if isSignUp {
                    try await authService.signUp(email: email.trimmingCharacters(in: .whitespaces),
                                                 password: password,
                                                 displayName: name.trimmingCharacters(in: .whitespaces),
                                                 birthYear: acceptedBirthYear!,
                                                 studentStatus: isStudent, school: school,
                                                 interests: initialInterests.isEmpty ? interestCategoriesRaw.split(separator: ",").map(String.init) : initialInterests)
                } else {
                    try await authService.signIn(email: email.trimmingCharacters(in: .whitespaces),
                                                 password: password)
                }
                await MainActor.run {
                    isSubmitting = false; Haptics.success()
                    if isSignUp { UserDefaults.standard.set(accountTypeRaw, forKey: "accountType") }
                    // Organizer sign-ups must verify before entering.
                    if isSignUp && accountTypeRaw == AccountType.organizer.rawValue {
                        showVerification = true
                    } else {
                        onComplete()
                    }
                }
            } catch {
                await MainActor.run { isSubmitting = false }
            }
        }
    }
}

#Preview {
    AuthView(onComplete: {}).environment(AuthService())
}
