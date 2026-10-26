"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSound } from "@/providers/SoundProvider";

interface DemoModalProps
{
  open: boolean;
  onClose: () => void;
}

/**
 * DemoModal — the real Verdure app walkthrough. A white dialog frames the
 * 16:9 demo video (autoplays muted, with controls to unmute/scrub).
 * Scroll lock, focus trap and a11y wiring are kept; no entrance animation.
 */
export default function DemoModal({ open, onClose }: DemoModalProps)
{
  let videoRef = useRef<HTMLVideoElement>(null);
  let panelRef = useRef<HTMLDivElement>(null);
  let closeBtnRef = useRef<HTMLButtonElement>(null);
  let sound = useSound();
  let [mounted, setMounted] = useState(false);

  useEffect(function ()
  {
    setMounted(true);
  }, []);

  let handleClose = useCallback(function ()
  {
    sound.playClick();
    onClose();
  }, [onClose, sound]);

  useEffect(function ()
  {
    if (!open) return;

    // --- lock scroll behind the modal ---
    let prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let prevActive = document.activeElement as HTMLElement | null;

    closeBtnRef.current?.focus();

    // Try to start playback (muted autoplay is allowed).
    let v = videoRef.current;
    if (v)
    {
      v.currentTime = 0;
      let p = v.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    }

    // --- Esc to close + focus trap ---
    let onKeyDown = function (e: KeyboardEvent)
    {
      if (e.key === "Escape")
      {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;
      let focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, video, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      let list = Array.from(focusables).filter(function (el)
      {
        return !el.hasAttribute("disabled");
      });
      let first = list[0];
      let last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first)
      {
        e.preventDefault();
        last.focus();
      }
      else if (!e.shiftKey && document.activeElement === last)
      {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return function ()
    {
      document.removeEventListener("keydown", onKeyDown);
      if (v) v.pause();
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [open, handleClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-6"
      onMouseDown={function (e)
      {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(30, 42, 33, 0.55)", backdropFilter: "blur(6px)" }}
      />

      {/* Dialog */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Verdure app demo"
        className="relative z-10 w-full max-w-4xl rounded-[26px] border border-line bg-elev p-4 text-cream shadow-[0_40px_90px_-40px_rgba(34,33,27,0.55)] md:p-6"
      >
        {/* Close */}
        <button
          ref={closeBtnRef}
          onClick={handleClose}
          onMouseEnter={sound.playHover}
          aria-label="Close demo"
          className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-[color:var(--on-accent)] transition-transform duration-200 hover:scale-95"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>

        {/* Header row */}
        <div className="mb-4 pr-12 md:mb-5">
          <span className="kicker">Sneak peek</span>
          <h3 className="font-display mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            Your neighborhood, in play.
          </h3>
        </div>

        {/* Video */}
        <div className="overflow-hidden rounded-[20px] border border-line p-2">
          <div className="relative aspect-video w-full overflow-hidden rounded-[13px] bg-black">
            <video
              ref={videoRef}
              src="/verdure-demo.mp4"
              poster="/verdure-demo-poster.jpg"
              className="h-full w-full object-cover"
              muted
              loop
              autoPlay
              playsInline
              controls
              preload="metadata"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
