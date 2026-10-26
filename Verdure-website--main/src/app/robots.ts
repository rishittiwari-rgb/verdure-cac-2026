import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * /robots.txt — the file a crawler asks for before anything else. Until now
 * the site had none, which meant no crawler was ever told where the sitemap
 * lived, and the signed-in routes were open to be crawled.
 *
 * The disallow list deliberately does NOT repeat the pages that carry
 * `robots: noindex` in their own metadata, and that is the opposite of what it
 * used to do. Disallowing /login, /signup and /account alongside their noindex
 * looked like belt and braces and was self-defeating: Disallow blocks the
 * FETCH, so Googlebot never retrieves the page, never sees the noindex, and
 * falls back to what it can see from the outside — the internal links pointing
 * at those URLs from the navbar, the pricing CTA, the roadmap and the
 * partnerships page. The documented result is a URL-only listing ("Indexed,
 * though blocked by robots.txt"): the exact outcome the noindex was added to
 * prevent, now unfixable because the instruction that would fix it is behind
 * the block.
 *
 * The two directives answer different questions and only one of them can be
 * used per page. "Do not index this" has to be readable to be obeyed, so the
 * pages that say it are left crawlable and say it for themselves. Disallow is
 * kept only for /auth/, which serves no HTML for a crawler to read a meta tag
 * out of — it is a callback and a JSON session probe, so there is no noindex to
 * miss and nothing to gain from fetching them.
 *
 * The preview and *.vercel.app copies of this same build are handled in
 * middleware with an X-Robots-Tag, because robots.txt is generated at build
 * time and cannot see which hostname is being asked.
 *
 * Nothing here may ever disallow public/google*.html. Those are the Search
 * Console ownership tokens; Google has to be able to fetch one to keep the
 * property verified, and blocking it is the standard way to lose access to
 * the very reports this file exists to feed. See README.md.
 */
export default function robots(): MetadataRoute.Robots
{
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/auth/"],
      },
    ],
    sitemap: SITE_URL + "/sitemap.xml",
    // No `host:`. Google has never supported the directive, Yandex deprecated
    // it in 2018, and the spec it came from expects a bare hostname rather than
    // the scheme-qualified URL Next emits here. The canonical host is already
    // asserted where crawlers actually read it — rel=canonical on every page.
  };
}
