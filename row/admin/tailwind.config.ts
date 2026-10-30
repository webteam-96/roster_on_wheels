import type { Config } from "tailwindcss";

// Merged config: admin (shadcn) theme + public website theme.
// The website's color keys don't collide with admin's shadcn keys except
// `muted` — admin's `muted` object is kept authoritative here, and the
// website's `text-muted` colour is supplied by overriding the `--muted` CSS
// var inside the `.site-shell` wrapper (see (site) globals), so neither app
// restyles the other.
// ROW "Fellowship" (row/website/design.md). Tailwind's default hue scales are remapped onto the
// Fellowship palette so the thousands of existing `bg-blue-700` / `text-slate-800` classes follow the
// brand without page edits. green/emerald/red/rose/amber stay stock: they carry status meaning.
const fellowshipBlue = {
  50: "#F3F8FD", 100: "#EDF4FB", 200: "#CFE2F6", 300: "#A9C6EA", 400: "#5E93D6", 500: "#0067C8",
  600: "#1F56A8", 700: "#17458F", 800: "#0B3F7A", 900: "#12376F", 950: "#0A2547",
};
const fellowshipNeutral = {
  50: "#F7F9FC", 100: "#EDF4FB", 200: "#D5DEE8", 300: "#B7C3D2", 400: "#8796AA", 500: "#64748B",
  600: "#4A5A70", 700: "#2A3F5C", 800: "#1B2C42", 900: "#132033", 950: "#0B1422",
};
const marigold = {
  50: "#FFF8EA", 100: "#FFEFCC", 200: "#FFE0A0", 300: "#FFD27A", 400: "#FFC65C", 500: "#F7A81B",
  600: "#E59A10", 700: "#B97A0B", 800: "#8A5B08", 900: "#5E3E06", 950: "#3A2604",
};
const blueFamily = Object.fromEntries(
  ["blue", "indigo", "sky", "cyan", "teal", "violet", "purple", "fuchsia", "pink"].map((k) => [k, fellowshipBlue]),
);
const neutralFamily = Object.fromEntries(
  ["slate", "gray", "zinc", "neutral", "stone"].map((k) => [k, fellowshipNeutral]),
);

const config: Config = {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			...blueFamily,
  			...neutralFamily,
  			yellow: marigold,
  			orange: marigold,
  			white: "#FCFDFE", // FRONTEND-RULES #3: `bg-white` surfaces are off-white
  			// ── admin (shadcn) ──
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			// ── public website palette ──
  			paper: {
  				DEFAULT: "#FCFDFE",
  				200: "#F7F9FC",
  				300: "#EDF4FB",
  			},
  			porcelain: "#EDF4FB",
  			midnight: {
  				DEFAULT: "#132033",
  				800: "#1B2C42",
  				700: "#2A3F5C",
  			},
  			cream: "#F7F9FC",
  			"cream-2": "#EDF4FB",
  			navy: fellowshipBlue,
  			azure: "#17458F",
  			mint: "#0067C8",
  			"mint-ink": "#0B3F7A",
  			marigold: "#F7A81B",
  			coral: "#FFC65C",
  			lilac: "#A9C6EA",
  			"sky-tone": "#CFE2F6",
  			"stone-tone": "#D5DEE8",
  			line: "rgba(27,44,66,.12)",
  			"ink-soft": "#64748B",
  			royal: {
  				DEFAULT: "#17458F",
  				light: "#0067C8",
  				dark: "#12376F",
  			},
  			gold: {
  				DEFAULT: "#F7A81B",
  				light: "#FFC65C",
  				dark: "#E59A10",
  				deep: "#B97A0B",
  			},
  			page: "#F7F9FC",
  			ink: "#1B2C42",
  			// NOTE: `muted` intentionally NOT redefined here (see header comment)
  		},
  		borderRadius: {
  			// Panels and cards use one deliberate radius (design.md 8.1, FRONTEND-RULES #23).
  			'2xl': '20px',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontFamily: {
  			// Figtree body, Bricolage Grotesque display (design.md §2).
  			sans: ["var(--font-body)", "Figtree", "ui-sans-serif", "system-ui", "sans-serif"],
  			display: ["var(--font-display)", "Bricolage Grotesque", "ui-sans-serif", "system-ui", "sans-serif"],
  		},
  		fontSize: {
  			"display-1": ["clamp(3.4rem,7.5vw,6.5rem)", { lineHeight: "1.05" }],
  			"display-2": ["clamp(2.4rem,5vw,4rem)", { lineHeight: "1.08" }],
  			heading: ["clamp(1.6rem,3vw,2.25rem)", { lineHeight: "1.15" }],
  			giant: ["clamp(4rem,9vw,7.5rem)", { lineHeight: "1" }],
  		},
  		boxShadow: {
  			// FRONTEND-RULES #18: no drop shadows as separation. Every shadow utility draws nothing;
  			// separate with `border-line` or a tonal step. `ring-line` is the one deliberate outline.
  			sm: "none", DEFAULT: "none", md: "none", lg: "none", xl: "none", "2xl": "none", inner: "none",
  			card: "none", "card-lg": "none", soft: "none", lift: "none", "card-pop": "none",
  			"glow-gold": "none", "glow-gold-sm": "none", "glow-royal": "none",
  			"ring-line": "0 0 0 1px rgba(27,44,66,.12)",
  		},
  		backgroundImage: {
  			// FRONTEND-RULES #1/#15: no gradients or glow orbs. Old utility names kept so pages still compile.
  			...Object.fromEntries(
  				["glow-warm", "glow-warm-light", "royal-sheen", "gold-sheen", "mesh-light", "glow-gold-corner",
  				 "glow-royal", "hero-radial", "gold-radial", "hero-fade", "event-card"].map((k) => [k, "none"]),
  			),
  		},
  		keyframes: {
  			"fade-up": {
  				"0%": { opacity: "0", transform: "translateY(16px)" },
  				"100%": { opacity: "1", transform: "translateY(0)" },
  			},
  			marquee: {
  				"0%": { transform: "translateX(0)" },
  				"100%": { transform: "translateX(-50%)" },
  			},
  			"float-slow": {
  				"0%, 100%": { transform: "translateY(0)" },
  				"50%": { transform: "translateY(-10px)" },
  			},
  			"pulse-dot": {
  				"0%, 100%": { opacity: "0.25" },
  				"50%": { opacity: "1" },
  			},
  		},
  		animation: {
  			"fade-up": "fade-up 0.6s ease-out both",
  			marquee: "marquee 36s linear infinite",
  			"float-slow": "float-slow 7s ease-in-out infinite",
  			"pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
  		},
  		transitionTimingFunction: {
  			"out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
  		},
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
