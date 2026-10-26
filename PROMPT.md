# Claude Code Prompt: Connectify Landing Page Redesign (Claymorphism)

> Paste this whole thing into Claude Code at the root of the Connectify landing page repo. It assumes the current site is live on Vercel and uses a Three.js globe in the hero.

---

## Role and mission

You are a senior product designer and front-end engineer who ships playful, high-craft consumer web for Gen Z apps. Your job is to take the existing Connectify landing page, which currently reads as generic AI output, and rebuild its entire visual system around **claymorphism** with the "Neon Synthesi" palette. The result should look like an intentionally designed, premium playful consumer product, not a Dribbble shot and not a SaaS template. Every choice should look like a human made it on purpose.

Do not touch the core copy meaning unless I list a change. Keep the existing Three.js globe but integrate it correctly into the new system. Preserve my existing JavaScript style conventions (Allman braces, `let` over `const`, no `.push()`, no arrow functions, `charAt` over bracket notation) in any JS you write or edit.

## Product context

Connectify is a gamified location-based outdoor exploration app for Gen Z and Millennials. It helps young people discover local events, outdoor spaces, and ways to connect with their community, with game mechanics layered on top (think discovery, streaks, points, real-world quests).

Brand position decision, lock this in: this is a **playful consumer app**, not B2B SaaS. So we are NOT going for the Linear / Vercel minimal-sharp look. We are going for tactile, friendly, confident, and a little bold. Claymorphism is the system, the neon palette is the energy.

## What is wrong right now (do not repeat)

- The whole thing reads as AI generated. Safe sans-serif fonts, generic fade-up animations, predictable layout.
- Text overlaps in the "how the app works" section.
- Text is hard to read in the "get early access" section near the bottom (contrast failure).
- The "scroll to explore" indicator in the hero is positioned wrong.
- The site looks broken / awkward on phones.
- The card animations specifically look AI generated.
- There is no plain-language description of what the app does before the statistics, so people see numbers before they understand the product.

---

## Design system (non-negotiable)

### Claymorphism, done correctly

Claymorphism = chunky inflated shapes with large border-radius, a soft outer drop shadow so the element floats above the background, plus two inner shadows (a light highlight top-left and a darker depth bottom-right) so it looks sculpted from clay. Rules:

- **One light source, top-left, everywhere.** Highlights live top-left, depth lives bottom-right, on every single clay element. Inconsistent light direction is the number one thing that makes clay look amateur.
- **Restraint.** Not every element is clay. Clay is for the things a user wants to press or that should feel like objects: buttons, feature cards, stat tiles, toggles, the CTA block, icon containers. Backgrounds and long text blocks stay flat.
- **Depth hierarchy.** Use shadow size to signal importance. CTAs and primary cards get bigger, softer floats. Secondary chips get smaller, tighter shadows. Do not give everything the same shadow.
- Clay is a 2021 to 2022 trend, so the only thing keeping it from looking dated is execution discipline. Hold the line on the three rules above.

### Color: the "Neon Synthesi" palette

Use these as CSS custom properties. The roles matter as much as the hexes, read them carefully.

```css
:root {
  /* Background canvas: this is the DOMINANT surface. Most of the page is this. */
  --silica:        #EAEFF4;
  --silica-shadow: #D1D9E6; /* outer shadow dark side */
  --silica-light:  #FFFFFF; /* outer shadow light side */

  /* Aqua: ACCENT and structure highlights, NOT the dominant surface. */
  --aqua:          #05F2D6;
  --aqua-gloss:    #88FFFA; /* inner top-left highlight */
  --aqua-depth:    #029E8B; /* inner bottom-right depth */

  /* Cherry: BUTTONS and primary highlights only. High energy, use sparingly. */
  --cherry:        #FF1E56;
  --cherry-gloss:  #FF829E; /* inner highlight */
  --cherry-depth:  #B3002B; /* inner depth */

  /* Text: near-black on light surfaces. Body text is NEVER neon. */
  --ink:           #16202E;
  --ink-soft:      #45556B;
}
```

**Critical hierarchy rule, this fixes the contrast bug:** silica is the base surface for ~70% of the page. Aqua is an accent (icon fills, stat highlights, one or two hero shapes, section accents). Cherry is reserved for primary CTAs and key highlights. Neon is never the dominant field, because the more neon area on screen, the harder text becomes to read and the more "toy" it looks.

### Contrast rules (mandatory, WCAG AA)

The current contrast complaint is unacceptable. Enforce these:

- Body text and any text under ~24px: use `--ink` on silica. Never aqua text, never cherry text at body size.
- Text on an **aqua** surface: must be `--ink` (dark). White on aqua fails badly. Aqua is light, so it always pairs with dark text.
- Text on a **cherry** surface (CTA labels): white, but only at 18px or larger and bold. White on cherry fails for small text, so CTA labels are large and heavy by design.
- The "get early access" section specifically: rebuild it on a silica or aqua surface with dark ink text, or a cherry surface with large bold white text. Test the final contrast, do not eyeball it.

### Clay shadow recipes (starting tokens, tune to taste)

```css
/* Neutral silica surface: cards, sections, containers */
.clay-surface {
  background: var(--silica);
  border-radius: 28px;
  box-shadow:
    10px 10px 20px var(--silica-shadow),
    -10px -10px 20px var(--silica-light);
}

/* Aqua object: hero shapes, icon tiles, accent chips */
.clay-aqua {
  background: var(--aqua);
  border-radius: 32px;
  box-shadow:
    12px 12px 26px rgba(2, 158, 139, 0.35),  /* outer float */
    inset 6px 6px 12px var(--aqua-gloss),     /* top-left highlight */
    inset -8px -8px 16px var(--aqua-depth);   /* bottom-right depth */
}

/* Cherry button: primary CTA */
.clay-cherry {
  background: var(--cherry);
  color: #fff;
  font-weight: 700;
  border-radius: 24px;
  box-shadow:
    10px 10px 22px rgba(179, 0, 43, 0.32),
    inset 6px 6px 12px var(--cherry-gloss),
    inset -8px -8px 16px var(--cherry-depth);
}
.clay-cherry:active {
  /* clay presses IN on tap, this is the whole point of the style */
  box-shadow:
    4px 4px 10px rgba(179, 0, 43, 0.3),
    inset 8px 8px 16px var(--cherry-depth),
    inset -6px -6px 12px var(--cherry-gloss);
  transform: translateY(1px);
}
```

Scale shadows DOWN on mobile (roughly 60% of desktop offsets and blur), otherwise the puffiness bloats and eats the screen.

### Typography (rounded to match the clay, but with contrast)

Do NOT use Inter, Manrope, Open Sans, or Nunito for headings. Those are the most overused UI fonts and they are why sites look mass produced. For claymorphism we want rounded, friendly letterforms that match the inflated shapes, BUT the display and body must contrast, not both be bubbly. Two bubbly rounded fonts together reads like a kids app or a template. The rule: one expressive rounded display + one cleaner, weight-flexible body.

**Use this pairing (all Google Fonts, free, easy to load):**

- **Display: `Fredoka`** (the variable family), SemiBold or Bold, for the hero headline and section headers only. Chunky rounded bubbles that match the clay perfectly. Use it sparingly. Never set paragraphs or long sentences in it, that reads childish and kills the premium feel. Hero and short headers only.
- **Body and UI: `Rubik`**, weights 400 to 700. Rounded corners so it harmonizes with the clay, but not geometric-circular, so it stays legible at small sizes. Full weight range gives real hierarchy. This carries all body text, the description line, form labels, button text, captions.

**Alternatives if you want a different display feel (with their caveats):**
- `Varela Round`: friendlier and less chunky than Fredoka, good for headings. Caveat: single weight (400 only), so you build hierarchy by size, not weight. Headings only, never body.
- `Quicksand` (Bold/SemiBold): clean circular terminals that suit clay. Caveat: overused, and weak legibility at small sizes, so display only, never body.
- `Rubik Mono One`: ultra-heavy squarish-rounded, only viable for one or two accent words. Not a heading font.

**Hard rules:**
- Never pair two bubbly rounded fonts (e.g. Quicksand display + Quicksand body). Keep ONE expressive rounded display + Rubik for the workhorse.
- Body text, the product description, and all form labels go in Rubik (legible), never in Fredoka, Varela Round, or Quicksand.
- Fredoka is a spice. Hero headline plus short section headers, that is it.

Type rules: big confident display sizes in the hero, tight intentional line-height on headings, real size contrast between display and body (do not make everything medium). Load fonts with `font-display: swap` and preconnect to the font host so Core Web Vitals do not tank.

### Motion (kill the AI animation tell)

The current animations look AI generated because they use the universal fade-up-on-scroll plus uniform stagger with the same easing. Replace that thinking entirely:

- No generic `opacity 0 to 1, translateY 20px` on everything. If you fade, fade with intent and vary it.
- Use **spring / physics-based motion** with overshoot and settle, so elements feel like they have weight, like clay. GSAP is fine for this.
- Cards should feel physical: on entrance, a subtle scale-up with a slight overshoot that settles, or a soft drop-and-bounce, not a flat slide. On hover, a small lift with the shadow growing (the clay rising off the surface). On tap, the clay presses in (see the `:active` recipe above).
- Vary timing and choreography across sections. Predictable uniform stagger is the tell. Let some things lead, some follow, some come from different directions.
- Keep Lenis for smooth scroll if it is already wired in, and use scroll position to drive a couple of intentional moments (parallax on the globe, a section that assembles). Do not scroll-trigger everything, that is also a tell.
- Respect `prefers-reduced-motion`: gate the big motion behind it.

---

## Page structure

Use this section framework (adapted from app-landing-page best practice for 2026). Order matters.

1. **Hero / above the fold.** Headline stating the core benefit in 5 to 10 words, a one-line subhead, the Three.js globe integrated as a clay-world object (see globe note), and a primary CTA. Keep the gamified emphasis. Fix the "scroll to explore" indicator: it should be bottom-center, clearly anchored, and animate subtly, not floating in a wrong-looking spot.

2. **Plain-language description (NEW, add this).** Immediately under the hero, before any statistics, add a short, explicit description so people understand the product before they see numbers. Use roughly this line, tighten as needed: *"Connectify is a gamified community-discovery platform that helps young people find local events, outdoor spaces, and opportunities to connect with their community."* Make it a clean, readable statement, dark ink on silica.

3. **Stats / social proof.** The existing statistics, but now AFTER the description. Render each stat in a clay tile.

4. **Feature highlights (gamified).** 3 to 5 benefit-led feature cards in clay. Lead with the benefit, not the feature name. Each card gets a clay icon tile (aqua or cherry fill, dark or white text per the contrast rules). This is the section whose card animations looked AI generated, so apply the physical motion direction here specifically.

5. **How it works.** A 3 to 4 step walkthrough. **Fix the text overlap here.** Rebuild the layout with proper spacing, a clean grid, and numbered clay step markers. Nothing overlaps at any breakpoint, verify on mobile.

6. **Team.** Keep the team section. **Change Vishvak Gurram's role to "Head of Product Strategy."**

7. **Get early access (final CTA).** **Fix the contrast here.** Rebuild on a high-contrast clay surface (silica or aqua with dark ink, or cherry with large bold white). The waitlist input and button are clay. Since the app is not launched, use a waitlist form, not dead app-store links.

8. **Footer.** Clean, on silica, dark ink, with the basics.

---

## Mobile (mandatory pass, not an afterthought)

The site currently looks broken on phones. Build mobile-first and verify on a real ~390px viewport, not just a desktop resize:

- Scale clay shadows and border-radius down on mobile so elements do not look bloated.
- Stack multi-column sections cleanly. The "how it works" and feature grids must reflow to single column with real spacing and zero overlap.
- Display type must shrink on mobile without overflowing. Test the longest headline.
- Touch targets at least 44px. CTAs full-width or near it on mobile.
- The globe must not blow up layout or kill performance on mobile, downscale or simplify it for small screens.

## Three.js globe integration

Keep the globe, it is a strength. But make it part of the clay world, not a separate layer fighting the UI:

- Correct z-index and layering so clay cards sit clearly above or beside it, never visually colliding.
- Tune the globe colors to harmonize with the palette (aqua-leaning), so it does not look like a stock dark-space globe pasted onto a light clay page.
- Make sure it is performant: cap pixel ratio, simplify geometry on mobile, and do not let it tank Core Web Vitals.

## Definition of done

- Every clay element uses one consistent top-left light source.
- Silica is the dominant surface, aqua and cherry are accents only. No neon-soup backgrounds.
- All text passes WCAG AA contrast. Specifically re-verify "get early access."
- No text overlap anywhere, including "how the app works," at desktop and mobile.
- "Scroll to explore" is correctly positioned and animated.
- The plain-language description appears before the stats.
- Vishvak Gurram is listed as "Head of Product Strategy."
- Display is a rounded expressive font (Fredoka), used only for hero and short headers. Body is Rubik. No two bubbly fonts paired. No body text set in Fredoka/Varela Round/Quicksand.
- Animations are physical and varied, no uniform fade-up-stagger.
- Mobile verified at ~390px, nothing broken, globe behaves.
- `prefers-reduced-motion` respected.

## Anti-patterns (do NOT do)

- Do not put neon text on the silica background.
- Do not make the entire page aqua or cherry.
- Do not use Inter/Manrope/Open Sans/Nunito for headings, and do not pair two bubbly rounded fonts, and do not set body text or form labels in Fredoka/Varela Round/Quicksand.
- Do not animate everything with the same scroll-fade and the same easing.
- Do not give every element the same shadow size.
- Do not ship without testing on an actual phone-width viewport.
- Do not leave dead app-store links, use a waitlist.

When you are done, give me a short summary of what changed by section, and call out anything where you made a judgment call I should review.
