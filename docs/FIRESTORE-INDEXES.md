# Firestore query and index audit

Local source/configuration proof only. No index has been deployed by this audit. The emulator does not enforce composite indexes; green emulator tests do not prove live index readiness. After a separately authorized deployment, wait for indexes to become ready and verify representative queries on that environment.

## Reproduce and enforce

Run `cd functions && npm run check:indexes`. The command scans the current sources, checks every mapping against `firestore.indexes.json`, and rejects stale or undocumented queries. CI and `test:units` run it. After reviewing a source change and adding any necessary index, run `node functions/scripts/check-firestore-indexes.mjs --write-docs` from the repository root. This only regenerates this document; it never writes indexes or deploys.

## Coverage and interpretation

Source roots: `functions/src`, `Verdure/Verdure`. Operational scripts: `functions/scripts/backfill-classify.mjs`, `functions/scripts/list-low-confidence.mjs`, `functions/scripts/coverage-check.mjs`, `functions/scripts/audit-volunteer-supply-local.mjs`, `functions/scripts/baseline.mjs`, `functions/scripts/backfill-annotate.mjs`, `functions/scripts/demo-investor-local.mjs`, `functions/scripts/outdoor-supply.mjs`. Tests and fixtures are excluded. New operational scripts containing queries are rejected until explicitly inventoried. The website console calls Firebase Functions; its Firestore queries appear under the server handlers below. Supabase SQL is outside this Firestore inventory.

TypeScript is parsed structurally, including variable aliases, conditional reassignments, finite collection names, and query helper parameters. Swift chains use a comment/string-aware balanced scanner. Unknown fields, operators, receivers, predicates, modular Web Firestore imports or dynamic directions fail closed and require a resolver extension. No whole-file hash substitutes for query inspection. Query values and pagination bounds do not alter index shape. Locations identify the last filter/order builder in a chain.

The inventory includes conservative builder prefixes and conditional variants, even if a later order is always appended before execution. Literal discriminator guards correlate the staff partner selector with its optional partnerId filter; that filter applies only to partnerPerks. The offline allRows helper's document-name order is resolved against all callers.

Every multiple-field query has an explicit matching composite, including equality-only combinations that Firestore could otherwise serve by index merging. Equality-prefix permutations/directions are accepted; ordered fields and array modes must match. A range with no explicit ordering receives its implicit ascending order. Single-field collection queries use automatic indexes; filtered/ordered collection-group queries require a matching fieldOverride. A scalar comparison against an array (ingestRuns.errors == []) uses ASCENDING, not CONTAINS. Explicit document-name order is conservatively included in composite definitions.

See [Firebase index types](https://firebase.google.com/docs/firestore/query-data/index-overview) and [index configuration schema](https://firebase.google.com/docs/reference/firestore/indexes).

## Compound mappings (53)

| Query location | Collection/scope | Filters | Explicit ordering | Matching index |
| --- | --- | --- | --- | --- |
| `Verdure/Verdure/Models/EventsAPIService.swift:301` | events / COLLECTION | hidden ==; active ==; broadcast ==; areaId ==; date >= | date ASCENDING | `COLLECTION/events/hidden:ASCENDING,active:ASCENDING,broadcast:ASCENDING,areaId:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/EventsAPIService.swift:310` | events / COLLECTION | hidden ==; active ==; broadcast ==; areaId ==; adultOnly ==; date >= | date ASCENDING | `COLLECTION/events/hidden:ASCENDING,active:ASCENDING,broadcast:ASCENDING,areaId:ASCENDING,adultOnly:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/EventsAPIService.swift:506` | events / COLLECTION | hidden ==; active ==; broadcast ==; category ==; date > | date ASCENDING | `COLLECTION/events/hidden:ASCENDING,active:ASCENDING,broadcast:ASCENDING,category:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/EventsAPIService.swift:514` | events / COLLECTION | hidden ==; active ==; broadcast ==; category ==; adultOnly ==; date > | date ASCENDING | `COLLECTION/events/hidden:ASCENDING,active:ASCENDING,broadcast:ASCENDING,category:ASCENDING,adultOnly:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/EventsAPIService.swift:556` | events / COLLECTION | hidden ==; active ==; broadcast ==; date >= | date ASCENDING | `COLLECTION/events/hidden:ASCENDING,active:ASCENDING,broadcast:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/EventsAPIService.swift:564` | events / COLLECTION | hidden ==; active ==; broadcast ==; adultOnly ==; date >= | date ASCENDING | `COLLECTION/events/hidden:ASCENDING,active:ASCENDING,broadcast:ASCENDING,adultOnly:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/EventsAPIService.swift:590` | events / COLLECTION | hidden ==; active ==; organizerId ==; date >= | Implicit/default | `COLLECTION/events/active:ASCENDING,hidden:ASCENDING,organizerId:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/EventsAPIService.swift:597` | events / COLLECTION | hidden ==; active ==; organizerId ==; adultOnly ==; date >= | Implicit/default | `COLLECTION/events/active:ASCENDING,hidden:ASCENDING,organizerId:ASCENDING,adultOnly:ASCENDING,date:ASCENDING` |
| `Verdure/Verdure/Models/FirestoreService.swift:182` | posts / COLLECTION | hidden == | createdAt DESCENDING | `COLLECTION/posts/hidden:ASCENDING,createdAt:DESCENDING` |
| `functions/scripts/baseline.mjs:115` | events / COLLECTION | areaId ==; active == | Implicit/default | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING` |
| `functions/scripts/coverage-check.mjs:35` | events / COLLECTION | areaId ==; active == | Implicit/default | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING` |
| `functions/scripts/demo-investor-local.mjs:94` | events / COLLECTION | areaId ==; active ==; adultOnly ==; date >=; date <= | date ASCENDING | `COLLECTION/events/active:ASCENDING,adultOnly:ASCENDING,areaId:ASCENDING,date:ASCENDING` |
| `functions/scripts/list-low-confidence.mjs:38` | events / COLLECTION | classificationConfidence < | classificationConfidence ASCENDING; __name__ ASCENDING | `COLLECTION/events/classificationConfidence:ASCENDING,__name__:ASCENDING` |
| `functions/scripts/outdoor-supply.mjs:28` | events / COLLECTION | areaId ==; active ==; date >=; date <= | Implicit/default | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING,date:ASCENDING` |
| `functions/src/account.ts:216` | moderationQueue / COLLECTION | targetType ==; targetId == | Implicit/default | `COLLECTION/moderationQueue/targetId:ASCENDING,targetType:ASCENDING` |
| `functions/src/discovery/discover.ts:155` | sourceSubmissions / COLLECTION | areaId ==; processedAt == | Implicit/default | `COLLECTION/sourceSubmissions/areaId:ASCENDING,processedAt:ASCENDING` |
| `functions/src/discovery/discover.ts:219` | sourceCandidates / COLLECTION | areaId ==; status ==; nextInspectAt <= | nextInspectAt ASCENDING | `COLLECTION/sourceCandidates/areaId:ASCENDING,status:ASCENDING,nextInspectAt:ASCENDING` |
| `functions/src/ingest/health.ts:32` | ingestRuns / COLLECTION | source ==; areaId == | Implicit/default | `COLLECTION/ingestRuns/areaId:ASCENDING,source:ASCENDING` |
| `functions/src/ingest/health.ts:34` | ingestRuns / COLLECTION | source ==; areaId == | runAt DESCENDING | `COLLECTION/ingestRuns/source:ASCENDING,areaId:ASCENDING,runAt:DESCENDING` |
| `functions/src/ingest/health.ts:35` | ingestRuns / COLLECTION | source ==; areaId ==; errors == | runAt DESCENDING | `COLLECTION/ingestRuns/source:ASCENDING,areaId:ASCENDING,errors:ASCENDING,runAt:DESCENDING` |
| `functions/src/ingest/index.ts:382` | events / COLLECTION | areaId ==; active == | Implicit/default | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING` |
| `functions/src/ingest/sources-registry.ts:103` | sources / COLLECTION | areaId ==; status == | Implicit/default | `COLLECTION/sources/areaId:ASCENDING,status:ASCENDING` |
| `functions/src/ingest/sources-registry.ts:104` | sources / COLLECTION | areaId ==; status ==; type == | Implicit/default | `COLLECTION/sources/areaId:ASCENDING,status:ASCENDING,type:ASCENDING` |
| `functions/src/ingest/sources-registry.ts:152` | sources / COLLECTION | areaId ==; status == | Implicit/default | `COLLECTION/sources/areaId:ASCENDING,status:ASCENDING` |
| `functions/src/ingest/store.ts:104` | events / COLLECTION | areaId ==; date >= | date ASCENDING | `COLLECTION/events/areaId:ASCENDING,date:ASCENDING` |
| `functions/src/moderation.ts:294` | moderationQueue / COLLECTION | status ==; slaDeadline <= | Implicit/default | `COLLECTION/moderationQueue/status:ASCENDING,slaDeadline:ASCENDING` |
| `functions/src/moderation.ts:334` | moderationQueue / COLLECTION | status ==; targetType == | Implicit/default | `COLLECTION/moderationQueue/status:ASCENDING,targetType:ASCENDING` |
| `functions/src/moderation.ts:334` | moderationQueue / COLLECTION | status in; targetType == | Implicit/default | `COLLECTION/moderationQueue/status:ASCENDING,targetType:ASCENDING` |
| `functions/src/moderation.ts:335` | moderationQueue / COLLECTION | status ==; targetType == | firstReportedAt ASCENDING | `COLLECTION/moderationQueue/status:ASCENDING,targetType:ASCENDING,firstReportedAt:ASCENDING` |
| `functions/src/moderation.ts:335` | moderationQueue / COLLECTION | status == | firstReportedAt ASCENDING | `COLLECTION/moderationQueue/status:ASCENDING,firstReportedAt:ASCENDING` |
| `functions/src/moderation.ts:335` | moderationQueue / COLLECTION | status in; targetType == | firstReportedAt ASCENDING | `COLLECTION/moderationQueue/status:ASCENDING,targetType:ASCENDING,firstReportedAt:ASCENDING` |
| `functions/src/moderation.ts:335` | moderationQueue / COLLECTION | status in | firstReportedAt ASCENDING | `COLLECTION/moderationQueue/status:ASCENDING,firstReportedAt:ASCENDING` |
| `functions/src/offline/packs.ts:47` | eventPlanSessions / COLLECTION | uid == | __name__ ASCENDING | `COLLECTION/eventPlanSessions/uid:ASCENDING,__name__:ASCENDING` |
| `functions/src/offline/packs.ts:47` | groupPlans / COLLECTION | memberUIDs array-contains | __name__ ASCENDING | `COLLECTION/groupPlans/memberUIDs:CONTAINS,__name__:ASCENDING` |
| `functions/src/organizers.ts:174` | organizers / COLLECTION | status == | createdAt ASCENDING | `COLLECTION/organizers/status:ASCENDING,createdAt:ASCENDING` |
| `functions/src/parks/api.ts:112` | events / COLLECTION | hidden ==; active ==; broadcast ==; date >=; date < | date ASCENDING | `COLLECTION/events/hidden:ASCENDING,active:ASCENDING,broadcast:ASCENDING,date:ASCENDING` |
| `functions/src/partners.ts:187` | partnerPerks / COLLECTION | active == | __name__ ASCENDING | `COLLECTION/partnerPerks/active:ASCENDING,__name__:ASCENDING` |
| `functions/src/place-stories.ts:173` | placeStoryOwnership / COLLECTION | ownerUid == | __name__ ASCENDING | `COLLECTION/placeStoryOwnership/ownerUid:ASCENDING,__name__:ASCENDING` |
| `functions/src/programs.ts:86` | events / COLLECTION | source == | applicationDeadline ASCENDING | `COLLECTION/events/source:ASCENDING,applicationDeadline:ASCENDING` |
| `functions/src/programs.ts:100` | events / COLLECTION | category ==; active ==; applicationDeadline > | applicationDeadline ASCENDING | `COLLECTION/events/category:ASCENDING,active:ASCENDING,applicationDeadline:ASCENDING` |
| `functions/src/programs.ts:118` | events / COLLECTION | category ==; active ==; applicationDeadline <= | applicationDeadline ASCENDING | `COLLECTION/events/category:ASCENDING,active:ASCENDING,applicationDeadline:ASCENDING` |
| `functions/src/ranking.ts:535` | events / COLLECTION | areaId ==; active == | Implicit/default | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING` |
| `functions/src/ranking.ts:538` | events / COLLECTION | areaId ==; active ==; date >= | date ASCENDING | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING,date:ASCENDING` |
| `functions/src/ranking.ts:539` | events / COLLECTION | areaId ==; active == | qualityScore DESCENDING | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING,qualityScore:DESCENDING` |
| `functions/src/ranking.ts:541` | events / COLLECTION | areaId ==; active ==; category ==; date >= | date ASCENDING | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING,category:ASCENDING,date:ASCENDING` |
| `functions/src/ranking.ts:595` | events / COLLECTION | areaId ==; active == | Implicit/default | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING` |
| `functions/src/ranking.ts:600` | events / COLLECTION | areaId ==; active ==; topicTags array-contains-any; date >=; date <= | date ASCENDING | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING,topicTags:CONTAINS,date:ASCENDING` |
| `functions/src/ranking.ts:603` | events / COLLECTION | areaId ==; active ==; category in; date >=; date <= | date ASCENDING | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING,category:ASCENDING,date:ASCENDING` |
| `functions/src/rsvp-partners.ts:27` | rsvpPartnerAlerts / COLLECTION | status ==; dueAt <= | dueAt ASCENDING | `COLLECTION/rsvpPartnerAlerts/status:ASCENDING,dueAt:ASCENDING` |
| `functions/src/social.ts:231` | invites / COLLECTION | eventId ==; status == | Implicit/default | `COLLECTION/invites/eventId:ASCENDING,status:ASCENDING` |
| `functions/src/staff-operations.ts:21` | moderationQueue / COLLECTION | status == | firstReportedAt ASCENDING | `COLLECTION/moderationQueue/status:ASCENDING,firstReportedAt:ASCENDING` |
| `functions/src/staff-operations.ts:28` | events / COLLECTION | areaId ==; active ==; date >= | date ASCENDING | `COLLECTION/events/areaId:ASCENDING,active:ASCENDING,date:ASCENDING` |
| `functions/src/staff-partners.ts:228` | partnerPerks / COLLECTION | partnerId == | __name__ ASCENDING | `COLLECTION/partnerPerks/partnerId:ASCENDING,__name__:ASCENDING` |

## Single-field and document-name mappings (82)

| Query location | Collection/scope | Filters | Explicit ordering | Matching index |
| --- | --- | --- | --- | --- |
| `Verdure/Verdure/Models/SocialService.swift:210` | invites / COLLECTION | — | createdAt DESCENDING | `Automatic collection index: createdAt:DESCENDING` |
| `Verdure/Verdure/Models/SocialService.swift:230` | notifications / COLLECTION | — | createdAt DESCENDING | `Automatic collection index: createdAt:DESCENDING` |
| `functions/scripts/audit-volunteer-supply-local.mjs:13` | events / COLLECTION | category == | Implicit/default | `Automatic collection index: category:ASCENDING` |
| `functions/scripts/backfill-annotate.mjs:52` | events / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/scripts/backfill-classify.mjs:53` | events / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/scripts/backfill-classify.mjs:72` | events / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/scripts/demo-investor-local.mjs:63` | attendees / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/attendees/uid:ASCENDING` |
| `functions/src/account.ts:59` | posts / COLLECTION | authorID == | Implicit/default | `Automatic collection index: authorID:ASCENDING` |
| `functions/src/account.ts:62` | postLikes / COLLECTION | postId == | Implicit/default | `Automatic collection index: postId:ASCENDING` |
| `functions/src/account.ts:69` | postLikes / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:75` | events / COLLECTION | creatorID == | Implicit/default | `Automatic collection index: creatorID:ASCENDING` |
| `functions/src/account.ts:77` | events / COLLECTION | organizerOwnerUid == | Implicit/default | `Automatic collection index: organizerOwnerUid:ASCENDING` |
| `functions/src/account.ts:87` | organizers / COLLECTION | ownerUid == | Implicit/default | `Automatic collection index: ownerUid:ASCENDING` |
| `functions/src/account.ts:95` | placeStories / COLLECTION | ownerUid == | Implicit/default | `Automatic collection index: ownerUid:ASCENDING` |
| `functions/src/account.ts:106` | placeStoryOwnership / COLLECTION | ownerUid == | Implicit/default | `Automatic collection index: ownerUid:ASCENDING` |
| `functions/src/account.ts:118` | attendees / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/attendees/uid:ASCENDING` |
| `functions/src/account.ts:139` | following / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/following/uid:ASCENDING` |
| `functions/src/account.ts:141` | friends / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/friends/uid:ASCENDING` |
| `functions/src/account.ts:143` | friendRequests / COLLECTION_GROUP | fromUid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/friendRequests/fromUid:ASCENDING` |
| `functions/src/account.ts:145` | friendRequests / COLLECTION_GROUP | toUid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/friendRequests/toUid:ASCENDING` |
| `functions/src/account.ts:147` | blocks / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/blocks/uid:ASCENDING` |
| `functions/src/account.ts:149` | invites / COLLECTION_GROUP | fromUid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/invites/fromUid:ASCENDING` |
| `functions/src/account.ts:151` | notifications / COLLECTION_GROUP | actorUid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/notifications/actorUid:ASCENDING` |
| `functions/src/account.ts:153` | activity / COLLECTION | actorUid == | Implicit/default | `Automatic collection index: actorUid:ASCENDING` |
| `functions/src/account.ts:155` | usernames / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:157` | entries / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/entries/uid:ASCENDING` |
| `functions/src/account.ts:159` | users / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:165` | attendance / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:167` | rateLimits / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:168` | storyEngagementKeys / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:170` | events / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/events/uid:ASCENDING` |
| `functions/src/account.ts:172` | plannerRuns / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:174` | eventPlanSessions / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:176` | feedSessions / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:178` | feedImpressions / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:179` | groupPlans / COLLECTION | ownerUid == | Implicit/default | `Automatic collection index: ownerUid:ASCENDING` |
| `functions/src/account.ts:182` | groupPlans / COLLECTION | memberUIDs array-contains | Implicit/default | `Automatic collection index: memberUIDs:CONTAINS` |
| `functions/src/account.ts:187` | groupPlans / COLLECTION | pendingUIDs array-contains | Implicit/default | `Automatic collection index: pendingUIDs:CONTAINS` |
| `functions/src/account.ts:194` | fulfillments / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/account.ts:212` | reports / COLLECTION | reporterUid == | Implicit/default | `Automatic collection index: reporterUid:ASCENDING` |
| `functions/src/common.ts:267` | blocks / COLLECTION_GROUP | uid == | Implicit/default | `fieldOverrides: COLLECTION_GROUP/blocks/uid:ASCENDING` |
| `functions/src/discovery/discover.ts:149` | organizers / COLLECTION | calendarUrl > | Implicit/default | `Automatic collection index: calendarUrl:ASCENDING` |
| `functions/src/discovery/discover.ts:230` | sources / COLLECTION | host in | Implicit/default | `Automatic collection index: host:ASCENDING` |
| `functions/src/economy.ts:328` | codes / COLLECTION | claimedBy == | Implicit/default | `Automatic collection index: claimedBy:ASCENDING` |
| `functions/src/economy.ts:419` | fulfillments / COLLECTION | month == | Implicit/default | `Automatic collection index: month:ASCENDING` |
| `functions/src/feedTelemetry.ts:76` | eventPlanSessions / COLLECTION | createdAt < | Implicit/default | `Automatic collection index: createdAt:ASCENDING` |
| `functions/src/feedTelemetry.ts:76` | feedImpressions / COLLECTION | createdAt < | Implicit/default | `Automatic collection index: createdAt:ASCENDING` |
| `functions/src/feedTelemetry.ts:76` | feedSessions / COLLECTION | createdAt < | Implicit/default | `Automatic collection index: createdAt:ASCENDING` |
| `functions/src/fulfillment.ts:382` | fulfillments / COLLECTION | status in | Implicit/default | `Automatic collection index: status:ASCENDING` |
| `functions/src/groupPlans.ts:46` | groupPlans / COLLECTION | memberUIDs array-contains | Implicit/default | `Automatic collection index: memberUIDs:CONTAINS` |
| `functions/src/groupPlans.ts:47` | groupPlans / COLLECTION | pendingUIDs array-contains | Implicit/default | `Automatic collection index: pendingUIDs:CONTAINS` |
| `functions/src/groupPlans.ts:63` | groupPlans / COLLECTION | ownerUid == | Implicit/default | `Automatic collection index: ownerUid:ASCENDING` |
| `functions/src/ingest/sources-registry.ts:159` | sources / COLLECTION | host in | Implicit/default | `Automatic collection index: host:ASCENDING` |
| `functions/src/ingest/store.ts:113` | rejectedListings / COLLECTION | areaId == | Implicit/default | `Automatic collection index: areaId:ASCENDING` |
| `functions/src/moderation.ts:251` | reports / COLLECTION | queueId == | Implicit/default | `Automatic collection index: queueId:ASCENDING` |
| `functions/src/moderation.ts:317` | moderationQueue / COLLECTION | status == | Implicit/default | `Automatic collection index: status:ASCENDING` |
| `functions/src/moderation.ts:332` | moderationQueue / COLLECTION | status in | Implicit/default | `Automatic collection index: status:ASCENDING` |
| `functions/src/moderation.ts:333` | moderationQueue / COLLECTION | status == | Implicit/default | `Automatic collection index: status:ASCENDING` |
| `functions/src/moderation.ts:345` | reports / COLLECTION | queueId == | Implicit/default | `Automatic collection index: queueId:ASCENDING` |
| `functions/src/moderation.ts:382` | events / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/moderation.ts:382` | organizers / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/moderation.ts:382` | posts / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/notifications.ts:182` | users / COLLECTION | fcmTokens != | Implicit/default | `Automatic collection index: fcmTokens:ASCENDING` |
| `functions/src/offline/packs.ts:47` | adventurePlans / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/offline/packs.ts:47` | dismissedPerks / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/offline/packs.ts:47` | following / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/offline/packs.ts:79` | eventPlanSessions / COLLECTION | uid == | Implicit/default | `Automatic collection index: uid:ASCENDING` |
| `functions/src/offline/packs.ts:80` | groupPlans / COLLECTION | memberUIDs array-contains | Implicit/default | `Automatic collection index: memberUIDs:CONTAINS` |
| `functions/src/offline/packs.ts:241` | offlinePacks / COLLECTION_GROUP | stageExpiresAt <= | stageExpiresAt ASCENDING | `fieldOverrides: COLLECTION_GROUP/offlinePacks/stageExpiresAt:ASCENDING` |
| `functions/src/organizers.ts:56` | organizers / COLLECTION | status == | Implicit/default | `Automatic collection index: status:ASCENDING` |
| `functions/src/organizers.ts:57` | organizers / COLLECTION | approvedAt > | Implicit/default | `Automatic collection index: approvedAt:ASCENDING` |
| `functions/src/organizers.ts:63` | organizers / COLLECTION | ownerUid == | Implicit/default | `Automatic collection index: ownerUid:ASCENDING` |
| `functions/src/organizers.ts:149` | events / COLLECTION | organizerId == | Implicit/default | `Automatic collection index: organizerId:ASCENDING` |
| `functions/src/parks/api.ts:128` | features / COLLECTION | parkIds array-contains | Implicit/default | `Automatic collection index: parkIds:CONTAINS` |
| `functions/src/parks/store.ts:174` | parkGenerations / COLLECTION | createdAt < | Implicit/default | `Automatic collection index: createdAt:ASCENDING` |
| `functions/src/place-stories.ts:107` | placeStoryOwnership / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/social.ts:244` | users / COLLECTION | savedEventIDs array-contains | Implicit/default | `Automatic collection index: savedEventIDs:CONTAINS` |
| `functions/src/staff-operations.ts:17` | moderationQueue / COLLECTION | status == | Implicit/default | `Automatic collection index: status:ASCENDING` |
| `functions/src/staff-operations.ts:22` | organizers / COLLECTION | status == | Implicit/default | `Automatic collection index: status:ASCENDING` |
| `functions/src/staff-partners.ts:227` | partnerPerks / COLLECTION | partnerId == | Implicit/default | `Automatic collection index: partnerId:ASCENDING` |
| `functions/src/staff-partners.ts:228` | partnerPerks / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
| `functions/src/staff-partners.ts:228` | partners / COLLECTION | — | __name__ ASCENDING | `Built-in document-name index` |
