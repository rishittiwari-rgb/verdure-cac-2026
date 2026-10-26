# DESIGN_NOTES — Verdure rebuild in the EverSwap design language

Source of truth for every number in the build. Everything below was **measured** from
everswap.com on 2026-07-19: the live CSS (`reference/everswap/src-study/index.css`), the
prettified engine bundle (`hoisted.pretty.js`, 20,975 lines, read line-by-line for each
section class), video recordings at 1440x900 and 390x844 (`video-desktop/`,
`video-mobile/`, frame dumps in `vframes-*/`), 2%-increment measurement stills
(`frames/p000-p100.png`) and interaction stills (`stills/`).

## 0. Reference architecture (what they actually run)

- **No GSAP, no Lenis, no ScrollTrigger.** Lusion's custom engine on three.js. Virtual
  scroll: `body{position:fixed}`, wheel deltas accumulate into `targetScrollPixel`,
  smoothed per frame with `delta = dist * (1 - Math.exp(-12 * dt))`
  (`wheelEaseCoeff = 12`, ScrollPane, bundle 19976/20067). At 60 fps that is an 18.1%
  per-frame catch-up → **our equivalent: Lenis `lerp: 0.18`** synced to `gsap.ticker`.
- Keyboard: arrows ±100px, PageUp/Down ±1 viewport (19980).
- Pinning: sections are `height: 100vh` content + `padding-bottom: Nvh`; the content is
  translated by `-screenY` every frame (= `position: sticky; top: 0`). All section
  animation is a pure function of **showScreenOffset** `n` = viewports scrolled since the
  section's top entered the bottom of the screen (ScrollDomRange, 15022).
- Whole-page choreography is scroll-mapped (`math.fit(n, a, b, 0, 1)` ranges), **not**
  time tweens — except three deliberate dt-integrations (pool CTA, join beat, navbar)
  noted below. Our build reproduces this: ScrollTrigger `onUpdate` computing the same
  ratios, imperative style writes.
- The painted world is WebGL with baked camera keyframes (position lerp + quaternion
  slerp indexed by progress, 17633). Our world is a layered SVG multiplane driven by the
  same progress mapping — allowed by the brief when it holds 60fps, which flat two-tone
  SVG does.

## 1. Palette — verified against live CSS

Live tokens: `--color-white:#fbfff4`, `--color-dark-green:#203727`,
`--color-black:#333338`, `--color-light-green:#e0ffab` (ALL button fills),
`--color-light-green2:#bccca2` (active nav dots), links `#516e5a`/`#62866d`.
Scene1 sky `#ADD8E6→#6495ED`, dimmed `#536970→#081733` (18293-96). So the *reference* is
a fully painted polychrome scene with a cream/deep-green UI — the "two colors" on
Awwwards are the brand tones, and buttons add a light-green accent.

**Verdure's hard rule from the brief stays: strictly `#fbfff4` + `#203727`, opacity
steps of ink allowed, no third hue.** Reconciliation:

- The painted world is rendered as an **ink-opacity ramp on cream** (riso-poster
  grading): sky = cream, far planes ≈ ink 14-22%, mid ≈ 40-60%, near ≈ 72-88%,
  foreground ≈ 95-100%. Fog = cream gradients. Night dim = ink overlay to ~90% with
  cream window-lights and the glowing cream trail (replaces their dimmed blue ramp).
- Their light-green CTA fill maps to **cream-filled pills** (`#fbfff4` bg + `#203727`
  text). "Watch the demo" stays filled and distinct via the **ink-filled pill**
  (`#203727` bg + cream text + play glyph) on cream contexts, and the two swap on dark
  contexts. Active side-dots use cream at 100% (vs 65% idle) instead of #bccca2.
- Selection: bg cream, text ink (their `#e0ffab/#203727` mapped into the two tones).

## 2. Type — verified faces and our equivalents

Reference: `--header-font: "Feature Display"` (Extralight 200 for h1-h3 + preloader,
Regular 400 for sub/btn2) and `--default-font: "Britti Sans"` (300/400/600). Both
commercial (`/fonts/FeatureDisplay-*.woff2`, `BrittiSans-*.woff2`).

Chosen equivalents (documented decision):

- **Display = Fraunces variable**, `SOFT 0, WONK 0`, weight **430** (`opsz` auto). At
  hero sizes the high optical-size cut gives Feature-Display-grade stroke contrast and
  editorial sharpness. Weight never drops below 400 anywhere — the owner's hard
  "no light/thin fonts" rule overrides the reference's 200 weight; 430 at 180px reads
  elegant, not thin. Small display (sub1/sub2 equivalents) = Fraunces 500.
- **Body = Plus Jakarta Sans**, floor 500 (owner rule; also genuinely the closest loaded
  face to Britti Sans's contemporary grotesque voice). Buttons 700.
- **Micro-labels/kickers = Geist Mono 700, tracked caps** (brief requirement; replaces
  the reference's serif kicker with the site's field-instrument voice).

Type scale (their exact formulas, `--content-unit = (100vw - 2*pad)/1440`):

| token | formula | @1440 |
|---|---|---|
| h1 | max(80px, 200u) | 188px |
| h2 | max(65px, 110u) | 104px |
| h3 | max(55px, 80u) | 75px |
| sub1 | max(16px, 22u) | 20.8px |
| sub2 | max(18px, 18u) | 17px |
| body1 | max(16px, 20u) | 18.9px |
| body2 | max(14px, 16u) | 15.1px |
| btn | max(16px, 16u) | 15.1px |
| preloader | max(30px, 45u) | 42.5px |

`--site-padding-x: min(60px, 40 * 100vw/1440)`; mobile breakpoint 991.98px switches
`--ref-screen-width` to 768. Headings `line-height: 1`; body 1.4.
Text shadows for legibility over the scene: titles `0 0 .12em rgba(0,0,0,.3)`,
subtitles/descriptions `0 0 1em rgba(0,0,0,.3)` (kept, with ink instead of black).

## 3. Scroll structure — their vh values and ours

Reference sections (CSS padding-bottom + 100vh content; verified live:
`#pages-container` height = **18675px at vh 900 = 20.75 viewports**; mobile 17513px at
844 ≈ 20.75):

| section | length | Verdure beat (same length unless noted) |
|---|---|---|
| home-hero | 200vh | Hero — kicker, giant "Verdure", plain-language line + 2 CTAs, "Scroll to start" |
| home-everblade | 600vh | "One habit / Walk. Check in. Grow." — night falls, trail streak lights |
| home-evernet | 175vh | "Where your evenings / Glow" → mid-beat word-swap → "Where your streak / Grows"; problem copy is the description |
| home-everyone | 500vh | The three-step loop (3 phones sequenced on the aerial map) — uses the measured everyone choreography |
| (everyone pattern, 2nd use) | 500vh | "Made for EVERyone" — Explorers / Neighbors / Partners |
| home-relayers | 200vh | "ReDiscovered." — leaf mark draws center |
| *(no equivalent — ours)* | 300vh | "Points, but you have to show up." — 3 game cards, everyone-grammar |
| *(no equivalent — ours)* | 250vh | Team — six builders |
| *(no equivalent — ours)* | 250vh | Roadmap "The trail ahead" |
| *(no equivalent — ours)* | 200vh | Plans strip (3 tiers) |
| home-pool | 300vh | "One map. Every morning." + waitlist + Watch the demo; 3D tilt exit |
| home-join | 100vh | Footer "Stay close to the trail / Walk with Verdure" |

Added sections keep the reference's rhythm (~300vh per beat average, matching their
2075vh / 7 beats). Total ≈ 3575vh. Reference-mapped beats keep their exact lengths.

## 4. Motion primitives (measured)

- **TextBlur** (19022): `opacity = r; filter: blur((1-r)*0.25em)`; snap to
  `filter:none` at r=1. Used for every text reveal.
- **Masked line slide**: outer span `overflow:hidden`, inner
  `translateY((1-r)*175% + 0.15ex)` (evernet 19519) or `translateX(±(1-r)*110%)`
  (everblade 19089).
- **Stagger-with-overlap** (SplitType chars/lines): for n items and overlap k, window
  `w = 1/(1 + (n-1)(1-k))`, offset `o = w(1-k)`; item i maps
  `fit(r, i*o, i*o + w)`. Overlaps used: pool title chars k=.975 **shuffled random
  order**, pool description lines k=.5, everyone card titles k=.95 shuffled,
  everyone card sublines k=.75, relayers description k=.5, join title spans k=.5.
- **dt-integrations** (the only time-based bits):
  pool CTA `ratio += 4*dt*(active? 1 : -2)` (0.25s in / 0.125s out), opacity `quadIn`,
  motion `1-sineIn` → translateY 2em→0 + rotateX 25°→0;
  join beat `ratio += dt*(shown? 1 : -2)`;
  navbar dots `activeRatio += dt*(active? 1 : -1)`, hover-dim others to .5 at 2/s.
- **Eases seen**: `cubicOut` (hero kicker intro, dot slide), `cubicInOut` (everyone icon),
  `quadIn` (trail fade, CTA opacity), `quartInOut` (preloader hide), `sineIn` (CTA lift).
  CSS transitions: buttons/text-swap .25s ease-out / ease-in-out; dot chevrons .25s;
  dot diamond opacity .5s.

## 5. Per-beat choreography (o = eased section ratio, n = showScreenOffset in viewports)

### Preloader (20544-20620)
Bg `#203727`; percent bottom-center `preloader` size; logo center opacity-staggered:
paths start 0 + i*.05, window .5; lines start .25 + i*.05, window .5. Logo container
scales .45→.75 over t .25→1. Percent display = `fit(weighted, .1, 1)` where weighted =
85% asset load (min ramp 2/s) + 15% compile step (min .25s). Hide (startTime 0→1s,
`quartInOut`): a **rotated-square hole** (45°) expands from 7.5% of the screen diagonal
(cap `fit(width,375,1440,.25,.1)`) to full; percent fades/slides down 1em in first 25%;
faint radial glow + hairline glints along the square's edges (t-driven, extending 15px).
`.page` container fades in .3s. Verdure mark: diamond leaf (6 paths + 4 hairline rays)
in cream, same stagger.

### Hero (19118-19154, 200vh)
- Intro (time-based, `startTime` = seconds after preloader starts hiding): kicker at
  1.75→2.75s `cubicOut`, translateY -100%→0 + TextBlur; "Scroll to start" at 2→2.5s;
  camera intro (17645): fov-ish offset 5→0 and y -200→0 over .2→2s `cubicOut` — our
  layers rise/settle over 1.8s.
- Scroll: hero content pinned 1 viewport, fades in the LAST half viewport of leave
  (`d = 1 - fit(n, r-.5, r)`); "Scroll to start" dies over first 25% of leave.
  Wordmark is the scene's set-piece (theirs is WebGL at the DOM h1 rect; ours is the DOM
  h1 itself, visible, over the stage).
- Hero + habit combined range drives scene1 camera (activeRatio over both sections).
- Mouse camera sway: `cameraLookStrength = .01` → our layers get ±(depth*10px) pointer
  parallax, lerped at ~5/s.
- REQUIRED plain-language line + Get Access (cream-filled pill) + Watch the demo
  (ink-filled pill) sit under the wordmark — always visible in-hero (brief hard rule).

### One habit (everblade 19039-19115, 600vh)
o = `fit(n, 0, viewSize)` (viewSize = 6):
- Title spans mask-slide in `.14→.23`, exit adds `s = fit(n, 5.5, 6)` push.
- Title halves split apart `.3→.4` by ±.8*subtitleWidth px; subtitle scales .8→1,
  slides to y -1em; out `.66→.76` (reverse).
- Subtitle words blur in `.35→.4`, out `.63→.67`.
- Description lines: in `.32→.4` staggered per line, out `.82→.9` (mobile .12→.21 /
  .75→.84).
- Canvas blade: vertical light-line sweep — tip `fit(o,.08,.16)` bottom→center,
  tail `fit(o,.25,.33)`, line exits `.65→.75`/`.85→.9`; diamond square draws `.35→.45`,
  undraws `.65→.7`; glass diamond bg opacity `.4→.45` in, `.64→.66` out.
- Scene: `dim = fit(n,.25,.75) * fit(n,3.5,4.5,1,0)` (night falls entering, dawn at
  3.5→4.5); `trail = fit(n,.45,4.5)` (the glowing streak draws across the whole beat);
  `crack = fit(n,.5,2.4)` → our equivalent: the lit route cutting through the
  neighborhood; trailActive fades out `quadIn` 3.5→4.5.

### Glow → Grows (evernet 19475-19555, 175vh)
- **Color-dip transition in**: full-screen fill to `#203727`, opacity
  `fit(n,-.5,-.25,0,1) * fit(n,0,.25,1,0)` — the world switches to the aerial map
  behind the dip.
- l = `fit(n, -.5, viewSize-.25)`: title masked-rise `.1→.3` (175% + .15ex), blur-out
  `.9→1`; subtitle blur in `.15→.3`, out `.9→1`; description lines in `.25→.35`
  staggered, out `.85→.95`.
- Word swap (ours, same primitive): "evenings/Glow" TextBlur out `.5→.58`,
  "streak/Grows" in `.58→.68` (uses the same blur grammar; documented addition).
- Logo canvas: horizontal light line (tail `fit(l,0,.1)`, tip `.27→.37`), three
  concentric diamonds draw `.5→.65 / .525→.675 / .55→.7`, mark fades in `.55→.65`;
  everything zooms/undraws `.85→1` (diamonds scale out, d = `fit(l,.85,1)`);
  glass diamond opacity `.65→.7` in, `.8→.9` out. Title/subtitle part vertically
  ±.55*logoHeight over `.475→.6`.

### Three-step loop + Made for EVERyone (everyone 19398-19472, 500vh each)
o = `fit(n, -.5, viewSize)`; section visible `0→.15` in, `.85→1` out (h).
Three items sequenced (their trails): item1 `h * fit(o,.18,.3333,1,0)` (visible first,
fades), item2 `h * fit(o,.3333,.48) * fit(o,.51,.6666,1,0)`, item3
`h * fit(o,.6666,.81)`. Per item x: icon diamond `rotate((1-y)*-45deg) scale(.5+.5y)`
with y = `fit(x,.4,.7,cubicInOut)` + glass opacity; title chars shuffled reveal over
`0→.5` (k=.95); sublines `.4→1` (k=.75). Kicker words stagger `fit(h, w*.05, .2+w*.05)`.
Each item pairs with a glowing route segment on the aerial map (their
`scene2.trails[i].activeRatio = item ratio`).
- Loop beat items = the three phones (map / check-in / streak) with **large filled-circle
  numbers** 01/02/03 (user-testing rule).
- Everyone beat items = Explorers / Neighbors / Partners cards.

### ReDiscovered (relayers 19558-19615, 200vh)
s = `fit(n, .5, viewSize+.5)`: center canvas — outer diamond draws `.035→.2`, undraws
`.8→1`; mark fades `.1→.2`, out `.8→.95`; title TextBlur `.075→.125` in, `.75→.95` out;
description lines `.12→.22` in, `.655→.755` out (k=.5). Logo block sits -15vh above
center, title-wrapper +35% of canvas below. **Diamond wipe out** (their relayersHide):
at n `.5→1` a rhombus grows from center (SDF `u_relayersHide*2`) freezing the previous
frame outside — ours: an ink rhombus clip that hands the scene to the next state,
identical timing.

### Game cards / Team / Roadmap / Plans (ours; reference grammar)
- Game (300vh): everyone-grammar with 3 quest/streak/badge cards, one shared
  interaction (hover lift + glass diamond pulse), no lone flip card.
- Team (250vh): kicker + 6 cards in 2 rows; TextBlur rows staggered (k=.75), ink-circle
  avatars with cream initials, identical treatment; enters `.12→.3`, exits `.8→.92`.
- Roadmap (250vh): 4 milestones sequenced like everyone items at
  `.15/.35/.55/.75` centers with status chips (mono 700 caps).
- Plans (200vh): 3 tier pillars rise staggered (`.2→.5`, k=.7), "Verdure+" center
  scaled 1.04 with "Most popular" chip; exits `.85→.95`.

### One map. Every morning. (pool 19332-19395, 300vh)
s = `fit(n, .5, viewSize+1)`: title chars shuffled-reveal `.2→.4` (k=.975); description
lines `.35→.5` (k=.5); CTA active when s in `.45→.6` → dt-ramp (4/s in, 8/s out),
opacity `quadIn`, rise `translateY 2em→0` + `rotateX 25°→0` (1-sineIn). Exit
h = `fit(s,.9,.975)`: whole block `translate3d(0, -20vh, -300px) rotate3d(-1,0,0,-25deg)`
with opacity 1-h under `perspective: 600px`. Water ripple post-pass → our pond plane
settles (opacity fade at n .5→1). Waitlist form mounts here (Supabase intact), plus the
ink-filled "Watch the demo".

### Footer (join 19618-19659, 100vh)
Trigger: n > .95 → dt-ramp (1/s in, 2/s out) s:
subtitle TextBlur `.2→.6`; title spans `.3→.85` (k=.5); buttons wrapper opacity+scale
`.5→1` over `.6→.95` first half, each link staggered `i*.2 → i*.2+.6` translateY 20%→0.
Scene: **joinHide** `fit(n, 0, .95)` — the world zooms (up to 3x) and a shrinking
rhombus window (offset y -.2*ratio) closes over solid `#203727`; eased
`linearStep(.75,1)²`. Ours: ink takes the frame, a diamond window holds the last scene
view, then the footer content (per stills: diamond window top-center, kicker, giant
line, cream pill of links). Footer links: Story, Roadmap, Community, Partners, Team,
Log in + socials; "Walk with Verdure".

### Side dots (Navbar class 20623-20698)
5 diamonds; hash targets with offsets (`data-offset` in viewports): ours →
hero 0, one-habit .5, glow|loop -.7, rediscovered 0, one-map 1.75. Active = section
`ratio ∈ [-1,1]` (secondary id ORs in). Appear only after `startTime > 2` and hide when
footer `hideScreenOffset < -.5`. Slide-in: per-dot
`fit(activeRatio, |i-2|*.06, |i-2|*.06 + .8, 1, 0, cubicOut)` × -2*site-pad-x
(mobile: bottom-center, y offset). Hover: others dim to .5 at 2/s. Chevrons close 1px on
hover/active (.25s), diamond core fades in .5s. Click = Lenis scrollTo(target, offset).

### Scroll indicator (20232-)
Right side, 6px × 200px cream rounded bar inside a `100vh - 20px` track, top = progress
× (track − 200px). Mobile width per CSS (right .25em).

### Nav CTA + pills (CSS)
Pill: height 3em, radius 1.5em, pad `.4em .4em .4em 1.5em`, icon circle 34px with
diagonal arrow. Hover: `:before` scales .97; **two-span text swap** — span1 out
(translateY -1em, fade), span2 in from +1em, .25s ease-out. Our spans: "Get Access" /
"Coming soon" on nav+hero CTAs; "Watch the demo" / "2 min" on demo buttons. Glass
variant: blur(8px), gradient cream 20%→10%, inset highlight — used for the nav CTA over
the scene. No magnetic pull on reference buttons (none in bundle) — magnets are removed
from pills; footer links scale 1.03 on hover (.18s).

## 6. The Verdure world (scene states per beat)

Fixed full-viewport stage behind `#ui`-equivalent content, five SVG planes + fog:
sky (cream + 5% ink cloud puffs, drifting slowly), far hills+rooftops (ink .16),
mid neighborhood (ink .5; library, mural wall, houses with cream windows), park plane
(ink .78; big tree, benches), foreground rim (ink .96). Multiplane camera = per-plane
translate/scale factors (far .2x, mid .5x, near 1x, fg 1.4x) along a designed path:

1. **Hero**: wide morning vista, wordmark over the park hill.
2. **One habit**: push down the main street; night dim (ink overlay → .9, cream
   windows light up); the cream trail streak draws through the streets (blur glow),
   dawn returns by n 3.5→4.5.
3. **Dip → aerial**: color-dip to ink, world flips to the top-down map (streets =
   cream lines, park blobs, pond) — "the whole app is a map" made literal.
4. **Loop + Everyone**: aerial slowly drifts; three glowing route segments light with
   the items.
5. **ReDiscovered**: pull back to the panorama through the leaf-diamond.
6. **Game/Team/Roadmap/Plans**: golden calm — vista variants with prop groups
   (flags, six trees, milestone posts, three signposts) sliding as the camera pans.
7. **One map**: settle at the overlook with pond foreground (cream ripple lines).
8. **Join**: diamond-wipe to solid ink.

Pointer sway on all planes (±10px × depth, strength .01 equivalent). Birds
(2-3 cream chevrons) cross on long beats. DPR-independent (SVG), transforms only,
`will-change: transform` on planes, zero per-frame allocation (cached refs + one
quickSetter per plane).

## 7. Performance / a11y bar

- Lenis `lerp 0.18` on gsap.ticker (matches wheelEaseCoeff 12); lagSmoothing(0).
- Transforms/opacity/filter only; blur is em-based and brief (their exact primitive).
- prefers-reduced-motion: choreography skipped; every beat renders as a designed
  static two-tone poster (text visible, stage in per-beat pose), native jump scrolling.
- Contrast: cream `#fbfff4` on ink `#203727` = 9.9:1 — passes everywhere; night scenes
  put copy on ink glass panels (owner rule).
- Mobile 390px: same beats/lengths, mobile fit-ranges where the reference declared them
  (everblade description .12→.21/.75→.84, title 180% vertical slide instead of 110%
  horizontal, subtitle stacks, dots move to bottom-center).
- Lazy: demo video preload=metadata on demand; no layout shift (fixed stage + sized
  sections).

## 8. Phase 2 verification checklist

Recording of our build (same protocol: 1440x900 + 390x844, constant-velocity pass,
eased slow pass, 2% frames into `reference/verdure/`) compared beat-by-beat vs
`reference/everswap/frames`. Three full compare-fix passes minimum.

| Beat | Trigger | Duration / ease | Travel + stagger | Pass |
|---|---|---|---|---|
| Preloader wipe (1s quartInOut, square-hole, % fade .25) | code = measured constants | ✓ | ✓ | ✓ stills p1-p4 `preloader-*` |
| Hero intro (kicker 1.75-2.75 cubicOut; cue 2-2.5) | ✓ | ✓ | ✓ | ✓ `stills-pass4/preloader-3` (mid blur-in) + `hero` |
| Hero leave fade (last .5 viewport) | ✓ | ✓ | ✓ | ✓ `frames-final/p002-p004` (content gone by n=2) |
| Habit title in .14-.23 / split .3-.4 / out .63-.85 | ✓ | ✓ | ✓ | ✓ `frames-final/p006` (mask-slide mid), `stills/habit-*` |
| Habit night dim .25-.75n, dawn 3.5-4.5n, trail .45-4.5n | ✓ | ✓ | ✓ | ✓ `p004` onset · `p006` full night+trail · `habit-night` dawn |
| Dip transition -.5→-.25→.25n | ✓ | ✓ | ✓ | ✓ `frames-final/p020` (solid ink exactly in window) |
| Glow title .1-.3, swap .5-.68, out .85-1 | ✓ | ✓ | code + frames p019-p021 | ✓ (swap moment not individually framed) |
| Loop items .18/.33-.48/.51-.66/.66-.81 + phones .15-.45 | ✓ | ✓ | ✓ | ✓ `stills p2-p4 loop-*` (dark aerial, one item at a time) |
| Everyone items (same measured ranges + routes) | ✓ | ✓ | ✓ | ✓ `stills p2-p4 everyone-2` (route streak + char scramble) |
| ReDiscovered .035-.2 draw, .8-.95 undraw, wipe .4-1n | ✓ | ✓ | ✓ | ✓ `stills-pass3/rediscovered` (light pano, ink mark) |
| Game/Team/Roadmap/Plans (rise/sequence grammar) | ✓ | ✓ | ✓ | ✓ `stills p3-p4 game/team/roadmap/plans` |
| One-map chars .2-.4, CTA .45-.6 dt-ramp, tilt-exit .9-.975 | ✓ | ✓ | ✓ | ✓ `stills p2-p4 onemap` + `p092` (pre-window empty by spec) |
| Join diamond close + dt-ramp reveal + link stagger .2/.6 | ✓ | ✓ | ✓ | ✓ `stills p2-p4 join` (window, pill, mono bar) |
| Dots stagger .8s cubicOut, hover dim .5, active states | code = measured constants | ✓ | ✓ | ✓ active/idle states across all stills |
| Pill hover swap .25s, ::before scale .97 | CSS = measured values | ✓ | ✓ | ✓ `stills/cta-hover*` artifacts recorded |
| Scroll lengths (ref beats keep exact vh; ours documented §3) | ✓ | — | — | ✓ section heights in `journey-config.ts` |
| Mobile 390 parity | ✓ | ✓ | ✓ | ✓ `stills-pass4/m-*` + `video-mobile-final` |
| Reduced-motion static posters | — | — | — | ✓ `subpages/rm-*` |
| Sub-pages two-tone editorial | — | — | — | ✓ `subpages/story-*`, `partnerships-*`, `login-top` |

## 9. Verification log

Three compare-fix passes on the running build (stills at every beat), then a full
final recording on the production server (`reference/verdure/`: constant-velocity
videos at 1440x900 + 390x844, 2%-increment frames `frames-final/`, interaction
stills). All evidence lives beside the reference corpus for direct comparison.

- **Pass 1** (`stills-pass1`): every beat fired, but cream chrome/text washed out
  over the cream sky (nav, dots, hero copy invisible — user-testing rule 1/2
  violations). Fixes: `--chrome` ink/cream flip driven per-frame from scene
  darkness; light beats switched to ink type with cream halos; the aerial map
  went dark (ink .94) so its beats stay cream like the reference's dark aerial;
  hero CTAs became ink-fill + cream-outline (both filled, distinct); glass cards
  deepened to ink .78.
- **Pass 2** (`stills-pass2`): chrome/beat contrast verified everywhere; caught
  the camera timeline running ~3% late (positions were page-height fractions,
  ScrollTrigger spans scrollable height) — rebuilt the timeline in absolute
  scroll-vh; loop phones led too late (ramp .15-.45); rediscovered still sat on
  the map (wipe re-aligned to n .4-1 with map-out at wipe end); join window
  framed empty sky (pano zoom origin moved to 50%/95%); kicker slot cleared the
  center nav; play glyph got its evenodd hole; roadmap windows overlapped to
  kill the dead handoff gap.
- **Pass 3** (`stills-pass3` + `stills-pass4` after a dev-server HMR corruption
  forced a clean restart): rediscovered lands on the light panorama with the
  dual-stroke ink mark ✓; join reads like the reference footer ✓; team/game/
  plans/roadmap verified; mobile capsule nav + stacked CTAs verified; mobile
  kicker clearance and the scroll-cue's cream flip on the dark rim applied.
- **Final** (`frames-final`, `video-desktop-final`, `video-mobile-final`,
  production build): sampled p002/p004/p006/p020/p056/p092 against the measured
  windows — dim onset, full night + lit windows + trail draw, the ink dip, and
  the pre-window quiet zones all land exactly where the fit-ranges say.
  `npm run lint` and `npm run build` clean.

Deviations from the reference, documented: display weight 430 (never 200 — owner
type rule); two-tone palette (reference is polychrome painted + light-green CTA
accent; mapped per §1); glow beat carries the word-swap addition; four
Verdure-only beats use the reference grammar at ~300vh rhythm; roadmap windows
overlap slightly (unlike the measured everyone zero-crossings) to avoid an empty
stage between milestones.

## 13. 2026-07-21 crispness pass (owner directive — "don't blur the texts")

- **Text blur removed everywhere**: `textBlur` in `lib/anim.ts` is now a pure
  opacity reveal on the same measured windows (name kept so every call site
  is untouched). No text is ever filtered mid-scroll.
- **Impact label voice** (owner: "nice and bold"): `.kicker`, `.font-num`,
  and `.join-links a` use the system `--font-impact` stack (Impact /
  Haettenschweiler / Franklin Gothic Bold / Arial Black). Geist Mono is
  removed from the bundle entirely — one less font download.
- **Nav minimalized to one flow**: the center link row and the mobile
  hamburger menu are gone. Chrome = mark+wordmark left, Log in + Get Access
  right (mobile capsule: brand + CTA). Sub-pages stay reachable via the
  footer and the journey's join bar (Pricing added there).
- **Glow beat un-fried**: the "Grows" swap word anchors with `inset-x-0` +
  text-align inside a full-width mask — no transform to knock it off-center.
- **Side dots**: hold the last active waypoint through the game→plans
  stretch instead of snapping back to the hero dot.
- **Legibility bumps**: join bar, footer bars, waitlist disclaimer, and
  milestone indexes raised from 45-70% to 70-90% opacity at 12-13px.

## 12. 2026-07-21 painted terrain + nebula palette (owner directive)

The owner supplied the EverSwap "Painted Landscape Hero" design handoff
(`Downloads/Everswap design assets.zip`) as the site background, a five-swatch
nebula palette, and asked for smoother scrolling with speed as the priority.

- **Palette** (sampled from the owner's reference): forest `#013025`, teal
  `#01465F`, jade `#117D56`, lime `#A1CD3F`, sage `#CCE58F`. Token remap:
  bg `#0C120D` (the handoff's own bg token), elevated `#121F16`, hairlines
  `#24392C`, text `#F2F5EE` (handoff token), **accent = lime `#A1CD3F`**
  (the handoff's accent role), scene light = sage `#CCE58F`, stage
  silhouettes = deep forest `#0E2519`; teal lives in the painted water +
  ambient washes. Emerald-era hexes are fully swept.
- **The background**: the handoff's procedural painted terrain (value-noise
  rivers/meadows/forests + 42k brush dabs + 32k tree dabs) is **pre-rendered
  at build time** — `reference/paint-capture.html` runs the handoff
  generator re-themed dark under Playwright and exports
  `public/painted-terrain.webp` (1800×3600, 120KB) + `-m.webp` (900w, 47KB).
  Runtime ships only the stills (the handoff README's own perf
  recommendation): `PaintedBackdrop` pans it under the stage planes via one
  gsap.ticker transform write (Lenis already smooths scrollY — no double
  easing), and sub-pages get it fixed + dimmed. Night dim / aerial map /
  dip / join overlays cover it exactly as before; choreography untouched.
  The zip's Kregan DEMO font was NOT shipped (demo license; type stays
  Plus Jakarta per §11).
- **Smooth/perf pass**: Lenis lerp 0.18 → **0.12** (owner smoothness ask);
  backdrop-blur radii cut (glass-ink/night-glass 16/14 → 10, beat GLASS
  12 → 8 with higher fill opacity); terrain images SSR'd with
  srcSet + fetchPriority so they load during the preloader.

## 11. 2026-07-20 OLED pivot (owner directive — supersedes §1 palette + §2 type)

The owner directed a full visual pivot to a **Dark OLED forest system**, replacing
the two-tone cream/ink rule. Structure, beat lengths, and every measured
choreography number are unchanged — only the grading and type changed.

- **Palette**: bg `#090A0F`, elevated `#0D1017`, hairlines `#1E2230`, text
  `#EDF1F7`, accent `#10B981` (emerald), scene light `#6EE7B7` (mint). The
  world is a **slate-opacity ramp** (`#44506B` at the §6 opacities) on the
  void; every light source (windows, lamps, trail, routes, pond) is emerald.
  Ambient radial emerald washes on the stage + body::before.
- **Type**: Fraunces retired. One geometric family — Plus Jakarta Sans, display
  weight 750 with -0.035em tracking (h1 -0.045em); body 500 floor stays (owner
  no-thin rule still in force); Geist Mono kickers unchanged.
- **Tokens**: legacy `--cream`/`--ink` + Tailwind `cream`/`ink` now map to
  light-text / void so the whole build keeps working; new `accent`, `line`,
  `elev` tokens. The chrome flip (`html.chrome-light`) is a structural no-op —
  both states resolve to light chrome.
- **Tactile layer**: `.glass-ink` = layered dark glass with a mouse-tracked
  emerald radial glow (GlowTracker feeds `--gx/--gy`, one delegated rAF
  listener); pills = emerald primary with glow / dark-glass / glass / outline
  variants, arrow glyph sweeps +4px on hover; fields, chips, phone mocks, demo
  modal, auth panels re-graded to elev + line + emerald.

## 10. 2026-07-20 addendum — dedicated pages + magnetic CTAs (owner directive)

- **Magnetic pills reinstated** (overrides the §5 no-magnets note): primary CTAs
  (hero pair, /pricing tier + close CTAs, /roadmap close CTA) get the existing
  `useMagnetic` 8px pointer pull via `PillButton`'s `magnetic` prop. Fine-pointer
  only, reduced-motion off — the measured pill grammar (hover swap, .97 face) is
  unchanged.
- **Hero mark**: the official leaf mark (LeafMark, currentColor ink) rides inside
  the hero `data-r="title"` node above the wordmark, sharing its blur-in and
  leave choreography exactly.
- **Dedicated /pricing and /roadmap pages** on the PageShell chrome (same
  Navbar/Footer/Lenis as /story and /partnerships). Tier and milestone facts
  moved to `src/lib/plans.ts` / `src/lib/milestones.ts` — single source shared
  with the landing Plans/Roadmap beats; the 12-beat journey is untouched.
- **Nav**: Pricing → /pricing and Roadmap → /roadmap join the center links; the
  journey keeps its own #roadmap/#plans beats and side-dot targets.
- **`.glass-ink`**: subtle ink-glass card surface for cream canvases (uniform
  rounded-2xl radius, hairline ink ring, 4px hover lift at .3s expo-out).
