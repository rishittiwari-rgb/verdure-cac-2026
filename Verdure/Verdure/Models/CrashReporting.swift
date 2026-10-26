import Foundation
import FirebaseCrashlytics

@MainActor enum CrashReporting {
    private(set) static var permitsCollection = false
    static var isEnabled: Bool { !UserDefaults.standard.bool(forKey: "crashReportsOptOut") }

    static func configure(unitTestHost: Bool, localEmulator: Bool) {
        // Collection defaults OFF in Info.plist, before Firebase initializes.
        // Simulator/tests never send diagnostics to the live Firebase project.
        #if targetEnvironment(simulator)
        permitsCollection = false
        #elseif DEBUG
        permitsCollection = !unitTestHost && UserDefaults.standard.bool(forKey: "QAEnableCrashReporting")
        #else
        permitsCollection = !unitTestHost && !localEmulator
        #endif
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(permitsCollection && isEnabled)
        if !isEnabled || !permitsCollection { Crashlytics.crashlytics().deleteUnsentReports() }
        // Deliberately no UID, email, prose, location or screen breadcrumbs.
    }
    static func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(!enabled, forKey: "crashReportsOptOut")
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(enabled && permitsCollection)
        if !enabled { Crashlytics.crashlytics().deleteUnsentReports() }
    }
    #if DEBUG
    static var canRunPhysicalQACrash: Bool {
        permitsCollection && isEnabled && UserDefaults.standard.bool(forKey: "QAExposeTestCrash")
    }
    static func runPhysicalQACrash() {
        guard canRunPhysicalQACrash else { return }
        fatalError("Verdure physical-device Crashlytics QA crash")
    }
    #endif
}
