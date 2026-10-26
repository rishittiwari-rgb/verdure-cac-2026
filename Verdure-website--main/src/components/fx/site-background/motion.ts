/**
 * The small maths the background leans on: the wordmark's easing curve,
 * the scroll keyframe reader, the handheld-camera noise, and the prop
 * clamp. All of it ported unchanged from the design source.
 */

/** A scroll position paired with the value the camera should hold there. */
export type Stop = [number, number];

/** cubic-bezier(0.22, 1, 0.36, 1) solved by bisection on x. */
export function bez(t: number): number
{
  let lo = 0;
  let hi = 1;
  let u = t;

  for (let i = 0; i < 18; i++)
  {
    u = (lo + hi) * 0.5;
    let mu = 1 - u;
    let x = 3 * mu * mu * u * 0.22 + 3 * mu * u * u * 0.36 + u * u * u;
    if (x < t) lo = u;
    else hi = u;
  }

  let mu = 1 - u;
  return 3 * mu * mu * u * 1.0 + 3 * mu * u * u * 1.0 + u * u * u;
}

/** Smoothstep between the two keyframes that bracket this scroll value. */
export function key(s: number, stops: Stop[]): number
{
  for (let i = 0; i < stops.length - 1; i++)
  {
    let a = stops[i];
    let b = stops[i + 1];

    if (s <= b[0] || i === stops.length - 2)
    {
      let t = Math.max(0, Math.min(1, (s - a[0]) / Math.max(1e-5, b[0] - a[0])));
      return a[1] + (b[1] - a[1]) * (t * t * (3 - 2 * t));
    }
  }

  return stops[0][1];
}

/** A prop reader that falls back to `d` and never leaves the [lo, hi] range. */
export function clampNum(v: unknown, d: number, lo: number, hi: number): number
{
  let n = Number(v);
  return Math.max(lo, Math.min(hi, isFinite(n) ? n : d));
}

/** Value noise on a line, seeded so each axis drifts independently. */
export function noise1(x: number, seed: number): number
{
  let i = Math.floor(x);
  let f = x - i;
  let u = f * f * (3 - 2 * f);

  let h = function (n: number): number
  {
    let t = Math.imul(n ^ seed, 0x27d4eb2d);
    t ^= t >>> 15;
    t = Math.imul(t, 0x85ebca6b);
    t ^= t >>> 13;
    return (t >>> 0) / 4294967295;
  };

  let a = h(i);
  let b = h(i + 1);
  return a + (b - a) * u;
}

/** Two octaves of smooth noise, so the handheld drift never reads as a loop. */
export function hand(t: number, seed: number): number
{
  return (0.66 * noise1(t * 0.34, seed) + 0.34 * noise1(t * 0.87 + 11, seed ^ 0x5f)) - 0.5;
}
