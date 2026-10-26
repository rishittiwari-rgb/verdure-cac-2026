import type { Config } from "tailwindcss";

let config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Clean-light system. Legacy names stay wired so existing markup
        // keeps working: cream = high-emphasis text (now ink), ink = the
        // page ground (now paper). RGB-channel vars keep the opacity
        // modifiers working (text-cream/70, bg-accent/10, ...).
        cream: "rgb(var(--cream-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        "accent-ink": "var(--accent-ink)",
        line: "var(--line)",
        elev: "var(--elev)",
      },
      fontFamily: {
        // One family for everything readable — Manrope (500 floor)
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        // --font-display, not --font-body. These two disagreed: this line
        // resolved `.font-display` to the BODY font while globals.css:146
        // resolves the same class name to Cormorant. Cormorant wins today only
        // because the globals rule is emitted later in the stylesheet, so the
        // display serif renders by source order rather than by intent — and any
        // change to CSS layer ordering would silently swap every display
        // heading on the site to Manrope and orphan the five Cormorant font
        // files still being downloaded. Making both say the same thing removes
        // the coin flip.
        display: ["var(--font-display)", "Garamond", "Georgia", "serif"],
        // Mono is fine print only (the build stamp)
        mono: ["ui-monospace", "Cascadia Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
