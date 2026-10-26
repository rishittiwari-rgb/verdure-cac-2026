import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";

export const MAX_STORY_CHARACTERS = 400;
export function storyPlaceId(value: unknown): string {
  if (typeof value !== "string" || value.length > 180 ||
      !/^(?:(?:city-parks|county-boundaries)_\d{1,12}|osm-\d{1,20}|(?:rec|nps)-[a-zA-Z0-9-]{1,140})$/.test(value)) {
    throw new HttpsError("invalid-argument", "Choose a park or a place from Verdure.");
  }
  return value;
}
export function storyContent(value: unknown): string {
  if (typeof value !== "string" || Array.from(value).length > MAX_STORY_CHARACTERS ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) {
    throw new HttpsError("invalid-argument", "Write up to 400 characters of plain text.");
  }
  // Blank text removes the public story. Never truncate an organizer's prose.
  return value.trim();
}
export function organizerStoryGate(data: FirebaseFirestore.DocumentData | undefined) {
  return { allowed: !!data && data.status === "approved" && data.hidden !== true && data.removed !== true };
}
export function authorStoryGate(data: FirebaseFirestore.DocumentData | undefined) {
  return { allowed: !!data && data.suspended !== true };
}
export function storyRevision(ownership: FirebaseFirestore.DocumentData | undefined, story?: FirebaseFirestore.DocumentData) {
  return createHash("sha256").update(JSON.stringify({ active: ownership?.active === true,
    storyId: ownership?.storyId ?? null, organizerId: ownership?.organizerId ?? null, ownerUid: ownership?.ownerUid ?? null,
    placeName: ownership?.placeName ?? null, content: story?.content ?? null, version: story?.version ?? null,
    hidden: story?.hidden === true, removed: story?.removed === true })).digest("hex");
}
export function storyIsPublic(ownership: FirebaseFirestore.DocumentData | undefined, story: FirebaseFirestore.DocumentData | undefined,
  organizer: FirebaseFirestore.DocumentData | undefined, author: FirebaseFirestore.DocumentData | undefined) {
  return ownership?.active === true && !!story && ownership.storyId === story.id &&
    ownership.organizerId === story.organizerId && ownership.ownerUid === story.ownerUid && organizer?.ownerUid === story.ownerUid &&
    organizerStoryGate(organizer).allowed && authorStoryGate(author).allowed &&
    story.hidden === false && story.removed !== true && typeof story.content === "string" && story.content.trim().length > 0;
}
