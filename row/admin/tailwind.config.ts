import type { Config } from "tailwindcss";

// Merged config: admin (shadcn) theme + public website theme.
// The website's color keys don't collide with admin's shadcn keys except
// `muted` — admin's `muted` object is kept authoritative here, and the
// website's `text-muted` colour is supplied by overriding the `--muted` CSS
// var inside the `.site-shell` wrapper (see (site) globals), so neither app
// restyles the other.
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
  				DEFAULT: "#FDFDFB",
  				200: "#F6F7F4",
  				300: "#E8EDF6",
  			},
  			porcelain: "#EFF1EC",
  			midnight: {
  				DEFAULT: "#06132E",
  				800: "#0B1D42",
  				700: "#101D3F",
  			},
  			cream: "#EDF1F7",
  			navy: {
  				50: "#EEF3FB",
  				100: "#DCE7F7",
  				600: "#0A57A8",
  				700: "#083A87",
  				800: "#00317B",
  				900: "#002B6C",
  				950: "#001A44",
  			},
  			azure: "#0067C8",
  			royal: {
  				DEFAULT: "#0A57A8",
  				light: "#3E8DDD",
  				dark: "#0B4EA0",
  			},
  			gold: {
  				DEFAULT: "#FBB420",
  				light: "#FCC03F",
  				dark: "#EDA80C",
  				deep: "#A96D00",
  			},
  			page: "#F6F8FC",
  			ink: "#1F2937",
  			// NOTE: `muted` intentionally NOT redefined here (see header comment)
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontFamily: {
  			sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
  			display: ["var(--font-fraunces)", "Georgia", "serif"],
  		},
  		fontSize: {
  			"display-1": ["clamp(3.4rem,7.5vw,6.5rem)", { lineHeight: "1.05" }],
  			"display-2": ["clamp(2.4rem,5vw,4rem)", { lineHeight: "1.08" }],
  			heading: ["clamp(1.6rem,3vw,2.25rem)", { lineHeight: "1.15" }],
  			giant: ["clamp(4rem,9vw,7.5rem)", { lineHeight: "1" }],
  		},
  		boxShadow: {
  			card: "0 1px 2px rgba(31,26,10,0.05), 0 10px 30px -14px rgba(31,26,10,0.16)",
  			"card-lg": "0 2px 6px rgba(31,26,10,0.06), 0 26px 52px -22px rgba(31,26,10,0.24)",
  			soft: "0 1px 2px rgba(31,26,10,0.05), 0 10px 30px -14px rgba(31,26,10,0.16)",
  			lift: "0 2px 6px rgba(31,26,10,0.06), 0 24px 48px -18px rgba(31,26,10,0.24)",
  			"glow-gold": "0 0 40px -6px rgba(251,180,32,0.45)",
  			"glow-gold-sm": "0 0 24px -6px rgba(251,180,32,0.5)",
  			"glow-royal": "0 12px 40px -10px rgba(10,87,168,0.35)",
  			"card-pop": "0 1px 2px rgba(2,32,71,0.04), 0 16px 40px -16px rgba(2,32,71,0.18)",
  		},
  		backgroundImage: {
  			"glow-warm":
  				"radial-gradient(56rem 36rem at 78% -10%, rgba(251,180,32,0.13), transparent 60%), radial-gradient(44rem 30rem at -10% 110%, rgba(10,87,168,0.22), transparent 58%)",
  			"glow-warm-light":
  				"radial-gradient(56rem 36rem at 82% -10%, rgba(251,180,32,0.10), transparent 60%), radial-gradient(44rem 30rem at -10% 110%, rgba(10,87,168,0.07), transparent 58%)",
  			"royal-sheen": "linear-gradient(120deg, #0A57A8 0%, #1E6FBE 55%, #3E8DDD 100%)",
  			"gold-sheen": "linear-gradient(120deg, #EDA80C 0%, #FBB420 60%, #FCC03F 100%)",
  			"mesh-light":
  				"radial-gradient(42rem 28rem at 12% -8%, rgba(62,141,221,0.14), transparent 60%), radial-gradient(38rem 26rem at 95% 12%, rgba(251,180,32,0.13), transparent 62%), radial-gradient(30rem 22rem at 55% 110%, rgba(10,87,168,0.08), transparent 60%)",
  			"glow-gold-corner":
  				"radial-gradient(40rem 28rem at 0% 100%, rgba(251,180,32,0.12), transparent 62%)",
  			"glow-royal":
  				"radial-gradient(48rem 32rem at 100% 0%, rgba(62,141,221,0.14), transparent 60%)",
  			"hero-radial":
  				"radial-gradient(52rem 32rem at 82% -12%, rgba(30,111,190,0.25), transparent 62%), radial-gradient(40rem 28rem at -8% 108%, rgba(251,180,32,0.10), transparent 60%)",
  			"gold-radial":
  				"radial-gradient(36rem 22rem at 88% 8%, rgba(251,180,32,0.14), transparent 65%)",
  			"hero-fade":
  				"linear-gradient(90deg, #06132E 0%, rgba(6,19,46,0.85) 34%, rgba(6,19,46,0.45) 60%, rgba(6,19,46,0) 82%)",
  			"event-card": "linear-gradient(135deg, #0B4EA0 0%, #1E6FBE 100%)",
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
