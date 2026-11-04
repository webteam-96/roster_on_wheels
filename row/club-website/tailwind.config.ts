import type { Config } from "tailwindcss";

const config: Config = {
  // ROW's own markup only. The themes (src/themes, src/site) ship their own precompiled stylesheets; generating
  // their classes here too put a second copy of the utilities in <head> and broke their cascade order.
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // CSS variables — overridden per theme so the same components render in 5 looks.
        brand: {
          DEFAULT: "var(--brand)",
          accent: "var(--brand-accent)",
          // The accent as text on white or light grey: dark enough for WCAG AA (4.5:1) with the default gold.
          "accent-ink": "var(--brand-accent-ink)",
          ink: "var(--brand-ink)",
          bg: "var(--brand-bg)",
          muted: "var(--brand-muted)",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
