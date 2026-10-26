/**
 * E4 — seed placeholder partner perks for local development.
 *
 * THESE ARE NOT REAL PARTNERS. No agreement exists with any business named
 * here. They exist so the perk UI, the surfacing rules and the redemption flow
 * can be exercised end to end against the emulator, and so the layout is
 * designed against realistic copy rather than "Perk 1 / Perk 2".
 *
 * The geography IS real: these are actual San Jose locations inside the launch
 * radius, because a perk two miles away and a perk two hundred miles away
 * exercise the distance term completely differently, and placeholder
 * coordinates would have hidden that.
 *
 * REFUSES TO RUN AGAINST PRODUCTION. Seeding fake partner offers into the live
 * catalog would put businesses' names on discounts they never agreed to, which
 * is not a bug you get to fix afterwards.
 */

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host ?? "")) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is not set.");
  console.error("These are placeholder partners and must never reach production.");
  process.exit(1);
}

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
initializeApp({ projectId: process.env.GCLOUD_PROJECT || "connectify-19dd8" });
const db = getFirestore();

const DAY = 86_400_000;
const now = Date.now();

const PERKS = [
  {
    id: "dev-roastery-coffee",
    title: "Free drip coffee with any pastry",
    partner: "Fictional Test Coffee Shop",
    description: "Show this code at the counter. One per customer.",
    kind: "discount",
    pointCost: 500,
    active: true,
    // San Pedro Square Market — real coordinates, inside the radius.
    latitude: 37.3365, longitude: -121.8947,
    categories: ["Market", "Social", "Meetup"],
    // A coffee perk at 9pm is the canonical example of a technically-valid,
    // obviously-wrong placement. Constrained so the hour logic is exercised.
    hours: [6, 7, 8, 9, 10, 11],
    terms: "Valid at the San Pedro Square location only. Not transferable.",
    codes: ["DEV-COFFEE-001", "DEV-COFFEE-002", "DEV-COFFEE-003"],
  },
  {
    id: "dev-trail-outfitter",
    title: "15% off trail gear",
    partner: "Fictional Test Trail Shop",
    description: "In-store only, on full-price items.",
    kind: "discount",
    pointCost: 1500,
    active: true,
    // Almaden Quicksilver area — real, ~8 mi out, so it exercises the
    // mid-distance band rather than the "basically here" one.
    latitude: 37.1878, longitude: -121.8408,
    categories: ["Cleanup", "Sports", "Volunteer"],
    hours: [],                       // any time — outdoor gear has no rush hour
    terms: "Excludes sale items and gift cards.",
    codes: ["DEV-TRAIL-001", "DEV-TRAIL-002"],
  },
  {
    id: "dev-museum-early",
    title: "Two-for-one admission",
    partner: "Fictional Test Activity Center",
    description: "Bring a friend. Members get this a week before everyone else.",
    kind: "experience",
    pointCost: 2000,
    active: true,
    latitude: 37.3496, longitude: -121.9059,
    categories: ["Workshop", "Festival", "Social"],
    hours: [10, 11, 12, 13, 14, 15, 16],
    // The early-access case: locked for free members, visible with its unlock
    // date, claimable now for Verdure+. This is the one that proves rule 6 —
    // both tiers SEE it, only one can claim it today.
    earlyAccessUntil: Timestamp.fromMillis(now + 7 * DAY),
    terms: "Valid Wednesday–Sunday. Under-5s free.",
    codes: ["DEV-MUSEUM-001", "DEV-MUSEUM-002", "DEV-MUSEUM-003", "DEV-MUSEUM-004"],
  },
];

for (const { codes, ...perk } of PERKS) {
  const partnerId = `${perk.id}-partner`;
  await db.doc(`partners/${partnerId}`).set({
    name: perk.partner, category: perk.id.includes("coffee") ? "coffee" : perk.id.includes("museum") ? "activities" : "retail",
    latitude: perk.latitude, longitude: perk.longitude, active: true, isPlaceholder: true,
    agreement: { agreedBy: "Fictional fixture owner", agreedAt: Timestamp.fromMillis(now),
      reference: "Emulator fixture only; not a real business agreement" },
  });
  await db.collection("partnerPerks").doc(perk.id).set({
    ...perk, partnerId, expiresAt: Timestamp.fromMillis(now + 30 * DAY),
    codePoolCount: codes.length,
    redeemedCount: 0,
    impressions: 0,
    seededAt: Timestamp.fromMillis(now),
    isPlaceholder: true,           // so a real catalog can never be confused for this
  });
  for (const code of codes) {
    await db.collection(`partnerPerks/${perk.id}/codes`).doc(code).set({
      code, claimedBy: null, claimedAt: null,
    });
  }
  console.log(`  seeded ${perk.id} (${codes.length} codes)${perk.earlyAccessUntil ? " [early access]" : ""}`);
}

console.log(`\n${PERKS.length} placeholder partners seeded. These are NOT real agreements.`);
