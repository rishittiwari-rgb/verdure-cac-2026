"use client";

import { useState } from "react";
import { useSound } from "@/providers/SoundProvider";

/**
 * SoundToggle — the journey's audio switch, floating bottom-right as a
 * glass capsule over the scene. First press expands the volume rail,
 * second toggles mute. Two-tone throughout.
 */
export default function SoundToggle()
{
  let { muted, volume, setVolume, playClick } = useSound();
  let [expanded, setExpanded] = useState(false);

  let onButton = function ()
  {
    if (!expanded)
    {
      setExpanded(true);
      return;
    }
    if (muted)
    {
      setVolume(0.45);
      playClick();
    }
    else
    {
      setVolume(0);
    }
  };

  let glass: React.CSSProperties = {
    background: "var(--elev)",
    border: "1px solid var(--line)",
    boxShadow: "0 10px 26px -16px rgba(22,24,29,0.4)",
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
      {/* Volume rail — appears when expanded */}
      {expanded && (
        <div className="flex items-center gap-2.5 rounded-full px-4 py-2.5 text-cream" style={glass}>
          <span className="kicker !text-[12px]">Vol</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(volume * 100)}
            onChange={function (e)
            {
              setVolume(Number(e.target.value) / 100);
            }}
            aria-label="Volume"
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-cream/25 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cream"
          />
          <span className="font-num w-7 text-right text-[12px] tabular-nums text-cream/80">
            {Math.round(volume * 100)}
          </span>
        </div>
      )}

      {/* Button */}
      <button
        onClick={onButton}
        onMouseLeave={function ()
        {
          if (expanded) window.setTimeout(function () { setExpanded(false); }, 2000);
        }}
        className="flex h-12 w-12 items-center justify-center rounded-full text-cream transition-transform duration-200 hover:scale-95"
        style={glass}
        aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      >
        {muted ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M19.07 4.93a10 10 0 010 14.14" />
            <path d="M15.54 8.46a5 5 0 010 7.07" />
          </svg>
        )}
      </button>
    </div>
  );
}
