/**
 * Every vendor secret, declared once.
 *
 * A secret set with `firebase functions:secrets:set` is only mounted into a
 * function that DECLARES it in its `secrets: [...]` option — so each module
 * imports the declaration from here and lists what it needs. Declaring the same
 * name in two modules would only produce a "declared twice" warning, but one
 * definition per key keeps the go-live runbook and the code in step.
 *
 * NONE of these may ever appear in the iOS bundle again. SerpApi, Ticketmaster,
 * NPS and Recreation.gov keys previously shipped in Info.plist via
 * Secrets.xcconfig and are considered compromised: rotate all of them after the
 * first release that reads events from Firestore only.
 */

import { defineSecret } from "firebase-functions/params";

export const RECREATION_GOV_KEY = defineSecret("RECREATION_GOV_KEY");
export const NPS_API_KEY = defineSecret("NPS_API_KEY");
export const TICKETMASTER_KEY = defineSecret("TICKETMASTER_KEY");
export const SERPAPI_KEY = defineSecret("SERPAPI_KEY");
