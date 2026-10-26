"use client";

import { useState } from "react";
import { useSound } from "@/providers/SoundProvider";

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

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
      {/* Volume slider — appears when expanded */}
      {expanded && (
        <div className="clay-sm flex items-center gap-2.5 px-4 py-2.5">
          <span className="kicker">Vol</span>
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
            className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-silica-shadow accent-cherry [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cherry"
          />
          <span className="w-7 text-right font-num text-[11px] font-semibold tabular-nums text-ink-soft">
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
        className="clay-sm clay-press flex h-12 w-12 items-center justify-center"
        aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      >
        {muted ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="text-ink-soft"
          >
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            style={{ color: "var(--cherry)" }}
          >
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M19.07 4.93a10 10 0 010 14.14" />
            <path d="M15.54 8.46a5 5 0 010 7.07" />
          </svg>
        )}
      </button>
    </div>
  );
}
