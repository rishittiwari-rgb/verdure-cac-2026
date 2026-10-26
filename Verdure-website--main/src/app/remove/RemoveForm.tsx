"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { normalizeHost, validHost } from "@/lib/removal/host";

/** Response shape of requestSourceRemoval (functions/src/discovery/removal.ts, RemovalOutcome). */
interface RemovalOutcome {
  host: string; removed: boolean; sources: number; activeEvents: number;
  requiresToken: boolean; token?: string; tokenVerified?: boolean; tokenWhere?: string; message: string;
}
/** Response shape of removalToken. */
interface TokenInfo { host: string; isSource: boolean; activeEvents: number; requiresToken: boolean; token: string; path: string }

const GENERIC = "The request could not be sent. Check your connection and try again.";
const BAD_HOST = "Enter the host name of the site, like events.example.org.";

async function readError(response: Response): Promise<string> {
  let message = "";
  try { const json = await response.json(); if (json && typeof json.error === "string") message = json.error; } catch { /* not JSON */ }
  if (response.status === 429) return message || "Too many requests from your address. Removal requests are limited to 5 per day and token lookups to 30 per hour; please try again later.";
  return message || `The server answered ${response.status}.`;
}

export default function RemoveForm({ baseUrl }: { baseUrl: string }) {
  const enabled = baseUrl.length > 0;
  const [hostInput, setHostInput] = useState("");
  const [busy, setBusy] = useState<"" | "token" | "remove">("");
  const [error, setError] = useState("");
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [result, setResult] = useState<RemovalOutcome | null>(null);
  const host = normalizeHost(hostInput);
  const hostOk = validHost(host);

  async function getToken() {
    if (!hostOk) { setError(BAD_HOST); return; }
    setBusy("token"); setError(""); setToken(null);
    try {
      const response = await fetch(`${baseUrl}/removalToken?host=${encodeURIComponent(host)}`, { method: "GET" });
      if (!response.ok) throw new Error(await readError(response));
      setToken(await response.json() as TokenInfo);
    } catch (e) { setError(e instanceof Error ? e.message : GENERIC); }
    finally { setBusy(""); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hostOk) { setError(BAD_HOST); return; }
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = { host };
    const contact = String(form.get("contact") ?? "").trim(), reason = String(form.get("reason") ?? "").trim();
    if (contact) body.contact = contact;
    if (reason) body.reason = reason;
    setBusy("remove"); setError(""); setResult(null);
    try {
      const response = await fetch(`${baseUrl}/requestSourceRemoval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      // 200 = removed, 403 = token required; both carry a RemovalOutcome body. 400/429/500 carry { error }.
      if (response.status === 200 || response.status === 403) {
        const out = await response.json() as RemovalOutcome;
        if (typeof out.message !== "string") throw new Error(GENERIC);
        setResult(out);
      } else throw new Error(await readError(response));
    } catch (e) { setError(e instanceof Error ? e.message : GENERIC); }
    finally { setBusy(""); }
  }

  if (!enabled) return <div className="submission-confirmation" role="status"><h3>Removal requests are not enabled on this build.</h3>
    <p>This site was built without <code>NEXT_PUBLIC_VERDURE_FUNCTIONS_URL</code>, so the form cannot reach the removal service. Email <a className="underline" href="mailto:support@verdure-app.com">support@verdure-app.com</a> with the host name and we will remove it.</p></div>;

  return <form className="submission-form" onSubmit={submit} aria-label="Request removal of a site from Verdure">
    <label className="submission-field"><span>Site host name</span>
      <input name="host" required maxLength={253} autoComplete="off" spellCheck={false} placeholder="events.example.org" value={hostInput} onChange={(e) => { setHostInput(e.target.value); setToken(null); setResult(null); }} />
      <small>{hostInput.trim() ? (hostOk ? <>We will remove <strong>{host}</strong> and everything under it.</> : "That does not look like a public host name. Paste the site address, like https://events.example.org/calendar.") : "A full URL is fine; only the host name is used."}</small>
    </label>
    <label className="submission-field"><span>Contact (optional)</span>
      <input name="contact" maxLength={200} autoComplete="email" placeholder="you@example.org" />
      <small>Only used if we need to tell you something about this request. Stored with the request log.</small></label>
    <label className="submission-field"><span>Reason (optional)</span>
      <textarea name="reason" maxLength={1000} rows={3} /></label>

    <div className="submission-note">
      <strong>Large sites:</strong> if {host || "the host"} has more than 100 active listings, the server first checks that you have published its token. Get the token here, publish it, then submit.
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="submission-submit" disabled={busy !== "" || !hostOk} onClick={getToken}>{busy === "token" ? "Looking up…" : "Get my token"}</button>
      </div>
      {token && <div className="submission-confirmation" role="status">
        <p>{token.isSource ? <>Verdure lists <strong>{token.activeEvents}</strong> active event{token.activeEvents === 1 ? "" : "s"} from {token.host}.</> : <>{token.host} is not currently a Verdure source ({token.activeEvents} active events).</>}{" "}
          {token.requiresToken ? "A published token is required before removal." : "No token is required: submitting the form removes it immediately. The token is shown anyway in case the count grows."}</p>
        <p className="mt-2">Publish this exact text at <code className="break-all">{token.path}</code></p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-white p-3 text-sm"><code>{token.token}</code></pre>
        <p className="mt-2">or add to the home page: <code className="break-all">{`<meta name="verdure-remove" content="${token.token}">`}</code></p>
      </div>}
    </div>

    <p className="submission-note">Submitting is final and automatic; nobody reviews it. The request, your contact and reason, and a hash of your network address are logged. See the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.</p>
    {error && <p role="alert" className="submission-error">{error}</p>}
    {result && <div className="submission-confirmation" role="status">
      <h3>{result.removed ? "Removed." : "Not removed yet: token required."}</h3>
      <p>{result.message}</p>
      {!result.removed && result.token && <p className="mt-2">Token to publish: <code className="break-all">{result.token}</code></p>}
      {result.removed && result.tokenWhere && <p className="mt-2">Token verified via {result.tokenWhere}.</p>}
    </div>}
    <button className="submission-submit" disabled={busy !== "" || !hostOk}>{busy === "remove" ? "Submitting…" : "Remove my site from Verdure"}</button>
  </form>;
}
