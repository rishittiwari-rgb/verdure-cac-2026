import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import TermsContent from "./TermsContent";

export const metadata: Metadata = {
  title: "Terms of Use — Verdure",
  description:
    "The plain-language terms for using Verdure: the optional Verdure+ subscription, how points and rewards work, community rules, and your account.",
};

export default function TermsPage() {
  return (
    <PageShell>
      <TermsContent />
    </PageShell>
  );
}
