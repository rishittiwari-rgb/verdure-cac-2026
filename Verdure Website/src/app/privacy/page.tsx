import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import PrivacyContent from "./PrivacyContent";

export const metadata: Metadata = {
  title: "Privacy Policy — Verdure",
  description:
    "What Verdure collects and what it doesn't. No tracking, no ads, no selling your data — just the account, location and photos needed to make check-ins and rewards work.",
};

export default function PrivacyPage() {
  return (
    <PageShell>
      <PrivacyContent />
    </PageShell>
  );
}
