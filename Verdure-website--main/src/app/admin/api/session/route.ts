import { cookies } from "next/headers";
import { clientIp } from "@/lib/security/request-ip";
import { rateLimit } from "@/lib/security/rate-limit";
import { STAFF_COOKIE, StaffError, readStaffJson, staffCall, staffConfiguration, staffFailure, staffResponse } from "@/lib/staff/server";

export async function GET() {
  try { return staffResponse(await staffCall("staffSession", {})); } catch (error) { return staffFailure(error); }
}
export async function POST(request: Request) {
  try {
    const data = await readStaffJson(request, 2048);
    if (typeof data.email !== "string" || typeof data.password !== "string" || data.email.length > 200 || data.password.length > 256) {
      throw new StaffError("Enter your staff email and password.");
    }
    const budget = rateLimit(`staff-login:${await clientIp()}`, 10, 15 * 60 * 1000);
    if (!budget.ok) throw new StaffError(`Too many sign-in attempts. Try again in ${budget.retryAfterSeconds} seconds.`, 429);
    const response = await fetch(staffConfiguration().authUrl, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data.email.trim(), password: data.password, returnSecureToken: true }),
      signal: AbortSignal.timeout(15000) });
    const account = await response.json();
    if (!response.ok || typeof account.idToken !== "string") throw new StaffError("Staff sign-in failed. Check your credentials and staff access.", 401);
    // The callable checks the CURRENT Firebase Auth admin claim server-side.
    // The website neither decodes a JWT nor trusts a browser-provided role.
    const session = await staffCall("staffSession", {}, account.idToken);
    (await cookies()).set(STAFF_COOKIE, account.idToken, { httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "strict", path: "/admin", maxAge: Math.min(3600, Number(account.expiresIn) || 3600) });
    return staffResponse(session);
  } catch (error) { return staffFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    await readStaffJson(request, 64);
    (await cookies()).set(STAFF_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/admin", maxAge: 0 });
    return staffResponse({ signedOut: true });
  } catch (error) { return staffFailure(error); }
}
