// Address normalisation for rate-limit keys.
//
// The point is that every address inside one IPv6 /64 — the smallest block an
// ISP hands to a single customer — shares one bucket, so holding a /64 is not
// the same as holding 18 quintillion free attempts.
//
// The previous version did `address.split(":").slice(0, 4)` on the TEXT, which
// is wrong the moment "::" appears, and "::" appears in most real addresses.
// The first four colon-separated groups are only the first four hextets when
// nothing is compressed:
//
//   2001:db8::1            -> "2001:db8::1"      one key per address
//   2001:db8::2            -> "2001:db8::2"      a second key, same /64
//   2001:db8:0:0:aaaa::1   -> "2001:db8:0:0"     a third key, same /64 again
//   [2001:db8:1:2::1]:4123 -> "[2001:db8:1:2"    bracket kept, port ignored
//
// So the exact allocation shape the collapse exists to defend against — a /64
// with a zero run in it — defeated it. The fix is to stop reading the text as
// if it were structure: parse to eight 16-bit groups, then keep the top four.

// Expands "::", accepts a bracketed host, a zone id, and an IPv4-mapped tail.
// Returns eight 16-bit groups, or null if this is not an IPv6 address.
function parseIpv6(input: string): number[] | null
{
  let text = input.trim();

  // "[2001:db8::1]:41234" — the bracketed form used wherever a port follows.
  if (text.startsWith("["))
  {
    let close = text.indexOf("]");

    if (close === -1)
    {
      return null;
    }

    text = text.slice(1, close);
  }

  // "fe80::1%eth0" — scope/zone id is not part of the address.
  let zone = text.indexOf("%");

  if (zone !== -1)
  {
    text = text.slice(0, zone);
  }

  if (!text.includes(":"))
  {
    return null;
  }

  // "::ffff:192.0.2.1" — rewrite the dotted tail as two hex groups so the
  // expansion below only ever deals with one notation.
  let lastColon = text.lastIndexOf(":");
  let tail = text.slice(lastColon + 1);

  if (tail.includes("."))
  {
    let octets = tail.split(".");

    if (octets.length !== 4)
    {
      return null;
    }

    let values: number[] = [];

    for (let octet of octets)
    {
      let value = Number(octet);

      if (!/^\d{1,3}$/.test(octet) || !Number.isInteger(value) || value < 0 || value > 255)
      {
        return null;
      }

      values[values.length] = value;
    }

    let high = ((values[0] << 8) | values[1]).toString(16);
    let low = ((values[2] << 8) | values[3]).toString(16);
    text = text.slice(0, lastColon + 1) + high + ":" + low;
  }

  let halves = text.split("::");

  if (halves.length > 2)
  {
    return null;
  }

  let head = halves[0] ? halves[0].split(":") : [];
  let rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

  let groups: string[];

  if (halves.length === 2)
  {
    let missing = 8 - head.length - rest.length;

    if (missing < 0)
    {
      return null;
    }

    groups = head.concat(new Array(missing).fill("0")).concat(rest);
  }
  else
  {
    groups = head;
  }

  if (groups.length !== 8)
  {
    return null;
  }

  let parsed: number[] = [];

  for (let group of groups)
  {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group))
    {
      return null;
    }

    parsed[parsed.length] = parseInt(group, 16);
  }

  return parsed;
}

// An IPv4-mapped address (::ffff:a.b.c.d) is an IPv4 client that arrived over
// a v6-capable path. Masking it to a /64 is spec-correct and catastrophic:
// every one of them expands to 0000:0000:0000:0000:0000:ffff:xxxx:xxxx, so the
// top four groups are zero for ALL of them, and the key collapses to
// 0:0:0:0::/64 — shared with each other, with ::1 and with ::. Five waitlist
// signups from one visitor would then rate-limit every IPv4 visitor on the
// site simultaneously. The v4 address is the real identity here, so it is
// unwrapped before any masking happens.
function mappedIpv4(groups: number[]): string | null
{
  for (let i = 0; i < 5; i++)
  {
    if (groups[i] !== 0)
    {
      return null;
    }
  }

  if (groups[5] !== 0xffff)
  {
    return null;
  }

  return [
    groups[6] >> 8,
    groups[6] & 0xff,
    groups[7] >> 8,
    groups[7] & 0xff,
  ].join(".");
}

/**
 * Rate-limit key for a client address. IPv6 collapses to its /64, IPv4-mapped
 * addresses unwrap to their IPv4 form first, and IPv4 or anything unparseable
 * is returned as-is — a malformed value gets its own bucket rather than
 * silently sharing one, and never throws, because this runs in middleware
 * where an exception turns a bad header into a 500.
 */
export function normalizeIp(address: string): string
{
  let trimmed = address.trim();
  let groups = parseIpv6(trimmed);

  if (!groups)
  {
    return trimmed;
  }

  let mapped = mappedIpv4(groups);

  if (mapped)
  {
    return mapped;
  }

  let prefix: string[] = [];

  for (let i = 0; i < 4; i++)
  {
    prefix[prefix.length] = groups[i].toString(16);
  }

  return prefix.join(":") + "::/64";
}

// Resolves one client identity from request headers.
//
// Shared by lib/security/request-ip.ts (Server Actions and Route Handlers, via
// next/headers) and lib/supabase/middleware.ts (which runs before next/headers
// exists and must read the request directly). Those two had the same logic
// copied into both files, which is how they came to disagree; keeping the
// resolution here means one client cannot be two different buckets depending on
// which runtime happened to charge them.
//
// HEADER ORDER IS THE WHOLE SECURITY PROPERTY, so, in order:
//
//   x-vercel-forwarded-for  Set by Vercel's proxy from the connecting socket.
//                           A client cannot forge it — anything it sends under
//                           this name is replaced, not appended.
//   x-real-ip               The same guarantee from Vercel, and the header a
//                           conventional nginx/Caddy front end sets. Single
//                           value, so there is no element to choose.
//   x-forwarded-for         Last, and read RIGHTMOST-first. This previously
//                           read the LEFTMOST element, which is the one part of
//                           the chain the client writes: `X-Forwarded-For:
//                           1.2.3.4` on every request minted a fresh bucket and
//                           turned every limit in the app into a no-op. It was
//                           safe only because Vercel overwrites the header, so
//                           the code was correct by deployment accident and
//                           would have failed silently the moment it ran behind
//                           any ordinary proxy, or behind none. The rightmost
//                           element is the one appended by the nearest hop we
//                           actually trust.
//
// Worst case is now over-counting rather than a bypass: behind a proxy chain
// that appends, the rightmost value may be a shared hop and several users land
// in one bucket. That direction costs someone an extra wait; the other
// direction costs the limit entirely.
export function resolveClientIp(
  getHeader: (name: string) => string | null
): string
{
  let vercel = getHeader("x-vercel-forwarded-for");

  if (vercel && vercel.trim())
  {
    return normalizeIp(vercel.trim());
  }

  let realIp = getHeader("x-real-ip");

  if (realIp && realIp.trim())
  {
    return normalizeIp(realIp.trim());
  }

  let forwarded = getHeader("x-forwarded-for");

  if (forwarded)
  {
    let parts = forwarded.split(",");

    // Rightmost non-empty. On Vercel the header carries a single value, so this
    // resolves to the same address the two checks above would have returned.
    for (let i = parts.length - 1; i >= 0; i--)
    {
      let candidate = parts[i].trim();

      if (candidate)
      {
        return normalizeIp(candidate);
      }
    }
  }

  // Local dev, or a proxy that strips all three. Everyone shares one bucket,
  // which is the safe direction to fail.
  return "unknown";
}
