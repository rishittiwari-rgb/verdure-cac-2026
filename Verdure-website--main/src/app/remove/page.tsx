import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, pageMetadata, webPageLd } from "@/lib/seo";
import { functionsBaseUrl } from "@/lib/removal/host";
import RemoveForm from "./RemoveForm";

const DESCRIPTION = "Ask Verdure to stop listing events from your website. Removal is automatic: the site is dropped, its listings are hidden on the next cycle, and it is never rediscovered.";

export const metadata: Metadata = pageMetadata({ title: "Remove your site", description: DESCRIPTION, path: "/remove" });

export default function RemovePage() {
  // Read on the server at build time; the client bundle receives the value as a prop.
  const baseUrl = functionsBaseUrl();
  return <PageShell>
    <JsonLd data={webPageLd({ path: "/remove", name: "Remove your site", description: DESCRIPTION, about: "organization" })} />
    <JsonLd data={breadcrumbLd([{ name: "Verdure", path: "/" }, { name: "Remove your site", path: "/remove" }])} />
    <div className="submission-page"><div className="submission-intro"><p className="submission-eyebrow">Publishers</p>
      <h1>Don’t want to be<br />listed? Say so.</h1>
      <p>Verdure finds public event calendars automatically and shows their events in the app, with a link back to the source. If that is your site and you would rather it weren’t included, tell us here. No account, no ticket, no waiting for a person.</p>
      <h2 className="mt-8 text-xl font-semibold">What happens when you submit</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
        <li><strong>Most sites are removed immediately.</strong> Every Verdure source on that host is marked removed the moment the request lands.</li>
        <li><strong>Events disappear on the next ingest cycle</strong>, which runs daily, so listings can stay visible for up to 24 hours.</li>
        <li><strong>The host is never rediscovered.</strong> It goes on a permanent never-discover list; automatic discovery will not inspect it again.</li>
        <li><strong>Sites with more than 100 active listings need proof of control.</strong> So a stranger cannot delete a library’s whole calendar, the server checks that the site has published its token at <code>/.well-known/verdure-remove.txt</code> or as a <code>&lt;meta name=&quot;verdure-remove&quot;&gt;</code> tag. Use “Get my token” below, publish it, then submit. The check is automatic too.</li>
        <li><strong>Limits:</strong> 5 removal requests per address per day and 30 token lookups per address per hour; the form shows the server’s answer, including those limits.</li>
      </ul>
      <p className="mt-6 text-sm">A site that was never a Verdure source can still be submitted; it just goes on the never-discover list. Changed your mind later? Email <a className="underline" href="mailto:support@verdure-app.com">support@verdure-app.com</a>.</p>
    </div>
    <section className="submission-panel"><h2>Remove a site</h2><RemoveForm baseUrl={baseUrl} /></section></div>
  </PageShell>;
}
