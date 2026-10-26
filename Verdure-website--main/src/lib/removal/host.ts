// Client-side mirror of normalizeHost / validHost in
// functions/src/discovery/removal.ts and functions/src/discovery/inspect.ts.
//
// The server is the authority: it normalises again and rejects what it will
// not inspect. This copy exists so the form can show the host the way the
// server will see it, and refuse obviously wrong input before spending one of
// the requester's five daily removal attempts on a 400.
//
// Keep the two in step. If the server rule changes, change this and the
// assertions in remove-host.test.mjs together.

export function normalizeHost(raw: unknown): string
{
  let host = String(raw ?? "").trim().toLowerCase();

  try
  {
    if (/^https?:\/\//.test(host))
    {
      host = new URL(host).hostname;
    }
  }
  catch
  {
    // keep the text as typed; validHost rejects it if it is not a host
  }

  return host.replace(/^www\./, "").replace(/\.$/, "");
}

export function validHost(host: string): boolean
{
  return (
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) &&
    host.includes(".") &&
    !host.includes("..") &&
    !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/i.test(host) &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(host)
  );
}

/** Where the Functions HTTP endpoints live; empty means the page is disabled. */
export function functionsBaseUrl(): string
{
  return (process.env.NEXT_PUBLIC_VERDURE_FUNCTIONS_URL || "").trim().replace(/\/+$/, "");
}
