import SwiftUI
import FirebaseCore
#if DEBUG
import FirebaseFirestore
import FirebaseAuth
import FirebaseFunctions
import FirebaseStorage
#endif

@main
struct VerdureApp: App {
    private let unitTestHost: Bool
    // Required for remote push: SwiftUI exposes no hook for the APNs device
    // token callback, and FCM can't route to a token it never sees.
    @UIApplicationDelegateAdaptor(VerdureAppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        // UI tests: start from the app's stored defaults as a reinstall would leave them,
        // so onboarding can complete for real (a `-hasCompletedOnboarding` launch argument
        // would pin the value and swallow the write that ends onboarding).
        if UserDefaults.standard.bool(forKey: "QAFreshInstall"), let bundleID = Bundle.main.bundleIdentifier {
            UserDefaults.standard.removePersistentDomain(forName: bundleID)
        }
        unitTestHost = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            NSClassFromString("XCTestCase") != nil
        #else
        unitTestHost = false
        #endif
        FirebaseApp.configure()
        #if DEBUG
        // Unit-test hosts always stay local. Device QA is explicit opt-in;
        // all four services use the same LAN host, never a mixed live/local stack.
        let qaEmulator = unitTestHost || QAData.offline || UserDefaults.standard.bool(forKey: "QAUseFirestoreEmulator")
        if qaEmulator {
            NetworkStatus.shared.forceOfflineForTesting = UserDefaults.standard.bool(forKey: "QAForceOffline")
            let host = unitTestHost ? "127.0.0.1" :
                (UserDefaults.standard.string(forKey: "QAEmulatorHost") ?? "127.0.0.1")
            let firestore = Firestore.firestore()
            firestore.useEmulator(withHost: host, port: 8899)
            // Firebase's iOS useEmulator sets the host but does not disable
            // TLS. The local Firestore emulator serves plaintext gRPC.
            let settings = firestore.settings
            settings.isSSLEnabled = false
            settings.cacheSettings = MemoryCacheSettings()
            firestore.settings = settings
            Auth.auth().useEmulator(withHost: host, port: 9099)
            // Actual SDK sign-out for repeatable guest-entry UI tests. Only
            // available in DEBUG and inside the explicit local emulator path.
            if UserDefaults.standard.bool(forKey: "QAResetAuth") { try? Auth.auth().signOut() }
            Functions.functions().useEmulator(withHost: host, port: 5002)
            Storage.storage().useEmulator(withHost: host, port: 9199)
            print("[Local QA] Auth/Firestore/Functions/Storage → \(host); unit-test host: \(unitTestHost)")
        }
        CrashReporting.configure(unitTestHost: unitTestHost, localEmulator: qaEmulator)
        if !qaEmulator { PushService.shared.start() }
        #else
        CrashReporting.configure(unitTestHost: false, localEmulator: false)
        PushService.shared.start()
        #endif
        if !unitTestHost { LivePartnerAlerts.shared.start() }
    }

    var body: some Scene {
        WindowGroup {
            if unitTestHost { Color.clear } else { RootView() }
        }
    }
}

/// Root view — owns app-wide state and drives the color scheme. Keeping the
/// @AppStorage here (in a View, not the App struct) makes the light/dark
/// toggle update reliably and apply at launch.
struct RootView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @AppStorage("prefersDarkMode") private var prefersDarkMode = false
    @Environment(\.scenePhase) private var scenePhase

    @State private var gameState = GameStateManager()
    @State private var locationManager = LocationManager()
    @State private var authService = AuthService()
    @State private var firestoreService = FirestoreService()
    @State private var functionsService = FunctionsService()
    @State private var placesService = PlacesAPIService()
    @State private var eventsService = EventsAPIService()
    @State private var storeService = StoreService()
    @State private var moderationService = ModerationService()
    @State private var socialService = SocialService()
    @State private var economyService = EconomyService()
    @State private var partnerDiscovery = PartnerDiscoveryService()
    @State private var discoveryFilters = DiscoveryFilters()
    @State private var parkGuides = ParkGuideService()
    @State private var offlinePacks = OfflinePackService()
    private let network = NetworkStatus.shared
    @State private var dailyGemFact: GemFact?

    var body: some View {
        Group {
            if hasCompletedOnboarding {
                MainTabView()
                    .environment(gameState)
                    .environment(locationManager)
                    .environment(authService)
                    .environment(firestoreService)
                    .environment(placesService)
                    .environment(eventsService)
                    .environment(storeService)
                    .environment(moderationService)
                    .environment(socialService)
                    .environment(economyService)
                    .environment(partnerDiscovery)
                    .environment(discoveryFilters)
                    .environment(parkGuides)
                    .environment(offlinePacks)
                    .onAppear {
                        if authService.isAuthStateResolved { offlinePacks.connect(authService.currentUser?.uid); economyService.connect(authService.currentUser?.uid); LivePartnerAlerts.shared.connect(authService.currentUser?.uid) }
                        locationManager.requestPermission()
                        connectServicesIfNeeded()
                        gameState.recordActiveDay()   // real daily streak
                        checkDailyGem()
                        if NotificationManager.shared.enabled {
                            Task { await NotificationManager.shared.requestPermission() }
                        }
                    }
                    .onChange(of: authService.isAuthenticated) { _, isAuth in
                        if isAuth {
                            connectServicesIfNeeded()
                            checkDailyGem()
                        } else {
                            gameState.disconnectCloud()
                            moderationService.clearLocal()
                            socialService.clearLocal()
                        }
                    }
                    .onChange(of: authService.signupProfileSavedAt) { _, saved in
                        guard saved != nil else { return }
                        Task { await eventsService.refresh(around: locationManager.userCoordinate) }
                    }
                    .onChange(of: authService.currentUser?.uid) { _, uid in
                        if authService.isAuthStateResolved { offlinePacks.connect(uid); economyService.connect(uid); LivePartnerAlerts.shared.connect(uid); refreshOfflinePacks() }
                    }
                    .onChange(of: authService.isAuthStateResolved) { _, resolved in
                        if resolved { offlinePacks.connect(authService.currentUser?.uid); economyService.connect(authService.currentUser?.uid); LivePartnerAlerts.shared.connect(authService.currentUser?.uid); refreshOfflinePacks() }
                    }
                    .onChange(of: network.isWiFi) { _, wifi in
                        if wifi && scenePhase == .active { refreshOfflinePacks() }
                    }
                    .onChange(of: scenePhase) { _, phase in
                        guard phase == .active else { return }
                        if authService.isAuthStateResolved { LivePartnerAlerts.shared.connect(authService.currentUser?.uid) }
                        gameState.recordActiveDay()   // streak counts foregrounds across days
                        // First foreground of a new day → show the Daily Gem.
                        checkDailyGem()
                        partnerDiscovery.beginSession()
                        Task { await partnerDiscovery.refresh(around: locationManager.userLocation) }
                        refreshOfflinePacks()
                        if economyService.hasLoaded { Task { await economyService.refresh() } }
                        // Retry place-collection ops only; attendance is never queued.
                        Task { await gameState.flushPendingOps() }
                    }
                    .fullScreenCover(item: $dailyGemFact) { fact in
                        DailyGemView(fact: fact) { dailyGemFact = nil }
                    }
            } else {
                OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                    .environment(authService)
                    .environment(discoveryFilters)
            }
        }
        .preferredColorScheme(prefersDarkMode ? .dark : .light)
        .onOpenURL { url in
            if let destination = DeepLinkRouter.parse(url.absoluteString) {
                DeepLinkRouter.shared.handle(destination)
            }
        }
    }

    private func refreshOfflinePacks() {
        guard network.isWiFi, !offlinePacks.entries.isEmpty else { return }
        Task {
            await placesService.fetchNearbyPlaces(around: locationManager.userCoordinate)
            await offlinePacks.refreshOnWiFi(places: placesService.places, savedPlaceIDs: gameState.savedPlaceIDs)
        }
    }

    /// Wire up Firestore sync + server callables and trigger initial fetches after auth.
    private func connectServicesIfNeeded() {
        if let user = authService.currentUser {
            gameState.connectCloud(firestore: firestoreService, functions: functionsService, userID: user.uid)
            Task { await moderationService.refreshBlocks() }
            Task { await socialService.refreshAll() }
            InitialLoad.start(around: locationManager.userCoordinate,
                              places: { await placesService.fetchNearbyPlaces(around: $0) },
                              events: { await eventsService.fetchNearbyEvents(around: $0) })
        }
    }

    /// Show the Daily Gem fun fact once per calendar day, on the first open of the day.
    private func checkDailyGem() {
        guard DailyGemStore.shouldShowSplash else { return }
        DailyGemStore.markSplashShown()
        let fact = DailyGemStore.todaysFact
        dailyGemFact = fact
        NotificationManager.shared.push(AppNotification(
            kind: .gem, title: "Today's Daily Gem",
            message: fact.text, timeAgo: "now"))
    }
}
