// Per-theme asset manifest — the exact <link> / <script> list each Site*.Master
// carries, in the same ORDER (order matters: madras deliberately loads
// classic-blue's compiled sheet FIRST so the legacy template-4 sheets win).
// Cache-buster query strings are kept verbatim so a bumped ?v= is visible here.
export const THEME_ASSETS = {
  'classic-blue': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@500;600;700;800&family=Dancing+Script:wght@600;700&family=DM+Sans:wght@300;400;500;700&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  'warm-modern': {
    styles: [
      '/Themes/warm-modern/fonts/fonts.css',
      '/Themes/warm-modern/css/theme.css?v=63',
    ],
    scripts: ['/Themes/warm-modern/js/rotary-anim.js?v=12'],
  },

  'civic-bold': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Outfit:wght@200;300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap',
      '/Themes/civic-bold/css/theme.css?v=6',
      '/Themes/civic-bold/css/civic-motion.css?v=65',
      '/Themes/civic-bold/css/civic-shell.css?v=17',
    ],
    scripts: ['/Themes/civic-bold/js/rotary-anim.js?v=57'],
  },

  'verdigris-ledger': {
    styles: [
      '/Themes/verdigris-ledger/fonts/fonts.css',
      '/Themes/verdigris-ledger/css/theme.css?v=8',
      '/Themes/verdigris-ledger/css/ledger.css?v=61',
    ],
    scripts: [
      '/Themes/verdigris-ledger/js/rotary-anim.js?v=9',
      '/Themes/verdigris-ledger/js/ledger.js?v=9',
    ],
  },

  // Theme 6. Deliberately reuses classic-blue's compiled sheet and its
  // rotary-anim.js: the Tailwind utilities the shared markup is built from have
  // to exist, and one maintained motion script beats a sixth copy.
  //
  // gold.css owns the shell + Home; gold-pages.css (Stage B, 2026-08-14) owns
  // every OTHER page — each one redesigned with its own composition on the same
  // brand. Both load AFTER rotary-design.css so they always win.
  gold: {
    styles: [
      // ONE display family: Anton (user's pick 2026-08-14) + Inter for UI/body.
      'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
      '/Themes/gold/css/gold.css?v=82',
      '/Themes/gold/css/gold-pages.css?v=27',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  // Theme 7 — "The Handloom". Same engineering call as gold: reuse classic-blue's
  // compiled sheet (the shared markup's Tailwind utilities have to exist) and its
  // rotary-anim.js (one maintained motion script beats a seventh copy). The
  // signature motion is CSS scroll-driven and needs no script at all.
  //
  // handloom.css owns the tokens, the shell, Home and the shared-page restyle.
  // handloom-pages.css (Stage B) owns the four bespoke pages. Both load AFTER
  // rotary-design.css so they always win.
  handloom: {
    styles: [
      'https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=Instrument+Sans:wght@400..700&display=swap',
      // Roundo is NOT on Google Fonts — it is ITF's, served free for commercial
      // use from Fontshare. Separate <link> because it is a different provider.
      'https://api.fontshare.com/v2/css?f%5B%5D=roundo@400,500,600,700&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
      '/Themes/handloom/css/handloom.css?v=153',
      // '/Themes/handloom/css/handloom-pages.css?v=1',   // uncommented at Stage B
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  // ── Theme 8 family (unreleased) ─────────────────────────────────────────
  // Each theme's OWN styles are Vite CSS imported by its modules under
  // src/themes/<key>/ (scoped by class prefix / html[data-theme]) and arrive with
  // its code chunk - see src/themes/registry.js. Listed here: the theme's fonts,
  // and classic-blue's compiled sheet + rotary-anim.js as the BASE, so a page a
  // theme has not redesigned (the single-club legacy pages) still renders
  // correctly inside its shell - the same arrangement gold and handloom use.
  'cinematic': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  'split-story': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Manrope:wght@400..800&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  'liquid-motion': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Instrument+Serif:ital@0;1&family=Unbounded:wght@300..900&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  'horizontal-journey': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Figtree:wght@400..800&family=Unbounded:wght@400..900&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  'photo-collage': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Figtree:wght@400..800&family=Kalam:wght@400;700&family=Shrikhand&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  'sunrise': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Instrument+Serif:ital@0;1&family=Unbounded:wght@300..900&display=swap',
      '/Themes/classic-blue/css/rotary-design.css?v=29',
    ],
    scripts: ['/Themes/classic-blue/js/rotary-anim.js?v=10'],
  },

  'madras-legacy': {
    styles: [
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@500;600;700;800&family=Dancing+Script:wght@600;700&family=DM+Sans:wght@300;400;500;700&display=swap',
      // Compiled design system FIRST so content pages authored for the classic
      // theme keep their look inside this shell; the legacy template-4
      // stylesheets load AFTER it so the RC Madras design always wins.
      '/Themes/classic-blue/css/rotary-design.css?v=29',
      '/Themes/madras-legacy/Home4CssAndStyles/css/all.min.css',
      // ⚠ TRAP: Bootstrap defines many of the SAME utility names as Tailwind,
      //   with !important and DIFFERENT values — .p-5 is 3rem here vs Tailwind's
      //   1.25rem, .mb-4 1.5rem vs 1rem, .gap-4 1.5rem vs 1rem. Because it loads
      //   after rotary-design.css AND uses !important, Bootstrap wins on every
      //   shared page madras renders. Measured 2026-08-24: the project detail
      //   stat cards came out 217px tall here against 153px on every other theme.
      //   Shared markup that must not be hijacked has to avoid those class names
      //   (ProjectDetail's STAT_BOX/STAT_ICON/STAT_GRID use inline styles).
      '/Themes/madras-legacy/Home4CssAndStyles/bootstrap/css/bootstrap.min.css',
      '/Themes/madras-legacy/Home4CssAndStyles/css/owl.carousel.new.css',
      '/Themes/madras-legacy/Home4CssAndStyles/css/club-theme-one.css?v=8',
    ],
    scripts: [
      // jQuery is in <head> on the original and every later script needs it, so
      // the list is loaded strictly in order.
      '/Themes/madras-legacy/Home4CssAndStyles/js/jquery.min.js',
      '/Themes/madras-legacy/Home4CssAndStyles/bootstrap/js/bootstrap.bundle.min.js',
      '/Themes/madras-legacy/Home4CssAndStyles/js/uiscript.js?v=2.8',
      '/Themes/madras-legacy/js/jquery.magnific-popup.min.js',
      '/Themes/madras-legacy/Home4CssAndStyles/js/owl.carousel.min.js',
      '/Themes/madras-legacy/js/rotary-anim.js?v=11',
    ],
  },
}

const loadedStyles = new Map()   // href -> { el, promise, owners:Set<theme> }
const loadedScripts = new Map()  // src  -> Promise

/**
 * Inject a <link rel=stylesheet> once; resolves when it has loaded (or failed).
 * `owner` records which theme wants it — several themes share hrefs (madras
 * deliberately loads classic-blue's compiled sheet, and both use the same Google
 * Fonts link), so ownership is a SET. Without that, activating madras would
 * disable the very sheet it needs.
 */
export function loadStylesheet(href, owner) {
  const hit = loadedStyles.get(href)
  if (hit) {
    if (owner) hit.owners.add(owner)
    return hit.promise
  }
  let el
  const promise = new Promise((resolve) => {
    el = document.createElement('link')
    el.rel = 'stylesheet'
    el.href = href
    el.dataset.rotaryTheme = 'true'
    el.onload = resolve
    el.onerror = resolve   // never block the page on a missing sheet
    document.head.appendChild(el)
  })
  loadedStyles.set(href, { el, promise, owners: new Set(owner ? [owner] : []) })
  return promise
}

/**
 * Only the ACTIVE theme's sheets may apply. The page never reloads when the
 * theme changes (a ?theme=…&pk=… preview switch, or the tenant resolving after
 * first paint), so a sheet loaded for the previous theme would otherwise keep
 * fighting the new one — two themes both defining :root tokens.
 */
function applyOnly(theme) {
  for (const { el, owners } of loadedStyles.values()) {
    if (owners.size === 0) continue
    el.disabled = !owners.has(theme)
  }
}

/** Inject a <script> once; resolves when it has run. Callers await in order. */
export function loadScript(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src)
  const p = new Promise((resolve) => {
    const el = document.createElement('script')
    el.src = src
    el.async = false
    el.dataset.rotaryTheme = 'true'
    el.onload = resolve
    el.onerror = resolve
    document.body.appendChild(el)
  })
  loadedScripts.set(src, p)
  return p
}

export function loadThemeStyles(theme) {
  const key = THEME_ASSETS[theme] ? theme : 'classic-blue'
  const set = THEME_ASSETS[key]

  // Start everything, but only WAIT on our own compiled sheets. The remote
  // Google Fonts link is on the list too, and awaiting it held the boot loader
  // on screen for seconds on a slow (or blocked) fonts.googleapis.com — fonts
  // swap in when they arrive, which is what font-display is for.
  const pending = []
  for (const href of set.styles) {
    const p = loadStylesheet(href, key)
    if (!/^https?:\/\//i.test(href)) pending.push(p)
  }

  applyOnly(key)                            // switch immediately…
  return Promise.all(pending).then(() => applyOnly(key))  // …and again once ours exist
}

/** Sequential — several themes depend on load order (jQuery before owl, etc). */
export async function loadThemeScripts(theme) {
  const set = THEME_ASSETS[theme] || THEME_ASSETS['classic-blue']
  for (const src of set.scripts) await loadScript(src)
}
