"use client";

import { useRef, useState } from "react";
import { useSound } from "@/providers/SoundProvider";
import { joinWaitlist } from "@/app/actions/waitlist";
import PillButton from "@/components/ui/PillButton";

/**
 * WaitlistForm — the Supabase waitlist signup, mountable from any beat or
 * page. Same server action and state machine the site has always shipped;
 * restyled into the two-tone pill system. tone="scene" renders cream-on-ink
 * fields for use over the journey; tone="cream" inverts for cream pages.
 */

type Status = "idle" | "loading" | "success" | "error";

export default function WaitlistForm({
  source,
  tone = "scene",
}: {
  source: string;
  tone?: "scene" | "cream";
})
{
  let sound = useSound();
  let [status, setStatus] = useState<Status>("idle");
  let [feedback, setFeedback] = useState("");
  let onScene = tone === "scene";

  // Set once, on the client's first render, and never rendered into the DOM —
  // so there is no hydration mismatch and no value sitting in the markup for a
  // scraper to copy. The action uses it to reject submissions that arrive
  // faster than a person could type.
  let mountedAt = useRef(Date.now());

  let onSubmit = async function (e: React.FormEvent<HTMLFormElement>)
  {
    e.preventDefault();
    sound.playClick();
    setStatus("loading");
    setFeedback("");

    let formData = new FormData(e.currentTarget);
    formData.set("rendered_at", String(mountedAt.current));

    // The action returns structured errors, but the invocation itself is a
    // network POST: without the catch, a dropped connection would leave the
    // form disabled on "Joining…" forever.
    try
    {
      let result = await joinWaitlist(formData);

      if (result.ok)
      {
        sound.playSuccess();
        setStatus("success");
        setFeedback("You're on the list. We'll be in touch the moment we launch.");
      }
      else
      {
        setStatus("error");
        setFeedback(result.error ?? "Something went wrong. Please try again.");
      }
    }
    catch
    {
      setStatus("error");
      setFeedback("Could not reach the server. Check your connection and try again.");
    }
  };

  let isLoading = status === "loading";

  if (status === "success")
  {
    return (
      <div
        role="status"
        className="mx-auto flex w-full max-w-xl items-center justify-center gap-3 rounded-[1.5em] border border-[color:var(--accent)]/40 bg-elev px-6 py-4 text-center"
      >
        <span
          className="flex h-6 w-6 flex-none rotate-45 items-center justify-center bg-accent"
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="-rotate-45">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
        <p className="t-body2 font-bold">{feedback}</p>
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-xl flex-col items-stretch gap-3 sm:flex-row sm:items-center"
      >
        <input type="hidden" name="source" value={source} />

        {/* Honeypot. Off-screen, unreachable by tab, hidden from the
            accessibility tree — a person cannot fill this in, so anything
            that does is a script. The action answers those with a fake
            success so there is nothing to tune against. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />

        <div className="flex-1">
          <label htmlFor={"waitlist-email-" + source} className="sr-only">
            Email address
          </label>
          <input
            id={"waitlist-email-" + source}
            name="email"
            type="email"
            required
            disabled={isLoading}
            placeholder="you@email.com"
            onFocus={sound.playFocus}
            className={onScene ? "field-ink" : "field-cream"}
          />
        </div>
        <PillButton
          type="submit"
          label={isLoading ? "Joining…" : "Join Waitlist"}
          disabled={isLoading}
          className="w-full justify-center sm:w-auto"
          onHover={sound.playHover}
        />
      </form>

      {status === "error" ? (
        // Two tones only: the error distinguishes itself by weight and mark,
        // never by a third hue.
        <p role="alert" className="mt-4 text-sm font-bold">
          <span aria-hidden="true">▲ </span>
          {feedback}
        </p>
      ) : (
        <p className="mt-4 text-[12px] font-medium text-cream/60">
          One email when we open, and nothing else. We don&apos;t sell or share
          your address.
        </p>
      )}
    </>
  );
}
