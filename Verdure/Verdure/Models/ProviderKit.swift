import Foundation

// =====================================================================
//  Shared plumbing for the remaining client-side data fetches (places).
//
//  Formerly the top of EventProviders.swift. The event providers themselves
//  are gone: events are ingested server-side on a schedule into the
//  normalized /events store and the app reads Firestore only (see
//  functions/src/ingest/ and EventsAPIService). What remains here is the
//  config reader, the hostile-text sanitizer and the HTTP helper that the
//  places pipeline (PlacesAPIService) still uses.
// =====================================================================

enum ProviderConfig {
    /// Read a build-time value from Info.plist (injected from Secrets.xcconfig),
    /// falling back to an environment variable. Treats unexpanded "$(VAR)" as empty.
    ///
    /// NOTE: only the two PLACES keys (NPS, Recreation.gov) are still read this
    /// way. Every event-provider key was removed from the bundle in Part 2 §1 —
    /// a key that reaches the device is public, and those are now Functions
    /// secrets consumed by the ingestion jobs.
    static func value(_ infoKey: String, env: String? = nil) -> String {
        if let v = Bundle.main.object(forInfoDictionaryKey: infoKey) as? String,
           !v.isEmpty, !v.hasPrefix("$(") { return v }
        if let env, let v = ProcessInfo.processInfo.environment[env], !v.isEmpty { return v }
        return ""
    }
}

// MARK: - Sanitizer (treat ALL external data as hostile)
//
// Every string that comes back from a third party OR another user (titles,
// descriptions, venue names, organizers, URLs) is scrubbed before it touches the
// app: HTML/markup stripped, control characters removed, whitespace collapsed,
// length-capped, and only http/https URLs allowed. Ingested events are scrubbed
// server-side too; scrubbing again on read costs nothing and means a document
// written by any path is safe to render.

enum Sanitize {
    private static let htmlTags = try? NSRegularExpression(pattern: "<[^>]+>")
    private static let multiSpace = try? NSRegularExpression(pattern: "\\s+")
    private static let entities: [String: String] = [
        "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
        "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&rsquo;": "’", "&ndash;": "–"
    ]

    /// Strip markup + control chars, decode common entities, collapse whitespace, cap length.
    static func text(_ s: String?, max: Int = 200) -> String {
        guard var t = s, !t.isEmpty else { return "" }
        if let re = htmlTags {
            t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: " ")
        }
        for (e, r) in entities { t = t.replacingOccurrences(of: e, with: r) }
        // Drop control characters (incl. newlines/tabs) so nothing hides in them.
        t = t.components(separatedBy: .controlCharacters).joined(separator: " ")
        if let re = multiSpace {
            t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: " ")
        }
        return String(t.trimmingCharacters(in: .whitespacesAndNewlines).prefix(max))
    }

    /// Allow ONLY well-formed http/https URLs — blocks javascript:, data:, file:, etc.
    static func url(_ s: String?) -> String? {
        guard let raw = s?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              let u = URLComponents(string: raw), let scheme = u.scheme?.lowercased(),
              scheme == "http" || scheme == "https", (u.host ?? "").contains(".") else { return nil }
        return u.string
    }

    /// Clamp externally-sourced coordinates to valid ranges (nil if absent/invalid).
    static func latitude(_ v: Double?) -> Double? {
        guard let v, v.isFinite, abs(v) <= 90, v != 0 else { return nil }
        return v
    }
    static func longitude(_ v: Double?) -> Double? {
        guard let v, v.isFinite, abs(v) <= 180, v != 0 else { return nil }
        return v
    }

    /// Parse a coordinate that APIs may return as a number OR a string.
    static func coord(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let s = any as? String { return Double(s) }
        if let n = any as? NSNumber { return n.doubleValue }
        return nil
    }
}

extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

// Ephemeral session (no Alt-Svc cache) so the first request isn't pushed onto HTTP/3.
let providerSession: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.waitsForConnectivity = true
    return URLSession(configuration: config)
}()

/// Shared GET-JSON helper used by the places providers. Disables HTTP/3 to
/// dodge the iOS Simulator's QUIC hang.
func fetchJSON(_ url: URL, headers: [String: String] = [:]) async -> Data? {
    var req = URLRequest(url: url)
    req.timeoutInterval = 15
    req.assumesHTTP3Capable = false
    for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
    do {
        let (data, resp) = try await providerSession.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(code) else { return nil }
        return data
    } catch { return nil }
}
