import { headers } from "next/headers";
import { resolveClientIp } from "./ip";

// Resolves the caller's address for rate-limiting purposes, for anything
// running with next/headers available (Server Actions, Route Handlers).
//
// The header precedence and the reasoning behind it live in resolveClientIp
// (lib/security/ip.ts), shared with the middleware so the two runtimes cannot
// disagree about what one client is. In short: platform-set headers first,
// x-forwarded-for last and read from the right, because its leftmost element is
// written by the client.
//
// A single cheap host is routinely handed an IPv6 /64 — 18 quintillion
// addresses — so keying a limit on the full address is the same as having no
// limit at all against anyone who bothers. Collapsing to the /64 means the
// whole allocation shares one bucket, which is the unit an ISP actually hands
// to one customer.
//
// The parsing lives in lib/security/ip.ts and is deliberately not a string
// split: see the note there for why the obvious version silently fails on
// every address containing "::".

export async function clientIp(): Promise<string>
{
  let requestHeaders = await headers();

  return resolveClientIp(function (name)
  {
    return requestHeaders.get(name);
  });
}
