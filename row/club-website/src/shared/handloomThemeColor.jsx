// ─────────────────────────────────────────────────────────────────────────────
// Handloom theme colour — a PERSONAL preference, per browser (asked for
// 2026-09-18: "colour save per user or per browser"). Like a light/dark toggle:
// every visitor sees the gear, picks a colour, and THEIR browser remembers it
// in localStorage. Nobody else's view changes. There is no server, no key, no
// gate — the earlier server store (deploy/theme-color.php, ?ck= key) is gone.
//
// ONE instance, mounted by SiteHandloom.jsx as a sibling of <main>; it holds the
// state. Its TWO triggers are portaled into slots the shell renders in its
// markup — one right of Admin login in the masthead, one beside the year select
// in the sticky shuttle bar — and the panel drops down under whichever trigger
// opened it. Portals, not two instances: the two buttons must agree on what is
// open, and the colour must be applied once.
//
// The pick is stored per club id, not per origin: on the dev host one origin
// serves whichever club the override points at, and a visitor's pick for one
// club must not leak onto another. In production origin and club coincide.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useClub } from '../context/ClubProvider.jsx'
import { HANDLOOM_COLORS, DEFAULT_GREEN, findHandloomColor, applyHandloomColor } from '../theme/handloomColors.js'

const storeKey = (clubId) => 'hl_color_' + clubId
const SLOTS = ['mast', 'shuttle']

function load(clubId) {
  try { return localStorage.getItem(storeKey(clubId)) } catch { return null }   // private mode: nothing saved
}
function save(clubId, color) {
  try { color ? localStorage.setItem(storeKey(clubId), color) : localStorage.removeItem(storeKey(clubId)) } catch { /* private mode: applies for this page view only */ }
}

// THE TRIGGERS are the style-switcher gear (asked for 2026-09-16: "the
// existing design, gear icon with rotation animation"), a square in the
// masthead's control row — 42px like the year select and Admin login, filled
// with the live colour, the gear turning slowly (off under reduced motion), ×
// while open — and a 32px twin in the sticky shuttle bar, cut like the bar's
// own compact year select. THE PANEL is a dropdown under whichever trigger
// opened it: round swatches, the active one ticked.
// Deliberate departure from the house radius law, by request: circles.
// The slot's z-index is the masthead's own layer value because .hl-nav__list
// (the gooey nav) sits at z-index:3 and would otherwise paint over the panel.
// The panel's text rules are scoped ABOVE the theme's .hl-inked rules: the
// shuttle bar is inked, and its headings are cloth — white on the white panel.
const CSS = `
.hl-tc-slot{position:relative;z-index:var(--hl-lyr-mast);display:inline-flex;align-items:center}
.hl-tc-slot:empty{display:none}
html[data-theme="handloom"] .hl-tc__btn{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;padding:0;background:var(--hl-green);border:var(--hl-rule) solid var(--hl-green);border-radius:var(--hl-r);color:var(--hl-cloth);cursor:pointer;transition:background var(--hl-d-hover) var(--hl-e-ui),border-color var(--hl-d-hover) var(--hl-e-ui)}
html[data-theme="handloom"] .hl-tc__btn:hover,html[data-theme="handloom"] .hl-tc__btn[aria-expanded="true"]{background:var(--hl-green-deep);border-color:var(--hl-green-deep)}
html[data-theme="handloom"] .hl-tc__btn:focus-visible{outline:var(--hl-focus-w) solid var(--hl-focus);outline-offset:var(--hl-focus-off)}
html[data-theme="handloom"] .hl-tc__btn--shuttle{width:32px;height:32px;background:transparent;border-color:var(--hl-thread-42);color:var(--hl-cloth)}
html[data-theme="handloom"] .hl-tc__btn--shuttle:hover,html[data-theme="handloom"] .hl-tc__btn--shuttle[aria-expanded="true"]{background:transparent;border-color:var(--hl-turmeric)}
.hl-tc__gear{width:22px;height:22px;animation:hlTcSpin 8s linear infinite}
.hl-tc__btn--shuttle .hl-tc__gear{width:18px;height:18px}
.hl-tc__x{display:none;width:20px;height:20px}
.hl-tc__btn[aria-expanded="true"] .hl-tc__gear{display:none}
.hl-tc__btn[aria-expanded="true"] .hl-tc__x{display:block}
@keyframes hlTcSpin{to{rotate:360deg}}
.hl-tc__panel{position:absolute;right:0;top:calc(100% + 8px);width:min(280px,calc(100vw - 40px));max-height:calc(100vh - 120px);overflow-y:auto;padding:18px 18px 16px;background:var(--hl-cloth);border:var(--hl-rule) solid var(--hl-thread);border-top:var(--hl-rule-2) solid var(--hl-green);font-family:var(--hl-ff-body);text-transform:none;letter-spacing:0;text-align:left;cursor:default}
html[data-theme="handloom"] .hl-tc__panel .hl-tc__title{margin:0;font:600 var(--hl-fs-dm)/1.2 var(--hl-ff-display);letter-spacing:var(--hl-ls-dm);color:var(--hl-green)}
html[data-theme="handloom"] .hl-tc__panel .hl-tc__sub{margin:4px 0 14px;font:400 var(--hl-fs-body-s)/1.45 var(--hl-ff-body);color:var(--hl-muted)}
.hl-tc__grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px 6px;margin:0;padding:0;list-style:none}
.hl-tc__sw{position:relative;display:block;width:34px;height:34px;margin:0 auto;padding:0;border:0;border-radius:var(--hl-r-round);cursor:pointer;color:#fff;transition:scale var(--hl-d-snap) var(--hl-e-ui)}
.hl-tc__sw svg{position:absolute;inset:0;margin:auto;width:16px;height:16px;display:none}
.hl-tc__sw[aria-pressed="true"]{outline:2px solid var(--hl-ink);outline-offset:2px}
.hl-tc__sw[aria-pressed="true"] svg{display:block}
.hl-tc__sw:hover{scale:1.1}
.hl-tc__sw:focus-visible{outline:var(--hl-focus-w) solid var(--hl-focus);outline-offset:var(--hl-focus-off)}
.hl-tc__reset{margin-top:16px;width:100%;justify-content:center}
@media (prefers-reduced-motion:reduce){.hl-tc__sw:hover{scale:1}.hl-tc__gear{animation:none}}
@media print{.hl-tc-slot{display:none}}
`

// Feather "settings" (MIT) — the cog every style switcher wears.
const GEAR = (
  <svg className="hl-tc__gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
const CLOSE = (
  <svg className="hl-tc__x" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
)
const TICK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
       strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
)

export default function HandloomThemeColor() {
  const { clubId } = useClub()
  const [color, setColor] = useState(null)
  const [open, setOpen] = useState(null)      // which trigger's panel: 'mast' | 'shuttle' | null
  const [slots, setSlots] = useState(null)    // { mast: Element, shuttle: Element }

  // This browser's saved pick for this club, applied on arrival. Leaving
  // Handloom (a theme switch) takes the colour along.
  useEffect(() => {
    if (!clubId) return
    const saved = load(clubId)
    setColor(applyHandloomColor(saved) ? saved : null)
    return () => applyHandloomColor(null)
  }, [clubId])

  // The slots are in the shell's own markup, committed in the same render as
  // this component, so they exist by the time effects run.
  useEffect(() => {
    const found = {}
    for (const s of SLOTS) found[s] = document.querySelector('[data-hl-tc-slot="' + s + '"]')
    setSlots(found)
  }, [])

  // Closing hands focus back to the trigger that opened the panel - the
  // focused swatch is unmounted with the panel, and without this focus fell to
  // <body>. Not on an outside click: the reader has moved on.
  const close = (refocus) => {
    const where = open
    setOpen(null)
    if (refocus && where) {
      const btn = document.querySelector('[data-hl-tc-slot="' + where + '"] .hl-tc__btn')
      if (btn) btn.focus()
    }
  }

  // Escape and any click outside the open trigger+panel close it.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') close(true) }
    const onClick = (e) => { if (!(e.target.closest && e.target.closest('[data-hl-tc-slot]'))) setOpen(null) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick) }
  }, [open])

  const pick = (next) => {
    applyHandloomColor(next)
    save(clubId, next)
    setColor(next)
    close(true)     // the recoloured page IS the confirmation; the panel closes
  }

  if (!slots) return null
  const current = findHandloomColor(color) || DEFAULT_GREEN

  const panel = (
    <div className="hl-tc__panel" id="hl-tc-panel" role="group" aria-label="Theme colour">
      <h2 className="hl-tc__title">Theme colour</h2>
      <p className="hl-tc__sub">Your pick for this site, on this device. Current: {current.name}.</p>
      <ul className="hl-tc__grid">
        {HANDLOOM_COLORS.map((c) => {
          const mine = c.key === color
          return (
            <li key={c.key}>
              <button type="button" className="hl-tc__sw" aria-pressed={mine}
                      aria-label={c.name} title={c.name}
                      style={{ backgroundColor: c.green }}
                      onClick={() => !mine && pick(c.key)}>
                {TICK}
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className="hl-btn hl-btn--outline hl-btn--xs hl-tc__reset" title={DEFAULT_GREEN.name}
              disabled={color === null} onClick={() => pick(null)}>
        Reset to default green
      </button>
    </div>
  )

  const trigger = (where) => (
    <>
      <button type="button" className={'hl-tc__btn hl-tc__btn--' + where} aria-expanded={open === where}
              aria-controls={open === where ? 'hl-tc-panel' : undefined} title="Change theme colour"
              aria-label={open === where ? 'Close theme colour' : 'Change theme colour'}
              onClick={() => setOpen((o) => (o === where ? null : where))}>
        {GEAR}{CLOSE}
      </button>
      {open === where ? panel : null}
    </>
  )

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {SLOTS.map((s) => (slots[s] ? createPortal(trigger(s), slots[s], s) : null))}
    </>
  )
}
