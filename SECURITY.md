# Security model — Verdure app

> **Red team:** `cd functions && npm run redteam` — ~44 attacks that must all
> fail, plus positive controls that must all pass. Runs on every CI push.
> It is the evidence behind every claim in this document; where a control isn't
> proven by a probe, that's said explicitly.

## Adversarial audit — 2026-07-28

Re-audited from a zero-trust position: assume the app is fully exposed and
prove otherwise. The threat model is **an attacker who has unzipped the
shipped `.ipa`** — they hold the public Firebase key, project id and bucket
name, can register accounts freely, and talk to the REST and callable endpoints
directly, so every in-app gate is irrelevant to them.

Writing the probes surfaced **five real vulnerabilities**, three of them by
attacking rather than by reading code:

| # | Severity | Vulnerability | Fix |
|---|---|---|---|
| 1 | **Critical** | **Self-dealt event farming.** Create your own event claiming `pointValue: 1000`, set its coordinates to where you're standing, upload any photo, check in → **1000 points minted**. Repeatable at 20/hour ≈ a **$50 gift card every hour, indefinitely**. | Points are refused for an event you created; value now comes from the server's category table, never the document |
| 2 | **Critical** | Server trusted the stored `pointValue` up to 1000, ignoring the category ceiling — a "Market" event (real value 75) paid 1000. | Clamped to `CATEGORY_MAX_POINTS[storedCategory]` |
| 3 | High | **Like inflation.** One account looped `increment(1)` and landed 6/6 likes on a single post. | Per-user ledger (`postLikes/{postId}_{uid}`) enforced atomically in rules via `!exists()` + `existsAfter()`; ledger rows are immutable so unlike→relike can't replay |
| 4 | Medium | **Type-confusion DoS.** `{"toString": "x"}` as any string field crashed the callable with `INTERNAL` — `String(x)` throws when `toString` isn't callable. Present in **all** callables. | `safeString()` treats non-strings as absent |
| 5 | Medium | **Client lockout (self-inflicted).** The user-doc `hasOnly` allowlist didn't include server-written fields, so once the server stamped `plusExpiresAt` or the daily counters, **every subsequent client sync failed permanently**. | Allowlist covers server fields; `noServerOwnedFieldChanges` still stops the client changing them |

Findings 1–3 were only visible by *executing* attacks. Two of the probes also
initially passed **vacuously** — one attacked a code path the app doesn't use,
another failed on a broken upload before reaching the assertion — which is why
the harness now asserts its own preconditions and includes positive controls.

### Still open, stated plainly

- **Five billable third-party keys ship in the bundle** (SerpApi, Ticketmaster,
  NPS, Recreation.gov, Eventbrite). A key on a device is public — this is
  quota/billing theft, not user-data exposure. `externalFetch` (an allowlisted
  server-side proxy, SSRF-tested) exists to end it, but the keys stay exposed
  until it is deployed, the app is rebuilt against it, **and all five are
  rotated** — every key in an already-released build is compromised for good.
- **No App Check**, so callables accept any valid user token, not just the real
  app. This is what makes account-farming cheap and is the next hardening step.
- **Rate limits are per-account**, so free account creation resets the budget.
  The daily earning cap is the backstop that bounds value regardless.
- **Cloud Functions are not deployed** — every control in the callables is code
  that has never run in production. The rules-layer controls *are* live.


The website's Supabase schema (`Verdure-website--main/supabase/migrations/`)
argues its security decisions out in comments rather than just stating them.
This file applies that same standard to the **iOS app + Firebase backend**, which
is a different stack — Firestore rules and Cloud Functions instead of RLS and
`SECURITY DEFINER` — but the principles carry over exactly.

Verified against the live project on **2026-07-28**.

---

## The principles, and where each one lives here

### 1. Deny by default

*Website:* RLS on with **no policy** → Postgres denies; the anon key can't touch
`waitlist` at all.

*App:* `firestore.rules` opens with a catch-all `match /{document=**} { allow
read, write: if false; }`. Access is then granted back narrowly, per collection.
The three most sensitive collections are **additionally** denied by name so a
future edit can't widen them by accident:

| Collection | Holds | Client access |
|---|---|---|
| `attendance` | GPS coordinates, proof-photo paths | none |
| `fulfillments` | gift-card orders, delivery email, spend | none |
| `rateLimits` | per-user request counters | none |

### 2. The trust boundary re-validates; it never assumes the app ran first

*Website:* `join_waitlist()` re-checks the email shape because "this function is
the trust boundary: it is reachable with the public key and must not assume the
website ran first."

*App:* the callables are reachable at `POST /<project>/<region>/<name>` with any
signed-in token, which bypasses every client-side gate. So `checkInToEvent`
independently requires a proof photo **in the caller's own folder**, requires GPS
coordinates, re-computes the haversine distance against the event's stored
location, and clamps the claimed points to the category ceiling. The iOS 500 ft
gate is a courtesy to honest users; the server check is the control.

### 3. Server-owned fields are unwritable by clients

The client never writes its own balance. Firestore rules deny writes to
`pointsBalance`, `lifetimePoints`, `checkedInEventIDs`, `redeemedRewardIDs` and
`plusExpiresAt` — on update *and* at create, so a fresh account can't be minted
holding points or a subscription. Only the Admin SDK (which bypasses rules) can
write them.

`plusExpiresAt` deserves its own note: it gates the earn multiplier and early
reward access, so a client that could set it would grant itself both. It is
written **only** by verified App Store notifications. Until that handler exists
it is never written, which makes the benefits inert rather than exploitable.

### 4. No credential anywhere that can bypass the rules

*Website:* deliberately no `service_role` key — "a bug in one public HTTP
endpoint would expose the whole database instead of one insert into one table."

*App:* the iOS client ships only the public Firebase config, which is gated by
the rules above. The privileged Admin SDK exists solely inside Cloud Functions
and is never exposed to a client.

### 5. Don't leak membership

*Website:* the sharpest argument in that schema — anon `INSERT` into a `UNIQUE`
column turns a signup form into a "is this person a customer?" oracle, because
PostgREST answers `201` for a stranger and `409` for an existing address. Fixed
with a `returns void` function so there is no answer to read.

*App:* the same class of leak lives in auth error messages.
`"No account found with this email"` vs `"Incorrect password"` lets anyone test
an address.

- **Server:** Firebase Email Enumeration Protection is **on**
  (`enableImprovedEmailPrivacy: true`, verified via the Identity Toolkit admin
  API), so sign-in failures collapse to one generic code.
- **Client:** `AuthService.mapFirebaseError` collapses
  `emailAlreadyInUse` / `userNotFound` / `wrongPassword` / `invalidCredential`
  into a single message, and the `default:` branch no longer echoes Firebase's
  raw description (which names the exact condition). This covers the sign-up
  path — where `EMAIL_EXISTS` is still returned server-side and can't be
  suppressed, since a duplicate account cannot be silently created — and it is
  what holds if the console setting is ever switched off.

**Residual, stated plainly:** an attacker who can observe *timing* may still
distinguish sign-up outcomes. Closing that needs a queued "check your email"
flow that never reports the result synchronously.

### 6. Bound the volume, not just the correctness

*Website:* `join_waitlist()` caps signups at 20/minute because the RPC endpoint
"bypasses the honeypot, the submit-time trap, the source allowlist and the
per-IP limiter in the server action — all of those live in the website, and this
endpoint is not the website."

*App:* the callables had **no** volume control. Correctness was covered
(idempotency stops double-spend; balance checks stop overdraft) but nothing
stopped a script hammering them — burning Firestore writes that cost real money
on Blaze, flooding `attendance` / `fulfillments`, and probing for a transaction
race. `enforceRateLimit()` now runs first in each callable:

| Callable | Ceiling |
|---|---|
| `checkInToEvent` | 20 / hour |
| `collectPlace` | 60 / hour |
| `redeemReward` | 15 / hour |

Design notes, mirroring the schema's reasoning:

- **Rejected calls consume budget too.** Otherwise invalid requests are free and
  an attacker simply sends malformed ones.
- **Because failures count, the ceilings must tolerate a human fumbling** — a
  mis-tap, not enough points, a locked drop. They sit an order of magnitude
  above real use rather than hugging it. Nobody attends 20 events an hour; a
  script does thousands.
- **Per-user, not global.** A global ceiling would let one abuser lock out every
  honest user.
- **Transactional.** Parallel calls can't both read the same count and each
  decide they're under the cap.
- **Counters are server-only.** A client that could reset its own counter would
  have no limit at all.

**Residual:** the limit is per *account*, so an attacker who can create accounts
freely gets a fresh budget per account. Tightening that means attaching cost to
account creation (App Check, or verified email before earning).

### 7. Depth that survives a policy being edited

*Website:* `CHECK` constraints on `waitlist` are kept even though the public key
can no longer reach the table — they're "the line that survives
`join_waitlist()` being edited, re-granted, or replaced."

*App:* the Firestore rules still validate types, sizes and ranges on every
client-writable document even though the callables already validate. Either
layer alone would mostly hold; both together survive one of them being wrong.

---

## Verifying any of this

```bash
# Full server contract against local emulators — 36 checks, no production touch
cd functions && npm run e2e
```

Covers, among others: clients cannot write points, grant themselves Verdure+,
read `fulfillments`/`attendance`, or reset their own rate-limit counter; check-in
rejects missing proof, foreign proof, missing coordinates and out-of-range
distance; the rate limiter trips exactly at its ceiling and is per-user.

Live rules can be diffed against `firestore.rules` through the Firebase Rules
REST API — see the DEPLOY STATUS section of `CLAUDE.md`.

## Known gaps

- **Cloud Functions are not deployed** (project is on Spark). Every control in
  sections 2 and 6 is code that has never executed in production. The rules in
  sections 1, 3 and 7 *are* live.
- **No App Check**, so callables accept requests from any client holding a valid
  user token, not just the real app.
- **Proof photos are not human-reviewed.** The server proves a photo exists, is
  owned by the caller, and that the caller's GPS was near the venue — not that
  the photo depicts the event.
