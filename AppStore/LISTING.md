# App Store Connect submission pack — Verdure

Everything here is written to match what the app **actually does today**. If a
feature ships or is pulled, update this file in the same commit.

---

## Basics

| Field | Value |
|---|---|
| App name | `Verdure` |
| Subtitle (30 char max) | `Step Outside. Connect Within.` (29) |
| Bundle ID | `com.verdure-app.verdure` |
| Primary category | Health & Fitness |
| Secondary category | Travel |
| Age rating | 4+ |
| Price | Free (with auto-renewable subscription) |

## Promotional text (170 char max — editable without review)

> Discover parks, trails and community events near you. Check in, earn points,
> and turn time outside into real gift cards. New seasonal rewards every month.

*(159 characters)*

> **Pending copy change — do not submit early.** A Verdure+ **1.25x earn
> multiplier** is implemented and server-enforced (`earnMultiplier` in
> `functions/src/index.ts`), and it is proven by the E2E suite. It is
> deliberately absent from both the description above and `PaywallView.features`
> because it cannot pay out until Cloud Functions are deployed *and* the Apple
> IAP secrets are set — and this repo's rule is that we do not sell a benefit
> that doesn't yet pay. Once both are true, add the line
> `• Bonus points — earn 1.25x on every check-in and collection`
> to the description **and** to `PaywallView.features` in the same commit, so
> the store listing and the in-app paywall can never disagree.

## Description

> **Step Outside. Connect Within.**
>
> Verdure turns your neighborhood into something worth exploring. Find the parks,
> trails, gardens and gathering places around you — then get outside and collect
> them.
>
> **Discover what's nearby**
> Real places from open map data and national park services, sorted by how close
> they are. Real community events with real dates and locations — never filler.
>
> **Collect the outdoors**
> Every place you visit becomes part of your collection, from Common city parks
> to Legendary scenic overlooks. Get close enough and it's yours.
>
> **Earn by showing up**
> Check in at community events to earn points. Attendance is verified with your
> location and a photo, so points mean something. Points become real gift cards.
>
> **Build a streak**
> Daily streaks, monthly challenges and badges that unlock from what you've
> genuinely done — no busywork.
>
> **A Daily Gem**
> One fun fact a day about nature, community and the environment. Small, but it
> gets you looking around.
>
> **Plan my adventure**
> Tell Verdure how long you've got and it builds you an itinerary — real places
> near you, ordered sensibly, shaped by the actual weather and the time of day.
> Every stop is a place that genuinely exists nearby; nothing is invented.
>
> **Verdure+ (optional)**
> $4.99/month or $49.99/year:
> • Unlimited Adventure Planner — free members get 5 plans a month
> • Early access to partner perks — see and claim new local offers first
> • Cash gift cards — $5 and $10, members only
> • Advanced stats — where your points come from and your last 30 days
> • Advanced personalization — switch interest profiles and save event filters
> • Offline park and place packs — seven-day downloads of guides, trail lines,
>   events, places and plans; background map imagery is not included
>
> Verdure is free to use. A subscription is entirely optional and never required
> to earn points or redeem partner perks.
>
> ---
> Location is used to find nearby places, to verify you're actually at an event
> when you check in, and for nothing else. We don't track you, and we don't sell
> your data.

## Keywords (100 char max, comma-separated, no spaces)

```
outdoors,parks,trails,hiking,walk,nature,community,events,local,explore,rewards,steps,adventure
```

*(94 characters)*

## Support / marketing URLs

**Publication remains a pre-submission blocker.** `/terms`, `/support` and the
corrected privacy page now build locally on the active website. Support uses a
Supabase-backed form and the authenticated staff submissions inbox; email
forwarding is no longer a prerequisite for this flow. No website routes or
migrations were deployed in this sprint. Public link resolution and production
form delivery still need release verification after publication.

| Field | Value |
|---|---|
| Support URL | `https://verdure-app.com/support` — local form and staff-inbox workflow tested; unpublished |
| Marketing URL | `https://verdure-app.com` — canonical domain |
| Privacy Policy URL | `https://verdure-app.com/privacy` — corrected local text; publication pending |
| Terms of Use (EULA) | Apple's standard EULA plus Verdure `/terms`, now built locally and restored in the app |

The canonical domain is `Legal.siteBase` in `Verdure/Verdure/Models/Legal.swift`.
Both documents also ship inside the binary through `LegalView`, linked from the
paywall, signup and Profile settings. Explicit DEBUG emulator QA can set
`QAWebsiteBaseURL` to a loopback/private-LAN local website to check these links
before publication; Release always uses the canonical domain.

---

> **Copy rule.** This block and `PaywallView.features` must say the same thing
> and change in the same commit. The previous version advertised "the Gold and
> Platinum tiers ($25 and $50 gift cards)" in both places — rewards the server
> has as `active: false` and refuses to redeem. Do not list a tier here without
> checking `CASH_CATALOG` in functions/src/economy.ts first.
>
> Two things deliberately absent. The **member badge** is real and still shows
> on the player card, but it is a cosmetic delight rather than a reason to pay,
> and padding a four-item list with it weakens the four. The **streak freeze**
> is absent because it is FREE for every account: selling relief from a
> punishment we invented would make the streak a lever on the subscription, and
> a unit test fails if any paywall string mentions it.

## Privacy nutrition label answers

These must match `Verdure/Verdure/PrivacyInfo.xcprivacy` exactly.

**Does your app collect data?** → **Yes**
**Do you use data for tracking?** → **No** — no ad SDKs, no third-party
analytics, no data brokers, and nothing follows a user across other apps or
websites, which is what Apple's "tracking" means.

| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Crash Data | Yes | No | No | App Functionality |
| Other Diagnostic Data | Yes | No | No | App Functionality |
| Product Interaction | Yes | Yes | No | Analytics |
| Precise Location | Yes | Yes | No | App Functionality |
| Email Address | Yes | Yes | No | App Functionality |
| Name | Yes | Yes | No | App Functionality |
| User ID | Yes | Yes | No | App Functionality |
| Photos or Videos | Yes | Yes | No | App Functionality |
| Other User Content (including organizer-written place stories) | Yes | Yes | No | App Functionality |
| Purchase History | Yes | Yes | No | App Functionality |
| Device ID | Yes | Yes | No | App Functionality |
| Other Data Types (birth year, optional student status and school) | Yes | Yes | No | App Functionality |
| Other Usage Data (saved events, recommendation feedback, feed analytics and story engagement) | Yes | Yes | No | App Functionality and Analytics |

The app does not collect an address book, health or browsing history, payment card details, billing or shipping addresses, or advertising identifiers. Firebase Crashlytics is integrated for crash and device diagnostics. Verdure attaches no account identifier, email, prose or location and adds no Google Analytics breadcrumbs. Crash Reports in Profile controls new diagnostics. Physical-device report receipt and readable-symbol proof remain pending. Website forms and web analytics are described separately in the shared privacy policy.

Nearby deal alerts use the existing Precise Location and account categories above.
Consent, weekly budget and delivered offer identifiers are account records;
alert coordinate samples are not retained. Explore preview pixels are not collected,
so it adds no uploaded photo/video category beyond existing attendance evidence.

Offline packs use the existing account, saved-event/plan and location data
categories above. A selected park or search area and existing provider place
results are sent to Firebase to prepare a private, server-entitlement-checked
download. A pack retains the account birth year to enforce saved Program age
limits offline. Server staging expires after one hour. Device packs contain the
member's authorized saves and plans, expire after seven days, are excluded from
device backups and are removed on sign-out/account switch or manual deletion.
They contain compressed event thumbnails with image metadata removed, public
park/trail data and view-only perks, with no partner codes, background map
imagery or queued attendance. Saved place itineraries are now retained in the
member's account so they can be included; account deletion removes them.

**On Product Interaction (the one unlinked row).** Verdure keeps first-party
analytics: which screens are opened and which features are used. It is keyed to
a random per-install UUID, not to the account, and carries no names, no message
or post content and no location — which is why it is declared Not Linked while
everything else here is Linked. It never leaves our own Firestore. Users can
switch it off in Profile › Settings › Product Analytics.

---

## App Review notes

> **Demo account**
> Sign in with:
>
> ```
> Email:    <verified review account email — create before submission>
> Password: (see the Demo Account fields in App Store Connect)
> ```
>
> This account is pre-seeded so the reviewer does not have to earn anything to
> see the app: it has a points balance large enough to redeem a reward, several
> saved and RSVP'd events, an unlocked badge, and a claimed partner perk code
> visible under Collect › Rewards › My Codes. Creating a fresh account works
> too ("Continue as guest" also browses without one), but a new account starts
> at zero points and cannot exercise the redemption flow at all.
>
> **SETUP REQUIRED BEFORE SUBMISSION — this account does not exist yet.**
> It cannot be created until Cloud Functions are deployed, because points and
> redemptions are server-authoritative and a client cannot mint them. Steps,
> once the backend is live:
>   1. Register a real review-account email through the normal sign-up screen.
>   2. Run `node functions/scripts/seed-review-account.mjs <uid>` against the
>      live project to grant the balance, RSVPs, badge and perk code.
>   3. Put the credentials in App Store Connect › App Review Information.
> Submitting without this leaves the reviewer unable to reach the reward flow,
> which is the most likely cause of a 2.1 rejection for this app.
>
> **About check-ins (important for review)**
> Checking in to an event requires two things by design: being physically within
> 500 ft of the venue, and attaching a photo as proof of attendance. On a
> simulator or from a desk, check-in will correctly stay locked and show
> "Too far to check in" — this is intended anti-fraud behaviour, not a bug.
> To exercise the flow, use Xcode's location simulation to set a location at one
> of the listed event venues, then attach any photo.
>
> **User-generated content & moderation (guideline 1.2)**
> Community posts, organizer events and member profiles each carry a ••• menu
> with **Report** (nine reason categories) and **Block**. Reports are reviewed by
> a person within 24 hours; content is hidden automatically once three
> different people report it, and anything unreviewed at the 24-hour mark is
> removed by a scheduled job (`moderationSweep`). Blocking is mutual and
> enforced server-side. Blocked members can be managed in Profile › Settings ›
> Safety & Blocking, which currently contains an unverified contact address;
> replace it with a receiving inbox before submission. To exercise the flow, report any post from a second
> test account — the reporter sees a confirmation and the reviewer queue
> receives the item.
>
> **Account deletion (guideline 5.1.1(v))**
> Profile › Settings › Delete Account. A server function removes the profile,
> points, collection, posts, events and their attendee lists, RSVPs, GPS
> attendance records, queued gift cards, proof photos in Storage and finally the
> Firebase Auth user. Delivered gift cards are kept in anonymised form as a
> financial record. Covered by the backend E2E suite.
>
> **Terms of Use & Privacy Policy (guideline 3.1.2)**
> Both are bundled in the app and tappable from the paywall (under the purchase
> button), the sign-up form, and Profile › Settings › Terms & Privacy. The
> paywall states price, subscription length and the auto-renewal terms; prices
> are rendered from the StoreKit product objects, never hardcoded.
>
> **About the subscription**
> Verdure+ unlocks an unlimited Adventure Planner (free members get 5 plans a
> calendar month), early access to partner perks, cash gift cards ($5 and $10),
> advanced stats, interest profiles and saved filters, and offline park and place
> packs. Online park guides and trail overviews remain free. Background map
> imagery is not included in downloads. Other free features include the daily
> streak and its one-missed-day freeze, which is not a paid feature and is not
> sold anywhere. The paywall lists
> only features that are live in this build — it previously advertised $25/$50
> reward tiers that the server declines, and those are gone from both the
> paywall and this listing.
>
> **About partner offers**
> Some screens may show a labelled offer from a local partner. Partners receive
> no personal information, a partner offer never changes the order of organic
> recommendations, at most one is shown per session, and each can be dismissed
> permanently. Offers never appear in Friends Activity.
>
> **About "Plan my adventure"**
> This builds an itinerary using a language model, but the model is only ever
> allowed to choose from a list of real nearby places the app has already
> fetched from public map/park data. Any place it returns that isn't on that
> list is discarded server-side, so the itinerary cannot contain invented
> locations. No user content is sent — only place names, categories and the
> current weather.
>
> **Location usage**
> Used for finding nearby places, the collection proximity check, and verifying
> event attendance. Optional adult-only nearby deal alerts use Always location,
> region monitoring and significant location changes after explicit promotional
> consent; they are off by default and share the weekly notification cap.
> Location samples for alerts are evaluated without persistent location history.
> There is no cross-app tracking. Explore view (beta) is optional and free;
> camera access is requested only when opened. Preview frames are not stored
> or transmitted, and labels use approximate GPS/compass positioning.

---

## Screenshot set

Captured at Apple's required 6.9" size (1320 × 2868) in `screenshots/6.9-inch/`:

| Order | File | Suggested caption |
|---|---|---|
| 1 | `events.png` | Real community events near you |
| 2 | `explore.png` | Discover the outdoors around you |
| 3 | `collect.png` | Collect every place you visit |
| 4 | `profile.png` | Streaks, badges and real rewards |
| 5 | `community.png` | See what your neighbors are finding |

*Regenerate:* boot the iPhone 16 Pro Max simulator and launch with
`-QATab <tab> -QADisableMotion YES -QAOfflineData YES` (see `QA.md`).

---

## Pre-submission blockers

- [x] **Privacy Policy page** — built at `/privacy` on the marketing site
- [x] **Terms of Use page** — built at `/terms`; the app bundles the same text
- [x] **Support page** — built at `/support` (both linked from the footer)
- [x] **In-app account deletion** — `deleteAccount` callable + Settings flow
- [x] **UGC moderation** — report, block, 24h review SLA, published contact
- [ ] **Deploy the marketing site** so those two URLs actually resolve, then
      paste the live URLs into App Store Connect
- [ ] Create the two subscriptions in App Store Connect
      (`com.verdure-app.verdure.plus.monthly`, `com.verdure-app.verdure.plus.yearly`)
      with localized display names, and attach them to the app
- [ ] Upgrade Firebase to Blaze and deploy Functions + Storage — **without this
      no check-in ever credits points and no proof photo uploads** (see the
      DEPLOY STATUS table in `PROJECT-NOTES.md`)
- [x] Real gift-card fulfilment — **Tremendous integrated**
      (`functions/src/fulfillment.ts`): a trigger + 30-minute sweeper drain the
      `/fulfillments` queue, orders are idempotent on `external_id`, permanent
      failures refund the user's points, and anything $25+ waits for manual
      approval. **Still needs**: a funded Tremendous account and the three
      secrets (`TREMENDOUS_API_KEY`, `TREMENDOUS_FUNDING_SOURCE_ID`, and
      `TREMENDOUS_CATALOG` mapping reward ids to that account's product ids).
      Nothing sends until those exist — the queue simply holds.
- [x] Server-side Verdure+ verification — **done**
      (`functions/src/subscriptions.ts`): the App Store Server API writes
      `users/{uid}.plusExpiresAt`, App Store Server Notifications V2 keep it
      fresh, and ownership is bound via a uid-derived `appAccountToken`.
      **Still needs**: an In-App Purchase key (.p8) from App Store Connect and
      the ASSN V2 URL pointed at the deployed `appStoreNotifications` endpoint.
- [x] **Adventure Planner**: works with no AI key. The server builds the
      itinerary with its own rules engine (`functions/src/adventure-engine.ts`:
      real nearby places only, posted hours, weather, sunset). Optional: set
      `ANTHROPIC_API_KEY` as a function secret to have a language model write
      it instead; the same real-place allowlist applies either way, and the
      store copy must not call the planner "AI" unless that key is configured.
- [ ] **Push notifications**: upload an APNs Auth Key (.p8) to Firebase → Cloud
      Messaging and add the Push Notifications capability to the App ID.
      Without both, permission is granted but nothing is ever delivered.
- [x] Privacy manifest (`PrivacyInfo.xcprivacy`) — done, ships in the bundle
- [x] Screenshots at a required size — done (6.9")
