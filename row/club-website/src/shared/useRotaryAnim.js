// Bridges the theme's rotary-anim.js into the SPA lifecycle.
//
// The Web Forms original loads the script per page and it self-starts on
// DOMContentLoaded. Here the shell mounts once and only the content swaps, so
// the copied scripts expose window.RotaryAnim.{shell,page} instead (see the
// "SPA bridge" block at the bottom of each Themes/*/js/rotary-anim.js) and we
// drive them from React.
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { loadThemeScripts } from '../theme/themeAssets.js'
import { useTheme } from '../theme/ThemeProvider.jsx'

/**
 * Layout-level: load the theme's scripts, then run the one-time shell
 * initialisers. `navReady` should flip true once the nav/drawer markup is in the
 * DOM — initNav() binds listeners to elements that don't exist before the menus
 * have loaded.
 */
export function useThemeShell(theme, navReady) {
  const done = useRef(false)

  useEffect(() => {
    let cancelled = false
    loadThemeScripts(theme).then(() => {
      if (cancelled || !navReady || done.current) return
      done.current = true
      if (window.RotaryAnim && window.RotaryAnim.shell) window.RotaryAnim.shell()
    })
    return () => { cancelled = true }
  }, [theme, navReady])
}

// ── Running page() safely, and often enough ─────────────────────────────────
// Content arrives from the API well after first paint, and some of it much
// later than the rest (the verdigris counter band sums impact across EVERY
// Rotary year). Anything rendered after the last page() call would never be
// initialised — .reveal elements stuck at opacity 0, counters frozen at "0".
//
// Rather than depend on 33 pages each listing every piece of state that changes
// their DOM — one omission is an invisible section — a MutationObserver watches
// the document and re-runs page() when the content settles. Every initialiser
// page() calls is guarded per element (see the __ra_* marks in rotary-anim.js),
// so re-running only ever picks up what is new.
let scheduled = null
let running = false
let missed = false
let observer = null

function runPage() {
  scheduled = null
  running = true
  try {
    if (window.RotaryAnim && window.RotaryAnim.page) window.RotaryAnim.page()
  } finally {
    // page() mutates the DOM itself (adds .is-visible, wraps [data-split] text).
    // MutationObserver callbacks are microtasks, so they land while `running` is
    // still true and are ignored; a macrotask clears the flag afterwards.
    setTimeout(() => {
      running = false
      // ...but REAL content can land in that same window, and dropping it left
      // it uninitialised forever. On /about the breadcrumb <h1> and eyebrow did
      // exactly that: never observed, so the page title stayed at opacity 0 for
      // as long as the tab was open. One make-up run picks up whatever was
      // skipped. It cannot ping-pong: page()'s own writes are attribute changes
      // and one-time-guarded wraps, so a settled page adds no elements and the
      // next run sets nothing to make up.
      if (missed) { missed = false; schedulePage(60) }
    }, 0)
  }
}

function schedulePage(delay = 120) {
  if (running) { missed = true; return }
  if (scheduled) clearTimeout(scheduled)
  scheduled = setTimeout(runPage, delay)
}

function ensureContentObserver() {
  if (observer || typeof MutationObserver === 'undefined') return
  observer = new MutationObserver((records) => {
    // Only ELEMENT additions mean new content that might need initialising.
    //
    // Ignoring text nodes matters: animateCount() rewrites a counter's
    // textContent on EVERY animation frame, which is a childList mutation. That
    // fed straight back into schedulePage(), so page() ran ~11 times while the
    // counters were counting and each run restarted them — the figures cycled
    // forever instead of settling. (initCounters is now per-node guarded too,
    // so this is belt AND braces.)
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) { schedulePage(); return }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

/**
 * Page-level: initialise this page's motion layer (reveal, counters, spotlight,
 * tilt, sliders, lightbox, …). `deps` only makes the first run happen sooner —
 * the observer above is what guarantees late-arriving content is picked up, so
 * an incomplete dep list is no longer a bug.
 */
export function useRotaryAnim(deps = []) {
  const { theme } = useTheme()

  useEffect(() => {
    let cancelled = false
    // MUST await the script. React commits child effects BEFORE parent effects,
    // so a page's useRotaryAnim runs before its layout's useThemeShell has even
    // asked for rotary-anim.js. Firing early found no window.RotaryAnim and
    // never retried, which left whole pages of .reveal elements at opacity 0.
    // loadThemeScripts is memoised per URL, so this is just "wait for the one
    // that's already loading".
    loadThemeScripts(theme).then(() => {
      if (cancelled) return
      ensureContentObserver()
      schedulePage(0)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps])
}

/**
 * Replay the page-entrance animation on every navigation.
 *
 * `.route-enter` on <main> is a CSS animation, and Web Forms served a fresh
 * document per click — so it played on EVERY page. Here <main> belongs to the
 * layout, which mounts once and is reused across routes, so the animation only
 * ever ran on the very first load and every later page just appeared. Toggling
 * the class with a forced reflow restarts it without remounting the subtree.
 */
export function useRouteEnter(ref) {
  const { pathname } = useLocation()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.classList.remove('route-enter')
    void el.offsetWidth          // reflow, or the browser coalesces the toggle
    el.classList.add('route-enter')
  }, [pathname, ref])
}

/**
 * The page loader (#rotary-loader).
 *
 * rotary-anim.js's initLoader() hid it as soon as `document.readyState` became
 * "complete". Under Web Forms that meant the fully rendered page had ARRIVED, so
 * the loader covered the whole wait. In an SPA it means the shell script has
 * loaded while every API call is still in flight — so the loader blinked out
 * immediately and you watched an empty page fill in behind it.
 *
 * Hide it when the club context has actually resolved instead. The original's 4s
 * safety cap is kept, so a hung API can never leave the loader trapping the page.
 */
export function useLoader(ready) {
  useEffect(() => {
    const el = document.getElementById('rotary-loader')
    if (!el) return
    let hidden = false
    const hide = () => {
      if (hidden) return
      hidden = true
      el.classList.add('rotary-loader--hidden')
      el.setAttribute('aria-hidden', 'true')
    }
    // A beat after the data lands so the first paint of real content is behind it.
    const t = ready ? setTimeout(hide, 150) : setTimeout(hide, 4000)
    return () => clearTimeout(t)
  }, [ready])
}

export default useRotaryAnim
