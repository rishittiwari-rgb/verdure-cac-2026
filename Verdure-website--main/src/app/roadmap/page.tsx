import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, pageMetadata, webPageLd } from "@/lib/seo";
import RoadmapContent from "./RoadmapContent";

export const metadata: Metadata = pageMetadata({
  title: "Roadmap — What We Are Building Next",
  description:
    "The trail ahead for Verdure: closed beta, community boards and local partners, public launch, then new cities. No inflated dates. The waitlist walks in first.",
  socialTitle: "Where the trail goes next.",
  path: "/roadmap",
});

export default function RoadmapPage()
{
  return (
    <PageShell>
      <JsonLd
        data={webPageLd({
          path: "/roadmap",
          name: "Roadmap",
          description:
            "The trail ahead for Verdure: closed beta, community boards and local partners, public launch, then new cities.",
          about: "app",
        })}
      />
      <JsonLd
        data={breadcrumbLd([
          { name: "Verdure", path: "/" },
          { name: "Roadmap", path: "/roadmap" },
        ])}
      />
      <RoadmapContent />
    </PageShell>
  );
}
