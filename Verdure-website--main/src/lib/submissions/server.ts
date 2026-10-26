import "server-only";
import { createClient } from "@supabase/supabase-js";
import { StaffError } from "@/lib/staff/server";

export const SUBMISSION_KINDS = ["support", "organizer", "merchant"] as const;
export type SubmissionKind = typeof SUBMISSION_KINDS[number];
export function submissionClient() {
  const url = process.env.VERDURE_SUBMISSIONS_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StaffError("The submissions inbox is unavailable. Please try again later.", 503);
  if (process.env.VERDURE_SUBMISSIONS_LOCAL === "1" &&
      (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))) {
    throw new StaffError("Local submissions testing requires a local database and development server.", 503);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
function text(value: unknown, label: string, max: number, min = 1) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new StaffError(`${label} must contain ${min}–${max.toLocaleString()} characters.`);
  }
  return value.trim();
}
export function validateSubmission(body: Record<string, unknown>) {
  const kind = body.kind;
  if (!SUBMISSION_KINDS.includes(kind as SubmissionKind)) throw new StaffError("Choose support, organizer or merchant interest.");
  const name = text(body.contactName, "Contact name", 100), email = text(body.contactEmail, "Contact email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new StaffError("Enter a valid contact email address.");
  let payload: Record<string, unknown>;
  if (kind === "support") payload = { subject: text(body.subject, "Subject", 160, 2), message: text(body.message, "Message", 4000, 10) };
  else if (kind === "organizer") {
    if (typeof body.eventsPerMonth !== "number" || !Number.isInteger(body.eventsPerMonth) || body.eventsPerMonth < 0 || body.eventsPerMonth > 10000) {
      throw new StaffError("Events per month must be a whole number from 0 to 10,000.");
    }
    if (typeof body.publicCalendar !== "boolean") throw new StaffError("Tell us whether you publish a public calendar.");
    let calendarURL: string | null = null;
    if (body.publicCalendar) {
      try {
        const url = new URL(text(body.calendarURL, "Public calendar URL", 1000));
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
        calendarURL = url.href;
      } catch { throw new StaffError("Enter a public calendar URL starting with https:// or http://."); }
    }
    payload = { organization: text(body.organization, "Organization", 160), organizationType: text(body.organizationType, "Organization type", 80),
      eventsPerMonth: body.eventsPerMonth, publicCalendar: body.publicCalendar, calendarURL };
  } else payload = { business: text(body.business, "Business", 160), category: text(body.category, "Category", 80),
    address: text(body.address, "Address", 300), offer: text(body.offer, "Offer", 2000, 3) };
  // Construct the payload explicitly: browser-supplied status, note, actor,
  // timestamps and unrelated personal fields never reach the database.
  return { p_kind: kind, p_contact_name: name, p_contact_email: email, p_payload: payload };
}
export function submissionFailure(code: string) {
  if (["22023", "23514", "22P02"].includes(code)) return new StaffError("Check the form fields and try again.");
  if (code === "P0002") return new StaffError("No such submission.", 404);
  return new StaffError("The submissions inbox is unavailable. Please try again later.", 503);
}
