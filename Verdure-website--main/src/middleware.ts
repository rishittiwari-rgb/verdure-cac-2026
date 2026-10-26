import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildCsp } from "@/lib/security/csp";

let IS_DEV = process.env.NODE_ENV !== "production";
let CSP = buildCsp(IS_DEV);

export async function middleware(request: NextRequest)
{
  let response = await updateSession(request);

  response.headers.set("Content-Security-Policy", CSP);

  // The same build answers on verdure-app.com, on the vercel.app deployment
  // behind it, and on a preview URL per push. To a crawler that is three
  // identical copies of the site competing with each other. The canonical on
  // every page names verdure-app.com as the original; this closes the other
  // side by telling a crawler not to index the copy it is currently reading.
  //
  // noindex without nofollow on purpose: the links on the copy still lead to
  // the canonical host, and there is no reason to stop that being followed.
  //
  // This lives here rather than in robots.ts because robots.txt is generated
  // once at build time and cannot know which hostname was asked for. Nothing
  // about the response body changes, so `curl <preview> | grep build-stamp`
  // still answers which build a URL is serving.
  let host = request.headers.get("host") || "";
  if (host.endsWith(".vercel.app"))
  {
    response.headers.set("X-Robots-Tag", "noindex");
  }

  return response;
}

export const config = {
  // Everything except Next's own immutable build output.
  //
  // This used to exclude any path ENDING in a static extension, which is a
  // web-cache-deception hole in waiting: the first dynamic segment under a
  // protected route makes /account/anything.png skip the auth gate while
  // looking cacheable to a CDN. Adding "/account/:path*" patched that one
  // route, but the exclusion would silently reopen for the next protected
  // prefix somebody adds — fixing the instance and leaving the class.
  //
  // Inverting it costs a middleware invocation on public asset requests, which
  // is real but bounded: middleware sets headers and never touches a response
  // body, so a 9.4 MB video pays the same fixed overhead as a favicon. In
  // exchange the auth gate cannot be routed around by choosing a filename, and
  // the CSP now lands on every response rather than only on documents.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
