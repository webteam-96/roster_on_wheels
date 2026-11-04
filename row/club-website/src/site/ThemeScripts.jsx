'use client'
// Loads a theme's motion scripts (public/Themes/<key>/js) and runs their entry points once the page is in:
// RotaryAnim.shell() wires the nav and drawer, RotaryAnim.page() the reveals, sliders and counters.
// Also hides the page loader the shells render (#rotary-loader): the page is server-rendered, so it is ready.
import { useEffect } from 'react'

const loaded = new Map()

export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve) => {
      const s = document.createElement('script')
      s.src = src
      s.async = false
      s.onload = resolve
      s.onerror = resolve
      document.body.appendChild(s)
    }))
  }
  return loaded.get(src)
}

export default function ThemeScripts({ scripts }) {
  useEffect(() => {
    let cancelled = false
    // The scripts rewrite DOM text (split headings, counters), so they must start only after React has hydrated
    // the page content; the theme chunks hydrate lazily, so wait until React owns every element directly inside the shell's <main>.
    const afterHydration = new Promise((resolve) => {
      const started = Date.now()
      const check = () => {
        const main = document.querySelector('main')
        const owned = (el) => Object.keys(el).some((k) => k.startsWith('__reactFiber'))
        const hydrated = !!main && Array.from(main.children).every(owned)
        if (hydrated || Date.now() - started > 8000) resolve()
        else setTimeout(check, 50)
      }
      check()
    })
    // A server-rendered image that failed before React attached its onError (photo fallbacks) is replayed now.
    afterHydration.then(() => {
      document.querySelectorAll('img').forEach((img) => {
        if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) img.dispatchEvent(new Event('error'))
      })
    })
    afterHydration.then(() => Promise.all(scripts.map(loadScript))).then(() => {
      if (cancelled) return
      const anim = window.RotaryAnim
      if (anim && anim.shell) anim.shell()
      if (anim && anim.page) anim.page()
    })
    const loader = document.getElementById('rotary-loader')
    const t = loader ? setTimeout(() => {
      loader.classList.add('rotary-loader--hidden')
      loader.setAttribute('aria-hidden', 'true')
    }, 150) : null
    return () => { cancelled = true; if (t) clearTimeout(t) }
  }, [scripts])
  return null
}
