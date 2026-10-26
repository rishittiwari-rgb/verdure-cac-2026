"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function InviteContent() {
  const [appURL, setAppURL] = useState<string | null>(null);

  useEffect(() => {
    // The token lives in the fragment: it never reaches the web server or a
    // referrer. Remove it promptly after constructing the app link.
    const parts = new URLSearchParams(window.location.hash.slice(1));
    const uid = parts.get("uid");
    const token = parts.get("token");
    window.history.replaceState(null, "", "/invite");
    if (!uid || !token || uid.length > 128 || token.length > 64 || uid.includes("/")) return;
    setAppURL(`verdure://friends/${encodeURIComponent(uid)}?token=${encodeURIComponent(token)}`);
  }, []);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-24 text-center">
      <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--gold-ink)]">A private invitation</p>
      <h1 className="mb-6 font-serif text-5xl leading-tight text-[var(--text)] sm:text-6xl">Good plans grow together.</h1>
      <p className="mx-auto mb-10 max-w-lg text-lg leading-relaxed text-[var(--muted)]">
        Someone you know invited you to connect on Verdure. Only people who accept each other as friends can see shared plans.
      </p>
      {appURL ? (
        <a className="mx-auto rounded-xl bg-[var(--accent)] px-8 py-4 font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)]" href={appURL}>
          Open invitation in Verdure
        </a>
      ) : (
        <p className="text-sm text-[var(--muted)]">This invitation is incomplete. Ask your friend to share a fresh link.</p>
      )}
      <p className="mt-8 text-sm text-[var(--muted)]">
        New to Verdure? <Link className="underline underline-offset-4" href="/">Join the beta waitlist</Link>, then return to this link after installing the app.
      </p>
    </main>
  );
}
