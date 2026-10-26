import type { Metadata } from "next";
import SubmissionForm from "@/components/SubmissionForm";
import PageShell from "@/components/layout/PageShell";
export const metadata: Metadata = { title: "Support — Verdure", description: "Ask the Verdure team for help." };
export default function SupportPage() {
  return <PageShell><div className="submission-page"><div className="submission-intro"><p className="submission-eyebrow">Here to help</p>
    <h1>A little help<br />along the way.</h1><p>Questions, account help or something that isn’t working? Send a request to our team.</p></div>
    <section className="submission-panel"><h2>Contact support</h2><SubmissionForm kind="support" /></section></div></PageShell>;
}
