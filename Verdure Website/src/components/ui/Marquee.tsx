"use client";

interface MarqueeProps
{
  reverse?: boolean;
}

// Three memorable words (per team feedback) — repeated so the ticker fills wide
// screens while the loop stays seamless.
let words = ["Explore", "Connect", "Belong"];
let items = words.concat(words).concat(words).concat(words);

export default function Marquee({ reverse = false }: MarqueeProps)
{
  let row = items.map(function (item, i)
  {
    return (
      <span key={i} className="flex shrink-0 items-center gap-8">
        <span className="font-display whitespace-nowrap text-[clamp(1.3rem,3vw,2.1rem)] font-semibold tracking-tight text-ink/[0.2]">
          {item}
        </span>
        {/* Accent diamond separator */}
        <span
          className="inline-block h-2 w-2 shrink-0 rotate-45"
          style={{ background: "var(--gold)", opacity: 0.7 }}
          aria-hidden="true"
        />
      </span>
    );
  });

  return (
    <div className="relative px-6 py-3 md:px-10" style={{ zIndex: 1 }} aria-hidden="true">
      {/* Pressed clay channel — the ticker runs inside a sculpted groove */}
      <div className="clay-inset relative overflow-hidden rounded-[22px] py-5">
        <div
          className="animate-marquee flex gap-8 whitespace-nowrap will-change-transform"
          style={reverse ? { animationDirection: "reverse" } : undefined}
        >
          {row}
          {row}
        </div>
      </div>
    </div>
  );
}
