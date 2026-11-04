'use client'
// Port of RotaryPage.Breadcrumb() + RotaryPage.EmptyState() + CurrentMenuName().
//
// These emit an HTML STRING in the C# original, so they are ported as string
// builders and injected with dangerouslySetInnerHTML — that keeps the markup
// byte-identical across all five theme branches instead of re-deriving it in
// JSX. Internal <a href="/"> links inside still route through the SPA:
// App.jsx installs a global anchor click-interceptor.
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { useMenus } from '@/site/menus.js'
import { toRoute, routeKey } from '@/site/routes.js'
import { usePageTitle } from './rotaryPage.js'

/** HttpUtility.HtmlEncode */
export function enc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * A consistent, on-brand "no data" empty state (icon medallion + title +
 * message), used wherever the API returns nothing so pages never render a blank
 * area. Markup mirrors the dignitary "Profile not available" card.
 */
export function emptyStateHtml(
  title = 'No data found',
  message = "There's nothing to show here yet. Please check back soon."
) {
  return (
    '<div class="reveal mx-auto max-w-xl rounded-2xl border border-navy/10 bg-white p-10 text-center shadow-card">' +
      '<div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-navy/5 text-navy">' +
        '<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>' +
      '</div>' +
      '<h2 class="font-heading text-xl font-bold text-navy">' + enc(title) + '</h2>' +
      '<p class="mt-3 text-sm leading-relaxed text-muted">' + enc(message) + '</p>' +
    '</div>'
  )
}

export function EmptyState({ title, message }) {
  return <div dangerouslySetInnerHTML={{ __html: emptyStateHtml(title, message) }} />
}

// ── CurrentMenuName ─────────────────────────────────────────────────────────
// Returns the menu name when its link targets the current page: same file, and
// every query param the menu link specifies (e.g. pr=CE) is present with the
// same value in the current request. Extra request params (yearId, host) are
// ignored.
function matchMenuName(linkType, linkValue, name, curKey, curQ) {
  if (!linkValue || !String(linkValue).trim() || !name || !String(name).trim()) return null
  const t = String(linkType || '').trim().toLowerCase()
  if (t === 'external' || t === 'url' || t === 'document' || t === 'html') return null

  const v = String(linkValue).trim()
  if (/^https?:\/\//i.test(v)) return null

  // Menu data still stores .aspx names (or dashboard slugs) while the app serves
  // clean routes, so compare both sides through the same normaliser.
  if (routeKey(v) !== curKey) return null

  const route = toRoute(v)
  const qi = route.indexOf('?')
  const linkQ = new URLSearchParams(qi >= 0 ? route.slice(qi + 1) : '')

  // ?pr=CE SPLITS AllProjects.aspx into its own menu target ("Club Service" / "Meetings"), so the
  // bare "Projects" link (no pr) must not claim it. Other ?pr= avenue pages (CS, IS, CP...) still
  // fall back to the bare "Projects" label when the menu has no entry of their own.
  if (!linkQ.get('pr') && (curQ.get('pr') || '').toUpperCase() === 'CE') return null

  // Every other query param the menu link specifies (e.g. pr=CE — which for a slug
  // like community_service is supplied by toRoute itself) must be present with
  // the same value. Extra request params (yearId, host) are ignored.
  for (const [k, val] of linkQ) {
    const cur = curQ.get(k)
    if (cur === null || cur.toLowerCase() !== val.toLowerCase()) return null
  }
  return name
}

/**
 * The club's own menu label for the CURRENT page, matched from the per-club menu
 * by page file + query (e.g. AllProjects.aspx?pr=CE → the club's "Meetings" /
 * "Events" menu name). Returns null when the page isn't a menu target (e.g.
 * detail pages), so callers keep their own title.
 */
export function useCurrentMenuName() {
  const menus = useMenus()
  const location = useLocation()
  if (!menus || menus.length === 0) return null

  const curKey = routeKey(location.pathname)
  const curQ = new URLSearchParams(location.search)

  for (const m of menus) {
    const hit = matchMenuName(m.linkType, m.linkValue, m.menuName, curKey, curQ)
    if (hit) return hit
    if (m.subMenus) {
      for (const s of m.subMenus) {
        const sh = matchMenuName(s.linkType, s.linkValue, s.subMenuName, curKey, curQ)
        if (sh) return sh
      }
    }
  }
  return null
}

// ── Breadcrumb ──────────────────────────────────────────────────────────────
/**
 * "2025-2026" -> "2025–26" — the period posted in the right field of the
 * verdigris register row. Returns "" when the year list did not resolve.
 */
export function ledgerPeriod(yearLabel) {
  if (!yearLabel || !String(yearLabel).trim()) return ''
  const t = String(yearLabel).trim()
  const p = t.split('-')
  if (p.length === 2) {
    const a = p[0].trim(), b = p[1].trim()
    if (a && b) return a + '–' + (b.length === 4 ? b.slice(2) : b)
  }
  return t
}

/**
 * The shared page-header band. One branch per theme; the first five are
 * byte-identical to the corresponding branch of RotaryPage.Breadcrumb():
 *   gold              — quiet cream rail (no ASP.NET counterpart; see below)
 *   handloom          — cloth band, ruled crumb trail, weft pick (no -mt-24)
 *   civic-bold        — dark near-black ground, mono crumb trail, lime slashes
 *   verdigris-ledger  — "THE COVER PLATE": plum ground, glass crumb plate
 *   warm-modern       — light dotted canvas, gold underline, gradient hairline
 *   madras-legacy     — the navy aurora band WITHOUT -mt-24 (solid static header)
 *   classic-blue      — the navy aurora band pulled up behind the floating pill
 */
export function buildBreadcrumbHtml(theme, { eyebrow, title, crumbLabel, midLabel, midHref, titleClass }) {
  const parts = []
  const t = title
  const crumb = crumbLabel || t

  if (theme === 'civic-bold') {
    const cchev = '<span class="text-gold" aria-hidden="true">/</span>'
    parts.push('<section class="relative overflow-hidden bg-canvas">')
    parts.push('<div class="civic-gridlines pointer-events-none absolute inset-0" aria-hidden="true"></div>')
    parts.push('<div class="container-x relative border-b border-navy/10 pb-9 pt-11 sm:pb-11 sm:pt-14">')
    parts.push('<nav class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">')
    parts.push('<a href="/" class="transition-colors hover:text-gold">Home</a>')
    if (midLabel) {
      parts.push(cchev)
      parts.push('<a href="' + enc(midHref) + '" class="transition-colors hover:text-gold">' + enc(midLabel) + '</a>')
    }
    parts.push(cchev)
    parts.push('<span class="break-words text-gold">' + enc(crumb) + '</span></nav>')
    if (eyebrow) parts.push('<p class="civic-eyebrow mt-6">' + enc(eyebrow) + '</p>')
    parts.push('<h1 class="mt-3 font-heading text-4xl font-extrabold uppercase leading-[0.9] tracking-tight text-ink md:text-6xl ' +
      (titleClass || '') + '">' + enc(t) + '</h1>')
    parts.push('</div>')
    parts.push('</section>')
    return parts.join('')
  }

  if (theme === 'verdigris-ledger') {
    // No data-split here: it shreds the h1 into per-char spans, which defeats
    // text-wrap:balance and can't break a long club-entered token. No eyebrow
    // on this theme either (removed by request) — the plate reads crumb -> title.
    parts.push('<section class="vl-ph">')
    parts.push('<img class="vl-ph__mark" src="/images/logo/wheel.png" alt="" aria-hidden="true" />')
    parts.push('<div class="container-x vl-ph__in">')
    parts.push('<nav aria-label="Breadcrumb"><ol class="vl-ph__crumbs">')
    parts.push('<li><a href="/">Home</a></li>')
    if (midLabel) parts.push('<li><a href="' + enc(midHref) + '">' + enc(midLabel) + '</a></li>')
    parts.push('<li><span class="vl-ph__here" aria-current="page">' + enc(crumb) + '</span></li>')
    parts.push('</ol></nav>')
    parts.push('<h1 class="vl-ph__title ' + (titleClass || '') + '">' + enc(t) + '</h1>')
    parts.push('<span class="vl-ph__rule" aria-hidden="true"></span>')
    parts.push('</div></section>')
    return parts.join('')
  }

  if (theme === 'warm-modern') {
    const wchev = '<svg class="h-3.5 w-3.5 shrink-0 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
    parts.push('<section class="relative overflow-hidden bg-dotgrid bg-canvas">')
    parts.push('<div class="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/15 blur-3xl" aria-hidden="true"></div>')
    parts.push('<div class="pointer-events-none absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-gold/10 blur-3xl" aria-hidden="true"></div>')
    parts.push('<div class="container-x relative pb-8 pt-8 sm:pb-10 sm:pt-10">')
    parts.push('<nav class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">')
    parts.push('<a href="/" class="transition-colors hover:text-gold-cta">Home</a>')
    if (midLabel) {
      parts.push(wchev)
      parts.push('<a href="' + enc(midHref) + '" class="transition-colors hover:text-gold-cta">' + enc(midLabel) + '</a>')
    }
    parts.push(wchev)
    parts.push('<span class="break-words text-gold-cta">' + enc(crumb) + '</span></nav>')
    // NO EYEBROW on warm-modern, by request: the band is the crumb trail and the
    // page title, with nothing between them ("About Us", "Our Members", "Our
    // Leadership" all restated what the crumb had just said). The h1 carries the
    // mt-6 the eyebrow used to, so the band keeps its height and rhythm — and it
    // now matches the pages that never passed an eyebrow in the first place.
    // `eyebrow` is still honoured by every OTHER theme's branch.
    parts.push('<h1 class="mt-6 font-heading text-3xl font-extrabold tracking-tight text-navy md:text-5xl ' +
      (titleClass || '') + '" data-split>' + enc(t) + '</h1>')
    parts.push('<div class="mt-5 flex items-center gap-2"><span class="h-1 w-14 rounded-full bg-gold"></span><span class="h-1 w-5 rounded-full bg-gold/40"></span><span class="h-1 w-2 rounded-full bg-gold/20"></span></div>')
    parts.push('</div>')
    parts.push('<div class="h-0.5 bg-gradient-to-r from-transparent via-gold/50 to-transparent" aria-hidden="true"></div>')
    parts.push('</section>')
    return parts.join('')
  }

  if (theme === 'gold') {
    // Gold has a SOLID two-row masthead, so the classic branch's -mt-24 (which
    // exists to slide the navy band up behind classic-blue's floating pill) hid
    // the top 6rem of this band — the h1 was clipped under the header on every
    // inner page. This branch keeps normal flow instead.
    //
    // This emits the SAME markup as <GPageHead> (src/pages/gold/kit.jsx) rather
    // than a band of its own, so the bespoke legacy pages that still render
    // <Breadcrumb> open exactly like every redesigned page. One masthead, one
    // set of rules — there is nothing gold-specific left here but the strings.
    // No data-split: it shreds the h1 into per-char spans, which fights the word
    // masks the rest of the theme animates with.
    const gsep = '<span class="gp-crumbs__sep" aria-hidden="true">/</span>'
    parts.push('<section class="gp-head">')
    parts.push('<div class="gld-x">')
    parts.push('<nav class="gp-crumbs" aria-label="Breadcrumb">')
    parts.push('<a href="/">Home</a>')
    if (midLabel) parts.push(gsep + '<a href="' + enc(midHref) + '">' + enc(midLabel) + '</a>')
    parts.push(gsep + '<span aria-current="page">' + enc(crumb) + '</span></nav>')
    parts.push('<div class="gp-head__in"><div class="gp-head__main reveal">')
    if (eyebrow) parts.push('<p class="gld-cap">' + enc(eyebrow) + '</p>')
    parts.push('<h1 class="gp-head__t ' + (titleClass || '') + '">' + enc(t) + '</h1>')
    parts.push('</div></div></div></section>')
    return parts.join('')
  }

  if (theme === 'handloom') {
    // Same fix as gold's branch, for the same reason: Handloom's masthead is
    // SOLID and static, so the default branch's -mt-24 (there to slide the navy
    // band up behind classic-blue's floating pill) would clip this h1 under it.
    // No data-split either — it shreds the h1 into per-char spans and deletes
    // any inner markup.
    //
    // titleClass is deliberately DROPPED: call sites (AllProjects, Directory)
    // append "uppercase tracking-wide", and Handloom titles follow the club's
    // own menu label casing — which <Breadcrumb> below already substitutes in.
    //
    // The weft pick is a SIBLING of .hl-x, not a child: .hl-weft takes the
    // container measure itself (handloom.css) and nesting it would double the
    // padding. It draws on scroll, in CSS — no script.
    const hsep = '<span class="hl-crumbs__sep" aria-hidden="true">/</span>'
    parts.push('<section class="hl-crumbs">')
    parts.push('<div class="hl-x">')
    parts.push('<nav aria-label="Breadcrumb">')
    parts.push('<a href="/">Home</a>')
    if (midLabel) parts.push(hsep + '<a href="' + enc(midHref) + '">' + enc(midLabel) + '</a>')
    parts.push(hsep + '<span aria-current="page">' + enc(crumb) + '</span></nav>')
    // NO EYEBROW ON THIS THEME (2026-09-07). The page header is the crumb trail
    // and the title, nothing between. The eyebrow was the third line — "About
    // Us", "Our Members", "Our Leadership", "Our Work" — and it mostly restated
    // the crumb directly above it. `eyebrow` is still passed by every call site
    // and still used by the other six branches; it is only dropped here.
    // The h1 already carries a 24px margin-top of its own, so removing the line
    // above it needs no spacing change.
    parts.push('<h1 class="reveal">' + enc(t) + '</h1>')
    parts.push('</div>')
    parts.push('<div class="hl-weft" data-hl-weft aria-hidden="true">' +
      '<i class="hl-weft__pick" style="--i:0"></i>' +
      '<i class="hl-weft__thread" style="--i:1"></i></div>')
    parts.push('</section>')
    return parts.join('')
  }

  const chevron = '<svg class="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
  // -mt-24 pulls the navy band up behind the transparent floating pill header
  // (header pt-4 + pill h-20 = 6rem = mt-24). The madras-legacy shell has a
  // SOLID static header (no floating pill), so there the band keeps normal flow.
  const madras = theme === 'madras-legacy'
  parts.push(madras
    ? '<section class="relative overflow-hidden bg-gradient-to-br from-navy-deep via-navy to-navy-deep text-white">'
    : '<section class="relative -mt-24 overflow-hidden bg-gradient-to-br from-navy-deep via-navy to-navy-deep text-white">')
  parts.push('<div class="aurora opacity-40"><span class="aurora-band aurora-band-1"></span><span class="aurora-band aurora-band-2"></span><span class="aurora-band aurora-band-3"></span></div>')
  parts.push('<div class="pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2 opacity-[0.07]"><img src="/images/logo/wheel.png" alt="" class="breadcrumb-wheel h-48 w-48" /></div>')
  parts.push(madras
    ? '<div class="container-x relative pt-10 pb-5 sm:pb-6">'
    : '<div class="container-x relative pt-28 pb-5 sm:pt-32 sm:pb-6">')
  if (eyebrow) parts.push('<p class="label-eyebrow shiny-text mb-1.5">' + enc(eyebrow) + '</p>')
  parts.push('<h1 class="font-heading text-2xl font-extrabold tracking-tight md:text-[2.1rem] md:leading-tight ' +
    (titleClass || '') + '" data-split>' + enc(t) + '</h1>')
  // Under madras the anchors need an explicit color: the shell's Bootstrap
  // (loaded after rotary-design.css) paints bare <a> link-blue.
  const crumbLink = madras ? 'text-white/70 transition-colors hover:text-gold' : 'transition-colors hover:text-gold'
  parts.push('<nav class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/70">')
  parts.push('<a href="/" class="' + crumbLink + '">Home</a>')
  if (midLabel) {
    parts.push(chevron)
    parts.push('<a href="' + enc(midHref) + '" class="' + crumbLink + '">' + enc(midLabel) + '</a>')
  }
  parts.push(chevron)
  parts.push('<span class="break-words font-semibold text-white">' + enc(crumb) + '</span>')
  parts.push('</nav></div></section>')
  return parts.join('')
}

/**
 * The breadcrumb band. Prefers the club's own menu label for this page, so the
 * title matches exactly what the user clicked in the nav (e.g. "Meetings"
 * instead of the hardcoded "Club Services"), and also becomes the page title.
 */
/**
 * @param {{ eyebrow?: string, title?: string, crumbLabel?: string, midLabel?: string, midHref?: string, titleClass?: string }} props
 */
export default function Breadcrumb({ eyebrow, title, crumbLabel, midLabel, midHref, titleClass }) {
  const { theme } = useTheme()
  const menuName = useCurrentMenuName()

  let t = title
  let crumb = crumbLabel
  if (menuName && menuName.trim()) {
    if (!crumb || crumb === title) crumb = menuName
    t = menuName
  }
  usePageTitle(t)

  const html = buildBreadcrumbHtml(theme, {
    eyebrow, title: t, crumbLabel: crumb, midLabel, midHref, titleClass,
  })
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

/** RotaryPage.Club — re-exported so pages can pull everything from one place. */
export { useClub }
