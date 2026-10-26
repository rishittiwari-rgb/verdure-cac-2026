// Verdure — waitlist signup notifier
//
// Called by public.send_waitlist_digest(), which pg_cron runs every 30 minutes
// (supabase/migrations/*_waitlist_digest.sql). Never by a browser. It turns one
// queued pg_net request into one email via Resend: the whole list to date, with
// everything new since the previous digest marked.
//
// DEPLOY WITH:
//   npm run supabase:deploy
//
// The JWT check is OFF for this function, declared as verify_jwt = false under
// [functions.waitlist-notify] in supabase/config.toml. That is deliberate and
// must not be removed. pg_net posts from inside Postgres; it has no Supabase
// session and sends no Authorization header, so the platform's JWT check would
// reject every legitimate call and the only thing that ever got through would
// be something holding a user token — the exact opposite of the intent.
// Authentication here is the x-verdure-signature comparison below, against a
// secret only Postgres and this function hold.
//
// It lives in config.toml rather than in a --no-verify-jwt deploy flag so that
// a bare `supabase functions deploy` cannot quietly restore the check. If it is
// ever turned on, notifications stop and the trigger swallows the failure.

type Entry = {
  email: string;
  source: string | null;
  created_at: string;
  // Decided in SQL against the digest watermark, not here by comparing against
  // a single address — a digest can carry any number of new signups.
  is_new: boolean;
};

type Notice = {
  kind: "digest" | "cap_reached";
  // Start of the window this digest covers.
  since: string;
  new_count: number;
  total: number;
  sent_today: number;
  cap: number;
  // The whole list to date, newest first, assembled by send_waitlist_digest().
  // Capped at waitlist_list_limit() in the database; list_truncated says
  // whether the cap bit, so the email can admit it rather than quietly showing
  // a short list.
  list: Entry[];
  list_truncated: boolean;
};

// A length bound, and deliberately NOT a shape check.
//
// An earlier version also ran each address through the same regex the waitlist
// table's CHECK constraint uses. That is the wrong trade for a digest: one
// address the regex disliked would fail validation for the WHOLE message, so a
// single odd row would silently cost the owner every subsequent report. The
// control that actually matters for a value being pasted into HTML is
// escapeHtml, which is applied unconditionally. The length cap stays, because
// that one is about how much memory a caller can make us spend.
let MAX_EMAIL_LENGTH = 254;

// Mirrors waitlist_list_limit() in the database. Stated again here rather than
// trusted, because this function's job is to assume the payload is hostile.
let MAX_LIST_ENTRIES = 2000;

// The array was previously described as "the one field that can cost real
// memory", and that was simply wrong: isEntryList bounded email but let source
// and created_at through on `typeof === "string"` alone, so 2000 entries could
// each carry a multi-megabyte string and every one of them would be validated,
// escaped and concatenated into the HTML body. The database truncates source to
// 40 characters on write and constrains it again on the column, so a legitimate
// producer never emits anything near these — which is the argument for bounding
// them here, not against it. This function does not get to assume its caller is
// the database.
let MAX_SOURCE_LENGTH = 120;
let MAX_TIMESTAMP_LENGTH = 64;

let RESEND_ENDPOINT = "https://api.resend.com/emails";

// The single response a prober is allowed to see. No body, no header, no
// difference between "your signature was wrong" and "your JSON was wrong" —
// both are things only a caller who already has the secret should be able to
// tell apart. What leaks is that something answers on this path, which the
// URL being guessable gives away anyway.
let notFound = function (): Response
{
  return new Response(null, { status: 404 });
};

let escapeHtml = function (value: string): string
{
  // Ampersand first, or the entities written by the later replacements get
  // escaped a second time.
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

let sha256 = async function (value: string): Promise<Uint8Array>
{
  let digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
};

// Both sides are hashed before they get here, so this always walks exactly 32
// bytes regardless of what was sent. That is the point: comparing the raw
// strings would return early on the first differing character AND would take
// a number of steps proportional to the shorter input, which leaks the
// secret's length as well as its prefix. It also means a caller cannot make
// the comparison cheap by sending an empty header.
let equalsInConstantTime = function (actual: Uint8Array, expected: Uint8Array): boolean
{
  let difference = actual.length ^ expected.length;

  // reduce rather than an indexed loop with a break: there is no early exit
  // to accidentally introduce, and every byte is always visited.
  difference = actual.reduce(function (accumulated, byte, index)
  {
    return accumulated | (byte ^ (expected.at(index) ?? 0));
  }, difference);

  return difference === 0;
};

let isNotice = function (value: unknown): value is Notice
{
  if (typeof value !== "object" || value === null)
  {
    return false;
  }

  let candidate = value as Record<string, unknown>;
  let kind = candidate.kind;

  return (
    (kind === "digest" || kind === "cap_reached") &&
    typeof candidate.since === "string" &&
    typeof candidate.new_count === "number" &&
    typeof candidate.total === "number" &&
    typeof candidate.sent_today === "number" &&
    typeof candidate.cap === "number" &&
    typeof candidate.list_truncated === "boolean" &&
    isEntryList(candidate.list)
  );
};

// The list is checked with the same care as the rest of the payload, and for
// the same reason: a signed caller is still another process, and every string
// in here is about to become part of an HTML document. every() on an empty
// array is true, which is correct — a first signup arriving before its own row
// is visible would send an empty list rather than nothing.
let isEntryList = function (value: unknown): value is Entry[]
{
  if (!Array.isArray(value) || value.length > MAX_LIST_ENTRIES)
  {
    return false;
  }

  return value.every(function (item)
  {
    if (typeof item !== "object" || item === null)
    {
      return false;
    }

    let entry = item as Record<string, unknown>;

    return (
      typeof entry.email === "string" &&
      entry.email.length <= MAX_EMAIL_LENGTH &&
      (entry.source === null ||
        (typeof entry.source === "string" &&
          entry.source.length <= MAX_SOURCE_LENGTH)) &&
      typeof entry.created_at === "string" &&
      entry.created_at.length <= MAX_TIMESTAMP_LENGTH &&
      typeof entry.is_new === "boolean"
    );
  });
};

// Every value below came from a public form on the landing page. The email
// passed a regex, but source, created_at and the counters are only ever as
// trustworthy as whatever wrote them, and the destination is an HTML document
// in the owner's mail client. So all of them go through escapeHtml, including
// the numbers — a rule with an exception is a rule someone edits wrongly
// later.
let renderHtml = function (notice: Notice): string
{
  let field = function (label: string, value: string | number | null): string
  {
    let shown = value === null || value === "" ? "—" : escapeHtml(String(value));
    return (
      `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;font:14px system-ui">${escapeHtml(label)}</td>` +
      `<td style="padding:6px 0;color:#111827;font:600 14px system-ui">${shown}</td></tr>`
    );
  };

  let plural = notice.new_count === 1 ? "signup" : "signups";

  let heading =
    notice.kind === "cap_reached"
      ? "Waitlist notifications paused for today"
      : `${notice.new_count} new ${plural}`;

  let note =
    notice.kind === "cap_reached"
      ? `<p style="margin:0 0 20px;color:#6b7280;font:14px/1.6 system-ui">` +
        `Today's cap of ${escapeHtml(String(notice.cap))} notification emails has been reached, so ` +
        `this is the last one until tomorrow. Signups are still being recorded, and ` +
        `nothing has been skipped — everything since this message will be in ` +
        `tomorrow's first digest.</p>`
      : "";

  return (
    `<div style="max-width:640px;margin:0 auto;padding:32px 24px">` +
    `<h1 style="margin:0 0 16px;color:#111827;font:600 20px system-ui">${escapeHtml(heading)}</h1>` +
    note +
    `<table style="border-collapse:collapse">` +
    field("New this window", notice.new_count) +
    field("Total on list", notice.total) +
    field("Covering since", notice.since) +
    field("Sent today", `${notice.sent_today} of ${notice.cap}`) +
    `</table>` +
    renderList(notice) +
    `</div>`
  );
};

// The full list to date, which is the point of the email as much as the one
// new address is. Same escaping rule as everything else: every cell goes
// through escapeHtml, including the row number and the timestamp.
let renderList = function (notice: Notice): string
{
  if (notice.list.length === 0)
  {
    return "";
  }

  let cell = "padding:7px 14px 7px 0;font:14px system-ui;border-bottom:1px solid #f3f4f6";

  let rows = notice.list
    .map(function (entry, index)
    {
      // Marked in SQL against the digest watermark. Doing it there rather than
      // here is what lets a single message flag several new arrivals.
      let isNew = entry.is_new;
      let weight = isNew ? "600" : "400";
      let colour = isNew ? "#111827" : "#374151";

      return (
        `<tr>` +
        `<td style="${cell};color:#9ca3af;text-align:right">${escapeHtml(String(index + 1))}</td>` +
        `<td style="${cell};color:${colour};font-weight:${weight}">${escapeHtml(entry.email)}` +
        (isNew ? ` <span style="color:#059669;font:600 12px system-ui">NEW</span>` : "") +
        `</td>` +
        `<td style="${cell};color:#6b7280">${escapeHtml(entry.source ?? "—")}</td>` +
        `<td style="${cell};color:#9ca3af;white-space:nowrap">${escapeHtml(entry.created_at.slice(0, 10))}</td>` +
        `</tr>`
      );
    })
    .join("");

  // Said plainly rather than left to be inferred from a count that does not
  // match the total above.
  let truncated = notice.list_truncated
    ? `<p style="margin:10px 0 0;color:#b45309;font:13px/1.5 system-ui">` +
      `Showing the ${escapeHtml(String(notice.list.length))} most recent of ` +
      `${escapeHtml(String(notice.total))}. The rest are in the Supabase dashboard.</p>`
    : "";

  return (
    `<h2 style="margin:28px 0 10px;color:#111827;font:600 15px system-ui">` +
    `Everyone on the list (${escapeHtml(String(notice.list.length))})</h2>` +
    `<table style="border-collapse:collapse;width:100%">${rows}</table>` +
    truncated +
    // Gmail clips a message around 102 kB and hides the rest behind "View
    // entire message". Worth saying once, at the bottom, where somebody who
    // has just scrolled a long list will read it.
    `<p style="margin:14px 0 0;color:#9ca3af;font:12px/1.5 system-ui">` +
    `If this email looks cut off, your mail client clipped it — click “View entire message”.</p>`
  );
};

Deno.serve(async function (request: Request): Promise<Response>
{
  if (request.method !== "POST")
  {
    return notFound();
  }

  // Read before anything else, because without it there is no way to
  // authenticate the caller and therefore no way to answer safely. This is
  // the one branch where an unauthenticated prober can tell a misconfigured
  // deployment from a healthy one, and it is worth it: the alternative is
  // returning 404 to the trigger forever while the owner believes signups are
  // being emailed.
  let secret = Deno.env.get("WAITLIST_NOTIFY_SECRET");

  if (!secret)
  {
    console.error("[waitlist-notify] WAITLIST_NOTIFY_SECRET is not set");
    return new Response("not configured", { status: 500 });
  }

  let presented = request.headers.get("x-verdure-signature") ?? "";
  let matches = equalsInConstantTime(await sha256(presented), await sha256(secret));

  if (!matches)
  {
    return notFound();
  }

  let payload: unknown;

  try
  {
    payload = await request.json();
  }
  catch
  {
    return notFound();
  }

  if (!isNotice(payload))
  {
    return notFound();
  }

  let apiKey = Deno.env.get("RESEND_API_KEY");
  let to = Deno.env.get("NOTIFY_TO");
  let from = Deno.env.get("NOTIFY_FROM");

  // Named individually so the log says which one is missing. Dropping the
  // notice silently here would be the worst of both worlds: the trigger
  // already swallows its own errors, so nothing else in the system would ever
  // mention it.
  if (!apiKey || !to || !from)
  {
    console.error(
      "[waitlist-notify] missing config:",
      !apiKey ? "RESEND_API_KEY" : "",
      !to ? "NOTIFY_TO" : "",
      !from ? "NOTIFY_FROM" : ""
    );
    return new Response("not configured", { status: 500 });
  }

  let subject =
    payload.kind === "cap_reached"
      ? "Verdure — waitlist notifications paused for today"
      : `Verdure — ${payload.new_count} new ` +
        `${payload.new_count === 1 ? "signup" : "signups"} (${payload.total} total)`;

  let sent = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: "Bearer " + apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: from,
      to: [to],
      subject: subject,
      html: renderHtml(payload),
    }),
  });

  if (!sent.ok)
  {
    // Logged, not returned. Resend's error bodies quote the API key prefix,
    // the sending domain and the recipient back at you, and this response is
    // written into pg_net's response table where it would sit in the database
    // in plain text.
    console.error("[waitlist-notify] resend rejected the send:", sent.status, await sent.text());
    return new Response("send failed", { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
