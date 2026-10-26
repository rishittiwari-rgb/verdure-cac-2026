import Image from "next/image";

/**
 * The Verdure compass-and-leaf mark — the owner's supplied art, cut to
 * transparency (public/verdure-mark.png). One component so every surface
 * renders the same brand at the same quality.
 */
export default function Logo({ size = 28 }: { size?: number })
{
  return (
    <Image
      src="/verdure-mark.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      priority
    />
  );
}
