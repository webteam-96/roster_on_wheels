// Resolves the theme for this page view (ThemeResolver port) and puts the shell
// into it: the <html data-theme> attribute every stylesheet keys off, plus that
// theme's stylesheets. Scripts are loaded by the layout, after its DOM exists.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useClub } from '../context/ClubProvider.jsx'
import {
  resolve, dbName,
  CLASSIC_BLUE, WARM_MODERN, MADRAS_LEGACY, CIVIC_BOLD, VERDIGRIS_LEDGER, GOLD, HANDLOOM, THEME8_KEYS,
} from './ThemeResolver.js'
import { loadThemeStyles } from './themeAssets.js'
import { preloadTheme } from '../themes/registry.js'
import { PINNED_THEME } from '../routes.js'

// Dev only: keep ONE context object across hot reloads. This module imports the theme registry, so an
// edit to any theme file re-runs it; a fresh createContext() then left the still-mounted <App> reading
// a context no provider served ("useTheme must be used inside <ThemeProvider>"). Production has no HMR.
const Ctx = (import.meta.hot && import.meta.hot.data.ctx) || createContext(null)
if (import.meta.hot) import.meta.hot.data.ctx = Ctx

export function ThemeProvider({ children }) {
  const club = useClub()
  const location = useLocation()
  // Which theme's stylesheets have finished loading. Comparing it to `theme`
  // (rather than a plain boolean) makes "ready" flip to false SYNCHRONOUSLY the
  // moment the theme changes — a boolean set in an effect would stay true for
  // one render and let the new shell mount before its CSS existed.
  const [readyTheme, setReadyTheme] = useState(null)

  // The chain reads the club's DB ThemeKey at step (e), so it can only settle
  // once the tenant has resolved. Until then classic-blue is the safe default —
  // the same value the C# falls back to.
  //
  // A page that pins its own shell (the theme Homes) beats the whole chain, just
  // as an .aspx with its own MasterPageFile does — see PINNED_THEME.
  const theme = useMemo(() => {
    const pinned = PINNED_THEME[location.pathname.replace(/\/+$/, '') || '/']
    if (pinned) return pinned
    // resolve() answers without the club whenever the theme comes from a local
    // source (?theme=, the per-port map, DevThemeOverride) — every preview port —
    // and falls through to classic-blue while the tenant is still loading. That
    // is what lets the boot loader paint in the right theme instead of flashing
    // Rotary blue and then swapping. Nothing that reads `theme` is mounted while
    // booting: App renders the loader alone until stylesReady.
    return resolve(club)
    // location.key so a ?theme=/&pk= preview applies on navigation too
  }, [club.loading, club.clubId, club.themeKey, club.tenant, location.key, location.pathname])

  // useLayoutEffect, not useEffect: layout effects all run BEFORE the browser
  // paints, and the loader mounts (as a child) before this provider effect would
  // otherwise fire — which showed one frame of classic blue on every theme.
  useLayoutEffect(() => {
    // Set immediately, including while the tenant loads: the boot loader styles
    // itself from html[data-theme] and no theme stylesheet is loaded yet, so
    // there is nothing else this can mis-colour.
    document.documentElement.setAttribute('data-theme', theme)
    if (theme === CIVIC_BOLD) {
      // Apply the saved light/dark mode (default light) — the master does this
      // in an inline <script> before first paint.
      let m = 'light'
      try {
        const saved = localStorage.getItem('civicMode')
        if (saved === 'dark' || saved === 'light') m = saved
      } catch { /* private mode */ }
      document.documentElement.setAttribute('data-civic-mode', m)
    } else {
      document.documentElement.removeAttribute('data-civic-mode')
    }
  }, [theme, club.loading])

  useEffect(() => {
    // Nothing themed is on screen until the tenant resolves (App shows the
    // BootLoader), so don't fetch a stylesheet we may be about to disable.
    if (club.loading) return
    let cancelled = false
    // Theme 8 themes carry their own CSS inside their code chunks: wait for the
    // shell/home chunks too, or the first paint would be unstyled.
    Promise.all([loadThemeStyles(theme), preloadTheme(theme)]).then(() => { if (!cancelled) setReadyTheme(theme) })
    return () => { cancelled = true }
  }, [theme, club.loading])

  const stylesReady = readyTheme === theme

  const value = useMemo(() => ({
    theme,
    stylesReady,
    dbName: dbName(theme),
    isClassic: theme === CLASSIC_BLUE,
    isWarm: theme === WARM_MODERN,
    isMadras: theme === MADRAS_LEGACY,
    isCivic: theme === CIVIC_BOLD,
    isVerdigris: theme === VERDIGRIS_LEDGER,
    isGold: theme === GOLD,
    isHandloom: theme === HANDLOOM,
    isTheme8: THEME8_KEYS.includes(theme),
  }), [theme, stylesReady])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The theme rendering this page view (ThemeResolver.Current + the Is* flags). */
export function useTheme() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>')
  return v
}
