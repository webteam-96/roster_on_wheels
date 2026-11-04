'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Footer visitor counter — one implementation, all six themes.
//
// ⚠ READ THIS BEFORE TRUSTING THE NUMBER.
//
// The ask was "count per user IP". A browser CANNOT do that: a page can't read
// its own IP, and "count each IP once" needs storage shared by every visitor.
// Checked 2026-08-18 — the live API has no counter endpoint (1075 paths in
// swagger, none for visits/hits/tracking), and this React build is static, so
// there is no server of ours in the request path.
//
// So there are two modes, chosen by ONE setting:
//
//   VisitorCountUrl BLANK  → local mode. Numbers come from localStorage and
//                            describe THIS BROWSER ONLY. Not IP-deduped, not
//                            shared between visitors, gone when they clear the
//                            cache. This is what ships today (chosen 2026-08-18).
//                            The caption says "Your visits" for exactly that
//                            reason — the label must not claim more than the
//                            data supports.
//
//   VisitorCountUrl SET    → server mode. One GET per page view; the server
//                            reads the real client IP, dedupes, and returns the
//                            site total, so the caption becomes "Visitors".
//                            Switching needs NO code change — set the env var.
//                            deploy/visits.php is that server. If it is missing
//                            or PHP is off, this falls back to local mode rather
//                            than leaving the footer blank.
//
// A THIRD knob sits on top of local mode: VisitorCountSeed is a baseline added
// to the all-time figure (the carry-over from the site this one replaced). It
// is added on read, never stored, and never applied to `today`. Setting it also
// flips the caption to "Visitors", since a seeded figure is a claim about the
// site rather than about the person reading it. It does NOT make the counter
// real: each browser still climbs from the same baseline on its own.
//
// Server contract (whatever you point it at must answer this):
//     GET  <VisitorCountUrl>?club=<clubId>
//     200  {"total": 12431, "today": 87}
// ROW's API (ClubWebsiteVisitsController): `total` = each day's distinct visitors summed, `today` = since UTC midnight.
//
// Nothing renders when there is no number — the same rule the rest of the
// footer follows (no "No data found" placeholder in a colophon).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { appSettings } from '@/site/config.js'
import { useClub } from '@/site/ClubContext.jsx'
import { countLocalVisit } from './visitorCount.js'
import { CSS, ROCKET, ICO_TODAY, ICO_TOTAL } from './visitorCountCard.jsx'

export { istDay, countLocalVisit } from './visitorCount.js'

/** Drop-in <style>; rendered by the component itself, once per page. */
export function VisitorCountStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}

/**
 * Counts this visit once per session and returns `{ total, today, live }`, or
 * null while loading / when there is nothing to show. `live` is true only in
 * server mode, where the figure really is the site's distinct-IP count.
 */
export function useVisitorCount() {
  const { clubId } = useClub()
  const [count, setCount] = useState(null)

  useEffect(() => {
    if (!clubId) return
    const url = appSettings.VisitorCountUrl
    if (!url) {
      const c = countLocalVisit(clubId)
      // The seed is applied on READ, never written to storage — otherwise
      // changing it later would compound on top of the stored figure. `today`
      // is deliberately left alone: a day that opens at 3,026 is nonsense.
      const seed = appSettings.VisitorCountSeed
      setCount(c && { ...c, total: c.total + seed, live: false, seeded: seed > 0 })
      return
    }

    // Server mode, with the local count as a safety net. If the endpoint is
    // missing or PHP is not enabled on the host, FALLING BACK beats rendering
    // nothing: a blank footer looks broken and gives no clue why, whereas the
    // local figure keeps the card intact while /visits.php?selftest=1 tells you
    // what is actually wrong.
    let live = true
    const ctl = new AbortController()
    const sep = url.includes('?') ? '&' : '?'
    const full = url + sep + 'club=' + encodeURIComponent(clubId)
    const seed = appSettings.VisitorCountSeed

    // Falling back keeps the footer intact, but it must never be SILENT: the
    // fallback looks identical to a working counter except the number is
    // per-browser, so a broken endpoint is invisible without this. Every message
    // names the endpoint and what to do next.
    const local = (why) => {
      // eslint-disable-next-line no-console
      console.warn(
        '[visitor counter] ' + why +
        '\n  endpoint: ' + full +
        '\n  Falling back to THIS BROWSER’s own count, so every visitor sees a different number.' +
        '\n  Diagnose: ' + url + '?selftest=1'
      )
      const c = countLocalVisit(clubId)
      if (live && c) setCount({ ...c, total: c.total + seed, live: false, seeded: seed > 0 })
    }

    fetch(full, { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const body = await r.text()
        if (!r.ok) return local('endpoint returned HTTP ' + r.status)
        // The single most likely production failure: the SPA fallback rewrite
        // catches /visits.php and serves index.html, so PHP never runs. It looks
        // like a 200, which is why this is checked before parsing.
        if (/^\s*</.test(body)) {
          return local('endpoint returned HTML, not JSON — the SPA rewrite is ' +
            'catching it. Exclude real files from the rewrite (skip when ' +
            'REQUEST_FILENAME is a file), or PHP is not enabled for this site.')
        }
        let d = null
        try { d = JSON.parse(body) } catch { return local('endpoint returned unparseable JSON') }
        if (d && d.error) return local('endpoint reported: ' + d.error)
        const total = Number(d && d.total)
        if (!Number.isFinite(total)) return local('endpoint sent no usable "total"')
        if (live) setCount({ total, today: Number(d.today) || 0, live: true })
      })
      .catch((e) => {
        if (e && e.name === 'AbortError') return
        local('could not reach the endpoint (' + (e && e.message) + ')')
      })
    return () => { live = false; ctl.abort() }
  }, [clubId])

  return count
}

const nf = new Intl.NumberFormat('en-US')

/** True when the visitor has asked the OS for less motion. */
function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Fires once, when `el` first scrolls into view — the trigger for both the
 * card's entrance and the count-up. Without IntersectionObserver it fires
 * immediately, so the figures are never left at zero.
 *
 * Takes the ELEMENT, not a ref object: the card is not rendered until the count
 * resolves, so an effect keyed on a ref (which never changes identity) would run
 * once against a null node and never observe anything. The caller passes a
 * callback ref, so this re-runs the moment the card actually mounts.
 */
function useInView(el) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (!el) return
    if (!('IntersectionObserver' in window)) { setInView(true); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        // `bottom <= 0` = the card is ABOVE the viewport, i.e. already scrolled
        // past. A jump straight to the page bottom (anchor link, restored scroll
        // position, or a footer taller than the screen — verdigris's is) never
        // produces an intersecting frame, and without this the card would sit at
        // opacity:0 forever.
        if (e.isIntersecting || e.boundingClientRect.bottom <= 0) {
          setInView(true); io.disconnect()
        }
      })
    }, { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [el])
  return inView
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

/**
 * A figure that counts up to `value` once `run` is true.
 *
 * Writes through a ref instead of setState: this ticks every frame for 1.4s and
 * re-rendering the whole card 84 times to change one text node is waste. The
 * initial render is the REAL number, so if JS never runs, or motion is reduced,
 * or the observer never fires, the visitor still sees the correct figure.
 *
 * ⚠ Deliberately NOT [data-count]: rotary-anim.js animates any such element with
 * its own formatter (browser-default locale), which would fight this one and
 * print 124,567 where the rest of the card says 1,24,567.
 */
function Figure({ value, run, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!run || reducedMotion()) { el.textContent = nf.format(value); return }
    let raf = 0, start = null
    const step = (ts) => {
      if (start === null) start = ts
      const p = Math.min((ts - start) / 1400, 1)
      el.textContent = nf.format(Math.round(value * easeOutCubic(p)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [run, value])
  return <span ref={ref} className={className}>{nf.format(value)}</span>
}

/**
 * The footer reading. `className` is passed through for placement only (margin
 * / alignment); everything visual comes from the theme rules above.
 */
export default function VisitorCount({ className = '' }) {
  const c = useVisitorCount()
  const [card, setCard] = useState(null)
  const inView = useInView(card)
  if (!c) return null
  // Captions follow what the figures actually describe: a seeded or server-side
  // number is about the SITE, an unseeded local one counts this browser alone.
  const site = c.live || c.seeded
  return (
    <>
      <VisitorCountStyles />
      <div className={'rv-vc-wrap ' + className}>
        <div ref={setCard} className={'rv-vc' + (inView ? ' is-in' : '')}>
          {ROCKET}
          <div className="rv-vc__stats">
            <div className="rv-vc__cell">
              <span className="rv-vc__l">{site ? "Today's visitors" : 'Today'}</span>
              <Figure value={c.today} run={inView} className="rv-vc__n rv-vc__n--today" />
              {ICO_TODAY}
            </div>
            <div className="rv-vc__rule" />
            <div className="rv-vc__cell">
              <span className="rv-vc__l">{site ? 'Total visitors' : 'Your visits'}</span>
              <Figure value={c.total} run={inView} className="rv-vc__n rv-vc__n--total" />
              {ICO_TOTAL}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
