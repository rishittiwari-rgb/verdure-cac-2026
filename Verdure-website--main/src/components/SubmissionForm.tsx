"use client";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";

const labels = { support: "Send support request", organizer: "Send organizer interest", merchant: "Send merchant interest" };
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="submission-field"><span>{label}</span>{children}</label>;
}
export default function SubmissionForm({ kind }: { kind: keyof typeof labels }) {
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState("");
  const [publicCalendar, setPublicCalendar] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = Object.fromEntries(form.entries());
    values.kind = kind;
    if (kind === "organizer") { values.eventsPerMonth = Number(form.get("eventsPerMonth")); values.publicCalendar = publicCalendar; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Your request could not be saved. Please try again.");
      setSent(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Your request could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  if (sent) return <div className="submission-confirmation" role="status"><h3>Received, thank you.</h3>
    <p>Your {kind === "support" ? "support request" : "interest form"} is in our team’s inbox. We’ll use your contact details to follow up.</p></div>;
  return <form className="submission-form" data-ready={ready} method="post" action="/api/submissions" onSubmit={submit} aria-label={labels[kind]}>
    <input type="hidden" name="kind" value={kind} />
    <div className="submission-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    {kind === "support" && <>
      <Field label="Subject"><input name="subject" required minLength={2} maxLength={160} /></Field>
      <Field label="How can we help?"><textarea name="message" required minLength={10} maxLength={4000} rows={5} /></Field>
    </>}
    {kind === "organizer" && <>
      <Field label="Organization"><input name="organization" required maxLength={160} autoComplete="organization" /></Field>
      <Field label="Organization type"><select name="organizationType" required defaultValue=""><option value="" disabled>Choose a type</option>
        {["Community group", "Nonprofit", "Library", "Parks department", "City government", "School", "Other"].map((type) => <option key={type}>{type}</option>)}</select></Field>
      <Field label="Events per month"><input name="eventsPerMonth" type="number" required min={0} max={10000} step={1} /></Field>
      <Field label="Do you publish a public calendar?"><select name="publicCalendar" value={publicCalendar ? "yes" : "no"} onChange={(e) => setPublicCalendar(e.target.value === "yes")}>
        <option value="no">No</option><option value="yes">Yes</option></select></Field>
      <Field label="Public calendar URL (if you publish one)"><input name="calendarURL" type="url" required={publicCalendar} maxLength={1000} placeholder="https://" />
        <small>Leave blank if you don’t publish a calendar. We may review a submitted calendar as a possible source of public events.</small></Field>
    </>}
    {kind === "merchant" && <>
      <Field label="Business"><input name="business" required maxLength={160} autoComplete="organization" /></Field>
      <Field label="Business category"><select name="category" required defaultValue=""><option value="" disabled>Choose a category</option>
        {["Coffee", "Food", "Retail", "Activities", "Other"].map((type) => <option key={type}>{type}</option>)}</select></Field>
      <Field label="Business address"><input name="address" required maxLength={300} autoComplete="street-address" /></Field>
      <Field label="What offer would you consider?"><textarea name="offer" required minLength={3} maxLength={2000} rows={4} /></Field>
      <p className="submission-note">Submitting interest doesn’t activate an offer. Written agreement is required before any business or perk goes live.</p>
    </>}
    <Field label="Contact name"><input name="contactName" required maxLength={100} autoComplete="name" /></Field>
    <Field label="Contact email"><input name="contactEmail" type="email" required maxLength={254} autoComplete="email" /></Field>
    <p className="submission-note">We use these details to review your request and contact you. See our <Link href="/privacy">privacy policy</Link>.
      {kind === "support" && " Please don’t include passwords, payment details or sensitive personal information."}</p>
    {error && <p role="alert" className="submission-error">{error}</p>}
    <button className="submission-submit" disabled={busy}>{busy ? "Sending…" : labels[kind]}</button>
  </form>;
}
