'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Theme 8 family — SPA-safe scroll motion (GSAP + ScrollTrigger + SplitText +
// Lenis), written once so six themes don't each get the lifecycle wrong.
//
// The samples these themes come from were single documents: set up once, never
// torn down. Here the shell mounts once and pages swap underneath it, data
// arrives after first paint, and React StrictMode runs every effect twice in
// development. So:
//   - every ScrollTrigger/tween a page makes lives in a gsap.context and is
//     reverted when the page unmounts or its data changes      -> useScene()
//   - smooth scroll is ONE Lenis instance owned by the shell, reset to the top
//     on every route                                              -> useSmoothScroll()
//   - positions are re-measured once late content/images land  -> refreshSoon(),
//                                                                  useRefreshOnImages()
//   - reduced motion: setup code never runs, so nothing is ever hidden
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect } from 'react'
import { useLocation } from '@/site/router.js'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

gsap.registerPlugin(ScrollTrigger, SplitText)
ScrollTrigger.config({ ignoreMobileResize: true })

export { gsap, ScrollTrigger, SplitText }

export const MOTION_OK = '(prefers-reduced-motion: no-preference)'
export const FINE_POINTER = '(hover: hover) and (pointer: fine)'
export const WIDE = '(min-width: 900px)'
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ── smooth scroll ────────────────────────────────────────────────────────────
let lenis = null
let tick = null
/** The shell's Lenis instance, or null (touch, reduced motion, not mounted). */
export const getLenis = () => lenis

/** Scroll to a y position through Lenis when it runs, natively otherwise; keeps pins in sync. */
export function scrollToY(y, immediate = false) {
  if (lenis) lenis.scrollTo(y, { immediate, force: true })
  else { window.scrollTo({ top: y, behavior: immediate ? 'auto' : 'smooth' }); ScrollTrigger.update() }
}

/**
 * Shell-level (call once in Site.jsx). Lenis on fine-pointer desktops with
 * motion allowed, driven by the GSAP ticker so pins and scrubs never lag the
 * scroll. Every route starts at the top: App's window.scrollTo alone loses to
 * a glide still in flight.
 */
export function useSmoothScroll() {
  const { pathname } = useLocation()

  useEffect(() => {
    const fine = window.matchMedia(FINE_POINTER)
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
    const start = () => {
      if (lenis || !fine.matches || calm.matches) return
      lenis = new Lenis({ autoRaf: false, lerp: 0.1 })
      lenis.on('scroll', ScrollTrigger.update)
      tick = (t) => { if (lenis) lenis.raf(t * 1000) }
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
    }
    const stop = () => {
      if (!lenis) return
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      lenis.destroy()
      lenis = null
    }
    const sync = () => ((fine.matches && !calm.matches) ? start() : stop())
    sync()
    fine.addEventListener('change', sync)
    calm.addEventListener('change', sync)
    return () => {
      fine.removeEventListener('change', sync)
      calm.removeEventListener('change', sync)
      stop()
    }
  }, [])

  useLayoutEffect(() => {
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true })
    // touch (no Lenis): to the top through ScrollTrigger's own scroll cache. A refresh queued while the last page
    // scrolled runs at scrollEnd - often the same frame as a tap - and read the old position from that cache
    // before the browser's scroll event, so the new page opened part-way down (2026-10-07 QA)
    else ScrollTrigger.getScrollFunc(window)(0)
  }, [pathname])
}

/** Pause/resume smooth scroll (e.g. while a full-screen menu or dialog is open). */
export function lockScroll(locked) {
  if (!lenis) return
  if (locked) lenis.stop(); else lenis.start()
}

// ── scenes ───────────────────────────────────────────────────────────────────
/**
 * All of a page's (or section's) motion. `setup(conditions, ctx)` runs inside a
 * gsap.matchMedia scoped to `scope` (so selector strings only match inside it)
 * and ONLY when motion is allowed. conditions = { motion, wide, fine }.
 * Everything it creates is reverted on unmount and whenever `deps` change, so
 * pass the loaded data in deps: the scene then builds against the real DOM.
 * `setup` may return a cleanup function. Never set a hidden start state in CSS:
 * with reduced motion setup never runs and the content must already be visible.
 */
export function useScene(scope, setup, deps = []) {
  useLayoutEffect(() => {
    const el = scope && scope.current
    if (!el) return undefined
    const mm = gsap.matchMedia(el)
    mm.add({ motion: MOTION_OK, wide: WIDE, fine: FINE_POINTER }, (ctx) => {
      if (!ctx.conditions.motion) return undefined
      return setup(ctx.conditions, ctx)
    })
    refreshSoon()
    return () => mm.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Run `fn` inside `ctx` once web fonts are ready (SplitText must measure real glyphs). */
export function afterFonts(ctx, fn) {
  let alive = true
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
  ready.then(() => { if (alive) ctx.add(fn) })
  return () => { alive = false }
}

let refreshTimer = null
/** Debounced ScrollTrigger.refresh() - call after content, images or fonts change layout. */
export function refreshSoon(delay = 120) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => ScrollTrigger.refresh(), delay)
}

/** Re-measure once the images inside `scope` load (API photos arrive late and change heights). */
export function useRefreshOnImages(scope, deps = []) {
  useEffect(() => {
    const el = scope && scope.current
    if (!el) return undefined
    const imgs = [...el.querySelectorAll('img')].filter((i) => !i.complete)
    // not refreshSoon itself as the listener: it would get the event as its delay (NaN -> 0 ms), an
    // immediate refresh per photo instead of one debounced refresh once they have landed
    const on = () => refreshSoon()
    imgs.forEach((i) => { i.addEventListener('load', on); i.addEventListener('error', on) })
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(on)
    return () => imgs.forEach((i) => { i.removeEventListener('load', on); i.removeEventListener('error', on) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
