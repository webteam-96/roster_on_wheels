// ─────────────────────────────────────────────────────────────────────────────
// The Handloom theme colour palette — the 12 hues a club may pick from.
//
// Handloom's whole brand colour is three tokens in handloom.css
// (--hl-green / --hl-green-deep / --hl-green-mid; --hl-madder aliases to them),
// so recolouring a site is rewriting those four custom properties inline on
// <html>. Each entry carries the same three roles the default green has:
//   green — headings, band titles, CTA fill        (>= 7:1 on the white cloth)
//   deep  — .hl-inked bands, footer, drawer        (cloth-on-dark text >= 7:1)
//   mid   — inline links in raw admin HTML         (>= 4.5:1 on white)
// test-theme-color.mjs asserts those floors, so a hex change that breaks
// contrast fails the check instead of shipping.
//
// The DEFAULT green is deliberately NOT in this list: "no selection" renders it,
// and "Reset" is simply forgetting the pick.
//
// The pick is a PERSONAL preference kept in the visitor's own browser
// (2026-09-18) — no server, so this list is the only copy.
//
// A FIFTH FLOOR (2026-09-17, release review): --hl-turmeric #D08B12 is small
// text on every .hl-inked surface (eyebrows, counter captions, footer heads) and
// needs 4.5:1 on `deep`. Teal, rust, bronze and olive shipped at 4.07-4.39 and
// were darkened by the smallest step that clears it; the test asserts it now.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_GREEN = { key: null, name: 'Default green', green: '#1F5138', deep: '#12332A', mid: '#2A6B49' }

export const HANDLOOM_COLORS = [
  { key: 'teal',     name: 'Teal',     green: '#145C5C', deep: '#0C3838', mid: '#1F7A7A' },
  { key: 'navy',     name: 'Navy',     green: '#1E3A8A', deep: '#142559', mid: '#2B4FB3' },
  { key: 'indigo',   name: 'Indigo',   green: '#3B2F8F', deep: '#251D5C', mid: '#4F42B5' },
  { key: 'plum',     name: 'Plum',     green: '#6B2A5B', deep: '#431A3A', mid: '#8A3A77' },
  { key: 'maroon',   name: 'Maroon',   green: '#7A1F2E', deep: '#4E141E', mid: '#9C2F42' },
  { key: 'rust',     name: 'Rust',     green: '#8A3A12', deep: '#54240B', mid: '#B04E1C' },
  { key: 'bronze',   name: 'Bronze',   green: '#6B4E0E', deep: '#402F09', mid: '#866317' },
  { key: 'olive',    name: 'Olive',    green: '#4F5E1A', deep: '#2C340E', mid: '#667A26' },
  { key: 'slate',    name: 'Slate',    green: '#2F4A6B', deep: '#1E3046', mid: '#3F6390' },
  { key: 'charcoal', name: 'Charcoal', green: '#333B3F', deep: '#1F2528', mid: '#4A555B' },
  { key: 'crimson',  name: 'Crimson',  green: '#8B1A38', deep: '#5A1024', mid: '#B02A4C' },
  { key: 'petrol',   name: 'Petrol',   green: '#0F4C6B', deep: '#0A3145', mid: '#1A678F' },
]

const TOKENS = ['--hl-green', '--hl-green-deep', '--hl-green-mid', '--hl-focus']

export function findHandloomColor(key) {
  return HANDLOOM_COLORS.find((c) => c.key === key) || null
}

/**
 * Put the site in `key`'s colour, or back to the default green for null /
 * unknown. Inline on <html> beats the html[data-theme="handloom"] rule, and
 * every dependent rule reads the tokens through var(), so nothing else moves.
 * --hl-focus follows on purpose: the ring must match the brand it sits on.
 * `root` is injectable so the check can run without a DOM.
 */
export function applyHandloomColor(key, root = document.documentElement) {
  const c = findHandloomColor(key)
  if (!c) { TOKENS.forEach((t) => root.style.removeProperty(t)); return null }
  root.style.setProperty('--hl-green', c.green)
  root.style.setProperty('--hl-green-deep', c.deep)
  root.style.setProperty('--hl-green-mid', c.mid)
  root.style.setProperty('--hl-focus', c.green)
  return c
}
