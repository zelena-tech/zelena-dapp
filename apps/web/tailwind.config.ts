import type { Config } from "tailwindcss";

const MONO = ['"Space Mono"', "ui-monospace", '"Cascadia Mono"', "Consolas", '"Courier New"', "monospace"];

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#080808",
        surface: "#101210",
        "surface-2": "#0C0E0C",
        line: "#1E2A18",
        "line-strong": "#2E4420",
        primary: "#3CE109",
        "primary-dim": "#2BA307",
        glow: "#0A1A04",
        muted: "#8B9A83",
        faint: "#55614F",
        paper: "#E8F0E2",
      },
      fontFamily: {
        head: MONO,
        body: MONO,
        mono: MONO,
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(60,225,9,0.25), 0 0 24px -6px rgba(60,225,9,0.35)",
        "glow-sm": "0 0 12px -4px rgba(60,225,9,0.4)",
      },
      transitionDuration: { "175": "175ms" },
      keyframes: {
        pulseline: { "0%, 100%": { opacity: "0.4" }, "50%": { opacity: "1" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        blink: { "0%, 49%": { opacity: "1" }, "50%, 100%": { opacity: "0" } },
      },
      animation: {
        pulseline: "pulseline 2s ease-in-out infinite",
        shimmer: "shimmer 1.5s infinite",
        blink: "blink 1.1s step-end infinite",
      },
    },
  },
  plugins: [],
};

export default config;
