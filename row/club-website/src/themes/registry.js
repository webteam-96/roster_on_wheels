// ─────────────────────────────────────────────────────────────────────────────
// Theme 8 family — where App.jsx finds each theme's shell, home and pages.
//
// Every theme is a folder:  src/themes/<key>/Site.jsx        the shell (layout)
//                           src/themes/<key>/Home.jsx        its home page
//                           src/themes/<key>/pages/<Page>.jsx its own inner pages
//
// Files are discovered by NAME (import.meta.glob), so adding a page is creating
// its file - nobody edits a shared list. A page a theme has not built yet simply
// is not found, and App.jsx falls back to the shared page for it.
//
// Everything is lazy: a theme's code, and the CSS its modules import, load only
// when that theme renders, so the ~1300 clubs on the released themes never
// download any of it.
//
// Page file names (the `page` prop App.jsx's <Swap> passes):
//   About  Projects  ProjectDetail  Directory  Directors  PastPresidents
//   Newsletters  Gallery  Events  EventDetail  Calendar  Dignitary
//   (SisterClubs / YouthPartners removed for ROW: they were one club's hard-coded lists)
// ─────────────────────────────────────────────────────────────────────────────
import { lazy } from 'react'
import { THEME8_KEYS } from '../theme/ThemeResolver.js'

const SHELLS = import.meta.glob('./*/Site.jsx')
const HOMES = import.meta.glob('./*/Home.jsx')
const PAGES = import.meta.glob('./*/pages/*.jsx')

function build(key) {
  const loadShell = SHELLS['./' + key + '/Site.jsx']
  const loadHome = HOMES['./' + key + '/Home.jsx']
  const pages = {}
  for (const [path, load] of Object.entries(PAGES)) {
    const m = path.match(/^\.\/([^/]+)\/pages\/([^/.]+)\.jsx$/)
    if (m && m[1] === key) pages[m[2]] = lazy(load)
  }
  return {
    Layout: loadShell ? lazy(loadShell) : null,
    Home: loadHome ? lazy(loadHome) : null,
    pages,
    // Fetch the shell and home chunks (and the CSS they import) BEFORE the boot
    // loader lifts, so the first paint is already this theme - ThemeProvider
    // waits on this alongside the theme's stylesheets.
    preload: () => Promise.all([loadShell && loadShell(), loadHome && loadHome()]).catch(() => null),
  }
}

export const THEME8 = Object.fromEntries(THEME8_KEYS.map((k) => [k, build(k)]))

/** Resolves once the theme's shell + home code (and their CSS) are in; instant for other themes. */
export function preloadTheme(theme) {
  const t = THEME8[theme]
  return t ? t.preload() : Promise.resolve()
}
