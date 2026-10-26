import Foundation

// MARK: - Legal surfaces
//
// App Review 3.1.2 requires an auto-renewable subscription to link to its Terms
// of Use (EULA) and Privacy Policy INSIDE the app, and 5.1.1 requires the policy
// to be reachable from the app. Both documents ship in the binary so the links
// remain available even when a website route is unavailable. The active
// website is Verdure-website--main. Terms, support and corrected privacy are
// built locally; this change does not publish the website.

enum Legal {
    /// Canonical website domain. New local routes still require publication
    /// before release; bundled documents remain available offline.
    static let siteBase = "https://verdure-app.com"

    /// Apple's standard Licensed Application End User License Agreement — the
    /// EULA declared for the app in App Store Connect, and always reachable.
    static let appleStandardEULAURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!
    static var termsOfServiceURL: URL { websiteURL(path: "terms") }
    static var supportURL: URL { websiteURL(path: "support") }
    static var privacyPolicyURL: URL { websiteURL(path: "privacy") }

    private static func websiteURL(path: String) -> URL {
        #if DEBUG
        // Explicit local QA only. Release always uses the canonical domain.
        // This lets the restored app link resolve against the unpublished
        // local website without a deploy or changing production configuration.
        if UserDefaults.standard.bool(forKey: "QAUseFirestoreEmulator"),
           let value = UserDefaults.standard.string(forKey: "QAWebsiteBaseURL"),
           let base = URL(string: value), let host = base.host,
           base.scheme == "http", base.user == nil, base.password == nil,
           base.query == nil, base.fragment == nil, base.path.isEmpty || base.path == "/" {
            let labels = host.split(separator: ".", omittingEmptySubsequences: false)
            let parts = labels.compactMap { Int($0) }
            let privateIPv4 = labels.count == 4 && parts.count == 4 && parts.allSatisfy { (0...255).contains($0) } &&
                (parts[0] == 10 || parts[0] == 127 || (parts[0] == 192 && parts[1] == 168) ||
                 (parts[0] == 172 && (16...31).contains(parts[1])))
            if host == "localhost" || host == "::1" || privateIPv4 { return base.appendingPathComponent(path) }
        }
        #endif
        return URL(string: siteBase)!.appendingPathComponent(path)
    }

    /// The single source of truth for the support address. Declared HERE rather
    /// than on ModerationService: that type is @MainActor, so a nonisolated
    /// static like this one cannot read from it (it did not compile).
    static let contactEmail = "support@verdure-app.com"
    static let lastUpdated = "October 21, 2026"

    /// Subscription facts, stated once so the paywall, the terms and the store
    /// listing cannot disagree. Prices shown to the user come from StoreKit.
    enum Subscription {
        static let name = "Verdure+"
        static let monthlyLength = "1 month"
        static let yearlyLength = "1 year"
        /// $49.99 vs 12 × $4.99 = $59.88 → 16.5%, rounded to 17. Never claim more.
        static let yearlySavingsPercent = 17
    }

    // MARK: - Terms of Use

    struct Section: Identifiable {
        let title: String
        let body: String
        var id: String { title }
    }

    static let termsSections: [Section] = [
        Section(title: "Agreement",
                body: "These Terms of Use (\"Terms\") are an agreement between you and Verdure (\"we\", \"us\") covering the Verdure iOS app and related services. By creating an account, browsing as a guest, or subscribing, you agree to them. Apple's standard Licensed Application End User License Agreement also applies to the app; where the two conflict, Apple's terms govern the license and these Terms govern everything else."),
        Section(title: "Who can use Verdure",
                body: "You must be at least 13 years old to create an account. If you are under 18, use Verdure with a parent or guardian's permission. You are responsible for keeping your sign-in details private and for everything done through your account."),
        Section(title: "Verdure+ subscription",
                body: "Verdure+ is an optional auto-renewable subscription available as a 1 month plan or a 1 year plan. The price and subscription length are shown in the app before you buy and are charged to your Apple ID at confirmation of purchase. The subscription renews automatically at the same price and length unless you turn off auto-renew at least 24 hours before the current period ends. You can manage or cancel it in your Apple ID account settings; cancelling stops future renewals but does not refund the current period, and refund requests are handled by Apple. Member benefits are those listed on the paywall in the version of the app you are using — nothing else is promised. If a benefit is withdrawn we will say so in the app before your next renewal."),
        Section(title: "Points and rewards",
                body: "Points are earned by verified activity in Verdure — checking in at events with your location and a proof photo, and collecting places you physically visit. Points have no cash value, cannot be bought, sold or transferred, and are not your property. Daily earning is capped, and cash gift-card redemptions are limited to a rolling twelve-month value per member and a monthly programme-wide budget; when either limit is reached the app tells you and redemption pauses. Partner perks are fulfilled by the partner on the partner's terms. We may withhold, reverse or cancel points and redemptions obtained through fraud, misrepresentation, automation or abuse, and may close accounts that do so. Rewards are delivered by email to the address on your account and may take several business days."),
        Section(title: "Your content and conduct",
                body: "You own what you post. By posting you give us a licence to show it to other Verdure users as part of the service. Don't post anything unlawful, harassing, hateful, sexually explicit, dangerous, deceptive, or that you don't have the right to share. Every post, event and profile can be reported; reports are reviewed by a person within 24 hours, content reported by several people is hidden immediately, and unreviewed reports lead to removal at the 24-hour mark. You can block any member. We may remove content or suspend accounts that break these rules. Questions about a moderation decision: use the support form at https://verdure-app.com/support."),
        Section(title: "Events and safety",
                body: "Events are published by community organizers or gathered from public calendars and ticketing feeds. We don't run them and can't guarantee they take place as listed. Use your own judgement about where you go and who you meet, especially outdoors. Never trespass, and follow the rules of the venue or park."),
        Section(title: "Your account",
                body: "Delete your app account from Profile › Settings › Delete Account. Account-owned data is removed by a server-side process; a failed request can be retried. Sent gift cards are unaffected and financial records are anonymized for accounting. Website requests and staff audit records are separate and follow the Privacy Policy. We may suspend or close accounts for abuse."),
        Section(title: "Disclaimers and liability",
                body: "Verdure is provided \"as is\". To the fullest extent permitted by law we disclaim warranties of any kind and are not liable for indirect, incidental or consequential damages, or for any loss arising from events, places or people you encounter through the app. Nothing here limits rights you have under consumer law that cannot be excluded."),
        Section(title: "Changes",
                body: "We may update these Terms. If a change is material we will tell you in the app before it takes effect, and continuing to use Verdure afterwards means you accept it. The date at the top is the current version."),
        Section(title: "Contact",
                body: "Verdure — support requests: https://verdure-app.com/support."),
        Section(title: "Website requests and partnerships",
                body: "Support and partnership interest forms send a request to our team for review. Submission does not approve an organizer, activate a merchant offer or create a business agreement. A merchant offer requires a recorded written confirmation before activation. Do not submit information you are not authorized to share."),
        Section(title: "Data and acknowledgements",
                body: "Places: © OpenStreetMap contributors, available under the Open Database License (openstreetmap.org/copyright). Weather: data by Open-Meteo.com, licensed under CC BY 4.0 (creativecommons.org/licenses/by/4.0); Verdure shows a short summary of it. Parks: National Park Service and Recreation.gov data, and the official park sources credited on each park guide. Events: public calendars from San José Public Library, Santa Clara County Library District, Palo Alto City Library, Alameda County Library, San Mateo County Libraries, Mountain View Public Library, San José State University, Stanford University, Santa Clara University, Midpeninsula Regional Open Space District, the City of San José, and other public calendars Verdure finds automatically. Fonts: Fredoka and Rubik, SIL Open Font License 1.1. Built with Firebase (Apache License 2.0)."),
    ]

    // MARK: - Privacy Policy (mirrors src/lib/legal.ts on the website)

    static let privacySections: [Section] = [
        Section(title: "The short version",
                body: "Verdure uses your account, activity and optional location information to help you discover places and events, make plans, earn points and claim rewards. We do not sell personal information or track you across other apps or websites. Local partner offers are labelled and do not change organic recommendation order."),
        Section(title: "Accounts and preferences",
                body: "In the app we store your email address, display name and birth year for age safeguards. Firebase Authentication handles passwords. Optional information includes student status, school, interests, children’s ages, accessibility needs, usual transport and preferred distance. We store points, badges, streaks, collections, saved and viewed events, recommendation feedback and subscription status. Apple handles subscription payments; we receive transaction identifiers and entitlement information, not payment card details or billing or shipping addresses."),
        Section(title: "Location, photos and social activity",
                body: "With your permission, we use location while you use the app to show nearby places, events and partner offers, and to verify place collection and event check-ins. Check-in coordinates and proof photos you select are stored as attendance evidence. We do not continuously collect background location. Adults can separately opt in to promotional nearby-deal notifications. That optional feature requests Always location only during its consent flow, monitors up to 20 nearby partners using iOS regions and significant location changes, and uses a recent location for server proximity checks without storing that sample or sharing it with partners. It is off by default, unavailable to minor or unknown-age accounts, respects quiet hours and shares the weekly notification cap. Turning it off stops monitoring on the phone and saves account opt-out when connected. Explore view (beta) is optional and free; it requests camera access only when opened and uses GPS and compass for approximate labels. Its live preview frames stay on the phone and are never stored or transmitted. Posts, events, RSVPs and public profile information may be visible to other members. Approved organizers can write public place stories after staff record written ownership confirmation. Story text, its organizer and place identity, revisions, reports and moderation decisions are stored. Staff ownership verification references are restricted to staff. Accepted friends in a group plan can see that plan, invitations and shortlist votes. Reports, blocking and moderation decisions are stored to protect members. A push registration token identifies the installation for notifications when available."),
        Section(title: "Offline downloads and saved plans",
                body: "Verdure+ members can download selected parks or an area, public provider place results, authorized saved events and plans, compressed event images and view-only perks. The selected parks or search area and existing place results are sent to Firebase to prepare a private download. Packs retain your account birth year to enforce saved Program age limits offline. Server staging expires after one hour; downloads on the device expire after seven days, are excluded from device backups and are removed on sign-out or account switch. You can delete packs from Offline packs in Profile. Packs refresh on Wi-Fi when the app opens, at most once an hour. Successful place itineraries are stored in your account and removed by account deletion. Background map imagery is not downloaded. GPS for an offline trail view uses your location permission; it is not uploaded by that view. Offline check-ins are refused and never queued."),
        Section(title: "Website forms and partner records",
                body: "Website accounts and waitlist entries use Supabase. Support requests store your contact name and email, subject and message. Organizer interest stores organization, type, contact details, events per month and optional public calendar URL. Merchant interest stores business, category, business address, contact details and the offer considered. Avoid including sensitive information in a message. Authorized staff can review these requests and record handling notes. Partner records may include a business address, business contact details and a written agreement reference. Staff access and actions are logged with actor, target, time and relevant before and after values in restricted audit records. An interest form does not activate a partner or approve an organizer."),
        Section(title: "Analytics, cookies and service logs",
                body: "The app records first-party feature usage using a random per-install identifier; records may also be linked to your signed-in account. These records do not include names, post content or precise location. Recommendation impressions and actions may be linked to your account and include event IDs, position and score signals. Product Analytics in Profile settings stops new app analytics records. The website uses Vercel Web Analytics for aggregate page use and performance, without analytics cookies or cross-site advertising tracking. Website sign-in uses essential authentication cookies; the site also uses session storage for an already-shown welcome animation. Hosting and service providers process technical request information such as IP addresses and error logs for operation and abuse prevention. The app uses Firebase Crashlytics for crash diagnostics, without Google Analytics or advertising SDKs. Crash reports contain crash stacks, app and device/OS details and installation identifiers; Verdure does not attach account IDs, email, post or story text, or precise location. Crash Reports in Profile settings controls new diagnostics independently of Product Analytics. Firebase processes diagnostics to identify and fix reliability problems."),
        Section(title: "Providers and external requests",
                body: "Google Firebase operates app accounts, database, functions, photo storage and messaging. Supabase operates website accounts, waitlist and submitted requests. Vercel hosts the website and its web analytics. Apple processes subscriptions. Gift-card fulfilment uses the account email address. AI is used only when configured: the planners then send selected public event or place candidates and planning preferences such as interests, time and duration to Anthropic, and event sequencing may include whether friends are going, without their names. Otherwise plans are built on Verdure's own servers with no AI provider. Place, event, weather and geocoding providers may receive a search area, coordinates, query or business address needed for a lookup. Local partners are not given your account email, name, precise location or activity history through partner discovery. Redeeming a code reveals that code to you for use with the partner. Links to organizers and public calendars lead to separate services with their own privacy policies."),
        Section(title: "Retention and deletion",
                body: "App account and game data are kept while the account exists. Delete Account in Profile settings runs a server-side removal of account-owned data, attendance evidence and proof photos; failed deletion can be retried. Sent gift-card financial records are anonymized for accounting, and filed reports retain their moderation effect without the reporter identity. Website accounts, independently submitted support or interest forms, staff handling notes and immutable audit records are separate from app account deletion. They are retained for follow-up, service operation and accountability; these forms do not have an automatic expiry or deletion schedule. Use the support form to request access, correction or deletion, and we will explain any records that must be retained. Provider backups and operational logs may persist according to provider retention practices. We do not promise instant deletion from every backup or independent system."),
        Section(title: "Your choices",
                body: "Manage location and notification permissions in iOS Settings and update optional profile preferences in the app. Turn off Product Analytics in Profile settings. Delete the app account from Profile settings. Website sign-out clears its authentication session cookies. You can ask to access, correct or delete information through the support form. Depending on where you live, additional privacy rights may apply; requests are reviewed under applicable law."),
        Section(title: "Children",
                body: "People under 13 cannot create an app account. Birth year is used to apply age safeguards; members aged 13–17 receive minor protections. Verdure is not directed to children under 13. If you believe a child has provided information, contact us through the support form so we can investigate and remove it."),
        Section(title: "Security and changes",
                body: "We use encrypted connections, server-side authorization and restricted data access. Staff-only submission records and audit history are not public. No system is perfectly secure. If our data practices change, we will update this policy and its date and communicate material changes. Questions and privacy requests can be submitted at https://verdure-app.com/support."),
    ]
}
