// Validates a client-supplied redirect target as a same-origin path.
//
// startsWith("/") plus a "//" rejection is not enough: browsers parse
// "/\evil.com" as protocol-relative (backslash is a slash to the WHATWG URL
// parser), and tab/newline characters are stripped before parsing, so
// "/\t/evil.com" collapses to "//evil.com" too. Rather than enumerating every
// such trick, resolve the candidate against a fixed sentinel origin and
// require that the parsed result stayed on it — the exact parsing the browser
// will do is what decides.
let SENTINEL = "https://redirect-guard.invalid";

export function safeInternalPath(target: unknown, fallback: string): string
{
  if (typeof target !== "string" || !target.startsWith("/"))
  {
    return fallback;
  }

  let resolved: URL;

  try
  {
    resolved = new URL(target, SENTINEL);
  }
  catch
  {
    return fallback;
  }

  if (resolved.origin !== SENTINEL)
  {
    return fallback;
  }

  let path = resolved.pathname + resolved.search + resolved.hash;

  // The origin check alone is not enough. "/..//evil.example" resolves ONTO
  // the sentinel origin — so the test above passes — but its pathname is
  // "//evil.example", and handing that back produces a protocol-relative
  // Location header that the browser reads as a different host entirely.
  // The returned value must itself be a single-slash path.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\"))
  {
    return fallback;
  }

  return path;
}
