// Regression assertions for the security primitives.
//
// These exist because every control in lib/security has now been wrong at
// least once in a way that reading it did not reveal and running it did
// immediately: the redirect guard accepted "/..//evil.example", the limiter's
// memory guard reset every counter it was supposed to protect, its first
// replacement evicted the longest-established limits, and the IPv6 collapse
// gave a distinct key to every address in any /64 containing a zero run.
//
// Run with: npm run test:security
//
// No test framework on purpose — the project has none, and one dependency-free
// script that exits non-zero is enough to keep these honest.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let out = mkdtempSync(join(tmpdir(), "verdure-sec-"));
let failures = 0;
let checks = 0;

function check(label, condition, detail)
{
  checks = checks + 1;

  if (!condition)
  {
    failures = failures + 1;
  }

  console.log(
    "  " + (condition ? "PASS" : "FAIL") + "  " + label + (detail ? "  " + detail : "")
  );
}

try
{
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/security/ip.ts",
      "src/lib/security/rate-limit.ts",
      "src/lib/security/safe-path.ts",
      "src/lib/security/identity-budget.ts",
      "--outDir", out,
      "--module", "commonjs",
      "--target", "es2020",
      "--skipLibCheck",
    ],
    { stdio: "inherit", shell: process.platform === "win32" }
  );

  let { normalizeIp, resolveClientIp } = await import(pathToFileURL(join(out, "ip.js")).href);
  let { rateLimit } = await import(pathToFileURL(join(out, "rate-limit.js")).href);
  let { safeInternalPath } = await import(pathToFileURL(join(out, "safe-path.js")).href);
  let { canSpendIdentityLookup } = await import(
    pathToFileURL(join(out, "identity-budget.js")).href
  );

  // ── Client-address resolution ───────────────────────────────────────────
  // This had no coverage at all, in either test file, while being the single
  // line every rate limit in the app depends on: it read the LEFTMOST
  // x-forwarded-for element, which is the part the client writes. One spoofed
  // header per request minted a fresh bucket and every limit became a no-op.
  // It was safe only because Vercel overwrites that header — correct by
  // deployment accident, and silently wrong behind any other proxy or none.
  console.log("\nresolveClientIp — header trust");

  let headersFrom = function (map)
  {
    return function (name)
    {
      return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
    };
  };

  let ipHeaderCases = [
    [
      "a client-supplied leftmost XFF cannot override the platform header",
      { "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "1.2.3.4" },
      "203.0.113.5",
    ],
    [
      "a client-supplied leftmost XFF cannot override x-real-ip",
      { "x-real-ip": "203.0.113.6", "x-forwarded-for": "1.2.3.4" },
      "203.0.113.6",
    ],
    [
      "a spoofed value prepended to a proxy chain is ignored",
      { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
      "203.0.113.7",
    ],
    [
      "the rightmost element wins across a longer chain",
      { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.8" },
      "203.0.113.8",
    ],
    [
      "a single-value XFF (what Vercel sends) still resolves to the client",
      { "x-forwarded-for": "203.0.113.9" },
      "203.0.113.9",
    ],
    [
      "trailing empty elements are skipped rather than yielding an empty key",
      { "x-forwarded-for": "203.0.113.10, " },
      "203.0.113.10",
    ],
    [
      "an IPv6 client still collapses to its /64",
      { "x-vercel-forwarded-for": "2001:db8:1:2::99" },
      "2001:db8:1:2::/64",
    ],
    [
      "no headers at all shares one bucket rather than minting keys",
      {},
      "unknown",
    ],
    [
      "an all-empty XFF falls through instead of returning an empty key",
      { "x-forwarded-for": " , " },
      "unknown",
    ],
  ];

  ipHeaderCases.forEach(function (entry)
  {
    let actual = resolveClientIp(headersFrom(entry[1]));

    check(entry[0], actual === entry[2], '-> "' + actual + '"');
  });

  // Two distinct spoofed values must not produce two distinct buckets when a
  // trusted header is present — that is the bypass, stated directly.
  let spoofA = resolveClientIp(
    headersFrom({ "x-real-ip": "203.0.113.20", "x-forwarded-for": "9.9.9.1" })
  );
  let spoofB = resolveClientIp(
    headersFrom({ "x-real-ip": "203.0.113.20", "x-forwarded-for": "9.9.9.2" })
  );

  check(
    "rotating a spoofed XFF does not mint a second bucket",
    spoofA === spoofB && spoofA === "203.0.113.20"
  );

  // ── IPv6 /64 collapse ───────────────────────────────────────────────────
  // Every case below returned a DISTINCT key under the string-splitting
  // version, which is precisely the free-buckets problem the collapse exists
  // to remove. "::" compression means the first four colon-separated groups
  // are not the first four hextets.
  console.log("\nnormalizeIp — IPv6 /64");

  let ipCases = [
    ["2001:db8:1234:5678::1", "2001:db8:1234:5678::/64"],
    ["2001:db8:1234:5678::2", "2001:db8:1234:5678::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:db8::2", "2001:db8:0:0::/64"],
    ["2001:db8:0:0:aaaa::1", "2001:db8:0:0::/64"],
    ["[2001:db8:1:2::1]:41234", "2001:db8:1:2::/64"],
    ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8:0:0::/64"],
    ["2001:DB8::AAAA", "2001:db8:0:0::/64"],
    ["2001:db8:0:1::1", "2001:db8:0:1::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    // Unwrapped, NOT masked. This line previously asserted "0:0:0:0::/64",
    // which encoded the bug as the expected result: every IPv4-mapped client
    // sharing one bucket with each other and with ::1.
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["203.0.113.9", "203.0.113.9"],
    ["unknown", "unknown"],
  ];

  for (let [input, expected] of ipCases)
  {
    let actual = normalizeIp(input);
    check(JSON.stringify(input), actual === expected, "-> " + JSON.stringify(actual));
  }

  let oneSlash64 = [
    "2001:db8::1",
    "2001:db8::2",
    "2001:db8:0:0:aaaa::1",
    "[2001:db8::99]:8080",
  ].map(normalizeIp);

  check("four addresses in one /64 share one key", new Set(oneSlash64).size === 1);

  // ── Redirect guard ──────────────────────────────────────────────────────
  console.log("\nsafeInternalPath — open redirect");

  let BS = String.fromCharCode(92);
  let redirectCases = [
    ["/account", "/account"],
    ["/pricing?a=1#x", "/pricing?a=1#x"],
    ["//evil.example", "/account"],
    ["/" + BS + "evil.example", "/account"],
    ["/" + String.fromCharCode(9) + "/evil.example", "/account"],
    ["https://evil.example", "/account"],
    ["javascript:alert(1)", "/account"],
    ["////evil.example", "/account"],
    ["/..//evil.example", "/account"],
    ["/.//evil.example", "/account"],
    ["", "/account"],
    [null, "/account"],
    [undefined, "/account"],
  ];

  for (let [input, expected] of redirectCases)
  {
    let actual = safeInternalPath(input, "/account");
    check(
      typeof input === "string" ? JSON.stringify(input) : String(input),
      actual === expected,
      "-> " + JSON.stringify(actual)
    );
  }

  // ── Rate limiter ────────────────────────────────────────────────────────
  console.log("\nrateLimit — thresholds and eviction");

  let WINDOW = 10 * 60 * 1000;

  for (let i = 0; i < 5; i++)
  {
    rateLimit("wl:threshold", 5, WINDOW);
  }

  check("6th request over a limit of 5 is refused", rateLimit("wl:threshold", 5, WINDOW).ok === false);

  for (let i = 0; i < 5; i++)
  {
    rateLimit("wl:victim", 5, WINDOW);
  }

  for (let i = 0; i < 24000; i++)
  {
    rateLimit("flood:" + i, 5, WINDOW);
  }

  check(
    "a fully-consumed bucket survives a 24k-key flood",
    rateLimit("wl:victim", 5, WINDOW).ok === false
  );

  // The flood above arrives as count=1 buckets, and for three revisions that
  // was the ONLY shape tested — which is why it kept passing while the property
  // it claims to prove was false. An attacker does not have to send cheap keys.
  // Saturating each flood key ties every bucket at consumed fraction 1.0, and a
  // stable sort then breaks the tie by insertion order, evicting the
  // longest-established bucket first: the victim. Flood by exhausting each key.
  for (let i = 0; i < 5; i++)
  {
    rateLimit("wl:victim2", 5, WINDOW);
  }

  check("wl:victim2 is refused before the saturated flood", rateLimit("wl:victim2", 5, WINDOW).ok === false);

  for (let i = 0; i < 24000; i++)
  {
    for (let j = 0; j < 5; j++)
    {
      rateLimit("satflood:" + i, 5, WINDOW);
    }
  }

  check(
    "a fully-consumed bucket survives a flood of EQUALLY consumed keys",
    rateLimit("wl:victim2", 5, WINDOW).ok === false
  );

  // Cross-policy ordering: identity (limit 60) must not be shed first purely
  // because its larger limit gives it the most ABSOLUTE headroom.
  for (let i = 0; i < 40; i++)
  {
    rateLimit("identity:1.2.3.4", 60, WINDOW);
  }

  // Saturated again, and this is the harsher direction: identity sits at 40/60
  // = 0.67 while every flood key sits at 1.0, so ANY policy that orders purely
  // by consumed fraction evicts the identity budget FIRST and hands back a
  // fresh 60 — the reset the limiter exists to deny.
  for (let i = 0; i < 24000; i++)
  {
    for (let j = 0; j < 5; j++)
    {
      rateLimit("flood2:" + i, 5, WINDOW);
    }
  }

  let remaining = 0;

  for (let i = 1; i <= 25; i++)
  {
    if (rateLimit("identity:1.2.3.4", 60, WINDOW).ok === false)
    {
      remaining = i;
      break;
    }
  }

  check(
    "a partially-consumed high-limit bucket keeps its count across a flood",
    remaining > 0 && remaining <= 21,
    "blocked after " + remaining + " further calls (expected ~20, not ~60)"
  );
  // ── Identity budget: probe traffic must not starve the /account gate ─────
  // The single shared bucket made a lockout possible. Exhaustion fails CLOSED
  // on a protected route and OPEN on an auth page — individually right, jointly
  // a loop: spend the whole budget on unauthenticated GET /auth/session and
  // every OTHER visitor behind that egress address loses /account, logs in
  // successfully, is redirected back, and bounces again.
  console.log("\ncanSpendIdentityLookup — one budget per purpose");

  let victimIp = "203.0.113.200";
  let probeSpent = 0;

  // Drain the probe allowance from one source, the way an attacker would.
  for (let i = 0; i < 200; i++)
  {
    if (canSpendIdentityLookup(victimIp, "probe") === false)
    {
      break;
    }

    probeSpent = probeSpent + 1;
  }

  check(
    "the probe budget is finite",
    probeSpent > 0 && canSpendIdentityLookup(victimIp, "probe") === false,
    "drained after " + probeSpent
  );

  check(
    "a drained probe budget does NOT lock the same source out of /account",
    canSpendIdentityLookup(victimIp, "gate") === true
  );

  check(
    "a drained probe budget does not consume the exchange budget either",
    canSpendIdentityLookup(victimIp, "exchange") === true
  );

  // The exchange allowance is the tight one: a replayed ?code is one outbound
  // Supabase Auth call per request, and a real user clicks a link once.
  let exchangeSpent = 1;

  for (let i = 0; i < 200; i++)
  {
    if (canSpendIdentityLookup(victimIp, "exchange") === false)
    {
      break;
    }

    exchangeSpent = exchangeSpent + 1;
  }

  check(
    "the exchange budget is tighter than the probe budget",
    exchangeSpent < probeSpent,
    exchangeSpent + " vs " + probeSpent
  );

  check(
    "draining every budget for one source leaves another source untouched",
    canSpendIdentityLookup("203.0.113.201", "gate") === true
  );
}
finally
{
  rmSync(out, { recursive: true, force: true });
}

console.log(
  "\n" + (failures === 0
    ? checks + " checks passed"
    : failures + " of " + checks + " checks FAILED")
);

process.exit(failures === 0 ? 0 : 1);
