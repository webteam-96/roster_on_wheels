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
// `total` = distinct IPs ever, `today` = distinct IPs since IST midnight.
//
// Nothing renders when there is no number — the same rule the rest of the
// footer follows (no "No data found" placeholder in a colophon).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import appSettings from '../config.js'
import { useClub } from '../context/ClubProvider.jsx'
import { countLocalVisit } from './visitorCount.js'
import { CSS, ROCKET, ICO_TODAY, ICO_TOTAL } from './visitorCountCard.jsx'

export { istDay, countLocalVisit } from './visitorCount.js'

/** Drop-in <style>; rendered by the component itself, once per page. */
export function VisitorCountStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}

/** The carry-over for THIS club only (VisitorCountSeed "1=3026;..."; a bare number = every club). */
export function seedFor(clubId, raw = appSettings.VisitorCountSeed) {
  const v = String(raw || '').trim()
  if (/^\d+$/.test(v)) return Number(v)
  const hit = v.split(';').map((kv) => kv.split('=')).find(([k]) => Number(k) === Number(clubId))
  return (hit && Number(hit[1])) || 0
}

/** The club's <label>.rotaryindia.org endpoint, when this page is on some OTHER
 *  host (a custom domain) - null otherwise, or when the url is not site-relative. */
// ROW: no fallback. The counter is the ROW API's absolute URL (one store for every host), and the
// RIZones <label>.rotaryindia.org hosts are not ours, so visitor ids must never be sent there.
export function altEndpoint() {
  return null
}

/** A random id for this browser (localStorage), sent only on the cross-site fallback. */
function browserId() {
  const K = 'rv_vid'
  try {
    let v = window.localStorage.getItem(K)
    if (!/^[a-f0-9]{32}$/.test(v || '')) {
      const b = new Uint8Array(16); window.crypto.getRandomValues(b)
      v = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
      window.localStorage.setItem(K, v)
    }
    return v
  } catch { return '' }
}

/**
 * Counts this visit once per session and returns `{ total, today, live }`, or
 * null while loading / when there is nothing to show. `live` is true only in
 * server mode, where the figure really is the site's distinct-IP count.
 */
export function useVisitorCount() {
  const { clubId, tenant } = useClub()
  const [count, setCount] = useState(null)

  useEffect(() => {
    if (!clubId) return
    const url = appSettings.VisitorCountUrl
    if (!url) {
      const c = countLocalVisit(clubId)
      // The seed is applied on READ, never written to storage — otherwise
      // changing it later would compound on top of the stored figure. `today`
      // is deliberately left alone: a day that opens at 3,026 is nonsense.
      const seed = seedFor(clubId)
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
    const seed = seedFor(clubId)

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

    // One endpoint -> { total, today }, or a rejection naming what was wrong.
    const ask = (u) => fetch(u, { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const body = await r.text()
        if (!r.ok) throw new Error('endpoint returned HTTP ' + r.status)
        // The single most likely production failure: the SPA fallback rewrite
        // catches /visits.php and serves index.html, so PHP never runs. It looks
        // like a 200, which is why this is checked before parsing.
        if (/^\s*</.test(body)) {
          throw new Error('endpoint returned HTML, not JSON — the SPA rewrite is ' +
            'catching it. Exclude real files from the rewrite (skip when ' +
            'REQUEST_FILENAME is a file), or PHP is not enabled for this site.')
        }
        let d = null
        try { d = JSON.parse(body) } catch { throw new Error('endpoint returned unparseable JSON') }
        if (d && d.error) throw new Error('endpoint reported: ' + d.error)
        const total = Number(d && d.total)
        if (!Number.isFinite(total)) throw new Error('endpoint sent no usable "total"')
        return { total, today: Number(d.today) || 0 }
      })

    // A custom domain whose vhost can't run PHP (rotarycolombowest.org answered
    // 500, 2026-11-02) still gets the ONE shared count: every vhost serves the same
    // docroot and store, so the club's own <label>.rotaryindia.org answers for it.
    // Cross-site, so no cookie - the browser's own id rides along as ?vid=.
    const alt = altEndpoint(tenant, url)
    ask(full)
      .catch((e) => {
        if (e && e.name === 'AbortError') throw e
        const vid = alt ? browserId() : ''
        if (!vid) throw e     // no id to send = every page view a "new" visitor; stay local
        return ask(alt + sep + 'club=' + encodeURIComponent(clubId) + '&vid=' + vid)
          .catch((e2) => { throw new Error(e.message + '; fallback ' + alt + ': ' + (e2 && e2.message)) })
      })
      .then((c) => { if (live) setCount({ ...c, live: true }) })
      .catch((e) => {
        if (e && e.name === 'AbortError') return
        local(e && e.message ? e.message : 'could not reach the endpoint')
      })
    return () => { live = false; ctl.abort() }
  }, [clubId, tenant])

  return count
}

const nf = new Intl.NumberFormat()   // visitor's own locale: ROW clubs are not only Indian

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
