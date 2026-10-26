"use client";

import Link from "next/link";

/**
 * PillButton — the site's one button. 3em pill, two-span hover text swap
 * (.25s), face scales .97 on hover, 34px circle glyph. Default is the
 * lime primary; ink/outline/glass are the quiet bordered secondary;
 * chrome is the primary sized for the nav.
 */

interface PillButtonProps
{
  label: string;
  hoverLabel?: string;
  href?: string;
  variant?: "cream" | "ink" | "glass" | "outline" | "chrome";
  small?: boolean;
  glyph?: React.ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  onPress?: () => void;
  onHover?: () => void;
}

export default function PillButton({
  label,
  hoverLabel,
  href,
  variant = "cream",
  small = false,
  glyph,
  type = "button",
  disabled = false,
  className = "",
  onPress,
  onHover,
}: PillButtonProps)
{
  let classes = "pill";
  if (variant === "ink") classes = classes + " pill--ink";
  if (variant === "glass") classes = classes + " pill--glass";
  if (variant === "outline") classes = classes + " pill--outline";
  if (variant === "chrome") classes = classes + " pill--chrome";
  if (small) classes = classes + " pill--sm";
  if (!hoverLabel) classes = classes + " pill--static";
  if (className) classes = classes + " " + className;

  let inner = (
    <>
      <span>{label}</span>
      {hoverLabel ? <span aria-hidden="true">{hoverLabel}</span> : null}
      {glyph || <ArrowGlyph />}
    </>
  );

  if (href)
  {
    return (
      <Link
        href={href}
        className={classes}
        onMouseEnter={onHover}
        onClick={onPress}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      onMouseEnter={onHover}
      onClick={onPress}
    >
      {inner}
    </button>
  );
}

/** Circle with the up-right arrow — the reference CTA glyph. */
export function ArrowGlyph()
{
  return (
    <svg viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17 0C26.3888 0 34 7.61116 34 17C34 26.3888 26.3888 34 17 34C7.61116 34 0 26.3888 0 17C0 7.61116 7.61116 0 17 0ZM13.501 14.0225V15.5225H17.4238C17.6321 15.5226 17.7358 15.7753 17.5879 15.9219L13.4951 19.9648L14.5557 21.0254L18.6035 17.0273C18.7509 16.8821 19.0008 16.9864 19.001 17.1934V21.0225H20.501V14.6064C20.501 14.2843 20.2392 14.0225 19.917 14.0225H13.501Z" />
    </svg>
  );
}

/** Circle with a play triangle — the Watch-the-demo glyph. */
export function PlayGlyph()
{
  return (
    <svg viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M17 0C26.3888 0 34 7.61116 34 17C34 26.3888 26.3888 34 17 34C7.61116 34 0 26.3888 0 17C0 7.61116 7.61116 0 17 0ZM14 11.9282C14 11.4658 14.5 11.1769 14.9004 11.4082L22.6797 15.9004C23.0801 16.1316 23.0801 16.7098 22.6797 16.941L14.9004 21.4332C14.5 21.6644 14 21.3755 14 20.9131V11.9282Z"
      />
    </svg>
  );
}
