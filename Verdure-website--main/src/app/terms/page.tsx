import PageShell from "@/components/layout/PageShell";
import LegalDocument from "@/components/LegalDocument";
import { TERMS_SECTIONS } from "@/lib/legal";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Terms of Service", description: "Terms for using Verdure, subscriptions, rewards, content and community safety.", path: "/terms" });
export default function TermsPage() {
  return <PageShell>
    <LegalDocument title="Terms of Service" intro="These terms cover the Verdure app, website and related services." sections={TERMS_SECTIONS} />
    <div className="page-pad mx-auto max-w-[820px] pb-16"><a className="underline" href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">Apple’s Standard EULA</a></div>
  </PageShell>;
}
