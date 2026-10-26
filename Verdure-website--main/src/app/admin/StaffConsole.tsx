"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";

type StaffSession = { uid: string; admin: boolean };
type Cap = { used: number; remaining: number; limit: number };
type ModerationItem = { queueId: string; targetType: string; targetId: string; status: string; hoursSinceFirstReport: number;
  overdue20Hours: boolean; reportCount: number; reasons: string[]; resolution?: string; reviewedBy?: string;
  content: Record<string, unknown> | null; originalContent?: { content?: string; description?: string }; snapshot?: Record<string, unknown>;
  reports: { reason: string; details?: string }[]; author?: { displayName: string; username: string; suspended: boolean } | null; eventDateMs?: number | null };
type Organizer = { id: string; displayName: string; category: string; description?: string; website?: string; status: string;
  eventCount?: number; reviewReason?: string; reviewedBy?: string };
type Partner = { id: string; name: string; category: string; address: string; contactName: string; contactEmail: string; contactPhone?: string;
  active: boolean; matchedAddress?: string; latitude?: number; longitude?: number;
  agreement?: { agreedBy: string; agreedAtMs: number; reference: string } | null };
type Perk = { id: string; title: string; description: string; terms: string; kind: string; pointCost: number; active: boolean;
  expiresAtMs: number; earlyAccessUntilMs?: number | null; codesLeft: number; lowStock: boolean };
type OperationsData = {
  area: { id: string; name: string }; areas: { id: string; name: string }[]; computedAtMs: number; month: string;
  sources: { source: string; lastRunAtMs: number | null; lastSuccessfulRunAtMs: number | null; lastSuccessfulEvents: number | null;
    lastRunEvents: number | null; lastOutcome: string; currentErrors: string[]; lastError: string | null; lastErrorAtMs: number | null; activeEvents: number }[];
  placeSources: { source: string; name: string; lastRunAtMs: number | null; lastSuccessfulRunAtMs: number | null;
    lastSuccessfulFeatures: number | null; lastRunFeatures: number | null; normalized: number | null; skippedNullGeometry: number;
    normalizedGeometryFeatures: number; lastOutcome: string; currentErrors: string[]; lastError: string | null; lastErrorAtMs: number | null; datasetURL: string }[];
  placeCatalog: { generation: string | null; publishedAtMs: number | null; count: number; latestOutcome: string; latestError: string | null };
  activeEvents: { total: number; bySource: Record<string, number> };
  duplicates: { active: number; suspected: number; rate: number; method: string };
  queues: { pendingReports: number; oldestReportHours: number | null; pendingOrganizers: number };
  spend: { rewardCommittedUsd: number; rewardFulfilledUsd: number; rewardCapUsd: number; rewardPaused: boolean;
    plannerEstimatedUsd: number; adventurePlannerCalls: number; eventPlannerCalls: number; serpApiCalls: number; serpApiCap: number; serpApiEstimatedUsd: number; note: string };
};
class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", headers: data === undefined ? undefined : { "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const body = await response.json();
  if (!response.ok) throw new RequestError(body.error || "The request could not be completed.", response.status);
  return body as T;
}
async function call<T>(name: string, data: unknown = {}): Promise<T> { return request<T>("/admin/api/call", "POST", { name, data }); }
function useWork(onAccessLost: () => void) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (e) {
      setError(e instanceof Error ? e.message : "The action could not be completed.");
      if (e instanceof RequestError && (e.status === 401 || e.status === 403)) onAccessLost();
    } finally { setBusy(false); }
  };
  return { busy, run, setMessage, notice: <><p className="staff-message" role="status">{message}</p>{error && <p className="staff-error" role="alert">{error}</p>}</> };
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="staff-field"><span>{label}</span>{children}</label>;
}
function dateInput(ms?: number | null) {
  if (!ms) return "";
  const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function uniqueId(kind: string) { return `${kind}-${crypto.randomUUID()}`; }
function safeLink(value?: string) {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export default function StaffConsole() {
  const [session, setSession] = useState<StaffSession | null>(null), [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("Moderation"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true;
    request<StaffSession>("/admin/api/session").then((x) => { if (active) setSession(x); }).catch((e) => {
      if (active && (!(e instanceof RequestError) || e.status !== 401)) setError(e.message);
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  const accessLost = useCallback(() => { setSession(null); setError("Your staff session ended or access changed. Sign in again."); }, []);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try { setSession(await request<StaffSession>("/admin/api/session", "POST", { email: form.get("email"), password: form.get("password") })); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); } finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError("");
    try { await request("/admin/api/session", "DELETE", {}); setSession(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign-out failed."); } finally { setBusy(false); }
  }
  return <>
    <header className="staff-header"><Link href="/" className="staff-brand">Verdure</Link><h1>Staff console</h1>
      {session && <button disabled={busy} onClick={signOut}>Sign out</button>}</header>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {checking ? <p role="status">Checking staff access…</p> : !session ? <section className="staff-signin">
      <h2>Sign in to review and manage</h2><p>Use your Verdure staff account. An existing website account does not grant staff access.</p>
      <form onSubmit={signIn}>
        <Field label="Staff email"><input name="email" type="email" autoComplete="username" required maxLength={200} /></Field>
        <Field label="Password"><input name="password" type="password" autoComplete="current-password" required maxLength={256} /></Field>
        <button className="staff-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form></section> : <>
      <nav className="staff-tabs" aria-label="Staff tools">{["Moderation", "Organizers", "Place stories", "Partners", "Programs", "Submissions", "Operations"].map((name) =>
        <button key={name} aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === "Moderation" && <Moderation onAccessLost={accessLost} />}
      {tab === "Organizers" && <Organizers onAccessLost={accessLost} />}
      {tab === "Place stories" && <StoryOwnership onAccessLost={accessLost} />}
      {tab === "Partners" && <Partners onAccessLost={accessLost} />}
      {tab === "Programs" && <Programs onAccessLost={accessLost} />}
      {tab === "Submissions" && <Submissions onAccessLost={accessLost} />}
      {tab === "Operations" && <Operations onAccessLost={accessLost} />}
    </>}
  </>;
}

type Submission = { id: string; kind: string; contact_name: string; contact_email: string; payload: Record<string, unknown>;
  status: string; created_at: string; handled_at?: string; handled_by?: string; handling_note?: string };
type SubmissionAudit = { id: string; actor: string; action: string; occurred_at: string; reason: string; before_state: unknown; after_state: unknown };
function Submissions({ onAccessLost }: { onAccessLost: () => void }) {
  const [kind, setKind] = useState(""), [status, setStatus] = useState("pending"), [items, setItems] = useState<Submission[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [notes, setNotes] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, { items: SubmissionAudit[]; nextCursor: string | null }>>({});
  const { busy, run, notice, setMessage } = useWork(onAccessLost);
  const load = useCallback(async (afterId: string | null = null) => {
    const result = await request<{ items: Submission[]; nextCursor: string | null }>("/admin/api/submissions", "POST",
      { action: "list", status, kind: kind || null, afterId });
    setItems((old) => afterId ? [...old, ...result.items.filter((item) => !old.some((entry) => entry.id === item.id))] : result.items);
    setCursor(result.nextCursor);
  }, [kind, status]);
  const loadHistory = async (id: string, afterId: string | null = null) => {
    const result = await request<{ items: SubmissionAudit[]; nextCursor: string | null }>("/admin/api/submissions", "POST", { action: "audit", id, afterId });
    setHistory((old) => ({ ...old, [id]: { ...result, items: afterId ? [...(old[id]?.items || []), ...result.items] : result.items } }));
  };
  useEffect(() => { setItems([]); setCursor(null); void run(() => load()); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const fieldLabels: Record<string, string> = { subject: "Subject", message: "Message", organization: "Organization", organizationType: "Type",
    eventsPerMonth: "Events per month", publicCalendar: "Publishes a public calendar", calendarURL: "Public calendar", business: "Business",
    category: "Category", address: "Address", offer: "Offer under consideration" };
  return <section><h2>Submissions inbox</h2><p>Support requests and interest from organizers and local businesses. Oldest requests appear first.</p>
    <div className="staff-toolbar"><Field label="Submission status"><select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
      <option value="pending">Pending</option><option value="handled">Handled</option></select></Field>
      <Field label="Submission type"><select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value)}><option value="">All types</option>
        <option value="support">Support</option><option value="organizer">Organizer interest</option><option value="merchant">Merchant interest</option></select></Field>
      <button disabled={busy} onClick={() => void run(() => load())}>Refresh inbox</button></div>
    {notice}
    {!busy && !items.length && <p className="staff-empty">No {status} submissions match these filters.</p>}
    <div className="staff-submissions">{items.map((item) => <article className="staff-submission" key={item.id}>
      <header><h3>{item.kind === "support" ? "Support request" : item.kind === "organizer" ? "Organizer interest" : "Merchant interest"}</h3>
        <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></header>
      <p><strong>{item.contact_name}</strong> · <a href={`mailto:${item.contact_email}`}>{item.contact_email}</a></p>
      <dl>{Object.entries(item.payload).filter(([key, value]) => fieldLabels[key] && value !== null).map(([key, value]) => {
        const href = key === "calendarURL" ? safeLink(String(value)) : null;
        return <div key={key}><dt>{fieldLabels[key]}</dt><dd>{href ? <><a href={href} target="_blank" rel="noreferrer">{String(value)}</a>
          <small>Candidate public source; terms and format must be checked before ingestion.</small></> : typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</dd></div>;
      })}</dl>
      {item.status === "handled" ? <div className="staff-resolution"><strong>Handled {item.handled_at && new Date(item.handled_at).toLocaleString()}</strong>
        <p>{item.handling_note}</p><small>Reviewed by {item.handled_by}</small></div> : <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
        await request("/admin/api/submissions", "POST", { action: "handle", id: item.id, note: notes[item.id] || "" });
        setNotes((old) => { const next = { ...old }; delete next[item.id]; return next; });
        await load(); setMessage("Submission marked handled. The note and review history were saved.");
      }); }}><Field label={`Handling note for ${item.contact_name}`}><textarea value={notes[item.id] || ""} required minLength={3} maxLength={1000}
        onChange={(e) => setNotes((old) => ({ ...old, [item.id]: e.target.value }))} rows={2} /></Field>
        <button className="staff-primary" disabled={busy}>Mark handled</button></form>}
      <button disabled={busy} onClick={() => void run(() => loadHistory(item.id))}>Review history for {item.contact_name}</button>
      {history[item.id] && <div className="staff-audit-history">{history[item.id].items.length === 0 ? <p>No handling actions yet.</p> :
        history[item.id].items.map((record) => <details key={record.id}><summary>{new Date(record.occurred_at).toLocaleString()} · {record.reason}</summary>
          <p>Actor: {record.actor} · Action: {record.action}</p><pre>{JSON.stringify({ before: record.before_state, after: record.after_state }, null, 2)}</pre></details>)}
        {history[item.id].nextCursor && <button disabled={busy} onClick={() => void run(() => loadHistory(item.id, history[item.id].nextCursor))}>Load more review history</button>}</div>}
    </article>)}</div>
    {cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>Load more submissions</button>}
  </section>;
}

function Operations({ onAccessLost }: { onAccessLost: () => void }) {
  const [areaId, setArea] = useState("san-jose-ca"), [data, setData] = useState<OperationsData | null>(null);
  const { busy, run, notice } = useWork(onAccessLost);
  const load = useCallback(async () => { setData(await call<OperationsData>("staffOperations", { areaId })); }, [areaId]);
  useEffect(() => { setData(null); void run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const date = (ms: number | null) => ms === null ? "Not recorded" : new Date(ms).toLocaleString();
  const dollars = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
  return <section><h2>Operations overview</h2><p>Source failures, current event supply, review queues and month-to-date spend.</p>
    <div className="staff-toolbar"><Field label="Launch area"><select value={areaId} disabled={busy} onChange={(e) => setArea(e.target.value)}>
      {(data?.areas ?? [{ id: "san-jose-ca", name: "San José / South Bay" }]).map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}
    </select></Field><button disabled={busy} onClick={() => void run(load)}>Refresh operations</button></div>{notice}
    {busy && <p role="status">Loading current operations…</p>}
    {data && <>
      <p>As of {date(data.computedAtMs)} · budget month {data.month} (UTC)</p>
      <div className="staff-metrics">
        <article><h3>Upcoming events</h3><strong>{data.activeEvents.total.toLocaleString()}</strong><p>Active, visible events in this launch area.</p></article>
        <article><h3>Suspected duplicate rate</h3><strong>{data.duplicates.active ? `${(data.duplicates.rate * 100).toFixed(2)}%` : "No events to measure"}</strong>
          <p>{data.duplicates.suspected} suspected of {data.duplicates.active} checked.</p></article>
        <article><h3>Pending reports</h3><strong>{data.queues.pendingReports.toLocaleString()}</strong>
          <p className={(data.queues.oldestReportHours ?? 0) > 20 ? "staff-overdue" : ""}>{data.queues.oldestReportHours === null ? "No pending reports" :
            `Oldest report: ${data.queues.oldestReportHours.toFixed(1)} hours${data.queues.oldestReportHours > 20 ? " — needs attention" : ""}`}</p></article>
        <article><h3>Pending organizers</h3><strong>{data.queues.pendingOrganizers.toLocaleString()}</strong><p>Applications awaiting staff review.</p></article>
      </div><p>{data.duplicates.method}</p>
      <h3>Ingestion health by source</h3>
      <div className="staff-table-scroll" role="region" aria-label="Ingestion health" tabIndex={0}><table className="staff-table">
        <thead><tr>{["Source", "Latest run", "Last successful run", "Events returned", "Active events", "Errors"].map((x) => <th key={x} scope="col">{x}</th>)}</tr></thead>
        <tbody>{data.sources.map((s) => <tr key={s.source}>
          <th scope="row">{s.source}<span className={s.lastOutcome === "failed" ? "staff-overdue" : ""}>{s.lastOutcome === "never-run" ? "No recorded run" : s.lastOutcome}</span></th>
          <td>{date(s.lastRunAtMs)}</td><td>{date(s.lastSuccessfulRunAtMs)}</td>
          <td>{s.lastRunEvents ?? "Not recorded"}<span>Last success: {s.lastSuccessfulEvents ?? "not recorded"}</span></td><td>{s.activeEvents}</td>
          <td>{s.currentErrors.length ? <ul>{s.currentErrors.map((error, i) => <li key={i}>{error}</li>)}</ul> : "No current error"}
            {!s.currentErrors.length && s.lastError && <details><summary>Previous error</summary><p>{s.lastError}</p><p>{date(s.lastErrorAtMs)}</p></details>}</td>
        </tr>)}</tbody></table></div>
      <details><summary>All primary source counts</summary><ul>{Object.entries(data.activeEvents.bySource).map(([source, count]) => <li key={source}>{source}: {count}</li>)}</ul></details>
      <h3>Park and trail data</h3>
      <p>Separate weekly pipeline, refreshed Tuesday mornings. Last complete catalog: {date(data.placeCatalog.publishedAtMs)}
        {data.placeCatalog.generation ? ` · ${data.placeCatalog.count.toLocaleString()} source features` : " · no catalog published"}.</p>
      {data.placeCatalog.latestError && <p role="alert" className="staff-overdue">Latest catalog update failed: {data.placeCatalog.latestError}
        {data.placeCatalog.generation ? " The previous complete catalog remains available." : " Park data is unavailable until a complete update succeeds."}</p>}
      <div className="staff-table-scroll" role="region" aria-label="Park data source health" tabIndex={0}><table className="staff-table">
        <thead><tr>{["Source", "Latest run", "Last successful run", "Features returned", "Usable geometry", "Errors"].map((x) => <th key={x} scope="col">{x}</th>)}</tr></thead>
        <tbody>{data.placeSources.map((s) => <tr key={s.source}>
          <th scope="row"><a href={s.datasetURL} target="_blank" rel="noopener noreferrer">{s.name}</a>
            <span className={s.lastOutcome === "failed" ? "staff-overdue" : ""}>{s.lastOutcome === "never-run" ? "No recorded run" : s.lastOutcome}</span></th>
          <td>{date(s.lastRunAtMs)}</td><td>{date(s.lastSuccessfulRunAtMs)}</td>
          <td>{s.lastRunFeatures ?? "Not recorded"}<span>Last success: {s.lastSuccessfulFeatures ?? "not recorded"}</span></td>
          <td>{s.normalized ?? "Not recorded"}{s.skippedNullGeometry > 0 && <span>{s.skippedNullGeometry} source features lack geometry and cannot be joined.</span>}
            {s.normalizedGeometryFeatures > 0 && <span>{s.normalizedGeometryFeatures} features had empty polygon components omitted; valid geometry retained.</span>}</td>
          <td>{s.currentErrors.length ? <ul>{s.currentErrors.map((error, i) => <li key={i}>{error}</li>)}</ul> : "No current error"}
            {!s.currentErrors.length && s.lastError && <details><summary>Previous error</summary><p>{s.lastError}</p><p>{date(s.lastErrorAtMs)}</p></details>}</td>
        </tr>)}</tbody></table></div>
      <h3>Spend and limits</h3><div className="staff-metrics">
        <article><h3>Reward commitments</h3><strong>{dollars(data.spend.rewardCommittedUsd)} / {dollars(data.spend.rewardCapUsd)}</strong>
          <p>{dollars(data.spend.rewardFulfilledUsd)} fulfilled. {data.spend.rewardPaused ? "Cash rewards are paused by the treasury kill switch." : "Treasury kill switch is off."}</p></article>
        <article><h3>Planner recorded estimate</h3><strong>{dollars(data.spend.plannerEstimatedUsd)}</strong><p>{data.spend.adventurePlannerCalls} adventure calls · {data.spend.eventPlannerCalls} event-planner calls</p></article>
        <article><h3>SerpApi recorded estimate</h3><strong>{dollars(data.spend.serpApiEstimatedUsd)}</strong><p>{data.spend.serpApiCalls} / {data.spend.serpApiCap} monthly searches</p></article>
      </div><p>{data.spend.note}</p>
    </>}
  </section>;
}

function Moderation({ onAccessLost }: { onAccessLost: () => void }) {
  const [status, setStatus] = useState("open"), [type, setType] = useState(""), [items, setItems] = useState<ModerationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, select] = useState<string | null>(null), [reason, setReason] = useState("");
  const { busy, run, setMessage, notice } = useWork(onAccessLost);
  const load = useCallback(async (afterId?: string) => {
    const data = await call<{ items: ModerationItem[]; nextCursor: string | null }>("listModerationQueue", { status,
      ...(type ? { targetType: type } : {}), ...(afterId ? { afterId } : {}) });
    setItems((old) => afterId ? [...old, ...data.items] : data.items); setCursor(data.nextCursor);
  }, [status, type]);
  useEffect(() => { void run(load); select(null); setReason(""); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = items.find((x) => x.queueId === selected);
  async function decide(action: string) {
    if (!item) return;
    await run(async () => { await call("moderateContent", { queueId: item.queueId, action, reason }); await load(); select(null); setReason(""); setMessage(`Review saved: ${action}.`); });
  }
  return <section><h2>Review reports</h2><p>Oldest reports appear first. Reports older than 20 hours need attention.</p>
    <div className="staff-toolbar">
      <Field label="Report status"><select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
        <option value="open">Pending</option><option value="resolved">Resolved history</option><option value="removed">Removed</option><option value="warned">Warned</option><option value="dismissed">Restored / dismissed</option>
      </select></Field>
      <Field label="Content type"><select value={type} disabled={busy} onChange={(e) => setType(e.target.value)}>
        <option value="">All content</option>{["post", "event", "organizer", "user", "place_story"].map((x) => <option key={x} value={x}>{x === "place_story" ? "Place story" : x}</option>)}
      </select></Field><button disabled={busy} onClick={() => void run(load)}>Refresh reports</button>
    </div>{notice}
    <div className="staff-workspace"><div className="staff-list" aria-label="Reports">
      {!busy && !items.length && <p>No reports match these filters.</p>}
      {items.map((x) => <button key={x.queueId} className={`staff-row ${selected === x.queueId ? "selected" : ""}`} onClick={() => { select(x.queueId); setReason(""); }}>
        <strong>{String(x.content?.title || x.content?.displayName || x.originalContent?.content || x.originalContent?.description || x.content?.content || x.targetType).slice(0, 100)}</strong>
        <span>{x.targetType} · {x.reportCount} {x.reportCount === 1 ? "report" : "reports"} · {x.status}</span>
        <span className={x.overdue20Hours && x.status === "open" ? "staff-overdue" : ""}>{Math.floor(x.hoursSinceFirstReport)} hours since first report{x.overdue20Hours && x.status === "open" ? " — needs attention" : ""}</span>
      </button>)}
      {cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>Load more reports</button>}</div>
      <article className="staff-detail">{item ? <>
        <h3>Reported {item.targetType}</h3><p className="staff-content">{String(item.content?.content || item.content?.description || item.content?.displayName || item.content?.title || "Content is no longer available.")}</p>
        {item.author && <p><strong>Author:</strong> {item.author.displayName || item.author.username || "Name unavailable"}{item.author.username && ` (@${item.author.username})`}{item.author.suspended && " · suspended"}</p>}
        {typeof item.content?.locationName === "string" && <p><strong>Venue:</strong> {item.content.locationName}</p>}
        {item.eventDateMs != null && <p><strong>Event date:</strong> {new Date(item.eventDateMs).toLocaleString()}</p>}
        {item.originalContent && <details><summary>Original reported text</summary><p className="staff-content">{item.originalContent.content || item.originalContent.description || "No original text recorded."}</p></details>}
        <h4>Report reasons</h4><ul>{item.reports.map((x, i) => <li key={i}><strong>{x.reason}</strong>{x.details && <p>{x.details}</p>}</li>)}</ul>
        {item.reportCount > item.reports.length && <p>Showing {item.reports.length} detailed reports of {item.reportCount}. All reported reasons: {item.reasons.join(", ")}.</p>}
        {item.resolution && <p><strong>Previous decision:</strong> {item.resolution}</p>}
        <Field label="Reason for this decision"><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} minLength={3} rows={3} /></Field>
        <div className="staff-actions">{["remove", "restore", "warn", "suspend"].map((action) => <button key={action} disabled={busy || reason.trim().length < 3}
          className={action === "remove" || action === "suspend" ? "staff-danger" : ""} onClick={() => void decide(action)}>{action[0].toUpperCase() + action.slice(1)}</button>)}</div>
      </> : <p>Select a report to read the content and make a decision.</p>}</article>
    </div></section>;
}

type StoryPlace = { placeId: string; placeName: string; officialURL: string; organizerId: string; active: boolean;
  verificationReference: string; verifiedBy: string; verifiedAtMs: number | null };
function StoryOwnership({ onAccessLost }: { onAccessLost: () => void }) {
  const [places, setPlaces] = useState<StoryPlace[]>([]), [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [notes, setNotes] = useState<Record<string, string>>({});
  const { busy, run, notice, setMessage } = useWork(onAccessLost);
  const load = useCallback(async (afterId?: string) => {
    const data = await call<{ places: StoryPlace[]; nextCursor: string | null }>("listStaffStoryPlaces", { afterId, limit: 50 });
    setPlaces((old) => afterId ? [...old, ...data.places.filter((p) => !old.some((x) => x.placeId === p.placeId))] : data.places);
    setCursor(data.nextCursor);
  }, []);
  useEffect(() => { void run(async () => {
    await load();
    const data = await call<{ organizers: Organizer[] }>("listOrganizerApplications", { status: "approved", limit: 100 });
    setOrganizers(data.organizers);
  }); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    await run(async () => {
      await call("setPlaceStoryOwnership", Object.fromEntries([...data.entries(), ["active", true]]));
      await load(); form.reset(); setMessage("Ownership verified. The approved organizer can now write this place's story.");
    });
  }
  return <section className="staff-section"><h2>Place stories</h2>
    <p>Verify that an approved organizer owns or manages the place before enabling its story. Keep a reference to written confirmation. Organizers write the text; staff review reports in Moderation.</p>
    <form className="staff-form" onSubmit={verify}>
      <Field label="Place ID"><input name="placeId" required maxLength={180} placeholder="city-parks_123 or osm-123" /></Field>
      <Field label="Approved organizer"><select name="organizerId" required defaultValue=""><option value="" disabled>Choose an organizer</option>
        {organizers.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}</select></Field>
      <Field label="Place name (outside the official park catalog)"><input name="placeName" maxLength={200} /></Field>
      <Field label="Official place link (outside the official park catalog)"><input name="officialURL" type="url" maxLength={1000} /></Field>
      <p>Official park names and links come from the park catalog. For other places, use the matching OpenStreetMap, Recreation.gov or NPS listing.</p>
      <Field label="Written ownership confirmation reference"><textarea name="verificationReference" required minLength={3} maxLength={1000} /></Field>
      <Field label="Reason for verification"><textarea name="reason" required minLength={3} maxLength={1000} /></Field>
      <button className="staff-primary" disabled={busy}>Verify ownership</button>
    </form>{notice}
    <button disabled={busy} onClick={() => void run(load)}>Refresh verified places</button>
    <div className="staff-list">{!busy && !places.length && <p>No place ownership has been verified.</p>}
      {places.map((p) => <article key={p.placeId} className="staff-detail"><h3>{p.placeName}</h3>
        <p>{p.active ? "Active ownership" : "Ownership revoked"} · {p.placeId}</p>
        <p>Organizer: {organizers.find((o) => o.id === p.organizerId)?.displayName || p.organizerId}</p>
        {safeLink(p.officialURL) && <a href={safeLink(p.officialURL)!} target="_blank" rel="noopener noreferrer">Official place listing</a>}
        <p>Confirmation: {p.verificationReference}</p>
        <p>Verified {p.verifiedAtMs ? new Date(p.verifiedAtMs).toLocaleString() : "time unavailable"} by {p.verifiedBy}</p>
        {p.active && <><Field label={`Reason to revoke ownership of ${p.placeName}`}><textarea value={notes[p.placeId] || ""}
          maxLength={1000} onChange={(e) => setNotes({ ...notes, [p.placeId]: e.target.value })} /></Field>
          <button disabled={busy || (notes[p.placeId] || "").trim().length < 3} onClick={() => void run(async () => {
            await call("setPlaceStoryOwnership", { placeId: p.placeId, active: false, reason: notes[p.placeId] });
            await load(); setMessage(`Ownership revoked for ${p.placeName}. Its story is no longer public.`);
          })}>Revoke ownership</button></>}
      </article>)}
    </div>{cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>Load more verified places</button>}
  </section>;
}

function Organizers({ onAccessLost }: { onAccessLost: () => void }) {
  const [status, setStatus] = useState("pending"), [items, setItems] = useState<Organizer[]>([]), [cap, setCap] = useState<Cap | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, select] = useState<string | null>(null), [reason, setReason] = useState("");
  const { busy, run, setMessage, notice } = useWork(onAccessLost);
  const load = useCallback(async (afterId?: string) => {
    const data = await call<{ organizers: Organizer[]; approvalCap: Cap; nextCursor: string | null }>("listOrganizerApplications", {
      status, ...(afterId ? { afterId } : {}) });
    setItems((old) => afterId ? [...old, ...data.organizers] : data.organizers); setCap(data.approvalCap); setCursor(data.nextCursor);
  }, [status]);
  useEffect(() => { void run(load); select(null); setReason(""); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = items.find((x) => x.id === selected), website = safeLink(item?.website);
  async function decide(action: string) {
    if (!item) return;
    await run(async () => { await call("approveOrganizer", { organizerId: item.id, action, reason }); await load(); select(null); setReason(""); setMessage(`Organizer decision saved: ${action}.`); });
  }
  return <section><h2>Organizer applications</h2>
    {cap && <p className="staff-cap"><strong>{cap.used} of {cap.limit} manual approvals used</strong><span>{cap.remaining} remaining. Reinstating a reviewed organizer keeps the same slot.</span></p>}
    <div className="staff-toolbar"><Field label="Organizer status"><select disabled={busy} value={status} onChange={(e) => setStatus(e.target.value)}>
      {["pending", "approved", "rejected", "suspended"].map((x) => <option key={x}>{x}</option>)}</select></Field><button disabled={busy} onClick={() => void run(load)}>Refresh applications</button></div>
    {notice}<div className="staff-workspace"><div className="staff-list">
      {!busy && !items.length && <p>No organizers match this status.</p>}
      {items.map((x) => <button className={`staff-row ${selected === x.id ? "selected" : ""}`} key={x.id} onClick={() => { select(x.id); setReason(""); }}>
        <strong>{x.displayName}</strong><span>{x.category} · {x.status}</span><span>{x.eventCount || 0} published events</span></button>)}
      {cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>Load more applications</button>}</div>
      <article className="staff-detail">{item ? <><h3>{item.displayName}</h3><p className="staff-content">{item.description || "No description provided."}</p>
        {website && <a href={website} target="_blank" rel="noreferrer">Visit organization website</a>}
        {item.reviewReason && <p><strong>Previous decision:</strong> {item.reviewReason}</p>}
        <Field label="Reason for organizer decision"><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} /></Field>
        <div className="staff-actions">{["approve", "reject", "suspend", "reinstate"].map((action) => <button key={action} disabled={busy || reason.trim().length < 3}
          onClick={() => void decide(action)}>{action[0].toUpperCase() + action.slice(1)}</button>)}</div>
      </> : <p>Select an organizer to review their application.</p>}</article></div>
  </section>;
}

function Partners({ onAccessLost }: { onAccessLost: () => void }) {
  const [partners, setPartners] = useState<Partner[]>([]), [cursor, setCursor] = useState<string | null>(null), [selected, select] = useState<Partner | null>(null);
  const [perks, setPerks] = useState<Perk[]>([]), [editingPerk, editPerk] = useState<Perk | null>(null), [perkCursor, setPerkCursor] = useState<string | null>(null);
  const [reason, setReason] = useState(""), [csv, setCsv] = useState(""), [partnerFormVersion, setPartnerFormVersion] = useState(0), [perkFormVersion, setPerkFormVersion] = useState(0);
  const draftPartner = useRef<string | null>(null), draftPerk = useRef<string | null>(null);
  const { busy, run, setMessage, notice } = useWork(onAccessLost);
  const loadPartners = useCallback(async (afterId?: string) => {
    const data = await call<{ items: Partner[]; nextCursor: string | null }>("listStaffPartners", { kind: "partners", ...(afterId ? { afterId } : {}) });
    setPartners((old) => afterId ? [...old, ...data.items] : data.items); setCursor(data.nextCursor);
  }, []);
  const loadPerks = useCallback(async (partnerId: string, afterId?: string) => {
    const data = await call<{ items: Perk[]; nextCursor: string | null }>("listStaffPartners", { kind: "perks", partnerId, ...(afterId ? { afterId } : {}) });
    setPerks((old) => afterId ? [...old, ...data.items] : data.items); setPerkCursor(data.nextCursor);
  }, []);
  useEffect(() => { void run(() => loadPartners()); }, [loadPartners]); // eslint-disable-line react-hooks/exhaustive-deps
  function choose(p: Partner | null) { select(p); editPerk(null); setCsv(""); setReason(""); setPerks([]); setPerkCursor(null);
    draftPartner.current = null; draftPerk.current = null; setPartnerFormVersion((x) => x + 1); setPerkFormVersion((x) => x + 1); if (p) void run(() => loadPerks(p.id)); }
  async function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    const partnerId = selected?.id || (draftPartner.current ??= uniqueId("partner"));
    const agreedBy = String(f.get("agreedBy") || "").trim(), reference = String(f.get("reference") || "").trim();
    await run(async () => {
      const result = await call<{ matchedAddress: string }>("savePartner", { partnerId, name: f.get("name"), category: f.get("category"), address: f.get("address"),
        contactName: f.get("contactName"), contactEmail: f.get("contactEmail"), contactPhone: f.get("contactPhone"), active: f.has("active"), reason: f.get("reason"),
        ...(agreedBy || reference || f.get("agreedAt") ? { agreement: { agreedBy, reference, agreedAtMs: new Date(String(f.get("agreedAt"))).getTime() } } : {}) });
      await loadPartners();
      const data = await call<{ items: Partner[] }>("listStaffPartners", { kind: "partners", targetId: partnerId });
      const current = data.items[0];
      if (current) {
        select(current); setPartners((old) => old.some((p) => p.id === partnerId) ? old.map((p) => p.id === partnerId ? current : p) : [...old, current]);
        setPartnerFormVersion((x) => x + 1); await loadPerks(partnerId);
      }
      setMessage(`Partner saved. Address matched: ${result.matchedAddress}.`);
    });
  }
  async function savePerk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const f = new FormData(event.currentTarget), perkId = editingPerk?.id || (draftPerk.current ??= uniqueId("perk"));
    await run(async () => { await call("upsertPartnerPerk", { perkId, partnerId: selected.id, title: f.get("title"), kind: f.get("kind"),
      terms: f.get("terms"), description: f.get("description"), pointCost: Number(f.get("pointCost")), active: f.has("active"),
      expiresAtMs: new Date(String(f.get("expiresAt"))).getTime(), earlyAccessUntilMs: f.get("earlyAccessUntil") ? new Date(String(f.get("earlyAccessUntil"))).getTime() : null,
      reason: f.get("reason") }); await loadPerks(selected.id); draftPerk.current = null; editPerk(null); setPerkFormVersion((x) => x + 1); setMessage("Perk saved. Load codes before making it available to members."); });
  }
  async function deactivate(kind: "partner" | "perk", targetId: string) {
    await run(async () => { await call("deactivatePartnerOffer", { kind, targetId, reason }); await loadPartners();
      if (selected) { await loadPerks(selected.id); if (kind === "partner") select({ ...selected, active: false }); }
      if (kind === "perk") editPerk(null); setReason(""); setMessage(`${kind === "partner" ? "Partner" : "Perk"} deactivated. It no longer appears to members.`); });
  }
  async function importCodes() {
    if (!editingPerk || !selected) return;
    await run(async () => { const result = await call<{ codesAdded: number; codesLeft: number }>("importPartnerCodes", { perkId: editingPerk.id, csv, reason });
      await loadPerks(selected.id); setCsv(""); setReason(""); setMessage(`${result.codesAdded} codes loaded; ${result.codesLeft} unused codes remain.`); });
  }
  return <section><h2>Partners and offers</h2><p>Activate a business only after recording its written agreement. Addresses are looked up when saved.</p>
    <div className="staff-toolbar"><button disabled={busy} className="staff-primary" onClick={() => choose(null)}>New partner</button>
      <button disabled={busy} onClick={() => void run(() => loadPartners())}>Refresh partners</button></div>{notice}
    <div className="staff-workspace"><div className="staff-list">
      {!busy && !partners.length && <p>No partners yet. Create a draft to get started.</p>}
      {partners.map((p) => <button key={p.id} disabled={busy} className={`staff-row ${selected?.id === p.id ? "selected" : ""}`} onClick={() => choose(p)}>
        <strong>{p.name}</strong><span>{p.category} · {p.active ? "Active" : "Inactive"}</span><span>{p.address}</span></button>)}
      {cursor && <button disabled={busy} onClick={() => void run(() => loadPartners(cursor))}>Load more partners</button>}</div>
      <article className="staff-detail"><h3>{selected ? "Edit partner" : "New partner draft"}</h3>
        <form key={`business-${partnerFormVersion}`} onSubmit={saveBusiness} className="staff-form-grid">
          <Field label="Business name"><input name="name" defaultValue={selected?.name} required maxLength={80} /></Field>
          <Field label="Business category"><select name="category" defaultValue={selected?.category || "other"}>{["coffee", "food", "retail", "activities", "other"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Full street address"><input name="address" defaultValue={selected?.address} required maxLength={100} placeholder="Street, city, state and ZIP" /></Field>
          <Field label="Contact name"><input name="contactName" defaultValue={selected?.contactName} required maxLength={100} /></Field>
          <Field label="Contact email"><input name="contactEmail" type="email" defaultValue={selected?.contactEmail} required maxLength={200} /></Field>
          <Field label="Contact phone (optional)"><input name="contactPhone" defaultValue={selected?.contactPhone} maxLength={40} /></Field>
          <fieldset className="staff-wide"><legend>Agreement on file</legend><p>All three fields are required before activation. Leave them empty for a draft.</p>
            <Field label="Who agreed"><input name="agreedBy" defaultValue={selected?.agreement?.agreedBy} maxLength={100} /></Field>
            <Field label="When they agreed"><input name="agreedAt" type="datetime-local" defaultValue={dateInput(selected?.agreement?.agreedAtMs)} /></Field>
            <Field label="Written confirmation reference"><input name="reference" defaultValue={selected?.agreement?.reference} maxLength={500} placeholder="Email reference or document location" /></Field>
          </fieldset>
          <label className="staff-checkbox staff-wide"><input name="active" type="checkbox" defaultChecked={selected?.active || false} />Activate partner</label>
          <Field label="Reason for saving"><textarea name="reason" required minLength={3} maxLength={1000} rows={2} /></Field>
          <button disabled={busy} className="staff-primary">{busy ? "Saving…" : "Save partner"}</button>
        </form>
        {selected && <><h3 className="staff-subsection">Offers from {selected.name}</h3>
          <button disabled={busy} onClick={() => { editPerk(null); draftPerk.current = null; setCsv(""); setPerkFormVersion((x) => x + 1); }}>New perk</button>
          <div className="staff-perk-list">{perks.map((p) => <button disabled={busy} key={p.id} className={`staff-row ${editingPerk?.id === p.id ? "selected" : ""}`} onClick={() => { editPerk(p); setCsv(""); setReason(""); setPerkFormVersion((x) => x + 1); }}>
            <strong>{p.title}</strong><span>{p.pointCost} points · {p.active ? "Active" : "Inactive"}</span><span className={p.lowStock ? "staff-overdue" : ""}>{p.codesLeft} unused codes{p.lowStock ? " — low stock" : ""}</span></button>)}</div>
          {perkCursor && <button disabled={busy} onClick={() => void run(() => loadPerks(selected.id, perkCursor))}>Load more perks</button>}
          <form key={`perk-${perkFormVersion}`} onSubmit={savePerk} className="staff-form-grid staff-subsection">
            <h4 className="staff-wide">{editingPerk ? "Edit perk" : "Create perk"}</h4>
            <Field label="Perk title"><input name="title" defaultValue={editingPerk?.title} required maxLength={80} /></Field>
            <Field label="Offer type"><select name="kind" defaultValue={editingPerk?.kind || "local-offer"}><option value="local-offer">Local offer</option><option value="percent-off">Percentage off</option><option value="free-item">Free item</option></select></Field>
            <Field label="Point cost (500–2,000)"><input name="pointCost" type="number" min={500} max={2000} step={1} required defaultValue={editingPerk?.pointCost || 500} /></Field>
            <Field label="Expires at"><input name="expiresAt" type="datetime-local" defaultValue={dateInput(editingPerk?.expiresAtMs)} required /></Field>
            <Field label="Verdure+ early access ends (optional)"><input name="earlyAccessUntil" type="datetime-local" defaultValue={dateInput(editingPerk?.earlyAccessUntilMs)} /></Field>
            <Field label="Description"><textarea name="description" maxLength={400} defaultValue={editingPerk?.description} rows={2} /></Field>
            <Field label="Offer terms"><textarea name="terms" required maxLength={1000} defaultValue={editingPerk?.terms} rows={3} /></Field>
            <label className="staff-checkbox"><input name="active" type="checkbox" defaultChecked={editingPerk?.active ?? true} />Activate perk</label>
            <Field label="Reason for saving perk"><textarea name="reason" required minLength={3} maxLength={1000} rows={2} /></Field>
            <button disabled={busy} className="staff-primary">Save perk</button>
          </form>
          {editingPerk && <section className="staff-subsection"><h4>Load codes for {editingPerk.title}</h4><p>CSV with one column named code. Up to 400 codes per upload. Duplicates, including already redeemed codes, are refused.</p>
            <Field label="Codes CSV file"><input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => {
              const file = e.target.files?.[0]; if (!file) return; void run(async () => { if (file.size > 65536) throw new Error("Choose a CSV under 64 KB."); setCsv(await file.text()); });
            }} /></Field>
            <Field label="CSV contents"><textarea rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} maxLength={65536} placeholder={"code\nEXAMPLE-001\nEXAMPLE-002"} /></Field>
          </section>}
          <section className="staff-subsection"><Field label="Reason for code upload or deactivation"><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} /></Field>
            <div className="staff-actions">{editingPerk && <><button disabled={busy || !csv.trim() || reason.trim().length < 3} onClick={() => void importCodes()}>Load CSV codes</button>
              <button className="staff-danger" disabled={busy || reason.trim().length < 3} onClick={() => void deactivate("perk", editingPerk.id)}>Deactivate perk</button></>}
              <button className="staff-danger" disabled={busy || reason.trim().length < 3} onClick={() => void deactivate("partner", selected.id)}>Deactivate partner</button></div>
          </section>
        </>}
      </article></div>
  </section>;
}

type ProgramListing = { programId: string; title: string; organization: string; officialURL: string; deadlineMs: number;
  minimumAge: number; maximumAge: number; cost: number; format: string; address: string; active: boolean; hidden: boolean; expired: boolean };
function Programs({ onAccessLost }: { onAccessLost: () => void }) {
  const [items, setItems] = useState<ProgramListing[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProgramListing | null>(null), [revision, setRevision] = useState(0);
  const [format, setFormat] = useState("in-person"), [reasons, setReasons] = useState<Record<string, string>>({});
  const { busy, run, notice, setMessage } = useWork(onAccessLost);
  const load = useCallback(async (afterId: string | null = null) => {
    const result = await call<{ items: ProgramListing[]; nextCursor: string | null }>("listStaffPrograms", afterId ? { afterId } : {});
    setItems(old => afterId ? [...old, ...result.items.filter(item => !old.some(entry => entry.programId === item.programId))] : result.items);
    setCursor(result.nextCursor);
  }, []);
  useEffect(() => { void run(() => load()); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  function reset() { setEditing(null); setFormat("in-person"); setRevision(v => v + 1); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget);
    await run(async () => {
      await call("saveProgram", { programId: editing?.programId || uniqueId("program"), title: fields.get("title"), organization: fields.get("organization"),
        officialURL: fields.get("officialURL"), deadlineMs: new Date(String(fields.get("deadline"))).getTime(), minimumAge: Number(fields.get("minimumAge")),
        maximumAge: Number(fields.get("maximumAge")), cost: Number(fields.get("cost")), format, address: fields.get("address"),
        active: fields.get("active") === "on", reason: fields.get("reason") });
      reset(); await load(); setMessage("Program saved. Current eligible listings are available in Verdure; the Program chip appears at ten nearby listings.");
    });
  }
  return <section><h2>Internships and programs</h2>
    <p>Curate published opportunities with their official deadline, cost and age requirements. Members read the organization’s listing and apply on its site.</p>
    <p>Virtual programs use the organization’s local address for nearby discovery. Expired deadlines disappear automatically. Listings hidden by moderation stay hidden after edits.</p>
    {notice}
    <form key={`${editing?.programId || "new"}-${revision}`} className="staff-signin" onSubmit={save}>
      <h3>{editing ? "Edit program" : "Add a program"}</h3>
      <Field label="Program title"><input name="title" required maxLength={120} defaultValue={editing?.title} /></Field>
      <Field label="Program organization"><input name="organization" required maxLength={100} defaultValue={editing?.organization} /></Field>
      <Field label="Official listing link"><input name="officialURL" type="url" required maxLength={1000} placeholder="https://" defaultValue={editing?.officialURL} /></Field>
      <Field label="Application deadline"><input name="deadline" type="datetime-local" required defaultValue={editing ? dateInput(editing.deadlineMs) : ""} /></Field>
      <div className="staff-toolbar">
        <Field label="Minimum eligible age"><input name="minimumAge" type="number" min={13} max={110} required defaultValue={editing?.minimumAge} /></Field>
        <Field label="Maximum eligible age"><input name="maximumAge" type="number" min={13} max={110} required defaultValue={editing?.maximumAge} /></Field>
        <Field label="Published cost (USD)"><input name="cost" type="number" min={0} max={100000} step="0.01" required defaultValue={editing?.cost} /></Field>
      </div>
      <Field label="Program format"><select value={format} onChange={e => setFormat(e.target.value)}><option value="in-person">In person</option><option value="virtual">Virtual</option></select></Field>
      <Field label={format === "virtual" ? "Organization’s local address" : "Program venue address"}><input name="address" required maxLength={100} defaultValue={editing?.address} /></Field>
      <label><input name="active" type="checkbox" defaultChecked={editing?.active ?? false} /> Make this listing active</label>
      <Field label="Reason for program change"><textarea name="reason" required minLength={3} maxLength={1000} /></Field>
      <div className="staff-toolbar"><button className="staff-primary" disabled={busy}>{busy ? "Saving…" : "Save program"}</button>
        {editing && <button type="button" disabled={busy} onClick={reset}>Cancel edit</button>}</div>
    </form>
    <div className="staff-toolbar"><h3>Curated listings</h3><button disabled={busy} onClick={() => void run(() => load())}>Refresh programs</button></div>
    {!items.length && <p>No programs curated yet.</p>}
    {items.map(item => <article className="staff-detail staff-program" data-program-id={item.programId} key={item.programId}>
      <h3>{item.title}</h3><p>{item.organization} · Ages {item.minimumAge}–{item.maximumAge} · {item.cost === 0 ? "Free" : `$${item.cost.toFixed(2)}`} · {item.format === "virtual" ? "Virtual" : "In person"}</p>
      <p>{item.address}</p><p>Deadline: {new Date(item.deadlineMs).toLocaleString()} · {item.expired ? "Expired" : item.hidden ? "Hidden by moderation" : item.active ? "Active" : "Inactive"}</p>
      <p><a href={item.officialURL} target="_blank" rel="noopener noreferrer">Official listing</a></p>
      <button disabled={busy} onClick={() => { setEditing(item); setFormat(item.format); setRevision(v => v + 1); }}>Edit program</button>
      {item.active && <><Field label={`Deactivation reason for ${item.title}`}><input required minLength={3} maxLength={1000} value={reasons[item.programId] || ""}
        onChange={e => setReasons(old => ({ ...old, [item.programId]: e.target.value }))} /></Field>
        <button disabled={busy || (reasons[item.programId] || "").trim().length < 3} onClick={() => void run(async () => {
          await call("deactivateProgram", { programId: item.programId, reason: reasons[item.programId] }); await load(); setMessage("Program deactivated.");
        })}>Deactivate program</button></>}
    </article>)}
    {cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>Load more programs</button>}
  </section>;
}
