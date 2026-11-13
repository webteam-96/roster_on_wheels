import type { Config } from "tailwindcss";

// Brand tokens mirror rotary-frontend (Goal Overview `go-*` palette + login card colours).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#EEF3FB",
          700: "#1D4FA8",
          900: "#0B2A5E",
          950: "#0F172A",
        },
        gold: {
          50: "#FEF6E7",
          500: "#F7A81B",
          600: "#E0960F",
        },
        ink: "#1E3A5F",
      },
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.04)",
      },
    },
  },
  plugins: [],
};

export default config;
