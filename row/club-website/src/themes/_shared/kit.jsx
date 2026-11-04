'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Theme 8 family — the few UI pieces that are behaviour, not design. Each theme
// styles them through its own class names; nothing here carries a look.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from '@/site/router.js'
import './monthpick.css'
import './scope.css'
import { initials } from '@/themes/shared/rotaryPage.js'
import { refreshSoon } from './motion.js'
export { imgFallback, hideOnError, portraitFallback, isPlaceholderPhoto } from '@/themes/gold/pages/kit.jsx'

const PLACEHOLDER = /profile_pic\.png$/i

/**
 * A line of display type on ONE line at every width (the home club name): start
 * from the CSS size and shrink `boxRef`'s font until `textRef`'s ink (an inline,
 * nowrap element inside it) fits the box. Re-fits only when the box's WIDTH
 * changes (its height follows the font size, so watching it would loop).
 */
export function useOneLine(boxRef, textRef, deps) {
  useLayoutEffect(() => {
    const box = boxRef.current, text = textRef.current
    if (!box || !text) return undefined
    let raf = 0, lastW = -1
    const fit = (force) => {
      const w = box.clientWidth
      if (!force && w === lastW) return
      lastW = w
      box.style.fontSize = ''
      const need = text.getBoundingClientRect().width
      if (need > w && need > 0) {
        const max = parseFloat(getComputedStyle(box).fontSize)
        box.style.fontSize = Math.floor(max * (w / need) * 0.985 * 10) / 10 + 'px'
      }
      refreshSoon()
    }
    const run = (force) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fit(force)) }
    fit(true)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => run(false)) : null
    if (ro) ro.observe(box)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => run(true))
    return () => { cancelAnimationFrame(raf); if (ro) ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * A person's photo that turns into their initials when there is no photo, the
 * API hands the legacy grey placeholder, or the file 404s - never a broken-image
 * glyph. `className` goes on whichever element renders; the monogram also gets
 * `monoClass` so a theme can style the two differently.
 */
export function PersonPhoto({ src, name, className = '', monoClass = '', alt, ...img }) {
  const [broken, setBroken] = useState(false)
  if (!src || PLACEHOLDER.test(src) || broken) {
    return (
      <span className={(className + ' ' + monoClass).trim()} role="img" aria-label={alt !== undefined ? alt : String(name || '')}>
        <span aria-hidden="true">{initials(name || '')}</span>
      </span>
    )
  }
  return <img src={src} alt={alt !== undefined ? alt : String(name || '')} className={className} loading="lazy" decoding="async" onError={() => setBroken(true)} {...img} />
}

/** An image that simply disappears (leaving its frame's own ground) if it fails. */
export function SafeImg({ src, alt = '', className = '', ...img }) {
  const [broken, setBroken] = useState(!src)
  if (broken) return null
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setBroken(true)} {...img} />
}

/** Split plain text into paragraphs on blank lines (API descriptions keep their breaks). */
export function paragraphs(text) {
  return String(text || '').split(/\n\s*\n|\r\n\s*\r\n/).map((p) => p.trim()).filter(Boolean)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad2 = (n) => String(n).padStart(2, '0')
const Chev = ({ left }) => <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d={left ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} /></svg>

/**
 * The calendar's month title, made a way to jump to ANY month (client, 2026-10-06: "how do I see last year?").
 * Drop it inside the title's wrapper (which gets position:relative): an invisible button covers the title, so the
 * design and its animation are untouched. Clicking it opens the theme's own month picker (a year with arrows, then
 * the twelve months; the shown month filled, this month ringed) - styled per theme in monthpick.css, NOT the
 * browser's grey picker. It is portalled to <body> and fixed under the title, kept on screen, and closes on Esc /
 * outside click / a pick. Picking goes to /calendar?month=yyyy-MM, the URL the arrows use.
 */
export function MonthJump({ year, month, label }) {
  const navigate = useNavigate()
  const btn = useRef(null)
  const pop = useRef(null)
  const [open, setOpen] = useState(false)
  const [y, setY] = useState(year)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const now = new Date()
  const nowY = now.getFullYear(), nowM = now.getMonth() + 1
  const maxY = nowY + 1, minY = nowY - 15

  const place = () => {
    const b = btn.current, p = pop.current
    if (!b) return
    const r = b.getBoundingClientRect(), w = p ? p.offsetWidth : 320, h = p ? p.offsetHeight : 300
    let left = r.left + Math.min(r.width, 360) / 2 - w / 2
    left = Math.max(16, Math.min(left, window.innerWidth - w - 16))
    let top = r.bottom + 10
    if (top + h > window.innerHeight - 8 && r.top - h - 10 > 8) top = r.top - h - 10   // no room below: open above
    setPos({ top, left })
  }
  const close = (refocus) => { setOpen(false); if (refocus && btn.current) btn.current.focus({ preventScroll: true }) }
  const go = (yy, mm) => { close(false); const v = yy + '-' + pad2(mm); if (v !== year + '-' + pad2(month)) navigate('/calendar?month=' + v) }

  useLayoutEffect(() => { if (open) place() }, [open, y])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true) } }
    const onDown = (e) => { if (pop.current && !pop.current.contains(e.target) && !(btn.current && btn.current.contains(e.target))) close(false) }
    const onMove = () => place()
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    // focus the shown month (or the first) so the keyboard starts inside
    const t = setTimeout(() => { const f = pop.current && (pop.current.querySelector('.t8-mp__m[aria-current]') || pop.current.querySelector('.t8-mp__m')); if (f) f.focus({ preventScroll: true }) }, 0)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <button ref={btn} type="button" onClick={() => { setY(year); setOpen((o) => !o) }} title="Choose a month"
              aria-label={'Choose a month' + (label ? ' (showing ' + label + ')' : '')} aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', zIndex: 2 }} />
      {open ? createPortal(
        <div ref={pop} className="t8-mp" role="dialog" aria-label="Choose a month" style={{ top: pos.top, left: pos.left }}>
          <div className="t8-mp__head">
            <button type="button" className="t8-mp__step" onClick={() => setY((v) => Math.max(minY, v - 1))} disabled={y <= minY} aria-label="Previous year"><Chev left /></button>
            <p className="t8-mp__yr" aria-live="polite">{y}</p>
            <button type="button" className="t8-mp__step" onClick={() => setY((v) => Math.min(maxY, v + 1))} disabled={y >= maxY} aria-label="Next year"><Chev /></button>
          </div>
          <div className="t8-mp__grid" role="group" aria-label={'Months of ' + y}>
            {MONTHS.map((n, i) => {
              const m = i + 1
              return (
                <button key={n} type="button" className="t8-mp__m" onClick={() => go(y, m)}
                        aria-current={y === year && m === month ? 'date' : undefined} data-now={y === nowY && m === nowM ? '' : undefined}
                        disabled={y > nowY + 1 || (y === maxY && m > nowM)}>
                  <span aria-hidden="true">{n.slice(0, 3)}</span><span className="t8-mp__sr">{n} {y}</span>
                </button>
              )
            })}
          </div>
          <div className="t8-mp__foot">
            <button type="button" className="t8-mp__now" onClick={() => go(nowY, nowM)}>This month</button>
            <button type="button" className="t8-mp__close" onClick={() => close(true)}>Close</button>
          </div>
        </div>, document.body) : null}
    </>
  )
}

/** Projects page: which projects - this Rotary year's, or every year's (?all=1, so Back and shared links keep it). */
export function useProjectScope() {
  const [sp, setSp] = useSearchParams()
  const scope = sp.get('all') === '1' ? 'all' : 'year'
  const set = (v) => {
    const n = new URLSearchParams(sp)
    if (v === 'all') n.set('all', '1'); else n.delete('all')
    n.delete('page')
    setSp(n)
  }
  return [scope, set]
}

/**
 * "Current year projects / All years projects" - the switch that replaces the project count at the top of the
 * Projects page (client, 2026-10-06). Styled per theme in scope.css; while the earlier years are still arriving it
 * says so (a club can have 20 years and ~1,400 projects).
 */
export function ScopeSwitch({ scope, onChange, yearLabel, loading, done, of, className = '' }) {
  return (
    <div className={('t8-scope ' + className).trim()}>
      <div className="t8-scope__btns" role="group" aria-label="Which projects">
        <button type="button" className="t8-scope__btn" aria-pressed={scope === 'year' ? 'true' : 'false'} onClick={() => onChange('year')}>
          Current year projects
        </button>
        <button type="button" className="t8-scope__btn" aria-pressed={scope === 'all' ? 'true' : 'false'} onClick={() => onChange('all')}>
          All years projects
        </button>
      </div>
      {loading ? <p className="t8-scope__note" role="status">Loading earlier years… {done} of {of}</p> : null}
    </div>
  )
}

/**
 * Counter rows: ONE font size for every figure, the largest at which ALL of them fit their cells (client,
 * 2026-10-06: the all-years cost "₹21,64,02,43,699" ran over its neighbours). Never larger than the theme's own
 * size. Each figure is measured from a hidden copy holding its FINAL text (data-fit, else its current text), so a
 * count-up in progress does not shrink the measure. `room` < 1 leaves margin inside round / sticker shapes.
 * Re-fits on resize, on font load and when `deps` change.
 */
export function useFitNumbers(ref, numSel, cellSel, deps = [], room = 1) {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return undefined
    let raf = 0
    const fit = () => {
      const els = [...root.querySelectorAll(numSel)].filter((e) => e.getClientRects().length)
      if (!els.length) return
      els.forEach((e) => { e.style.fontSize = '' })
      let target = Infinity
      for (const el of els) {
        const cell = el.closest(cellSel) || el.parentElement
        const cs = getComputedStyle(cell)
        const avail = (cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * room
        const base = parseFloat(getComputedStyle(el).fontSize)
        const probe = el.cloneNode(true)
        const fin = el.getAttribute('data-fit')
        if (fin != null) probe.textContent = fin
        Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', left: '0', top: '0', width: 'auto', maxWidth: 'none', whiteSpace: 'nowrap', fontSize: base + 'px' })
        probe.removeAttribute('id')
        el.parentElement.appendChild(probe)
        const w = probe.getBoundingClientRect().width
        probe.remove()
        if (!w || !avail) continue
        target = Math.min(target, base * Math.min(1, avail / w))
      }
      if (!Number.isFinite(target)) return
      const px = Math.floor(target * 0.98 * 10) / 10 + 'px'
      els.forEach((e) => { e.style.fontSize = px })
    }
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit) }
    fit()
    // again once the row has settled (entrance animations, shapes picked for the final figures) - measuring only at
    // mount left a long figure at full size in its shape until something resized the window
    const t1 = setTimeout(run, 250), t2 = setTimeout(run, 1000)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null
    if (ro) ro.observe(root)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(run) : null
    if (mo) mo.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-fit', 'data-shape'] })
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run)
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); if (ro) ro.disconnect(); if (mo) mo.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
