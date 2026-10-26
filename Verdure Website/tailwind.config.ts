import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--silica-rgb) / <alpha-value>)",
        foreground: "rgb(var(--ink-rgb) / <alpha-value>)",

        // Neon Synthesi — clay system. RGB-channel vars so opacity modifiers work.
        silica: {
          DEFAULT: "rgb(var(--silica-rgb) / <alpha-value>)",
          shadow: "rgb(var(--silica-shadow-rgb) / <alpha-value>)",
          light: "rgb(var(--silica-light-rgb) / <alpha-value>)",
        },
        aqua: {
          DEFAULT: "rgb(var(--aqua-rgb) / <alpha-value>)",
          gloss: "rgb(var(--aqua-gloss-rgb) / <alpha-value>)",
          depth: "rgb(var(--aqua-depth-rgb) / <alpha-value>)",
        },
        cherry: {
          DEFAULT: "rgb(var(--cherry-rgb) / <alpha-value>)",
          gloss: "rgb(var(--cherry-gloss-rgb) / <alpha-value>)",
          depth: "rgb(var(--cherry-depth-rgb) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "rgb(var(--gold-rgb) / <alpha-value>)",
          gloss: "rgb(var(--gold-gloss-rgb) / <alpha-value>)",
          depth: "rgb(var(--gold-depth-rgb) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink-rgb) / <alpha-value>)",
          soft: "rgb(var(--ink-soft-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        // Body / UI workhorse
        sans: ["var(--font-rubik)", "system-ui", "sans-serif"],
        rubik: ["var(--font-rubik)", "system-ui", "sans-serif"],
        // Expressive rounded display — hero + short headers only
        display: ["var(--font-fredoka)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        clay: "28px",
        "clay-lg": "36px",
        "clay-sm": "20px",
      },
    },
  },
  plugins: [],
};
export default config;
