import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const STAFF_COOKIE = "verdure_staff_session";
const PROJECT = "connectify-19dd8";
export const STAFF_FUNCTIONS = new Set([
  "staffSession", "staffOperations", "listModerationQueue", "moderateContent", "listOrganizerApplications", "approveOrganizer",
  "listStaffPrograms", "saveProgram", "deactivateProgram",
  "setPlaceStoryOwnership", "listStaffStoryPlaces",
  "listStaffPartners", "savePartner", "upsertPartnerPerk", "importPartnerCodes", "deactivatePartnerOffer",
]);
export class StaffError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function staffConfiguration() {
  const local = process.env.VERDURE_STAFF_EMULATOR === "1";
  if (local && process.env.NODE_ENV === "production") throw new StaffError("Local staff testing is unavailable in a production build.", 503);
  const apiKey = local ? "local" : process.env.VERDURE_FIREBASE_API_KEY;
  if (!apiKey) throw new StaffError("Staff sign-in is not configured on this server.", 503);
  return {
    authUrl: `${local ? "http://127.0.0.1:9099/identitytoolkit.googleapis.com" : "https://identitytoolkit.googleapis.com"}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    functionsUrl: local ? `http://127.0.0.1:5002/${PROJECT}/us-central1` : `https://us-central1-${PROJECT}.cloudfunctions.net`,
  };
}
export function checkSameOrigin(request: Request,
  originMessage = "This request must come from the staff console."): void {
  // Next may normalize a loopback request URL to localhost even when the
  // browser used 127.0.0.1. Host is the origin the browser actually addressed.
  let expectedOrigin: string;
  try { expectedOrigin = new URL(`${new URL(request.url).protocol}//${request.headers.get("host")}`).origin; }
  catch { throw new StaffError(originMessage, 403); }
  if (request.headers.get("origin") !== expectedOrigin) throw new StaffError(originMessage, 403);
}
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) throw new StaffError("A request body is required.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new StaffError("The request is too large.", 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function readStaffJson(request: Request, maxBytes = 131072,
  originMessage = "This request must come from the staff console."): Promise<Record<string, unknown>> {
  checkSameOrigin(request, originMessage);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new StaffError("JSON is required.", 415);
  const body = await readBoundedText(request, maxBytes);
  try {
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new StaffError("The request must contain a JSON object."); }
}
export async function staffCall(name: string, data: unknown, suppliedToken?: string) {
  if (!STAFF_FUNCTIONS.has(name)) throw new StaffError("That action is unavailable in the staff console.", 403);
  const token = suppliedToken ?? (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) throw new StaffError("Sign in with your staff account.", 401);
  const config = staffConfiguration();
  let response: Response;
  try {
    response = await fetch(`${config.functionsUrl}/${name}`, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(30000) });
  } catch { throw new StaffError("The staff service is unavailable. Try again shortly.", 503); }
  const payload = await response.json().catch(() => null);
  if (payload?.error) {
    const status: Record<string, number> = { UNAUTHENTICATED: 401, PERMISSION_DENIED: 403, INVALID_ARGUMENT: 400,
      FAILED_PRECONDITION: 422, NOT_FOUND: 404, ALREADY_EXISTS: 409, RESOURCE_EXHAUSTED: 429, UNAVAILABLE: 503 };
    throw new StaffError(payload.error.message || "The action could not be completed.", status[payload.error.status] || 500);
  }
  if (!response.ok || !payload || !("result" in payload)) throw new StaffError("The staff service returned an invalid response.", 503);
  return payload.result;
}
export function staffResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow" } });
}
export function staffFailure(error: unknown) {
  return staffResponse({ error: error instanceof StaffError ? error.message : "The action could not be completed. Try again." },
    error instanceof StaffError ? error.status : 500);
}
