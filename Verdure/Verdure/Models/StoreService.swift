import Foundation
import Observation
import StoreKit

// MARK: - Store Service (Verdure+ subscription via StoreKit 2)
//
// Product IDs must match App Store Connect (and Verdure.storekit for local
// simulator testing — the Verdure scheme points at it):
//   com.verdure-app.verdure.plus.monthly   $4.99/month
//   com.verdure-app.verdure.plus.yearly    $49.99/year
//
// TRUST MODEL. `isPlus` below is CLIENT state and drives UI only — which tiles
// show a lock, whether the paywall appears. It is never the basis for granting
// value, because a jailbroken device can make it say anything.
//
// Anything that costs money (the 1.25x earn multiplier, Plus-only early access
// to limited drops) is decided server-side from `users/{uid}.plusExpiresAt`,
// which only the Admin SDK can write and only after Apple has cryptographically
// verified the purchase. See functions/src/subscriptions.ts.
//
// The two are connected by `linkSubscription`: after a successful purchase or
// restore we hand the server a transaction id, it asks Apple, and it writes the
// entitlement. `appAccountToken` (server-derived from the uid) is attached at
// purchase so Apple tells the server WHICH account bought it.

@MainActor @Observable
final class StoreService {

    static let monthlyID = "com.verdure-app.verdure.plus.monthly"
    static let yearlyID = "com.verdure-app.verdure.plus.yearly"
    private static let allIDs: Set<String> = [monthlyID, yearlyID]

    // MARK: - Published State

    private(set) var products: [Product] = []
    private(set) var purchasedIDs = Set<String>()
    private(set) var isLoadingProducts = false
    private(set) var isPurchasing = false
    var lastError: String?

    /// True when the user has an active Verdure+ entitlement.
    var isPlus: Bool { !purchasedIDs.isEmpty }

    var monthly: Product? { products.first { $0.id == Self.monthlyID } }
    var yearly: Product? { products.first { $0.id == Self.yearlyID } }

    private var updatesTask: Task<Void, Never>?

    // MARK: - Init

    init() {
        // Listen for transactions that happen outside the purchase flow
        // (renewals, Ask to Buy approvals, purchases on other devices).
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
        Task {
            await loadProducts()
            await refreshEntitlements()
        }
    }

    // MARK: - Products

    func loadProducts() async {
        guard products.isEmpty, !isLoadingProducts else { return }
        isLoadingProducts = true
        defer { isLoadingProducts = false }
        do {
            products = try await Product.products(for: Self.allIDs)
                .sorted { $0.price < $1.price }
        } catch {
            lastError = "Couldn't load subscription options. \(error.localizedDescription)"
        }
    }

    // MARK: - Purchase / Restore

    /// Purchase a subscription. Returns true when the entitlement is active.
    @discardableResult
    func purchase(_ product: Product) async -> Bool {
        guard !isPurchasing else { return false }
        isPurchasing = true
        defer { isPurchasing = false }
        lastError = nil

        do {
            // Attach the server-derived account token so Apple records WHO bought
            // this. Without it the server can only fall back to first-claim
            // binding, which is weaker. If the token can't be fetched (offline,
            // signed out) the purchase still proceeds — blocking a sale over a
            // bookkeeping nicety would be worse than the weaker binding.
            var options: Set<Product.PurchaseOption> = []
            if let token = await appAccountToken() {
                options.insert(.appAccountToken(token))
            }

            let result = try await product.purchase(options: options)
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    lastError = "Purchase couldn't be verified."
                    return false
                }
                purchasedIDs.insert(transaction.productID)
                await transaction.finish()
                // Hand the server the transaction so it can verify with Apple and
                // write the entitlement. Best-effort: the entitlement also lands
                // via App Store Server Notifications, and refreshEntitlements()
                // retries at next launch, so a failure here is not a lost purchase.
                await link(transaction: transaction)
                Haptics.success()
                return true
            case .userCancelled:
                return false
            case .pending:
                lastError = "Purchase is pending approval."
                return false
            @unknown default:
                return false
            }
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    /// Re-sync with the App Store (e.g. after reinstalling).
    func restorePurchases() async {
        lastError = nil
        try? await AppStore.sync()
        await refreshEntitlements()

        // FALLBACK. If StoreKit came back with nothing, ask the SERVER whether
        // this account has an entitlement it already verified with Apple.
        //
        // This is the reinstall-on-a-new-phone case: `AppStore.sync()` can fail
        // or return empty (wrong Apple ID signed into the App Store, a sandbox
        // hiccup, transient StoreKit error) while the server still holds a
        // perfectly valid, Apple-verified subscription bound to this uid. Without
        // this, a paying member taps Restore, sees "nothing to restore", and is
        // told to buy a subscription they already own.
        //
        // It can only ever REPORT what the server already verified — it cannot
        // grant anything, because the server recomputes the entitlement from
        // Apple rather than trusting this call.
        if purchasedIDs.isEmpty {
            if let plus = try? await FunctionsService().refreshMySubscription(), plus {
                serverVerifiedPlus = true
                lastError = "Your Verdure+ membership is active on this account."
            }
        }
    }

    // MARK: - Entitlements

    func refreshEntitlements() async {
        var owned = Set<String>()
        var newest: StoreKit.Transaction?
        for await entitlement in Transaction.currentEntitlements {
            if case .verified(let transaction) = entitlement,
               Self.allIDs.contains(transaction.productID),
               transaction.revocationDate == nil {
                owned.insert(transaction.productID)
                if newest == nil || transaction.purchaseDate > newest!.purchaseDate {
                    newest = transaction
                }
            }
        }
        purchasedIDs = owned
        // Re-link on every refresh, not just at purchase: this is what repairs a
        // device that bought Plus while the backend was down, and what binds a
        // restore on a new phone.
        if let newest { await link(transaction: newest) }
    }

    // MARK: - Server binding

    private var cachedAccountToken: UUID?

    /// The account token the server expects to see inside the Apple transaction.
    private func appAccountToken() async -> UUID? {
        if let cachedAccountToken { return cachedAccountToken }
        guard let raw = try? await FunctionsService().appAccountToken(),
              let uuid = UUID(uuidString: raw) else { return nil }
        cachedAccountToken = uuid
        return uuid
    }

    /// Tell the server about a transaction so it can verify it with Apple.
    private func link(transaction: StoreKit.Transaction) async {
        let id = String(transaction.originalID)
        do {
            let active = try await FunctionsService().linkSubscription(transactionId: id)
            serverVerifiedPlus = active
        } catch {
            // Silent by design — see the call sites. The server has two other
            // paths to the same truth (notifications, refreshMySubscription).
            serverVerifiedPlus = nil
        }
    }

    /// What the SERVER says about this account's entitlement, when known.
    /// `nil` means "not yet confirmed", which is different from "not a member".
    private(set) var serverVerifiedPlus: Bool?

    private func handle(_ update: VerificationResult<Transaction>) async {
        if case .verified(let transaction) = update {
            await transaction.finish()
            await refreshEntitlements()
        }
    }
}
