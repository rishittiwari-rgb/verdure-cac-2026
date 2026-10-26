// Assertions for normalizeHost / validHost in src/lib/removal/host.ts.
//
// These mirror normalizeHost in functions/src/discovery/removal.ts and
// validHost in functions/src/discovery/inspect.ts. The server is the
// authority; this copy decides what the /remove form shows and whether it
// lets a submit through. The two must agree, or the form either rejects a
// host the server would remove or burns one of a requester's five daily
// attempts on a 400.
//
// Run with: npm run test:remove

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let out = mkdtempSync(join(tmpdir(), "verdure-remove-"));
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
      "src/lib/removal/host.ts",
      "--outDir", out,
      "--module", "commonjs",
      "--target", "es2020",
      "--skipLibCheck",
    ],
    { stdio: "inherit", shell: process.platform === "win32" }
  );

  let mod = await import(pathToFileURL(join(out, "host.js")).href);
  let normalizeHost = mod.normalizeHost;
  let validHost = mod.validHost;

  let equals = function (input, expected)
  {
    let actual;

    try
    {
      actual = normalizeHost(input);
    }
    catch (error)
    {
      report(JSON.stringify(input), false, "THREW " + error.message);
      return;
    }

    report(JSON.stringify(input), actual === expected, "-> " + JSON.stringify(actual));
  };

  let valid = function (input, expected)
  {
    let actual = validHost(normalizeHost(input));
    report("validHost " + JSON.stringify(input), actual === expected, "-> " + actual);
  };

  console.log("\nnormalizeHost: URLs collapse to the host, www. and trailing dot drop");
  equals("events.example.org", "events.example.org");
  equals("  Events.Example.ORG  ", "events.example.org");
  equals("https://www.example.org/calendar?x=1", "example.org");
  equals("http://Events.Example.org:8080/path", "events.example.org");
  equals("www.example.org", "example.org");
  equals("example.org.", "example.org");
  equals("https://www.sjpl.org/events", "sjpl.org");
  // Not a URL scheme we parse: left as typed (and rejected by validHost below).
  equals("ftp://example.org", "ftp://example.org");
  equals("example.org/calendar", "example.org/calendar");
  equals("", "");
  equals(null, "");
  equals(undefined, "");

  console.log("\nvalidHost: what the server will inspect");
  valid("events.example.org", true);
  valid("https://www.example.org/calendar", true);
  valid("careercenter.sjsu.edu", true);
  valid("a.b", true);
  valid("", false);
  valid("example", false);
  valid("example..org", false);
  valid("-example.org", false);
  valid("example.org-", false);
  valid("ex ample.org", false);
  valid("example.org/calendar", false);
  valid("localhost", false);
  valid("localhost.local", false);
  valid("127.0.0.1", false);
  valid("10.1.2.3", false);
  valid("192.168.1.1", false);
  valid("172.16.0.1", false);
  valid("172.32.0.1", false);
  valid("169.254.1.1", false);
  valid("8.8.8.8", false);
  valid("http://[::1]/", false);

  let junk = ["http://", "https://", "://", "http://%", "\t", "\n", "a".repeat(300), "https://exa mple.org"];
  let threw = 0;

  for (let value of junk)
  {
    try
    {
      validHost(normalizeHost(value));
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
