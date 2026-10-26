import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, pageMetadata, pricingLd, webPageLd } from "@/lib/seo";
import PricingContent from "./PricingContent";

export const metadata: Metadata = pageMetadata({
  title: "Pricing — Free and Verdure+ Plans",
  description:
    "Verdure Free costs nothing, forever. Verdure+ ($4.99/mo or $49.99/yr) adds unlimited planning, early partner perks, cash gift cards, advanced stats and interest profiles.",
  socialTitle: "One habit. Two ways to walk it.",
  path: "/pricing",
});

export default function PricingPage()
{
  return (
    <PageShell>
      {/* Prices come from lib/plans.ts, the single owner-supplied source —
          the markup never restates a number of its own. */}
      <JsonLd data={pricingLd()} />
      <JsonLd
        data={webPageLd({
          path: "/pricing",
          name: "Pricing",
          description:
            "Verdure Free costs nothing, forever. Verdure+ adds unlimited planning, early partner perks, cash gift cards, advanced stats and interest profiles.",
          about: "app",
        })}
      />
      <JsonLd
        data={breadcrumbLd([
          { name: "Verdure", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ])}
      />
      <PricingContent />
    </PageShell>
  );
}
