'use client'
// Port of the view helpers on Faster_ClubWebsite/RotaryPage.cs, used throughout
// the pages: Media(), WithYear(), ExternalUrl(), Initials(), AvenueLabel/Color.
import { useEffect } from 'react'
import { mediaUrl, avenueFromModuleKey } from '@/site/media.js'
import { appSettings } from '@/site/config.js'

/** API base URL for client scripts that call the API directly (it is CORS-enabled). */
export const apiBase = appSettings.ApiBaseUrl

/** Absolutise an API-relative media path. */
export const media = mediaUrl

/**
 * Append the selected yearId to a link so a YEAR-SCOPED detail page (ProjectDetail,
 * diginitary) opens in the SAME Rotary year the user is viewing. The year is
 * intentionally NOT persisted across plain navigation, so a link INTO a year-scoped
 * detail must carry it — else a project/officer from an older year 404s.
 */
export function withYear(url, selectedYearId) {
  const s = url === null || url === undefined ? '' : String(url)
  if (selectedYearId === null || selectedYearId === undefined) return s
  return s + (s.includes('?') ? '&' : '?') + 'yearId=' + selectedYearId
}

/**
 * Normalise an external link so it opens correctly in a new tab. Admin data often
 * stores bare hosts like "www.google.com" with no scheme, which the browser would
 * treat as a relative path.
 */
export function externalUrl(url) {
  if (!url || !String(url).trim()) return ''
  const u = String(url).trim()
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('//')) return 'https:' + u
  return 'https://' + u
}

/** Ships in the build (also the favicon and og.php's last-resort preview image). */
export const WHEEL_SRC = '/images/logo/wheel.png'

/**
 * onError for a PROJECT or EVENT picture.
 *
 * civic-bold shows the Rotary wheel on white; every other theme keeps the
 * behaviour it has today (hide the broken image and let the container's own
 * colour show). The theme is read from <html data-theme>, which ThemeProvider
 * sets, so no call site has to thread a flag down to its images.
 *
 * Covers BOTH cases the request named — a project with no image uploaded, and
 * an image whose URL 404s — because an empty src fires `error` just as a broken
 * one does.
 *
 * `onerror = null` first: without it, a wheel that itself failed to load would
 * re-enter this handler forever.
 */
export function wheelFallback(e) {
  const img = e && e.currentTarget ? e.currentTarget : e
  if (!img) return
  img.onerror = null
  const theme = typeof document === 'undefined'
    ? '' : document.documentElement.getAttribute('data-theme')
  if (theme !== 'civic-bold') {
    img.style.visibility = 'hidden'
    return
  }
  img.src = WHEEL_SRC
  // Marks this as a PLACEHOLDER wheel, not one of the real wheel logos in the
  // header and footer — so it can be told apart when styling or testing.
  img.setAttribute('data-wheel-fallback', '')
  img.style.visibility = ''
  img.style.objectFit = 'contain'
  img.style.background = '#fff'
  // The wheel is a logo, not a photograph: inset it so it reads as a placeholder
  // mark rather than a picture cropped to the box.
  img.style.padding = '14%'
}

/**
 * Make dashboard rich text WRAPPABLE, by turning non-breaking spaces into
 * ordinary ones.
 *
 * The dashboard's editor is pasted into from Word and PDFs, and that paste
 * joins words with &nbsp; instead of spaces. A non-breaking space never wraps,
 * so a whole sentence becomes ONE token as far as the browser is concerned —
 * club 959's About text is 148 nbsp's forming unbreakable runs of 319, 280 and
 * 135 characters. What the reader then sees depends on the container:
 *
 *   with `break-words`  → the run is chopped mid-WORD at whatever character
 *                         hits the edge ("…was charte" / "red in 1936")
 *   without it          → the run overflows and the whole page scrolls sideways
 *
 * Neither is acceptable, and no CSS fixes it, because the browser is behaving
 * correctly for the markup it was given. The text has to be repaired instead.
 *
 * Covers the entity spellings AND the raw characters: U+00A0 (nbsp), U+202F
 * (narrow nbsp) and U+2007 (figure space) are all non-breaking.
 *
 * Related: [[horizontal-scroll-guard]] — the same paste habit is what forced
 * the site-wide overflow-x guard, and what buildBioHtml() already worked around
 * for dignitary bios before this was shared.
 */
export function wrappableHtml(html) {
  if (html === null || html === undefined) return ''
  return String(html)
    .replace(/[   ]/g, ' ')
    .replace(/&nbsp;|&NBSP;|&#160;|&#xA0;|&#xa0;/g, ' ')
}

/** Up-to-two-letter initials from a name, for avatar fallbacks. */
export function initials(name) {
  const s = name === null || name === undefined ? '' : String(name).trim()
  if (!s) return '?'
  const parts = s.split(/[\s.,]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/** Map an API module key to the legacy avenue code. */
export const avenueCode = avenueFromModuleKey

/** Human label for an avenue, from a module key. */
export function avenueLabel(moduleKey) {
  switch (avenueFromModuleKey(moduleKey)) {
    case 'CP': return 'Community Service'
    case 'CS': return 'Club Service'
    case 'VS': return 'Vocational Service'
    case 'NGS': return 'New Generation Service'
    case 'IS': return 'International Service'
    case 'PII': return 'Public Image Initiative'
    case 'CE': return 'Club Events'
    default: return moduleKey === null || moduleKey === undefined ? '' : String(moduleKey)
  }
}

/** Tailwind badge color class for an avenue. */
export function avenueColor(moduleKey) {
  switch (avenueFromModuleKey(moduleKey)) {
    case 'CP': return 'bg-blue-500'
    case 'CS': return 'bg-emerald-500'
    case 'VS': return 'bg-amber-500'
    case 'NGS': return 'bg-fuchsia-500'
    case 'IS': return 'bg-violet-500'
    case 'PII': return 'bg-rose-500'
    case 'CE': return 'bg-cyan-500'
    default: return 'bg-navy'
  }
}

/** The document title for this page (the server sets it first through route metadata). */
export function usePageTitle(title) {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
}

/**
 * THE PROJECT PICTURE BOX — 16:9, the shape club photographs actually are.
 *
 * An INLINE STYLE on purpose. There is no Tailwind build in this app (the
 * compiled sheets are copied verbatim), so `aspect-video` and `aspect-[16/9]`
 * do not exist in any of them and adding the class would style nothing.
 *
 * It replaces the fixed heights these cards used to carry (h-44 / h-52 / h-40 /
 * h-[300px]). A fixed height with a fluid width gives the box whatever aspect
 * its grid column happens to be — measured 435x176, i.e. 2.47:1 — so a 16:9
 * photograph could never fill it and sat with 61px of dead ground down each
 * side. Paired with `bg-white object-contain` on the <img>, a landscape photo
 * now fills the box exactly and nothing is ever cropped.
 */
export const PHOTO_BOX = { aspectRatio: '16 / 9' }
