# Verdure: Rishit's decisions, accounts, and budget

Prepared 2026-09-27 for an owner handoff. This is a request list, **not** an
instruction to buy or deploy anything now. The current sprint brief explicitly
forbids deployment, and Rishit confirmed no deployment or paid accounts yet.
He will set up free mail forwarding and a company GitHub organization later.
Local code and simulator work can continue without these.
The items below are needed to turn that work into a real, supportable launch.
Prices are public US list prices checked on this date; account terms, region,
taxes, and actual usage can change.

## The short version to send Rishit

1. **Confirm the publishing entity and brand.** Who legally owns Verdure and
   what seller name should appear in the App Store? `verdure-app.com` is the
   confirmed single public and email domain.
2. **Choose the account holder and budget owner.** The company should own
   Apple Developer, Firebase/Google Cloud billing, Vercel, the domain, the
   model API account, and the rewards account. Invite developers with roles;
   do not pass around account passwords or API keys.
3. **Approve the core launch accounts when ready:** Apple Developer
   membership ($99/year) and Firebase Blaze (no fixed subscription, but a
   payment method and metered usage). Review the current Vercel plan because
   its free Hobby plan is restricted to noncommercial personal use.
4. **Finish the support/privacy inbox.** Rishit plans free forwarding for
   `support@verdure-app.com` and `privacy@verdure-app.com`. We need the DNS
   owner to add and test mail records and a named responder.
5. **Decide what to activate at launch:** paid Claude planner calls,
   funded gift-card rewards, Verdure+ subscriptions, and any paid partner API.
   Each needs its own budget/owner. Code exists, but production paths are not
   validated.
6. **Give assigned people access:** John reviews the 200 classifications and
   then 20 ranking profiles; Rishit approves privacy, terms and App Store copy;
   Advaith owns 24-hour safety response; Adithya needs moderation queue access
   and training. Two iPhones are still needed for complete field QA.

## Money: required, conditional, and optional

| Item | Public price / exposure | Rishit's decision | Current Verdure state |
| --- | --- | --- | --- |
| **Apple Developer Program** | **$99/year** in the US for an individual or organization. Apple may grant eligible nonprofits, schools, or government bodies a waiver. [Apple enrollment](https://developer.apple.com/programs/enroll/) | Choose organization versus individual enrollment, an authorized Account Holder, and who pays. Organization enrollment needs a legal entity, domain-associated work email, public website, and D-U-N-S number; the D-U-N-S request itself is free. [Apple D-U-N-S](https://developer.apple.com/help/account/membership/D-U-N-S) | Needed for TestFlight, App Store distribution, subscription setup, and production APNs. **Basic testing on a personally owned iPhone can be done with a free Apple Account in Xcode**, with short-lived provisioning; it is not a substitute for launch. [Apple personal-team limits](https://developer.apple.com/help/account/basics/about-your-developer-account) |
| **Firebase / Google Cloud Blaze** | **$0 fixed plan fee; pay as used.** A Cloud Billing account/payment method is required. Firestore, Functions, Storage, network, build artifacts, and secrets can create charges. Budget alerts are warnings, not a hard cap. [Firebase pricing](https://firebase.google.com/pricing), [billing guidance](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) | Approve a monthly test and launch budget, link company billing to project `connectify-19dd8`, enable Storage, and designate who watches charges. | Project was last verified on Spark, with no deployed Functions or composite indexes. Live guest event reads are denied by old rules. No upgrade or deploy has been made. The [read budget](READ-BUDGET.md) is a floor, not a production invoice. |
| **Commercial website hosting** | Vercel Pro is advertised at **$20/month**, with additional developer seats and usage potentially billable. Hobby is for personal, noncommercial use. [Vercel pricing](https://vercel.com/pricing), [Hobby policy](https://vercel.com/docs/plans/hobby) | Tell us which Vercel account/team owns the live site, its present plan, and whether it is approved for Verdure's business use. If it is already Pro, there may be no new base purchase. | `verdure-app.com` is live on Vercel; the local CLI is not linked or signed in. Website deployment remains on hold. |
| **Anthropic API for planners** | Usage-based. The code defaults to `claude-sonnet-5`; Anthropic lists **$2 per million input tokens and $10 per million output tokens** for that model. Actual cost depends on request volume and token counts. [Anthropic model pricing](https://www.anthropic.com/news/claude-sonnet-5) | Decide whether model-powered planning launches, who owns the API organization/key, and a monthly spend limit. | No live planner function or production model-key path has been verified. The verified-event deterministic fallback works without the key; model quality/cost has not been tested live. |
| **Tremendous gift-card rewards** | The API has no setup or subscription fee; most merchant gift cards cost their **face value**. Funding by credit card can add a 3% processing fee; some monetary payout options have other fees. [Tremendous API pricing](https://www.tremendous.com/gift-card-api) | Approve a real reward budget, funding source, per-redemption and monthly limits, and who handles failed orders. | Sandbox code exists. Production API approval, funding, product catalog mapping, and real fulfillment testing remain. [Production access process](https://help.tremendous.com/hc/en-us/articles/41472382853523-Requesting-API-access) |
| **Email receiving** | Can be **$0** if `support@` and `privacy@` forward to an existing monitored inbox. For example, ImprovMX lists free forwarding; its paid sending tier starts at $9/month. [ImprovMX pricing](https://www.improvmx.com/pricing/) | Set up the planned free forwarding on `verdure-app.com`, name the responder and tell engineering when ready for a delivery test. Pay for a hosted mailbox only if needed. | No delivery test has passed; the addresses must be treated as inactive until Rishit confirms setup. |
| **Website data and mail services** | Conditional. Supabase has a free tier and Pro from **$25/month**; free projects can pause after inactivity. Resend currently allows **3,000 emails/month free**, then paid tiers from **$20/month**. [Supabase pricing](https://supabase.com/pricing), [Resend pricing](https://resend.com/pricing) | Identify the existing Supabase/Resend owners and plans; decide whether website auth, waitlist persistence, and owner notifications must be production-reliable. | Website source uses Supabase; its optional waitlist notification function expects a Resend key and verified sending domain. Do not buy a second service until the existing live setup is inventoried. |
| **SerpApi gap-fill source** | **Not required to pay now.** Its free plan lists 250 searches/month; paid Starter lists $25/month for 1,000. [SerpApi pricing](https://serpapi.com/pricing) | Only approve a paid tier if measured event coverage justifies it. | The ingest code caps use at 90 calls/month, below the listed free quota; no key is configured. |
| **Domain renewal and partner licenses** | Amounts unknown until the registrar and partners are identified. Idealist asks applicants to inquire about pricing. [Idealist API](https://www.idealist.org/en/open-network-api) | Confirm who owns `verdure-app.com` and its renewal date. Defer paid partner/API contracts. | Bandsintown and Songkick are out of scope by Rishit's decision. |
| **Physical test hardware** | **$0 if two suitable iPhones can be borrowed or assigned**; otherwise purchase cost depends on the devices. | Name two testers and devices before release QA. | No two-phone field run has been completed. |

Apple's commission on Verdure+ subscription receipts is a separate variable
cost, not another up-front membership. The company's Account Holder must
complete the Paid Apps Agreement and tax/banking setup to offer in-app
purchases. [Apple IAP setup](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases),
[banking](https://developer.apple.com/help/app-store-connect/manage-banking-information/enter-banking-information).

## Accounts and information the company must create or grant

| Priority | Ask Rishit for | Why and exact handoff |
| --- | --- | --- |
| 1 | **Legal entity name, publishing choice, authorized contact, business phone/address, and D-U-N-S status.** | Apple organization enrollment displays the legal entity as the seller. A DBA/brand alone is insufficient. The Account Holder needs an Apple Account with two-factor authentication. `verdure-app.com` is canonical. |
| 1 | **Domain registrar and Vercel project ownership.** | Identify the domain/DNS admin, current Vercel team/plan, and a role-based developer invitation. The site must eventually publish working `/invite`, `/support`, and `/terms` routes and the approved privacy text. No website deployment has been authorized. |
| 1 | **A real company contact setup.** | Rishit will configure free forwarding for `support@verdure-app.com` and `privacy@verdure-app.com`, name the receiving inbox and responder, then tell engineering to test both addresses. Local iOS and website contact strings now use the chosen domain; no mail delivery is claimed yet. |
| 1 | **Google Cloud billing owner and Firebase project access.** | Confirm the correct project is `connectify-19dd8`, approve Blaze and a budget, then invite a developer with least-privilege access needed for release. The company should retain billing ownership. No deployment until separately authorized. |
| 1 | **Repository ownership and team access.** | The Git remote currently points to `github.com/lalubalu/appc.git`. Rishit will create a company GitHub organization; then provide its slug and his GitHub username so the repo can be transferred and his organization/repository admin access verified. No transfer is possible before the organization exists. |
| 1 | **Apple Developer organization/team and App Store Connect roles.** | Account Holder completes enrollment and agreements; developer access is granted by invitation. Later: create monthly/yearly Verdure+ products, APNs auth key, App Store Server API key, and Server Notifications V2 configuration. Do not send private `.p8` keys in chat. |
| 2 | **Tremendous company account, production approval, funding source, and chosen reward catalog.** | The backend expects `TREMENDOUS_API_KEY`, `TREMENDOUS_FUNDING_SOURCE_ID`, and reward-to-product mapping. Decide whether gift-card redemption is enabled at launch. |
| 2 | **Anthropic API organization and spend authority, if the model planner will launch.** | Create a scoped key and spending controls; engineering stores it as a server secret, never in the iOS bundle. |
| 2 | **Existing Supabase and Resend project access, if the website's signup/waitlist is in scope.** | Confirm who owns the current projects and their production configuration. The website's notification function expects a verified sending domain and a receiving owner inbox. |
| 2 | **Company-owned public-data API accounts, where those features are approved.** | The backend has server-secret slots for `TICKETMASTER_KEY`, `NPS_API_KEY`, `RECREATION_GOV_KEY`, and optional `SERPAPI_KEY`. Identify existing accounts or create them under Verdure; decide usage terms and quotas before enabling a source. The current free public adapters do not require these keys. |
| 2 | **Partner contact identity and introductions.** | Provide Verdure's organization name, contact name, and business email for the drafted [Idealist inquiry](IDEALIST-INQUIRY.md). Introduce owners of four local volunteer sources or obtain authorized structured endpoints. SeatGeek catalog access is optional. Bandsintown and Songkick have been dropped. |
| 2 | **Two real iPhones and testers.** | Run [DEVICE-QA.md](../DEVICE-QA.md) on Wi-Fi and cellular with location, camera, notifications, two accounts, friend invites, and queue replay. A free Apple personal team may suffice for some early device checks, but paid membership and the live backend are needed for the full launch path. |
| 2 | **Named human reviewers and operational owners.** | John: [200-event classifier audit](CLASSIFICATION-AUDIT.md), then [20-profile ranking set](RANKING-EVAL.md). Rishit: privacy, terms and App Store copy approval. Advaith: 24-hour safety response. Adithya: moderation operations; see [moderation handoff](MODERATION-HANDOFF.md). His authenticated Firebase UID and deployed staff tools are still needed before access can be granted. |
| 3 | **An App Review demo mailbox/account after the backend is live.** | Create a real review login, then seed its points, events, and perk state as documented in [LISTING.md](../AppStore/LISTING.md). App Store reviewers need credentials for flows a fresh account cannot reach. |

## Decisions that should stay explicit

- **No production deployment now.** The existing instruction stands until
  the owner authorizes a coordinated release of backend, rules, indexes,
  storage, and website changes.
- **No automatic purchases.** Getting access to an account is not approval to
  start a paid plan, place a funded reward order, or accept a partner license.
- **No false launch claim.** The local 9,813-event corpus and populated iOS
  screenshots are emulator evidence. The live event index remains empty/blocked
  for guest reads, and classification, ranking, read-cost, device, and
  model-path gates are still open. See [sprint status](SPRINT-STATUS-2026-09-27.md).
