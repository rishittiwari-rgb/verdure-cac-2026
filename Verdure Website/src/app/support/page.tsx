import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import SupportContent from "./SupportContent";

export const metadata: Metadata = {
  title: "Support — Verdure",
  description:
    "Help with check-ins, points, rewards and Verdure+ — plus how to reach us, manage your subscription, or delete your account.",
};

export default function SupportPage() {
  return (
    <PageShell>
      <SupportContent />
    </PageShell>
  );
}
