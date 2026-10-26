// Assertions for normalizeIp in src/lib/security/ip.ts.
//
// This module has been wrong twice in ways that reading it did not reveal.
// First it split the address text on ":" and took four groups, which is only
// the /64 when nothing is compressed — so every address in a /64 containing a
// zero run got its own bucket, the exact case the collapse exists to prevent.
// Then, with a spec-correct mask in place, IPv4-mapped addresses all folded
// onto 0:0:0:0::/64 together with ::1 and ::, which is worse: it does not
// merely fail to limit an attacker, it lets one visitor rate-limit every IPv4
// client on the site at once.
//
// Run with: npm run test:ip

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let out = mkdtempSync(join(tmpdir(), "verdure-ip-"));
let failures = 0;
let total = 0;

let report = function (label, ok, detail)
{
  total = total + 1;

  if (!ok)
  {
    failures = failures + 1;
  }

  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + label + (detail ? "  " + detail : ""));
};

try
{
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/security/ip.ts",
      "--outDir", out,
      "--module", "commonjs",
      "--target", "es2020",
      "--skipLibCheck",
    ],
    { stdio: "inherit", shell: process.platform === "win32" }
  );

  let mod = await import(pathToFileURL(join(out, "ip.js")).href);
  let normalizeIp = mod.normalizeIp;

  let equals = function (input, expected)
  {
    let actual;

    try
    {
      actual = normalizeIp(input);
    }
    catch (error)
    {
      report(JSON.stringify(input), false, "THREW " + error.message);
      return;
    }

    report(JSON.stringify(input), actual === expected, "-> " + JSON.stringify(actual));
  };

  console.log("\nIPv4-mapped unwraps BEFORE masking");
  // The whole point: these must be distinct from each other and from ::1/::,
  // or one visitor's budget becomes every IPv4 visitor's budget.
  equals("::ffff:192.0.2.7", "192.0.2.7");
  equals("::ffff:203.0.113.9", "203.0.113.9");
  equals("::ffff:8.8.8.8", "8.8.8.8");
  equals("::FFFF:192.0.2.7", "192.0.2.7");
  // Hex spelling of the same mapped address.
  equals("::ffff:c000:0207", "192.0.2.7");
  equals("[::ffff:192.0.2.7]:51000", "192.0.2.7");

  // Four, not five: ::1 and :: really do share 0:0:0:0::/64, which is correct
  // — they are both inside that block. What must not happen is an IPv4-mapped
  // client landing in it alongside them.
  let mappedKeys = new Set(
    ["::ffff:192.0.2.7", "::ffff:203.0.113.9", "::ffff:8.8.8.8", "::1", "::"].map(normalizeIp)
  );
  report("three IPv4-mapped clients plus the ::-block are four distinct keys", mappedKeys.size === 4);

  let loopbackKey = normalizeIp("::1");
  let anyCollides = ["::ffff:192.0.2.7", "::ffff:203.0.113.9", "::ffff:8.8.8.8"].some(
    function (address)
    {
      return normalizeIp(address) === loopbackKey;
    }
  );
  report("no IPv4-mapped client shares the ::1 bucket", anyCollides === false);

  console.log("\n/64 collapse");
  equals("2001:db8:1234:5678::1", "2001:db8:1234:5678::/64");
  equals("2001:db8:1234:5678::2", "2001:db8:1234:5678::/64");
  equals("2001:db8::1", "2001:db8:0:0::/64");
  equals("2001:db8::2", "2001:db8:0:0::/64");
  equals("2001:db8:0:0:aaaa::1", "2001:db8:0:0::/64");
  // Must NOT collide with the three above.
  equals("2001:db8:0:1::1", "2001:db8:0:1::/64");

  let oneBlock = new Set(
    ["2001:db8::1", "2001:db8::2", "2001:db8:0:0:aaaa::1", "2001:db8::dead:beef"].map(normalizeIp)
  );
  report("four addresses in one /64 share one key", oneBlock.size === 1);

  console.log("\nnotation: uppercase, leading zeros, :: at either end or alone");
  equals("2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8:0:0::/64");
  equals("2001:DB8::AAAA", "2001:db8:0:0::/64");
  equals("::", "0:0:0:0::/64");
  equals("::1", "0:0:0:0::/64");
  equals("2001:db8::", "2001:db8:0:0::/64");
  equals("fe80::", "fe80:0:0:0::/64");
  equals("2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64");

  console.log("\nbrackets, ports and zone indices");
  equals("[2001:db8:1:2::1]:41234", "2001:db8:1:2::/64");
  equals("[2001:db8:1:2::1]", "2001:db8:1:2::/64");
  equals("fe80::1%eth0", "fe80:0:0:0::/64");
  equals("fe80::1%25eth0", "fe80:0:0:0::/64");
  equals("[fe80::1%eth0]:443", "fe80:0:0:0::/64");

  console.log("\nIPv4 passes through untouched");
  equals("203.0.113.9", "203.0.113.9");
  equals("10.0.0.1", "10.0.0.1");

  console.log("\nmalformed input falls back, never throws");
  // Two "::" runs are illegal; so are over-long groups, non-hex, and empties.
  equals("2001::db8::1", "2001::db8::1");
  equals("2001:db8:1:2:3:4:5:6:7:8", "2001:db8:1:2:3:4:5:6:7:8");
  equals("2001:db8:zzzz::1", "2001:db8:zzzz::1");
  equals("2001:db8:12345::1", "2001:db8:12345::1");
  equals("::ffff:999.0.0.1", "::ffff:999.0.0.1");
  equals("[2001:db8::1", "[2001:db8::1");
  equals("", "");
  equals("unknown", "unknown");
  equals("   203.0.113.9   ", "203.0.113.9");

  // A middleware exception turns a malformed header into a 500, so the
  // no-throw property is asserted over junk as well as over near-misses.
  let junk = [
    ":", "::::", ":::", "%", "[]", "[]:80", "::%", "a".repeat(300),
    "1:2:3:4:5:6:7:8:9", "::ffff:", "::ffff:1.2.3", "::ffff:1.2.3.4.5",
    "\t", "\n", "0:0:0:0:0:0:0", "fe80::1%", "[::1]:", "::1%zone%zone",
  ];
  let threw = 0;

  for (let value of junk)
  {
    try
    {
      normalizeIp(value);
    }
    catch (error)
    {
      threw = threw + 1;
      console.log("    THREW on " + JSON.stringify(value) + ": " + error.message);
    }
  }

  report(junk.length + " junk inputs handled without throwing", threw === 0);
}
finally
{
  rmSync(out, { recursive: true, force: true });
}

console.log(
  "\n" + (failures === 0 ? total + " checks passed" : failures + " of " + total + " checks FAILED")
);

process.exit(failures === 0 ? 0 : 1);
