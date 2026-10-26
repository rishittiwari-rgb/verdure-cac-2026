"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface WelcomeFlourishProps
{
  name: string;
}

// How long the overlay stays before it fades. Long enough to read a name,
// short enough that somebody who has seen it forty times is not waiting on it.
let HOLD_MS = 1700;
let FADE_MS = 620;

// One key per browser session. Without it the greeting replays on every
// client-side navigation back to /account, which turns a welcome into a
// nuisance — and a nuisance in front of the content the person came for.
let SEEN_KEY = "verdure:welcomed";

export default function WelcomeFlourish({ name }: WelcomeFlourishProps)
{
  // Starts closed and opens in an effect on purpose. Rendering it open on the
  // server would put an opaque panel into the HTML, so anybody with JavaScript
  // disabled — or anybody watching the page before hydration — would get a
  // permanent cover over their own account page.
  let [phase, setPhase] = useState<"idle" | "showing" | "leaving">("idle");

  useEffect(function ()
  {
    let seen = window.sessionStorage.getItem(SEEN_KEY);

    if (seen)
    {
      return;
    }

    window.sessionStorage.setItem(SEEN_KEY, "1");

    // Honoured by skipping the overlay entirely rather than by shortening it.
    // Someone who asks for reduced motion is not asking for a faster full-
    // screen wipe; the account page underneath says the same thing.
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced)
    {
      return;
    }

    setPhase("showing");

    let toLeaving = window.setTimeout(function ()
    {
      setPhase("leaving");
    }, HOLD_MS);

    let toGone = window.setTimeout(function ()
    {
      setPhase("idle");
    }, HOLD_MS + FADE_MS);

    return function ()
    {
      window.clearTimeout(toLeaving);
      window.clearTimeout(toGone);
    };
  }, []);

  if (phase === "idle")
  {
    return null;
  }

  // Portalled to <body>, not rendered in place.
  //
  // The first version rendered inside <main> and was measurably wrong: the
  // overlay came out the width of the account column instead of the window.
  // `position: fixed` is only fixed relative to the VIEWPORT while no ancestor
  // establishes a containing block, and transform / filter / backdrop-filter
  // all do — which the glass surfaces on this page use. Rather than hunt for
  // which ancestor did it and hope nobody adds another, this leaves the
  // subtree entirely. document.body is safe to reach here because `phase` only
  // leaves "idle" inside an effect, which never runs on the server.
  return createPortal(
    <div
      // aria-hidden and no focus trap: the greeting is decoration over content
      // that is already announced by the page itself. A screen reader user
      // hears "Your account", which is the useful thing, and never has to
      // dismiss a panel they cannot see.
      aria-hidden="true"
      className="vd-welcome"
      data-leaving={phase === "leaving" ? "true" : undefined}
    >
      <div className="vd-welcome__inner">
        <span className="vd-welcome__kicker">Welcome back</span>
        <span className="vd-welcome__name">{name}</span>
        <span className="vd-welcome__rule" />
      </div>
    </div>,
    document.body
  );
}
