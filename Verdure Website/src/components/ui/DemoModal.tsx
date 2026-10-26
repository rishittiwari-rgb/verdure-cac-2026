"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { Gem, Award, Zap, X } from "lucide-react";
import { useLenis } from "@/providers/LenisProvider";
import { useSound } from "@/providers/SoundProvider";

interface DemoModalProps
{
  open: boolean;
  onClose: () => void;
}

/**
 * DemoModal — the real Verdure app walkthrough.
 *
 * A clay dialog frames the 16:9 demo video (autoplays muted, with controls to
 * unmute/scrub). Entrance, scroll lock, focus trap and a11y wiring are kept.
 */
export default function DemoModal({ open, onClose }: DemoModalProps)
{
  let overlayRef = useRef<HTMLDivElement>(null);
  let panelRef = useRef<HTMLDivElement>(null);
  let videoRef = useRef<HTMLVideoElement>(null);
  let closeBtnRef = useRef<HTMLButtonElement>(null);
  let lenis = useLenis();
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
    lenis?.stop();
    let prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let prevActive = document.activeElement as HTMLElement | null;

    let reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    closeBtnRef.current?.focus();

    // Try to start playback (muted autoplay is allowed).
    let v = videoRef.current;
    if (v)
    {
      v.currentTime = 0;
      let p = v.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    }

    // --- entrance ---
    let ctx = gsap.context(function ()
    {
      if (reduced)
      {
        gsap.set(overlayRef.current, { opacity: 1 });
        gsap.set(panelRef.current, { opacity: 1, scale: 1, y: 0 });
        return;
      }
      let tl = gsap.timeline();
      tl.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: "power3.out" }
      ).fromTo(
        panelRef.current,
        { opacity: 0, scale: 0.92, y: 26 },
        { opacity: 1, scale: 1, y: 0, duration: 0.55, ease: "back.out(1.5)" },
        "-=0.15"
      );
    });

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
      ctx.revert();
      if (v) v.pause();
      document.body.style.overflow = prevOverflow;
      lenis?.start();
      prevActive?.focus?.();
    };
  }, [open, lenis, handleClose, sound]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-6"
      onMouseDown={function (e)
      {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(10,23,18,0.6)", backdropFilter: "blur(4px)" }}
      />

      {/* Dialog */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Verdure app demo"
        className="clay-lg relative z-10 w-full max-w-4xl p-4 md:p-6"
      >
        {/* Close */}
        <button
          ref={closeBtnRef}
          onClick={handleClose}
          onMouseEnter={sound.playHover}
          aria-label="Close demo"
          className="clay-sm clay-press absolute -right-2 -top-2 z-20 flex h-11 w-11 items-center justify-center text-ink-soft transition-colors duration-300 hover:text-cherry md:right-3 md:top-3"
        >
          <X size={18} />
        </button>

        {/* Header row */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 pr-10 md:mb-5">
          <div>
            <span className="kicker">Sneak Peek</span>
            <h3 className="font-display mt-1 text-2xl font-bold tracking-tight text-ink md:text-3xl">
              Your neighborhood, <span className="text-cherry">gamified.</span>
            </h3>
          </div>
          <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
            <Tag>
              <Gem size={13} className="text-cherry" /> Daily Gems
            </Tag>
            <Tag>
              <Zap size={13} className="text-aqua-depth" /> Live XP
            </Tag>
            <Tag>
              <Award size={13} className="text-gold" /> Badges
            </Tag>
          </div>
        </div>

        {/* Video — framed in a dark evergreen bezel */}
        <div
          className="overflow-hidden rounded-[26px] p-2"
          style={{ background: "linear-gradient(160deg, #1c3a30, #0a1712)" }}
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-black">
            <video
              ref={videoRef}
              src="/verdure-demo.mp4"
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

/** Clay chip, matching the site's tag vocabulary. */
function Tag({ children }: { children: React.ReactNode })
{
  return (
    <span className="clay-sm inline-flex items-center gap-2 px-3 py-2 font-num text-[12px] font-semibold text-ink-soft">
      {children}
    </span>
  );
}
