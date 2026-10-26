# Free external gates — 2026-09-27

Scope: read-only checks and no-cost access requests for the Verdure sprint. No
production deployment, billing change, API purchase, account creation or
environment switch was made. The owner explicitly said **no deployment yet**.

## Public source availability

`node functions/scripts/ingest-smoke.mjs` fetched records from all 11
configured public sources on September 27. The log is
`/tmp/verdure-radius-preview-20260927.log`. The latest adapters returned 12,267
raw records in total, including 6,018 from San José Public Library, 1,916
from Santa Clara County Library District and 54 from Midpen. These are source
responses, not deduplicated, radius-filtered live Firestore events. Ticketmaster
and NPS were skipped because their keys are unset. This run made no Firestore
writes. The one-record change from the earlier smoke run came from the live SCU
feed. C0 human classification review and the live-corpus read/cost gates still
precede production ingestion.

## Website and hosting

- The owner confirmed `https://verdure-app.com/` is the production website.
  It responds `200` with a Vercel server header.
- `https://verdure-app.com/invite` responds `404`. The invitation route exists
  in local website source only.
- `https://verdure-app.com/privacy` responds `200` and displays a policy dated
  July 26, 2026, including payment and shipping language. The newer local
  policy is unpublished.
- `https://verdure-app.com/terms` and `/support` respond `404`. The App Store
  listing now treats those routes as unbuilt on the active site. The iOS app's
  canonical website was corrected from `verdure.app` (also `404`) to the
  confirmed `verdure-app.com`; its dead "Terms on the web" button was removed
  while the packaged terms and Apple's EULA remain accessible.
- Neither domain had an MX record at the first check. Rishit later said he
  will set up free forwarding for support and privacy on `verdure-app.com`.
  Do not publish a support contact or submit App Store metadata until a
  mailbox is configured and delivery-tested. The active domain uses Vercel DNS;
  [Vercel says it provides no mail service](https://vercel.com/docs/domains/working-with-domains).
  [ImprovMX](https://www.improvmx.com/pricing/) and
  [Forward Email](https://forwardemail.net/en) currently offer free forwarding
  to an existing inbox, but neither was configured.
- `npx --yes vercel whoami` reports Logged out; no `.vercel` project link is
  present in the local website directory. The web dashboard also opens to a
  sign-in screen, so the owning account/team and current plan are unverified.
  GitHub CLI is signed in, but the repository has no GitHub deployment records.
  No push or deploy was attempted.

## Free access requests

| Service | Official path | Current gate |
| --- | --- | --- |
| Idealist Listings API | [Open Network API inquiry](https://www.idealist.org/en/open-network-api), which leads to a five-question Typeform | First name, last name, email and organization are required on the first screen. The owner's contact identity is needed. The page describes API pricing but does not promise free access. Draft: `docs/IDEALIST-INQUIRY.md`. |
| SeatGeek Public Catalog API | [Developer portal](https://portal.seatgeek.com/) and its [approval form](https://docs.google.com/forms/d/13gfeUdfbZQpnT3XNd12pyi7P2A4W7vDoB4bSwIdlG9k/viewform) | The form requires the email address of a pending SeatGeek developer account and an intended-use explanation. It states the Public Catalog API provides catalog data, not prices or ticket listings. No developer account or key is available in the workspace. |
| Bandsintown and Songkick | See `docs/NATIONAL-API-EVALUATION.md` | Dropped from active work by Rishit's 2026-09-27 decision. |

## Next actions when inputs arrive

1. With the Verdure contact name, business email and organization name, complete
   the Idealist inquiry for listings access and pricing information. Do not agree
   to paid or contractual terms on behalf of the owner.
2. With a registered SeatGeek developer account email, submit the catalog API
   access request, then assess coverage and overlap before adding an adapter.
3. After the owner authorizes a website deployment and the correct Vercel
   project/account is connected, publish the locally prepared invite, privacy
   and pricing changes and verify the public routes.
