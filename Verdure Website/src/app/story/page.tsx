import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import StoryContent from "./StoryContent";

export const metadata: Metadata = {
  title: "Our Story — Verdure",
  description:
    "Why Verdure exists: reconnecting people with their local environments and each other, revitalizing underused public spaces, and building healthier, more connected communities.",
};

export default function StoryPage() {
  return (
    <PageShell>
      <StoryContent />
    </PageShell>
  );
}
