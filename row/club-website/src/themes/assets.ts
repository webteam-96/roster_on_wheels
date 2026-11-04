// Stylesheets and scripts each theme needs, ported from the RIZones club site (theme/themeAssets.js).
// The released themes ship precompiled CSS under public/Themes; the newer themes reuse classic-blue's compiled
// sheet and bring their own CSS through their components.

export interface ThemeAssets {
  styles: string[];
  scripts: string[];
}

const CLASSIC_CSS = "/Themes/classic-blue/css/rotary-design.css?v=29";
const CLASSIC_JS = "/Themes/classic-blue/js/rotary-anim.js?v=10";
const gf = (families: string) => `https://fonts.googleapis.com/css2?${families}&display=swap`;

export const THEME_ASSETS: Record<string, ThemeAssets> = {
  "classic-blue": {
    styles: [
      gf("family=Inter:wght@400;500;600;700;800&family=Poppins:wght@500;600;700;800&family=Dancing+Script:wght@600;700&family=DM+Sans:wght@300;400;500;700"),
      CLASSIC_CSS,
    ],
    scripts: [CLASSIC_JS],
  },
  "warm-modern": {
    styles: ["/Themes/warm-modern/fonts/fonts.css", "/Themes/warm-modern/css/theme.css?v=61"],
    scripts: ["/Themes/warm-modern/js/rotary-anim.js?v=12"],
  },
  "civic-bold": {
    styles: [
      gf("family=Poppins:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Outfit:wght@200;300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500"),
      "/Themes/civic-bold/css/theme.css?v=6",
      "/Themes/civic-bold/css/civic-motion.css?v=65",
      "/Themes/civic-bold/css/civic-shell.css?v=17",
    ],
    scripts: ["/Themes/civic-bold/js/rotary-anim.js?v=57"],
  },
  "verdigris-ledger": {
    styles: [
      "/Themes/verdigris-ledger/fonts/fonts.css",
      "/Themes/verdigris-ledger/css/theme.css?v=8",
      "/Themes/verdigris-ledger/css/ledger.css?v=60",
    ],
    scripts: ["/Themes/verdigris-ledger/js/rotary-anim.js?v=9", "/Themes/verdigris-ledger/js/ledger.js?v=7"],
  },
  gold: {
    styles: [
      gf("family=Anton&family=Inter:wght@400;500;600;700;800"),
      CLASSIC_CSS,
      "/Themes/gold/css/gold.css?v=81",
      "/Themes/gold/css/gold-pages.css?v=26",
    ],
    scripts: [CLASSIC_JS],
  },
  cinematic: { styles: [gf("family=Archivo:wdth,wght@62..125,100..900"), CLASSIC_CSS], scripts: [CLASSIC_JS] },
  "split-story": {
    styles: [gf("family=Archivo:wdth,wght@62..125,100..900&family=Manrope:wght@400..800"), CLASSIC_CSS],
    scripts: [CLASSIC_JS],
  },
  "liquid-motion": {
    styles: [gf("family=Geist:wght@400..700&family=Instrument+Serif:ital@0;1&family=Unbounded:wght@300..900"), CLASSIC_CSS],
    scripts: [CLASSIC_JS],
  },
  "horizontal-journey": {
    styles: [gf("family=Figtree:wght@400..800&family=Unbounded:wght@400..900"), CLASSIC_CSS],
    scripts: [CLASSIC_JS],
  },
  "photo-collage": {
    styles: [gf("family=Figtree:wght@400..800&family=Kalam:wght@400;700&family=Shrikhand"), CLASSIC_CSS],
    scripts: [CLASSIC_JS],
  },
  sunrise: {
    styles: [gf("family=Geist:wght@400..700&family=Instrument+Serif:ital@0;1&family=Unbounded:wght@300..900"), CLASSIC_CSS],
    scripts: [CLASSIC_JS],
  },
};
