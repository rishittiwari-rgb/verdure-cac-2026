import Foundation
import SwiftUI
import Observation
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions

// MARK: - Auth Service (Firebase Auth Wrapper)

@MainActor @Observable
final class AuthService {

    // MARK: - Published State

    var currentUser: VerdureUser?
    private(set) var isAuthStateResolved = false
    var isAuthenticated: Bool { currentUser != nil }
    var isLoading = false
    var errorMessage: String?
    var ageRegistrationPending = false
    /// Set once a new account's profile (interests, student status) and age band are stored.
    /// The auth listener fires at createUser, before either exists, so a feed ranked then
    /// would ignore the picks; RootView refetches on this.
    private(set) var signupProfileSavedAt: Date?

    // MARK: - Private

    private let userKey = "currentUserJSON"
    private var authStateHandle: AuthStateDidChangeListenerHandle?

    // MARK: - Init

    init() {
        listenForAuthChanges()
    }

    // MARK: - Auth State Listener

    private func listenForAuthChanges() {
        authStateHandle = Auth.auth().addStateDidChangeListener { [weak self] _, firebaseUser in
            Task { @MainActor in
                if let firebaseUser {
                    let user = VerdureUser(
                        uid: firebaseUser.uid,
                        email: firebaseUser.email ?? "",
                        displayName: firebaseUser.displayName ?? firebaseUser.email?.components(separatedBy: "@").first ?? "User",
                        joinDate: firebaseUser.metadata.creationDate ?? Date()
                    )
                    self?.currentUser = user
                    self?.persistUser(user)
                } else {
                    self?.currentUser = nil
                }
                self?.isAuthStateResolved = true
            }
        }
    }

    enum SignupAgeDecision: Equatable {
        case invalid
        case under13
        case eligible(Int)
    }

    static func signupAgeDecision(birthYear: Int?, currentYear: Int = Calendar.current.component(.year, from: Date())) -> SignupAgeDecision {
        guard let birthYear, birthYear >= currentYear - 110, birthYear <= currentYear else { return .invalid }
        return currentYear - birthYear < 13 ? .under13 : .eligible(birthYear)
    }

    // MARK: - Auth Methods

    /// Sign up with email, password, and display name.
    func signUp(email: String, password: String, displayName: String, birthYear: Int,
                studentStatus: Bool, school: String, interests: [String] = []) async throws {
        isLoading = true
        errorMessage = nil

        // Reject age before processing credentials or invoking any SDK/network.
        guard case .eligible = Self.signupAgeDecision(birthYear: birthYear) else {
            isLoading = false
            errorMessage = "Sign-up is unavailable for this birth year."
            throw AuthError.unknown(errorMessage!)
        }

        // Sanitize inputs
        let cleanEmail = Self.sanitize(email, maxLength: 320).lowercased()
        let cleanName = Self.sanitize(displayName, maxLength: 100)
        let cleanSchool = studentStatus ? Self.sanitize(school, maxLength: 100) : ""
        let cleanInterests = Array(Set(interests.map { Self.sanitize($0, maxLength: 40) }
            .filter { !$0.isEmpty })).sorted().prefix(20)

        // Validate email format
        guard !cleanEmail.isEmpty, Self.isValidEmail(cleanEmail) else {
            isLoading = false
            errorMessage = "Please enter a valid email address."
            throw AuthError.invalidEmail
        }
        // Validate password strength.
        //
        // 8 rather than Firebase's 6-character floor: these accounts hold a
        // points balance redeemable for real gift cards, so a credential-
        // stuffing hit has cash value. 8 is also the NIST floor. We deliberately
        // do NOT impose symbol/case composition rules — they push people toward
        // "Passw0rd!" and are no longer recommended; length is what matters.
        guard password.count >= 8, password.count <= 128 else {
            isLoading = false
            errorMessage = "Password must be at least 8 characters."
            throw AuthError.weakPassword
        }
        // Reject the handful of passwords that dominate credential-stuffing
        // lists. Cheap, and it costs a genuine user nothing.
        let normalized = password.lowercased()
        let commonPasswords: Set<String> = [
            "password", "password1", "password123", "12345678", "123456789",
            "qwerty123", "letmein1", "iloveyou", "welcome1", "abc12345",
            "verdure1", "verdure123",
        ]
        guard !commonPasswords.contains(normalized) else {
            isLoading = false
            errorMessage = "That password is too common. Please choose another."
            throw AuthError.weakPassword
        }
        // Validate display name
        guard !cleanName.isEmpty else {
            isLoading = false
            errorMessage = "Please enter your name."
            throw AuthError.missingName
        }

        do {
            let result = try await Auth.auth().createUser(withEmail: cleanEmail, password: password)
            let uid = result.user.uid
            let changeRequest = result.user.createProfileChangeRequest()
            changeRequest.displayName = cleanName
            try await changeRequest.commitChanges()
            // Establish a complete profile before the server records the private
            // age band. If the network fails afterward, unknown age stays in the
            // restricted state and the member can retry from Friends.
            try await Firestore.firestore().collection("users").document(uid).setData([
                "displayName": cleanName,
                "email": cleanEmail,
                "studentStatus": studentStatus,
                "school": cleanSchool,
                "interests": Array(cleanInterests),
                "createdAt": FieldValue.serverTimestamp(),
                "lastUpdated": FieldValue.serverTimestamp(),
            ], merge: true)
            do {
                _ = try await Functions.functions().httpsCallable("registerAgeBand")
                    .call(["birthYear": birthYear])
                ageRegistrationPending = false
            } catch {
                ageRegistrationPending = true
            }
            signupProfileSavedAt = Date()

            let user = VerdureUser(
                uid: uid,
                email: cleanEmail,
                displayName: cleanName,
                joinDate: Date()
            )

            self.currentUser = user
            self.isLoading = false
            self.persistUser(user)
            // Attach this device's push token to the account that just signed in.
            // FCM only volunteers a token at launch, so without this an existing
            // install never registers for any account but the first.
            await PushService.shared.registerCurrentTokenForSignedInUser()
        } catch {
            self.isLoading = false
            self.errorMessage = Self.mapFirebaseError(error as NSError)
            throw AuthError.unknown(self.errorMessage ?? error.localizedDescription)
        }
    }

    func retryAgeRegistration(birthYear: Int) async -> Bool {
        do {
            _ = try await Functions.functions().httpsCallable("registerAgeBand")
                .call(["birthYear": birthYear])
            ageRegistrationPending = false
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    /// Sign in with email and password.
    func signIn(email: String, password: String) async throws {
        isLoading = true
        errorMessage = nil

        let cleanEmail = Self.sanitize(email, maxLength: 320).lowercased()

        guard !cleanEmail.isEmpty, Self.isValidEmail(cleanEmail) else {
            isLoading = false
            errorMessage = "Please enter a valid email address."
            throw AuthError.invalidEmail
        }
        guard !password.isEmpty, password.count <= 128 else {
            isLoading = false
            errorMessage = "Please enter your password."
            throw AuthError.emptyPassword
        }

        do {
            let result = try await Auth.auth().signIn(withEmail: cleanEmail, password: password)
            let firebaseUser = result.user
            let uid = firebaseUser.uid
            let userEmail = firebaseUser.email ?? email
            let name = firebaseUser.displayName ?? email.components(separatedBy: "@").first ?? "User"
            let created = firebaseUser.metadata.creationDate ?? Date()

            let user = VerdureUser(
                uid: uid,
                email: userEmail,
                displayName: name,
                joinDate: created
            )

            self.currentUser = user
            self.isLoading = false
            self.persistUser(user)
            // Attach this device's push token to the account that just signed in.
            // FCM only volunteers a token at launch, so without this an existing
            // install never registers for any account but the first.
            await PushService.shared.registerCurrentTokenForSignedInUser()
        } catch {
            self.isLoading = false
            self.errorMessage = Self.mapFirebaseError(error as NSError)
            throw AuthError.unknown(self.errorMessage ?? error.localizedDescription)
        }
    }

    /// Sign out the current user.
    func signOut() {
        // Before the sign-out, while the uid is still resolvable: detach this
        // device's push token from the account. Otherwise the next person to use
        // the phone keeps receiving notifications meant for the previous user.
        PushService.shared.unregisterCurrentDeviceOnSignOut()

        do {
            try Auth.auth().signOut()
        } catch {
            errorMessage = "Failed to sign out: \(error.localizedDescription)"
        }

        currentUser = nil
        errorMessage = nil
        UserDefaults.standard.removeObject(forKey: userKey)
    }

    /// Clear any displayed error.
    func clearError() {
        errorMessage = nil
    }

    // MARK: - Firebase Error Mapping

    /// Map Firebase auth errors to user-facing text.
    ///
    /// ACCOUNT ENUMERATION: messages must never reveal whether an address is
    /// registered. "No account found with this email" vs "Incorrect password"
    /// turns the sign-in form into a membership oracle — anyone can test an
    /// address and read the answer off which error comes back. That's the same
    /// class of leak the website's schema removes by making `join_waitlist()`
    /// return void so a duplicate is indistinguishable from a new signup.
    ///
    /// So every "this address does / doesn't exist and this password is / isn't
    /// right" outcome collapses into ONE message. Errors that describe the
    /// user's own input (malformed email, weak password) stay specific, because
    /// they say nothing about who else has an account.
    ///
    /// State of play (verified 2026-07-28): the project already has Firebase's
    /// Email Enumeration Protection on (`enableImprovedEmailPrivacy: true`), so
    /// the SERVER collapses sign-in failures into one generic code. Two gaps
    /// remain, which this closes:
    ///   • sign-up still returns EMAIL_EXISTS — unavoidable server-side, since
    ///     a duplicate account can't be silently created;
    ///   • the old `default:` branch echoed Firebase's raw description, which
    ///     names the exact condition and reopened the oracle underneath.
    /// It's also the control that holds if that console setting is switched off.
    private static func mapFirebaseError(_ error: NSError) -> String {
        switch error.code {
        // ── Indistinguishable by design ──
        // Phrased to fit BOTH forms: on sign-in it reads as bad credentials, on
        // sign-up as "that didn't work, maybe you're already registered" — a
        // nudge that's equally true whether or not the address exists, so it
        // guides the user without confirming anything about them.
        case AuthErrorCode.emailAlreadyInUse.rawValue,
             AuthErrorCode.userNotFound.rawValue,
             AuthErrorCode.wrongPassword.rawValue,
             AuthErrorCode.invalidCredential.rawValue:
            return "We couldn't complete that. Double-check your email and password — and if you've been here before, try signing in instead."

        // ── Safe to be specific: about the input, not about other accounts ──
        case AuthErrorCode.invalidEmail.rawValue:
            return "Invalid email address."
        case AuthErrorCode.weakPassword.rawValue:
            return "Password is too weak. Use at least 8 characters."
        case AuthErrorCode.networkError.rawValue:
            return "Network error. Please check your connection."
        case AuthErrorCode.tooManyRequests.rawValue:
            return "Too many attempts. Please try again later."
        default:
            // Never surface a raw Firebase description: they name the exact
            // condition (e.g. "There is no user record...") and would reopen
            // the oracle through the default branch.
            return "Something went wrong. Please try again."
        }
    }

    // MARK: - Input Sanitization

    /// Strip control characters, trim whitespace, enforce max length.
    private static func sanitize(_ input: String, maxLength: Int) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleaned = trimmed.unicodeScalars.filter { scalar in
            !CharacterSet.controlCharacters.contains(scalar)
        }
        let result = String(String.UnicodeScalarView(cleaned))
        return String(result.prefix(maxLength))
    }

    /// Validate email format using a strict regex.
    private static func isValidEmail(_ email: String) -> Bool {
        let pattern = #"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"#
        return email.range(of: pattern, options: .regularExpression) != nil
    }

    // MARK: - Session Persistence (local backup)

    private func persistUser(_ user: VerdureUser) {
        if let data = try? JSONEncoder().encode(user) {
            UserDefaults.standard.set(data, forKey: userKey)
        }
    }
}

// MARK: - User Model

struct VerdureUser: Codable, Identifiable {
    let uid: String
    let email: String
    let displayName: String
    let joinDate: Date

    var id: String { uid }

    var initials: String {
        let parts = displayName.split(separator: " ")
        if parts.count >= 2 {
            return String(parts[0].prefix(1) + parts[1].prefix(1)).uppercased()
        }
        return String(displayName.prefix(2)).uppercased()
    }

    var joinDateFormatted: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM yyyy"
        return formatter.string(from: joinDate)
    }
}

// MARK: - Auth Errors

enum AuthError: LocalizedError {
    case invalidEmail
    case weakPassword
    case missingName
    case emptyPassword
    case networkError
    case userNotFound
    case wrongPassword
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .invalidEmail: return "Invalid email address."
        case .weakPassword: return "Password must be at least 8 characters."
        case .missingName: return "Please enter your name."
        case .emptyPassword: return "Please enter your password."
        case .networkError: return "Network error. Please try again."
        case .userNotFound: return "No account found with this email."
        case .wrongPassword: return "Incorrect password."
        case .unknown(let msg): return msg
        }
    }
}
