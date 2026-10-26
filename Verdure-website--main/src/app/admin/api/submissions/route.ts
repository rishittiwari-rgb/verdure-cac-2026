import { readStaffJson, staffCall, StaffError, staffFailure, staffResponse } from "@/lib/staff/server";
import { submissionClient, SUBMISSION_KINDS, submissionFailure } from "@/lib/submissions/server";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function POST(request: Request) {
  try {
    const body = await readStaffJson(request, 8192);
    // Re-check canonical Firebase Auth claims on EVERY request, including
    // reads. Supabase website login and browser-supplied actor are irrelevant.
    const session: { uid: string; admin: boolean } = await staffCall("staffSession", {});
    const supabase = submissionClient();
    let name: string, data: Record<string, unknown>;
    if (body.action === "list") {
      const status = body.status ?? "pending", kind = body.kind ?? null, after = body.afterId ?? null;
      if (!["pending", "handled"].includes(status as string) || (kind !== null && !SUBMISSION_KINDS.includes(kind as typeof SUBMISSION_KINDS[number])) ||
          (after !== null && !uuid(after))) throw new StaffError("Choose valid inbox filters.");
      name = "list_website_submissions"; data = { p_actor: session.uid, p_status: status, p_kind: kind, p_after_id: after, p_limit: 50 };
    } else if (body.action === "handle") {
      if (!uuid(body.id) || typeof body.note !== "string" || body.note.trim().length < 3 || body.note.trim().length > 1000) {
        throw new StaffError("Select a submission and add a handling note of 3–1,000 characters.");
      }
      name = "handle_website_submission"; data = { p_actor: session.uid, p_id: body.id, p_note: body.note.trim() };
    } else if (body.action === "audit") {
      const id = body.id ?? null, after = body.afterId ?? null;
      if ((id !== null && !uuid(id)) || (after !== null && !uuid(after))) throw new StaffError("Choose valid audit filters.");
      name = "list_submission_audit"; data = { p_actor: session.uid, p_target: id, p_after_id: after };
    } else throw new StaffError("Choose an inbox action.");
    const { data: result, error } = await supabase.rpc(name, data);
    if (error) { console.error("[staff-submissions] action refused", name, error.code); throw submissionFailure(error.code); }
    return staffResponse(result);
  } catch (error) { return staffFailure(error); }
}
