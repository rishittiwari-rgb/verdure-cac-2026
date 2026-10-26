# Volunteer supply follow-up — 2026-09-27

Four organizations in G4 were fingerprinted read-only with
`node functions/scripts/fingerprint.mjs <hostname>`. These probes do **not**
add post-freeze sources or imply any live Verdure listings. The C0 human audit
has not passed, so the source list remains frozen.

| Organization | Official calendar evidence | Fingerprint result |
| --- | --- | --- |
| [Our City Forest](https://www.ourcityforest.org/newsletters) | Volunteer calendar and Eventbrite signup mentioned | Home/robots 200; LiveWhale, Localist and CivicPlus probes 404; platform unconfirmed |
| [Guadalupe River Park Conservancy](https://grpg.org/calendar/events/) | Recurring orchard, rose garden and trail workdays | WordPress home/robots 200; apparent 200s at LiveWhale/Localist paths returned **HTML**, not feed data; platform unconfirmed |
| [Grassroots Ecology](https://www.grassrootsecology.org/calendar) | Official volunteer events calendar | Home/robots 200; standard feed probes 404; platform unconfirmed |
| [Keep Coyote Creek Beautiful](https://www.keepcoyotecreekbeautiful.org/creek-cleanups) | Monthly creek cleanups link to Eventbrite registration | Wix home/robots 200; LiveWhale/Localist probes 404, CivicPlus probe 400; platform unconfirmed |

The official Guadalupe page says community workdays require preregistration
and gives chaperone rules for younger volunteers. Those facts must be preserved
if its listings are eventually indexed. A 200 HTML response on a feed-shaped
URL is **not** a feed; the fingerprinter correctly leaves the platform unknown.

At that September checkpoint, next source work needed a terms/usage review and an actual structured event
endpoint or organizer permission. A silent HTML parser would violate the
existing source-failure rule. Once the human classifier audit passes, any
source added here requires rerunning the C0.4 audit before shipping.

The official [Idealist Open Network API page](https://www.idealist.org/en/open-network-api)
routes applicants to an inquiry form. The application is prepared in
`IDEALIST-INQUIRY.md`; it has not been submitted because the project has no
verified business contact name/email in the repository.

## Existing-feed supply preview

A read-only `node functions/scripts/ingest-smoke.mjs` run after the classifier
corrections fetched **12,267 raw records** from all 11 configured public feeds.
Of those, **3,213** were dated in the following 30 days, carried coordinates,
and lay strictly within 25 miles of the San José center. **55** of those were
classified Volunteer before deduplication or human review: San José Public
Library 42, Midpen 10, SJSU 2, Stanford 1. The log is
`/tmp/verdure-radius-preview-20260927.log`.

This is promising source supply, **not** a pass of the 30-live-listing gate.
The production `/events` collection remains empty, repeated occurrences and
false-positive volunteer labels have not been removed, and some source entries
may not ask attendees to volunteer. Review each candidate's activity and age
eligibility before deciding whether the subtype can appear.

## October 4 current-corpus audit and complete native supply

This supersedes the September supply preview as current **local** evidence.
The working emulator initially contained 124 test/review documents rather than
the public corpus. `refresh-public-corpus-local.mjs` refreshed the six configured,
previously reviewed public adapters through the actual frozen classifier,
deduplication, provenance, staleness and source-health pipeline. All six completed
without errors. No new adapter, classifier mapping or ranking tuning was used.

At the recorded audit time, 137 current public Volunteer-classified listings
were within 25 miles of San José City Hall; 53 fell in the next 30 days. The
persisted source counts were BiblioCommons 121, Midpen 12, Localist 3 and
LiveWhale 1. The additional title/start/location audit found zero duplicates.
Different dated service sessions remain separate listings; duplicate copies of
the same occurrence do not. Test records without source provenance are excluded.

Classification is not proof that attendees volunteer. A conservative reviewed
subset contains **80 direct-service invitations**: 65 library service sessions,
12 official Midpen volunteer projects, two university garden invitations and
one SCU garden session. The other 53 teen-service meetings/orientations are
outside this lower bound. Four apparent category false positives (two meditation
sessions, an admissions talk and an awards event) are recorded separately and
not counted in the 80. Their records and the frozen classifier were not changed.
This is an invitation-evidence review, not a new human accuracy benchmark.

`volunteer-invitation-review-2026-10-04.json` records reviewed IDs and a digest of
their descriptions. The read-only audit checks current visibility, dates,
radius, duplicate rules and those exact reviewed facts again; an expired or
changed record cannot inherit its earlier confirmation. See the report's
`invitationReview` for the current 30-day subset and repeatable lower bound.

Native supply previously counted only the first 80 chronological discovery
cards. `EventsAPIService.fetchVolunteerSupply()` now pages the complete current
public Volunteer query independently, with the existing rule constraints and
an explicit 2,000-document bound. Discovery and Everything receive the full
supply; threshold filtering counts unique current in-radius IDs. A failure
clears the complete supply rather than retaining a stale count. Signed-out
public browsing remains supported. The category/visibility/date index is added
locally; production deployment and the full H1 inventory are not claimed.

Fresh connected native tests passed for all public Volunteer IDs beyond the
first 80, both discovery arrays, and the 25-mile chip. A separate unit proves
29 + duplicate, expired or distant listings stay hidden, while 30 unique
current local listings reveal the chip. Program account/eligibility regressions
also passed alongside this change: **4 tests, zero failures or skips**, recorded
in `docs/evidence/opportunity-native-regressions-2026-10-04.json`. Program
fixtures were cleaned again after that run. The conservative reviewed subset
includes **36 invitations in the next 30 days**, so the minimum is met even
without counting the longer horizon or teen-service meeting records.

## Nine requested organizations — current fingerprint and permission disposition

All nine hosts were probed on October 4 using the existing read-only
fingerprinter. Three complete receipts are saved under `docs/evidence`.
These are endpoint findings, not a claim that no other endpoint exists.
No contact, signup or permission request was sent.

| Organization | Published source / terms observations | Current disposition |
| --- | --- | --- |
| [Our City Forest](https://www.ourcityforest.org/volunteers) | Official page directs dated listings to Eventbrite; standard feed probes 404. [robots](https://www.ourcityforest.org/robots.txt) disallows Squarespace JSON/iCal format routes. | No supported permission-reviewed feed found; no Squarespace format-route workaround or Eventbrite scraper added. |
| [Guadalupe River Park Conservancy](https://grpg.org/get-involved/volunteer/) | WordPress; apparent feed-shaped 200s are HTML. [Published terms](https://grpg.org/terms/) prohibit scraping/data mining. They contain template text, which is recorded rather than treated as permission to ignore the restriction. | Excluded from automated ingestion pending an authorized feed/organizer path. Preregistration and minor/chaperone conditions remain relevant. |
| [Grassroots Ecology](https://www.grassrootsecology.org/calendar) | Public calendar; standard feed probes 404. [robots](https://www.grassrootsecology.org/robots.txt) disallows JSON/iCal format routes. No separately verified reuse permission discovered. | No adapter added; permission/official feed remains unresolved. Do not use prohibited format routes. |
| [Save The Bay](https://savesfbay.org/calendar/) | Actual published iCalendar and Tribe JSON endpoints found beyond the standard probes. iCal carries `X-Robots-Tag:noindex`; neither feed supplies venue coordinates. [robots](https://savesfbay.org/robots.txt) requests a 10-second crawl delay. [Privacy policy](https://savesfbay.org/privacy-policy/) is not a republication license. | Excluded from automatic ingestion: the inspected policies do not establish reuse permission and the feeds do not provide precise official venue geometry. A supported permission/venue source is required before onboarding. No coordinate guesses or unsupported permission claim. |
| [Keep Coyote Creek Beautiful](https://www.keepcoyotecreekbeautiful.org/creek-cleanups) | Wix; official cleanup page links to Eventbrite. Standard feeds return 404 or CivicPlus 400. No independently verified ingestion permission. | No supported feed added; organizer/feed permission remains unresolved. |
| [San José Parks Foundation](https://www.sanjoseparks.org/volunteer) | Wix page offers a volunteer signup form, not dated occurrences. Standard feed probes return 404/400. No published feed/license found by this survey. | No listings fabricated from a signup form; authorized dated source remains unresolved. |
| [HandsOn Bay Area](https://www.handsonbayarea.org/calendar) | Home identifies HandsOn Connect; feed probes 404, robots 404. [Privacy policy](https://www.handsonbayarea.org/privacy-policy) references HandsOn Connect terms; the attempted `/terms-of-use` path is 404. | Permission is **unverified**, not declared forbidden or granted; no unsupported API/HTML adapter added. |
| [United Way Bay Area](https://uwba.org/get-involved/volunteer/) | Current page offers a volunteer newsletter rather than dated local listings. Standard feeds 404. [Published policy/terms](https://uwba.org/privacy-policy/) describes site/user data, not a dated export. | No dated supply to ingest from the inspected page; future calendar/feed candidate remains open. |
| [JustServe](https://www.justserve.org/) | SPA; standard API probe 404, RSS-shaped 200 is HTML. [robots](https://www.justserve.org/robots.txt) allows projects while excluding account/admin routes. The [official terms](https://www.churchofjesuschrist.org/legal/justserve-terms-of-use?lang=eng) retrieval returned 503. | Terms/feed permission remains **unverified**; no account access, private API guess or scraper added. A terms-search result alone was not treated as permission. |

The minimum local supply is met by existing permission-reviewed feeds. D2's
required fingerprint/disposition survey is complete: supported licensed feeds
continue through the existing pipeline; all nine additional hosts have explicit
exclusion reasons where permission, a supported dated feed or venue facts are
missing. This is not a claim that excluded organizations were ingested. The native threshold
does not depend on activating any fictional organization or sending outreach.

## Re-run current local evidence

From repository root, with the working loopback emulator running:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 GCLOUD_PROJECT=connectify-19dd8 node functions/scripts/refresh-public-corpus-local.mjs docs/evidence/volunteer-public-source-refresh-2026-10-04.json
FIRESTORE_EMULATOR_HOST=127.0.0.1:8899 GCLOUD_PROJECT=connectify-19dd8 node functions/scripts/audit-volunteer-supply-local.mjs docs/evidence/volunteer-supply-2026-10-04.json docs/evidence/volunteer-invitation-review-2026-10-04.json
node functions/scripts/fingerprint.mjs www.ourcityforest.org grpg.org www.grassrootsecology.org savesfbay.org www.keepcoyotecreekbeautiful.org www.sanjoseparks.org www.handsonbayarea.org uwba.org www.justserve.org
xcodebuild -project Verdure/Verdure.xcodeproj -scheme Verdure -destination 'platform=iOS Simulator,id=D55D802A-6C43-4FD0-8E2F-65952BF28EB7' -only-testing:VerdureTests/CoreLogicTests/testVolunteerSupplyReadsCompletePublicCorpusBeyondFirstDiscoveryPage -only-testing:VerdureTests/CoreLogicTests/testVolunteerChipRequiresThirtyUniqueCurrentListingsInRadius test
```

Refresh is a local write; the subsequent audit only reads Firestore. Both refuse
production hosts/project mismatch. A changed dataset may require a new review
rather than editing old evidence to manufacture a pass. Count receipts and
source provenance, not API fetch totals, prove the supply result. Physical
device behavior, production indexes and deployment remain untested.

## Final October 4 read-back

The final read-only audit again found 137 classified listings in 25 miles,
80 reviewed direct-service invitations, and 36 reviewed invitations within
30 days. See `docs/evidence/volunteer-supply-final-2026-10-04.json`. Changed
description digests cannot reuse prior review. Save The Bay's current official
calendar and privacy policy were rechecked and its robots receipt retained
(`save-the-bay-robots-2026-10-04.txt`): crawl permission is not a republication
license. No permission outreach, private API guessing or venue coordinate
guessing was performed. Future source onboarding remains conditional on facts
that the published pages currently do not establish.
