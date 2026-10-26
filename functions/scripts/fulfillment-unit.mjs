// Fulfilment classification tests — no emulator, no network, no vendor account.
//
//   node functions/scripts/fulfillment-unit.mjs
//
// WHY THIS EXISTS SEPARATELY FROM THE E2E SUITE.
// The E2E suite proves the queue is written and locked down, but it can never
// reach the vendor call — there's no Tremendous account in CI and there
// shouldn't be. Yet the vendor call is where the money decisions live: which
// HTTP status means "try again in half an hour" versus "give the user their
// points back and stop". Getting that wrong is expensive in both directions —
// a retryable error treated as permanent refunds a card that was actually sent,
// and a permanent error treated as retryable spins forever.
//
// So `fetch` is stubbed and only the classification is asserted.

import { __testing } from "../lib/fulfillment.js";

const { placeOrder } = __testing;

let passed = 0, failed = 0;
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name} ${extra}`); }
}

const realFetch = globalThis.fetch;

/** Run placeOrder against a canned HTTP response. */
async function withResponse({ status, body = "{}", throws = null }, fn) {
  globalThis.fetch = async () => {
    if (throws) throw new Error(throws);
    return { status, ok: status >= 200 && status < 300, text: async () => body };
  };
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}

const baseArgs = {
  fulfilmentId: "uid123_starbucks-5",
  rewardId: "starbucks-5",
  email: "member@example.com",
  apiKey: "test-key",
  fundingSourceId: "FUNDING123",
  catalog: { "starbucks-5": "PRODUCT123" },
  campaignId: "",
  baseUrl: "https://testflight.tremendous.com/api/v2",
};

console.log("── Tremendous fulfilment classification ──");

// 200 and 201 must be indistinguishable: 201 is Tremendous replaying an order we
// already placed. Treating it as a failure would refund a card that WAS sent.
const sent200 = await withResponse(
  { status: 200, body: JSON.stringify({ order: { id: "ORD1", rewards: [{ id: "RW1" }] } }) },
  () => placeOrder(baseArgs));
ok("200 → sent, with the order id captured",
   sent200.kind === "sent" && sent200.orderId === "ORD1", JSON.stringify(sent200));

const sent201 = await withResponse(
  { status: 201, body: JSON.stringify({ order: { id: "ORD1", rewards: [{ id: "RW1" }] } }) },
  () => placeOrder(baseArgs));
ok("201 (idempotent replay) is treated exactly like 200",
   sent201.kind === "sent" && sent201.orderId === "ORD1", JSON.stringify(sent201));

// 402 = our Tremendous balance is empty. The user's redemption is perfectly
// valid; failing it for our accounting problem would be backwards.
const insufficient = await withResponse({ status: 402, body: "insufficient funds" },
  () => placeOrder(baseArgs));
ok("402 insufficient funds → RETRY (top up, don't punish the user)",
   insufficient.kind === "retry", JSON.stringify(insufficient));

// 400/401/403 will never succeed by repeating the same request.
for (const status of [400, 401, 403]) {
  const r = await withResponse({ status, body: "nope" }, () => placeOrder(baseArgs));
  ok(`${status} → PERMANENT (retrying can't fix a bad payload or key)`,
     r.kind === "permanent", JSON.stringify(r));
}

// 409 = same external_id, different parameters. Retrying re-sends the same
// conflict forever, so it needs a human.
const conflict = await withResponse({ status: 409, body: "conflict" },
  () => placeOrder(baseArgs));
ok("409 conflicting external_id → PERMANENT", conflict.kind === "permanent",
   JSON.stringify(conflict));

// 5xx and network faults are the ordinary transient case.
const server = await withResponse({ status: 503, body: "unavailable" },
  () => placeOrder(baseArgs));
ok("503 → RETRY", server.kind === "retry", JSON.stringify(server));

const netFail = await withResponse({ status: 0, throws: "ECONNRESET" },
  () => placeOrder(baseArgs));
ok("network error → RETRY", netFail.kind === "retry", JSON.stringify(netFail));

// An unknown reward id is a code/config bug, not something to keep hammering.
const unknown = await withResponse({ status: 200 },
  () => placeOrder({ ...baseArgs, rewardId: "not-a-real-reward" }));
ok("unknown reward id → PERMANENT", unknown.kind === "permanent", JSON.stringify(unknown));

// No product id AND no campaign is a CONFIGURATION gap — the queue should hold
// until the catalog secret is set, not burn the user's redemption.
const unconfigured = await withResponse({ status: 200 },
  () => placeOrder({ ...baseArgs, catalog: {}, campaignId: "" }));
ok("no product id and no campaign → RETRY (config gap, holds the queue)",
   unconfigured.kind === "retry", JSON.stringify(unconfigured));

// A success body we can't parse must not be read as "sent" — that would mark a
// card delivered with no order id to reconcile against.
const garbled = await withResponse({ status: 200, body: "<html>oops" },
  () => placeOrder(baseArgs));
ok("unparseable 200 → RETRY, never a silent 'sent'",
   garbled.kind === "retry", JSON.stringify(garbled));

// The request itself must carry the idempotency key and the right denomination.
let captured = null;
globalThis.fetch = async (_url, init) => {
  captured = JSON.parse(init.body);
  return { status: 200, ok: true, text: async () => JSON.stringify({ order: { id: "X", rewards: [] } }) };
};
await placeOrder(baseArgs);
globalThis.fetch = realFetch;
ok("external_id is the fulfilment doc id (the whole idempotency story)",
   captured?.external_id === "uid123_starbucks-5", JSON.stringify(captured?.external_id));
ok("denomination comes from the catalog, not parsed from the reward id",
   captured?.reward?.value?.denomination === 5, JSON.stringify(captured?.reward?.value));
ok("delivery is addressed to the recipient on the fulfilment row",
   captured?.reward?.recipient?.email === "member@example.com",
   JSON.stringify(captured?.reward?.recipient));

console.log(`\n══ ${passed} passed, ${failed} failed ══`);
process.exit(failed > 0 ? 1 : 0);
