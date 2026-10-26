import { checkSameOrigin, readBoundedText, readStaffJson, staffFailure, staffResponse, StaffError } from "@/lib/staff/server";
import { submissionClient, validateSubmission, submissionFailure } from "@/lib/submissions/server";
import { clientIp } from "@/lib/security/request-ip";
import { rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const native = request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded") ?? false;
  const success = () => native ? new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request received — Verdure</title><main><h1>Received, thank you.</h1><p>Your request is in our team’s inbox. We’ll use your contact details to follow up.</p><p><a href="/support">Support</a> · <a href="/partnerships#interest">Partnerships</a> · <a href="/">Verdure home</a></p></main></html>',
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow" } }) : staffResponse({ ok: true });
  try {
    let body: Record<string, unknown>;
    if (native) {
      checkSameOrigin(request, "Submit this form from the Verdure website.");
      const form = new URLSearchParams(await readBoundedText(request, 24576));
      for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new StaffError("Check the form fields and try again.");
      body = Object.fromEntries(form.entries());
      if (body.kind === "organizer") {
        body.eventsPerMonth = typeof body.eventsPerMonth === "string" && body.eventsPerMonth.trim() ? Number(body.eventsPerMonth) : NaN;
        body.publicCalendar = body.publicCalendar === "yes" ? true : body.publicCalendar === "no" ? false : undefined;
      }
    } else body = await readStaffJson(request, 24576, "Submit this form from the Verdure website.");
    const limited = rateLimit(`submissions:${await clientIp()}`, 6, 10 * 60 * 1000);
    if (!limited.ok) throw new StaffError("Too many submissions from this connection. Please try again later.", 429);
    if (typeof body.website === "string" && body.website.trim()) return success(); // Honeypot.
    const values = validateSubmission(body), supabase = submissionClient();
    const { error } = await supabase.rpc("submit_website_request", values);
    if (error) { console.error("[submissions] write refused", error.code); throw submissionFailure(error.code); }
    return success();
  } catch (error) {
    if (native) return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request not saved — Verdure</title><main><h1>Your request could not be saved.</h1><p>Please check your fields and try again shortly.</p><p><a href="/support">Return to support</a> · <a href="/partnerships#interest">Return to partnerships</a></p></main></html>',
      { status: error instanceof StaffError ? error.status : 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow" } });
    return staffFailure(error);
  }
}
