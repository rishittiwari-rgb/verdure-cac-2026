"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useBoot } from "@/providers/BootProvider";

interface LoadingScreenProps
{
  onComplete: () => void;
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps)
{
  let containerRef = useRef<HTMLDivElement>(null);
  let counterRef = useRef<HTMLSpanElement>(null);
  let countNodeRef = useRef<HTMLSpanElement>(null);
  let barRef = useRef<HTMLDivElement>(null);
  let barTrackRef = useRef<HTMLDivElement>(null);
  let taglineRef = useRef<HTMLDivElement>(null);
  let lineRefs = useRef<(HTMLSpanElement | null)[]>([]);
  let exitedRef = useRef(false);

  let { isReady, markCountDone } = useBoot();

  // Intro — count up, fill the rule, reveal the tagline, then report the gate.
  useEffect(function ()
  {
    let tl = gsap.timeline();

    tl.to(
      { val: 0 },
      {
        val: 100,
        duration: 2.6,
        ease: "power2.inOut",
        onUpdate: function ()
        {
          let v = Math.round(this.targets()[0].val);
          if (countNodeRef.current)
          {
            countNodeRef.current.textContent = String(v).padStart(3, "0");
          }
        },
      }
    );
    tl.to(barRef.current, { width: "100%", duration: 2.6, ease: "power2.inOut" }, 0);

    // Clear the meter, reveal the masked tagline lines.
    tl.to(barTrackRef.current, {
      opacity: 0,
      y: -16,
      duration: 0.4,
      ease: "power2.in",
      delay: 0.15,
    });
    tl.to(
      counterRef.current,
      { opacity: 0, scale: 0.85, duration: 0.3, ease: "power2.in" },
      "-=0.3"
    );
    tl.set(taglineRef.current, { opacity: 1 });
    tl.from(lineRefs.current.filter(Boolean), {
      yPercent: 115,
      duration: 0.9,
      stagger: 0.12,
      ease: "expo.out",
    });
    tl.to({}, { duration: 0.45 });

    tl.call(function ()
    {
      markCountDone();
    });

    return function ()
    {
      tl.kill();
    };
  }, [markCountDone]);

  // Exit — slide away once every boot gate is satisfied. Runs once.
  useEffect(function ()
  {
    if (!isReady || exitedRef.current) return;
    exitedRef.current = true;
    let tween = gsap.to(containerRef.current,
    {
      yPercent: -100,
      duration: 1,
      ease: "power4.inOut",
      onComplete,
    });
    return function ()
    {
      tween.kill();
    };
  }, [isReady, onComplete]);

  // Failsafe — never strand the user if a gate never resolves.
  useEffect(function ()
  {
    let t = window.setTimeout(function ()
    {
      if (exitedRef.current) return;
      exitedRef.current = true;
      gsap.to(containerRef.current,
      {
        yPercent: -100,
        duration: 0.8,
        ease: "power4.inOut",
        onComplete,
      });
    }, 10000);
    return function ()
    {
      window.clearTimeout(t);
    };
  }, [onComplete]);

  let lines = ["Step Outside.", "Connect Within."];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-silica"
    >
      {/* Counter */}
      <span
        ref={counterRef}
        className="font-num text-8xl font-bold tabular-nums tracking-tighter text-ink/10 select-none md:text-[11rem]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <span ref={countNodeRef}>000</span>
      </span>

      {/* Thin progress rule */}
      <div
        ref={barTrackRef}
        className="absolute bottom-[38%] left-1/2 h-[3px] w-44 -translate-x-1/2 overflow-hidden rounded-full bg-silica-shadow"
      >
        <div
          ref={barRef}
          className="h-full rounded-full"
          style={{
            width: "0%",
            background: "linear-gradient(90deg, var(--aqua-depth), var(--aqua))",
          }}
        />
      </div>

      {/* Tagline reveal */}
      <div
        ref={taglineRef}
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 opacity-0"
      >
        {lines.map(function (line, i)
        {
          return (
            <span key={i} className="block overflow-hidden">
              <span
                ref={function (el)
                {
                  lineRefs.current[i] = el;
                }}
                className="font-display block text-[clamp(2rem,7vw,5rem)] font-bold leading-[1.05] tracking-tight"
              >
                {i === 1 ? (
                  <>
                    Connect <span className="text-cherry">Within.</span>
                  </>
                ) : (
                  <span className="text-ink">{line}</span>
                )}
              </span>
            </span>
          );
        })}
      </div>

      {/* Corner ticks */}
      <div className="absolute left-8 top-8 h-5 w-5 border-l border-t" style={{ borderColor: "rgba(22,32,46,0.14)" }} />
      <div className="absolute right-8 top-8 h-5 w-5 border-r border-t" style={{ borderColor: "rgba(22,32,46,0.14)" }} />
      <div className="absolute bottom-8 left-8 h-5 w-5 border-b border-l" style={{ borderColor: "rgba(22,32,46,0.14)" }} />
      <div className="absolute bottom-8 right-8 h-5 w-5 border-b border-r" style={{ borderColor: "rgba(22,32,46,0.14)" }} />

      {/* Label */}
      <span className="absolute bottom-8 left-1/2 -translate-x-1/2 kicker">
        Verdure
      </span>
    </div>
  );
}
