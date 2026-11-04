'use client'
// Re-runs the theme's page animations (RotaryAnim.page) when a page's client-side content changes.
// The first run happens in site/ThemeScripts.jsx once the theme's script has loaded.
import { useEffect } from 'react'

export function useRotaryAnim(deps = []) {
  useEffect(() => {
    if (window.RotaryAnim && window.RotaryAnim.page) window.RotaryAnim.page()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's content signals
  }, deps)
}

export default useRotaryAnim

// The shells' setup hooks in the source. site/ThemeScripts.jsx runs the shell and page scripts and hides the
// loader once the server-rendered page has hydrated, so these have nothing left to do.
export function useThemeShell() {}
export function useRouteEnter() {}
export function useLoader() {}
