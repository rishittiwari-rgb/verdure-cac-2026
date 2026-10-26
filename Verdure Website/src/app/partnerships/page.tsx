import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import PartnershipsContent from "./PartnershipsContent";

export const metadata: Metadata = {
  title: "Partnerships — Verdure",
  description:
    "Partner with Verdure: drive foot traffic to parks, libraries, and local spaces, access engagement analytics, and run branded challenges and reward programs.",
};

export default function PartnershipsPage() {
  return (
    <PageShell>
      <PartnershipsContent />
    </PageShell>
  );
}
