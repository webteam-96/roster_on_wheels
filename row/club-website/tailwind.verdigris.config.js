/** @type {import('tailwindcss').Config} */
// The Verdigris Ledger palette for the REACT PORT ONLY.
//
// Why this file exists: the root tailwind.verdigris.config.js still carries the
// theme's ORIGINAL peacock-teal / eucalyptus palette, but ledger.css was later
// recoloured to plum + magenta. The result was a green header, top strip and
// footer wrapped around a lavender page — the two halves of the theme
// disagreeing. This config re-points the SAME token names at the plum values
// ledger.css already uses, so all the shared markup (bg-navy, text-ink,
// bg-canvas, text-gold …) recolours without touching a single component.
//
// Values are taken FROM ledger.css, not invented:
//   --peacock   #3A0E3C   -> navy            (deep plum: dark sections, buttons)
//   --peacock-2 #2A0A2C   -> navy.deep       (footer / deepest ground)
//   --ink       #1E0A20   -> ink             (body text, plum near-black)
//   --muted     #574A5C   -> muted           (muted plum-grey)
//   --sea       #F0ECF5   -> canvas          (lavender paper ground)
//   --marigold  #901F93   -> gold.light      (the bright ceremonial accent)
//   --burnt     #6E1770   -> gold            (text-legible on lavender)
//   --pine      #5E1660   -> gold.cta        (strongest on-light emphasis)
//
// Build:  npm run build:css:verdigris   (from this folder)
// It writes into public/Themes/verdigris-ledger/css/theme.css — the ASP.NET
// tree's copy is NOT touched, so the .aspx keeps the green palette until the
// same change is made there deliberately.
export default {
  content: [
    // the port's own components…
    '../Club-Website-reactjs/src/**/*.{js,jsx}',
    // …plus the shared reference source and the ASP.NET markup, so this sheet
    // still carries the FULL shared class vocabulary (that is what lets the
    // theme swap recolour inner pages authored for classic-blue).
    '../src/**/*.{js,jsx}',
    '../New-Club-Website-Theme/Faster_ClubWebsite/**/*.{aspx,ascx,Master,master,html}',
    '../New-Club-Website-Theme/Faster_ClubWebsite/*.cs',
    '../New-Club-Website-Theme/Faster_ClubWebsite/Themes/**/js/**/*.js',
  ],
  safelist: ['warm-nav-link', 'warm-nav-link--active', 'btn-outline-navy',
    'ledger-nav-link', 'ledger-nav-link--active'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#3A0E3C', deep: '#2A0A2C' },
        gold: { DEFAULT: '#6E1770', light: '#901F93', cta: '#5E1660' },
        ink: '#1E0A20',
        muted: '#574A5C',
        canvas: '#F0ECF5',
      },
      fontFamily: {
        sans: ['Newsreader', 'Georgia', 'serif'],
        heading: ['"Bricolage Grotesque"', 'Newsreader', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        script: ['Newsreader', 'Georgia', 'serif'],
      },
      maxWidth: { content: '1400px' },
      boxShadow: {
        card: '0 4px 20px rgba(58, 14, 60, 0.10)',
        cardHover: '0 12px 34px rgba(58, 14, 60, 0.18)',
      },
    },
  },
  plugins: [],
}
