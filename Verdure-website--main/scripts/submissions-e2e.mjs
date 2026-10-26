// Real local Supabase, Firebase admin authorization, Next routes and browser forms.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
const origin = process.env.VERDURE_STAFF_TEST_URL || "http://127.0.0.1:3104";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):8899$/);
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(execFileSync(`${root}node_modules/.bin/supabase`, ["status", "-o", "json"], { encoding: "utf8", cwd: root, env: process.env }));
assert.match(config.API_URL, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
assert.match(config.DB_URL, /^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//);
const privileged = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false } });
const suffix = Date.now().toString(36), session = `verdure-submissions-${suffix}`, email = `${session}@example.test`, password = "local-fixture-password";
const names = { support: `Support Fixture ${suffix}`, organizer: `Organizer Fixture ${suffix}`, merchant: `Merchant Fixture ${suffix}` };
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`PASS ${name}`); };
// Fresh temporary browser context; never attaches to a personal Chrome profile.
const chrome = await chromium.launch({ executablePath: process.env.VERDURE_TEST_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await chrome.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
async function browser(...args) {
  const [action, ...values] = args;
  if (action === "open") return page.goto(values[0], { waitUntil: "domcontentloaded" });
  if (action === "wait") return values[0] === "--text" ? page.getByText(values[1], { exact: false }).first().waitFor() : page.locator(values[0]).first().waitFor();
  if (action === "fill") return page.locator(values[0]).fill(values[1]);
  if (action === "select") return page.locator(values[0]).selectOption(values[1]);
  if (action === "click") return page.locator(values[0]).click();
  if (action === "get") return page.locator(values[1]).innerText();
  if (action === "eval") return JSON.stringify(await page.evaluate(values[0]));
  if (action === "screenshot") return page.screenshot({ path: values[0] });
  if (action === "set") return page.setViewportSize({ width: Number(values[1]), height: Number(values[2]) });
  if (action === "close") { await context.close(); return chrome.close(); }
  if (action === "find") {
    const locator = values[0] === "label" ? page.getByLabel(values[1], { exact: true }) : page.getByRole(values[1], { name: values[4], exact: values.includes("--exact") });
    return values[2] === "fill" ? locator.fill(values[3]) : locator.click();
  }
  throw new Error(`Unknown browser action ${action}`);
}
async function formFill(kind, name, value) { return await browser("fill", `form[aria-label="Send ${kind === "support" ? "support request" : `${kind} interest`}"] [name="${name}"]`, value); }
async function click(label) { return await browser("find", "role", "button", "click", "--name", label, "--exact"); }
function sql(text) { return execFileSync("psql", [config.DB_URL, "-v", "ON_ERROR_STOP=1", "-At"], { input: text, encoding: "utf8" }); }
async function account(label, method = "signUp") {
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${label}-${email}`, password, returnSecureToken: true }) });
  const data = await response.json(); assert.ok(data.idToken, JSON.stringify(data)); return { ...data, email: `${label}-${email}` };
}
async function api(path, data, token, otherHeaders = {}) {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", origin,
    ...(token ? { cookie: `verdure_staff_session=${token}` } : {}), ...otherHeaders }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
}
const refs = [];
let websiteUserID;
try {
  let staff = await account("staff"), member = await account("member");
  execFileSync(process.execPath, [fileURLToPath(new URL("../../functions/scripts/staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
    "--grant", "--reason", "Local submissions inbox test"], { env: process.env });
  staff = await account("staff", "signInWithPassword");
  await browser("open", `${origin}/support`); await browser("wait", "--text", "Contact support");
  await browser("wait", 'form[data-ready="true"]');
  await formFill("support", "subject", `Support fixture ${suffix}`);
  await formFill("support", "message", `Please help with this local fixture. <script>window.fixtureExecuted=true</script> ${suffix}`);
  await formFill("support", "contactName", names.support); await formFill("support", "contactEmail", email);
  await click("Send support request"); await browser("wait", "--text", "Received, thank you.");
  check("native support form confirms a saved request", (await browser("get", "text", "body")).includes("in our team’s inbox"));
  await browser("open", `${origin}/partnerships#interest`); await browser("wait", "--text", "For organizers");
  await browser("wait", 'form[data-ready="true"]');
  await formFill("organizer", "organization", `Fictional community ${suffix}`);
  await browser("select", 'form[aria-label="Send organizer interest"] select[name="organizationType"]', "Community group");
  await formFill("organizer", "eventsPerMonth", "4");
  await browser("select", 'form[aria-label="Send organizer interest"] select[name="publicCalendar"]', "yes");
  await formFill("organizer", "calendarURL", `https://calendar.example.test/public/${suffix}`);
  await formFill("organizer", "contactName", names.organizer); await formFill("organizer", "contactEmail", email);
  await click("Send organizer interest"); await browser("wait", "--text", "Received, thank you.");
  await formFill("merchant", "business", `Fictional merchant ${suffix}`);
  await browser("select", 'form[aria-label="Send merchant interest"] select[name="category"]', "Coffee");
  await formFill("merchant", "address", "123 Fictional Road, San Jose, CA 95113");
  await formFill("merchant", "offer", "15% off a fictional fixture drink.");
  await formFill("merchant", "contactName", names.merchant); await formFill("merchant", "contactEmail", email);
  await click("Send merchant interest"); await page.waitForFunction(() => document.querySelectorAll(".submission-confirmation").length === 2);
  const rows = await privileged.from("website_submissions").select("*").eq("contact_email", email).order("created_at");
  assert.ifError(rows.error); rows.data.forEach((row) => refs.push(row.id));
  check("all three native forms write to real Supabase", rows.data.length === 3 && new Set(rows.data.map((row) => row.kind)).size === 3);
  check("organizer stores calendar URL and exact monthly count", rows.data.find((r) => r.kind === "organizer").payload.eventsPerMonth === 4 &&
    rows.data.find((r) => r.kind === "organizer").payload.calendarURL === `https://calendar.example.test/public/${suffix}`);
  check("merchant stores considered offer and address without activation", rows.data.find((r) => r.kind === "merchant").payload.offer.startsWith("15%") &&
    rows.data.every((r) => r.status === "pending" && r.handled_by === null));
  const nativeBody = new URLSearchParams({ kind: "support", subject: "Native POST fixture", message: "Local native fallback fixture only.",
    contactName: `Native Fixture ${suffix}`, contactEmail: email, status: "handled", actor: "forged" });
  const native = await fetch(`${origin}/api/submissions`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: nativeBody });
  check("native POST fallback persists without putting personal data in a URL", native.status === 200 && (await native.text()).includes("Received, thank you.") && !native.url.includes(email));
  const nativeRow = await privileged.from("website_submissions").select("*").eq("contact_name", `Native Fixture ${suffix}`).single();
  check("public browser cannot set status or staff actor", nativeRow.data.status === "pending" && nativeRow.data.handled_by === null &&
    Object.keys(nativeRow.data.payload).sort().join(",") === "message,subject");
  for (const table of ["website_submissions", "submission_audit"]) {
    check(`anon cannot read ${table}`, !!(await anon.from(table).select("*")).error);
  }
  for (const [name, data] of [
    ["submit_website_request", { p_kind: "support", p_contact_name: "Forgery", p_contact_email: email, p_payload: { subject: "Direct", message: "Direct API bypass attempt" } }],
    ["list_website_submissions", { p_actor: "forged-admin" }], ["handle_website_submission", { p_actor: "forged-admin", p_id: refs[0], p_note: "Forged handling" }],
    ["list_submission_audit", { p_actor: "forged-admin" }]
  ]) check(`anon RPC denied: ${name}`, !!(await anon.rpc(name, data)).error);
  const createdWebsiteUser = await privileged.auth.admin.createUser({ email: `supabase-${email}`, password, email_confirm: true, user_metadata: { admin: true } });
  assert.ifError(createdWebsiteUser.error); websiteUserID = createdWebsiteUser.data.user.id;
  const websiteUser = await anon.auth.signInWithPassword({ email: `supabase-${email}`, password });
  assert.ifError(websiteUser.error); assert.ok(websiteUser.data.session);
  check("Supabase website account with editable admin metadata cannot read inbox", !!(await anon.from("website_submissions").select("*")).error);
  check("Supabase website account cannot execute staff RPC", !!(await anon.rpc("list_website_submissions", { p_actor: staff.localId })).error);
  const ordinaryCookie = websiteUser.data.session.access_token;
  check("Supabase session cannot authorize Firebase staff route", [401, 403].includes((await api("/admin/api/submissions", { action: "list" }, ordinaryCookie)).status));
  for (const action of ["list", "handle", "audit"]) {
    check(`Firebase non-admin denied: ${action}`, (await api("/admin/api/submissions", { action, id: refs[0], note: "Forged note", actor: staff.localId }, member.idToken)).status === 403);
  }
  check("unauthenticated inbox denied", (await api("/admin/api/submissions", { action: "list" })).status === 401);
  check("inbox cross-origin request denied", (await api("/admin/api/submissions", { action: "list" }, staff.idToken, { origin: "https://evil.example" })).status === 403);
  check("public form cross-origin request denied", (await api("/api/submissions", {}, undefined, { origin: "https://evil.example" })).status === 403);
  const oversized = await api("/api/submissions", { message: "a".repeat(25000) });
  check("public body is bounded before parsing or writing", oversized.status === 413);
  await browser("open", `${origin}/admin`); await browser("wait", "--text", "Sign in to review and manage");
  await browser("find", "label", "Staff email", "fill", staff.email); await browser("find", "label", "Password", "fill", password); await click("Sign in");
  await browser("wait", "--text", "Review reports"); await click("Submissions"); await browser("wait", "--text", names.support);
  const inboxText = await browser("get", "text", "body");
  check("native inbox renders all three private submissions", Object.values(names).every((name) => inboxText.includes(name)));
  check("submitted markup renders as text", (await browser("eval", "window.fixtureExecuted === true")).trim() === "false");
  const note = `Handled fixture request ${suffix}`;
  await browser("fill", `article:has-text("${names.support}") textarea`, note);
  await browser("click", `article:has-text("${names.support}") button:has-text("Mark handled")`);
  await browser("wait", "--text", "Submission marked handled.");
  await browser("select", 'label:has-text("Submission status") select', "handled"); await browser("wait", "--text", note);
  await click(`Review history for ${names.support}`); await browser("wait", "--text", note);
  const support = rows.data.find((r) => r.kind === "support"), handled = await privileged.from("website_submissions").select("*").eq("id", support.id).single();
  assert.ifError(handled.error);
  check("native handled history saves note and verified Firebase actor", handled.data.status === "handled" && handled.data.handling_note === note && handled.data.handled_by === staff.localId);
  const audit = await api("/admin/api/submissions", { action: "audit", id: support.id }, staff.idToken);
  check("admin can read immutable before/after handling audit", audit.status === 200 && audit.body.items.some((r) => r.actor === staff.localId &&
    r.before_state.status === "pending" && r.after_state.status === "handled" && r.reason === note));
  check("client cannot overwrite verified actor", (await api("/admin/api/submissions", { action: "handle", id: support.id, note: "Updated fixture note", actor: "forged" }, staff.idToken)).body.handled_by === staff.localId);
  check("handling requires a note", (await api("/admin/api/submissions", { action: "handle", id: support.id, note: "" }, staff.idToken)).status === 400);
  check("audit updates are refused even to service role", !!(await privileged.from("submission_audit").update({ reason: "forged" }).eq("target", support.id)).error);
  check("audit deletes are refused even to service role", !!(await privileged.from("submission_audit").delete().eq("target", support.id)).error);
  // A same-timestamp corpus proves the compound keyset cursor has no gaps.
  const paged = Array.from({ length: 105 }, (_, i) => ({ id: randomUUID(), kind: "support", contact_name: `Paging Fixture ${suffix} ${i}`,
    contact_email: email, payload: { subject: "Paging fixture", message: "Local pagination fixture only." }, created_at: "2020-01-01T00:00:00Z" }));
  refs.push(...paged.map((r) => r.id)); assert.ifError((await privileged.from("website_submissions").insert(paged)).error);
  const found = [], cursors = [];
  let cursor = null;
  do {
    const page = await api("/admin/api/submissions", { action: "list", kind: "support", status: "pending", afterId: cursor }, staff.idToken);
    assert.equal(page.status, 200, JSON.stringify(page.body)); found.push(...page.body.items.filter((r) => r.contact_email === email && r.contact_name.startsWith("Paging Fixture")).map((r) => r.id));
    cursor = page.body.nextCursor; if (cursor) cursors.push(cursor);
  } while (cursor);
  check("105 equal-timestamp submissions page without omissions or repeats", found.length === 105 && new Set(found).size === 105 && cursors.length >= 2);
  check("missing inbox cursor requests refresh rather than skipping rows", (await api("/admin/api/submissions", { action: "list", afterId: randomUUID() }, staff.idToken)).status === 400);
  const rollback = paged[0].id;
  sql(`create function verdure_private.qa_submission_audit_failure() returns trigger language plpgsql set search_path='' as $$ begin if new.target='${rollback}' then raise exception 'Local audit rollback fixture'; end if; return new; end $$;
    create trigger qa_submission_audit_failure before insert on public.submission_audit for each row execute function verdure_private.qa_submission_audit_failure();`);
  try {
    check("handling fails if its audit cannot commit", (await api("/admin/api/submissions", { action: "handle", id: rollback, note: "Must roll back" }, staff.idToken)).status === 503);
    const original = await privileged.from("website_submissions").select("status,handling_note").eq("id", rollback).single();
    check("audit failure rolls back handled status and note", original.data.status === "pending" && original.data.handling_note === null);
  } finally { sql("drop trigger qa_submission_audit_failure on public.submission_audit; drop function verdure_private.qa_submission_audit_failure();"); }
  const badForm = { kind: "organizer", contactName: "Invalid fixture", contactEmail: email, organization: "Fixture", organizationType: "Community",
    eventsPerMonth: 1, publicCalendar: true, calendarURL: "javascript:alert(1)" };
  check("unsafe calendar URL refused", (await api("/api/submissions", badForm)).status === 400);
  check("invalid contact email refused", (await api("/api/submissions", { ...badForm, contactEmail: "not-an-email" })).status === 400);
  check("unknown form kind refused by database", !!(await privileged.rpc("submit_website_request", { p_kind: "admin", p_contact_name: "Unknown fixture",
    p_contact_email: email, p_payload: {} })).error);
  // Next dev recompiles route modules as pages warm, which can reset an
  // in-memory limiter. Measure a consecutive sequence after routes are warm;
  // never infer a global/durable limit from earlier browser requests.
  let throttled = false;
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await api("/api/submissions", { ...badForm, kind: attempt % 2 ? "support" : "merchant" });
    if (response.status === 429) { throttled = true; break; }
    assert.equal(response.status, 400);
  }
  check("per-process public rate limit applies across form kinds", throttled);
  await browser("set", "viewport", "390", "844"); await browser("screenshot", `/tmp/verdure-submissions-mobile-${suffix}.png`);
  check("mobile staff inbox has no page overflow", (await browser("eval", "document.documentElement.scrollWidth <= window.innerWidth")).trim() === "true");
  await browser("open", `${origin}/support`); await browser("screenshot", `/tmp/verdure-support-mobile-${suffix}.png`);
  check("mobile support form has no page overflow", (await browser("eval", "document.documentElement.scrollWidth <= window.innerWidth")).trim() === "true");
  execFileSync(process.execPath, [fileURLToPath(new URL("../../functions/scripts/staff-admin.mjs", import.meta.url)), "--uid", staff.localId,
    "--revoke", "--reason", "Local submissions revocation test"], { env: process.env });
  for (const action of ["list", "handle", "audit"]) check(`revoked admin denied with old cookie: ${action}`,
    (await api("/admin/api/submissions", { action, id: support.id, note: "Old token attempt" }, staff.idToken)).status === 403);
  console.log(`${checks} submissions browser/server/database checks passed`);
} finally {
  await browser("close");
  if (websiteUserID) await privileged.auth.admin.deleteUser(websiteUserID);
  sql(`delete from public.website_submissions where contact_email='${email}';`);
  // Audit remains append-only; all personal values were fictional fixtures.
}
