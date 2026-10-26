import assert from "node:assert/strict";
import { storyContent, storyPlaceId, storyRevision, storyIsPublic } from "../lib/place-story-policy.js";
let checks = 0;
function check(name, action) { action(); checks++; console.log(`PASS ${name}`); }
for (const value of ["city-parks_1", "county-boundaries_12", "osm-123", "rec-42", "nps-a-b-c"])
  check(`known place ID ${value}`, () => assert.equal(storyPlaceId(value), value));
for (const value of [null, "", "../users/one", "city-parks_", "nps-/users", "made-up-place"])
  check(`unsafe place ID ${JSON.stringify(value)}`, () => assert.throws(() => storyPlaceId(value)));
check("400 Unicode code points are accepted without surrogate truncation", () => assert.equal(storyContent("🌳".repeat(400)), "🌳".repeat(400)));
check("401 code points are rejected instead of truncated", () => assert.throws(() => storyContent("🌳".repeat(401))));
check("blank text removes public prose", () => assert.equal(storyContent(" \n\t "), ""));
check("multiline text preserves organizer paragraphs", () => assert.equal(storyContent("  First\nSecond  "), "First\nSecond"));
check("control characters are refused", () => assert.throws(() => storyContent("Hello\u0000world")));
const assignment = { active: true, storyId: "story", ownerUid: "owner", organizerId: "org", placeName: "Park" };
const story = { id: "story", ownerUid: "owner", organizerId: "org", content: "Organizer's own account", version: 1, hidden: false, removed: false };
const organizer = { ownerUid: "owner", status: "approved", hidden: false }, author = { suspended: false };
check("approved canonical publisher is public", () => assert.ok(storyIsPublic(assignment, story, organizer, author)));
for (const [label, a, s, o, u] of [
  ["revoked ownership", { ...assignment, active: false }, story, organizer, author],
  ["different story", { ...assignment, storyId: "successor" }, story, organizer, author],
  ["different owner", { ...assignment, ownerUid: "other" }, story, organizer, author],
  ["changed organizer owner", assignment, story, { ...organizer, ownerUid: "other" }, author],
  ["pending organizer", assignment, story, { ...organizer, status: "pending" }, author],
  ["hidden organizer", assignment, story, { ...organizer, hidden: true }, author],
  ["removed organizer", assignment, story, { ...organizer, removed: true }, author],
  ["suspended author", assignment, story, organizer, { suspended: true }],
  ["deleted author", assignment, story, organizer, undefined],
  ["hidden story", assignment, { ...story, hidden: true }, organizer, author],
  ["removed story", assignment, { ...story, removed: true }, organizer, author],
  ["blank story", assignment, { ...story, content: "  " }, organizer, author],
]) check(`${label} is never public`, () => assert.equal(storyIsPublic(a, s, o, u), false));
for (const [label, a, s] of [
  ["prose edit", assignment, { ...story, content: "Revised account" }],
  ["moderation", assignment, { ...story, hidden: true }],
  ["revocation", { ...assignment, active: false }, story],
  ["transfer", { ...assignment, storyId: "successor" }, story],
]) check(`${label} changes live revision`, () => assert.notEqual(storyRevision(a, s), storyRevision(assignment, story)));
check("private verification text cannot influence public metadata", () => assert.equal(storyRevision({ ...assignment, verificationReference: "PRIVATE" }, story), storyRevision(assignment, story)));
console.log(`${checks} place-story policy checks passed`);
