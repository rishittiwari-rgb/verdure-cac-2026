/**
 * A schema.org block, rendered as the JSON-LD data block Google reads.
 *
 * This is the site's only dangerouslySetInnerHTML, and it is safe by
 * construction: every object passed in is built at build time from constants
 * in lib/seo.ts, never from user input or a request. The `<` escape is
 * defence in depth — it makes a "</script>" inside any future string
 * incapable of closing the tag early, whatever the source of that string.
 *
 * No nonce is needed: the CSP carries 'unsafe-inline' on script-src (see
 * lib/security/csp.ts for why), and browsers do not execute a data block of
 * this type in any case.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> })
{
  let json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
