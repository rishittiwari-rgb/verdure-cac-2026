// Contexts for a named human reviewer. No relevance judgments are generated.
import { readFileSync, writeFileSync } from "node:fs";

const corpusPath = process.argv[2];
if (!corpusPath) throw new Error("Usage: node scripts/make-rank-golden-template.mjs <rank-corpus.json>");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
if (!corpus.corpusHash || !Array.isArray(corpus.events) || !corpus.snapshotAtMs) {
  throw new Error("Expected a frozen ranking corpus with a hash and snapshot time");
}
const sj = { lat: 37.3382, lng: -121.8863 };
const pa = { lat: 37.4419, lng: -122.1430 };
const mv = { lat: 37.3861, lng: -122.0839 };
const profiles = [
  ["cold-start-san-jose", { ...sj }],
  ["outdoors-san-jose", { ...sj, interests: ["outdoors"] }],
  ["volunteering-san-jose", { ...sj, interests: ["volunteering"] }],
  ["fitness-san-jose", { ...sj, interests: ["fitness"] }],
  ["arts-san-jose", { ...sj, interests: ["arts"] }],
  ["music-san-jose", { ...sj, interests: ["music"] }],
  ["food-san-jose", { ...sj, interests: ["food"] }],
  ["tech-san-jose", { ...sj, interests: ["tech"] }],
  ["learning-san-jose", { ...sj, interests: ["learning"] }],
  ["community-san-jose", { ...sj, interests: ["community"] }],
  ["family-five-year-old", { ...sj, interests: ["family"], householdYoungestAge: 5 }],
  ["family-ten-year-old", { ...sj, interests: ["family", "outdoors"], householdYoungestAge: 10 }],
  ["student-sjsu", { ...sj, interests: ["tech"], studentStatus: true, school: "San José State University" }],
  ["student-scu", { ...sj, interests: ["learning"], studentStatus: true, school: "Santa Clara University" }],
  ["close-to-home", { ...sj, interests: ["outdoors"], distancePreset: "close" }],
  ["worth-the-drive", { ...sj, interests: ["outdoors"], distancePreset: "drive" }],
  ["walkable-only", { ...sj, interests: ["community"], transportMode: "walk" }],
  ["palo-alto-arts", { ...pa, interests: ["arts", "music"] }],
  ["palo-alto-family", { ...pa, interests: ["family"], householdYoungestAge: 7 }],
  ["mountain-view-learning", { ...mv, interests: ["learning"] }],
].map(([id, context]) => ({ id, context, relevantEventIDs: [], reviewerNotes: "" }));

const path = corpusPath.replace(/rank-corpus-preview-/, "rank-golden-template-");
if (path === corpusPath) throw new Error("Expected a rank-corpus-preview-* input filename");
writeFileSync(path, JSON.stringify({ corpusHash: corpus.corpusHash,
  reviewerName: "", reviewedAt: "", profiles }, null, 2) + "\n");
console.log(`${path}: ${profiles.length} contexts, no relevance labels`);
