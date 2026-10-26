import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, pageMetadata, webPageLd } from "@/lib/seo";
import PartnershipsContent from "./PartnershipsContent";

export const metadata: Metadata = pageMetadata({
  title: "Partnerships for Local Spaces",
  description:
    "Partner with Verdure: drive foot traffic to parks, libraries, and local spaces, access engagement analytics, and run branded challenges and reward programs.",
  socialTitle: "Put your space on the daily map.",
  path: "/partnerships",
});

export default function PartnershipsPage()
{
  return (
    <PageShell>
      <JsonLd
        data={webPageLd({
          path: "/partnerships",
          name: "Partnerships",
          description:
            "Partner with Verdure: drive foot traffic to parks, libraries and local spaces, with engagement analytics and branded challenges.",
          about: "organization",
        })}
      />
      <JsonLd
        data={breadcrumbLd([
          { name: "Verdure", path: "/" },
          { name: "Partnerships", path: "/partnerships" },
        ])}
      />
      <PartnershipsContent />
    </PageShell>
  );
}
