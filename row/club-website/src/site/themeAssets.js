'use client'
// Browser-side asset loading the ported homes call (the RIZones site's theme/themeAssets.js, reduced to what ROW
// uses): an extra stylesheet for one page, and the theme's scripts (already loaded by site/ThemeScripts.jsx).
import { THEME_ASSETS } from '@/themes/assets'
import { loadScript } from './ThemeScripts.jsx'

const styles = new Map()

/** Add a stylesheet once; resolves when it has loaded or failed. */
export function loadStylesheet(href) {
  if (!styles.has(href)) {
    styles.set(href, new Promise((resolve) => {
      const el = document.createElement('link')
      el.rel = 'stylesheet'
      el.href = href
      el.onload = resolve
      el.onerror = resolve
      document.head.appendChild(el)
    }))
  }
  return styles.get(href)
}

/** Resolves once the theme's scripts are in. */
export async function loadThemeScripts(theme) {
  const set = THEME_ASSETS[theme] || THEME_ASSETS['classic-blue']
  for (const src of set.scripts) await loadScript(src)
}
