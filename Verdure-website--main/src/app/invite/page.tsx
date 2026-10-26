import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import InviteContent from "./InviteContent";

export const metadata: Metadata = {
  title: "Friend invitation — Verdure",
  description: "Open a private invitation to connect with someone you know on Verdure.",
  robots: { index: false, follow: false },
};

export default function InvitePage() {
  return <PageShell><InviteContent /></PageShell>;
}
