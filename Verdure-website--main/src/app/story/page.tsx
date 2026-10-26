import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbLd, pageMetadata, webPageLd } from "@/lib/seo";
import StoryContent from "./StoryContent";

export const metadata: Metadata = pageMetadata({
  title: "Our Story — Why Verdure Exists",
  description:
    "Why Verdure exists: the spaces around us deserve people in them, and going outside should be the easy option. Here is the thinking behind the app.",
  socialTitle: "We're putting the neighborhood back on the map.",
  path: "/story",
});

export default function StoryPage()
{
  return (
    <PageShell>
      <JsonLd
        data={webPageLd({
          path: "/story",
          name: "Our Story",
          description:
            "Why Verdure exists: the spaces around us deserve people in them, and going outside should be the easy option.",
          type: "AboutPage",
          about: "organization",
        })}
      />
      <JsonLd
        data={breadcrumbLd([
          { name: "Verdure", path: "/" },
          { name: "Our Story", path: "/story" },
        ])}
      />
      <StoryContent />
    </PageShell>
  );
}
