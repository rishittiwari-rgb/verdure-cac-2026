import { readStaffJson, StaffError, staffCall, staffFailure, staffResponse } from "@/lib/staff/server";

export async function POST(request: Request) {
  try {
    const body = await readStaffJson(request);
    if (typeof body.name !== "string") throw new StaffError("Choose a staff action.");
    return staffResponse(await staffCall(body.name, body.data ?? {}));
  } catch (error) { return staffFailure(error); }
}
