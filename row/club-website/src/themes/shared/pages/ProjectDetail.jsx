'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Port of ProjectDetail.aspx + ProjectDetail.aspx.cs — one project's detail page
// (?pid=), its photo gallery + lightbox, the share row, and the "Project
// Updates" (child project) list with its popup.
//
// TWO FORCED DIFFERENCES, both documented at their site below:
//   1. ProjectHierarchy.GetChildren() — the C# reads parent_project_id straight
//      from MySQL because the deployed API returned no Children. A browser
//      cannot open a MySQL socket, so only the API's `children` (plus the
//      LOCAL-only ?demoChild=1 preview) survive here.
//   2. The child popup + lightbox are PORTALLED with createPortal instead of the
//      original's document.body.appendChild(modal) — same reason, spelled out at
//      the portal call: <main class="route-enter"> keeps a filled transform +
//      will-change, which makes it the containing block for position:fixed
//      descendants, so an in-tree overlay anchors to the page, not the viewport.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { moneySymbol, groupIntBlankZero, isInr, projectCurrency } from '@/themes/shared/money.js'
import { useTheme } from '@/site/theme.js'
import * as api from '@/site/clubApi.js'
import { media, avenueLabel, avenueColor, usePageTitle, wrappableHtml, wheelFallback, PHOTO_BOX } from '@/themes/shared/rotaryPage.js'
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
// The viewer's stylesheet is shared with EventDetail so the two detail pages
// cannot drift apart. This page keeps its own open/close STATE because the
// viewer is coordinated with the child-project popup here (one body-scroll lock,
// one Esc handler across both overlays).
import { LIGHTBOX_CSS } from '@/themes/shared/PhotoLightbox.jsx'
import { pool } from '@/themes/shared/pages/AllProjects.jsx'
import { useProjectShare, shareChannels, sharePopup, shareUrlFor, SHARE_ICONS } from '@/themes/shared/projectShare.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { isLocalRequest } from '@/site/config.js'

// ── Child-update popup + image lightbox (theme-agnostic .pdm-*). Hand-written
//    on purpose: EVERY theme's Tailwind is precompiled, so new utility classes
//    used only here would not exist — bespoke classes need no recompile. ──
/**
 * Padding for the four stat cards, as an inline style rather than the `p-5`
 * class they used to carry.
 *
 * madras-legacy loads bootstrap.min.css AFTER the compiled Tailwind sheet, and
 * Bootstrap defines the SAME utility names with !important — its `.p-5` is 3rem,
 * not Tailwind's 1.25rem. The cards measured 217px tall on madras against 153px
 * everywhere else, with the figure stranded at the bottom of a mostly empty box.
 * An inline style cannot be hijacked and gives every theme the 20px the class
 * was meant to mean.
 *
 * The same collision applies to EVERY shared Tailwind class Bootstrap also ships
 * (p-*, m-*, gap-*, d-*) anywhere madras renders shared markup — this fixes the
 * card, not the underlying clash.
 */
const STAT_BOX = { padding: '20px' }
// mb-4 and gap-4 lose to Bootstrap the same way p-5 did (1.5rem vs 1rem).
const STAT_ICON = { marginBottom: '16px' }
const STAT_GRID = { gap: '16px' }

const PAGE_CSS = `
        /* per-theme accent for the popup chrome (kicker + stat chips). Values are the
           theme accents DARKENED to hold WCAG AA on the white panel — classic's gold
           #F5A623 (1.9:1) and warm's coral #F26430 (3:1) fail as-is. madras-legacy
           carries no override on purpose: its inner pages ride rotary-design.css, so
           it takes the classic accent from :root. */
        :root{--pdm-a:#A66A00;}                                   /* classic-blue + madras */
        html[data-theme="warm-modern"]{--pdm-a:#C2410C;}          /* deep terracotta */
        html[data-theme="civic-bold"]{--pdm-a:#4E780A;}           /* civic olive-lime (light mode value) */
        html[data-theme="verdigris-ledger"]{--pdm-a:#6E1770;}     /* burnt magenta */
        .pdm-kicker{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:var(--pdm-a);}
        .pdm-stat__ic{color:var(--pdm-a);background:rgba(0,0,0,.05);background:color-mix(in srgb,var(--pdm-a) 12%,#fff);}
        .pdm-panel{animation:pdmIn .38s cubic-bezier(.2,.7,.2,1);}
        [data-child-modal] [data-child-backdrop]{animation:pdmFade .32s ease;}
        @keyframes pdmIn{from{opacity:0;transform:translateY(26px) scale(.965);}to{opacity:1;transform:none;}}
        @keyframes pdmFade{from{opacity:0;}}
        .pdm-sep{margin-top:1.25rem;padding-top:1.1rem;border-top:1px solid rgba(0,0,0,.08);}
        /* share row — chrome comes from each theme's own utility classes; what is
           bespoke is only the brand-colour hover (a precompiled Tailwind sheet has
           no hover:bg-[#25D366]) and the "Copied" toast. --pdm-brand is set inline
           per channel; channels without a brand fall back to the theme accent. */
        .pdm-sh{display:flex;flex-wrap:wrap;gap:.5rem;}
        .pdm-sh__b{position:relative;transition:background-color .25s,color .25s,transform .25s;}
        .pdm-sh__b svg{height:16px;width:16px;}
        .pdm-sh__b:hover,.pdm-sh__b:focus-visible{background:var(--pdm-brand,var(--pdm-a));color:#fff;transform:translateY(-2px);}
        .pdm-sh__t{pointer-events:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;border-radius:6px;background:#1c1c24;color:#fff;padding:.25rem .5rem;font-size:10px;font-weight:700;opacity:0;transition:opacity .2s;}
        .pdm-sh__t.is-on{opacity:1;}
        /* stat tiles: one segmented strip — every tile draws its own top+left hairline
           (box-shadow) and the container's overflow:hidden crops the outer ones, so the
           dividers stay correct for any tile count (1–4) at any wrap width */
        .pdm-stats{margin-top:1.1rem;display:flex;flex-wrap:wrap;border:1px solid rgba(0,0,0,.08);border-radius:14px;overflow:hidden;background:rgba(0,0,0,.015);}
        .pdm-stat{flex:1 1 130px;display:flex;flex-direction:column;align-items:flex-start;gap:.35rem;padding:.85rem 1rem .8rem;box-shadow:-1px -1px 0 0 rgba(0,0,0,.07);}
        .pdm-stat__ic{display:flex;height:30px;width:30px;align-items:center;justify-content:center;border-radius:9px;}
        .pdm-stat__ic svg{height:16px;width:16px;}
        .pdm-stat__n{font-weight:800;font-size:1.15rem;line-height:1.1;letter-spacing:-.01em;font-variant-numeric:tabular-nums;}
        .pdm-stat__l{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;}
        /* photo mosaic: 2-up, 3-up from 640px; the FIRST photo runs 2x2 when 3+ photos */
        .pdm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;}
        @media(min-width:640px){.pdm-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}
        .pdm-grid a{position:relative;display:block;aspect-ratio:4/3;border-radius:10px;overflow:hidden;cursor:zoom-in;background:rgba(0,0,0,.05);}
        .pdm-grid a:only-child{grid-column:1/-1;aspect-ratio:16/9;}
        @media(min-width:640px){.pdm-grid a:first-child:nth-last-child(n+3){grid-column:span 2;grid-row:span 2;}}
        /* exactly two photos: split the row 50/50 instead of leaving a dead third track
           (:has-less browsers just keep the 3-col layout — harmless) */
        @media(min-width:640px){.pdm-grid:has(a:first-child:nth-last-child(2)){grid-template-columns:repeat(2,minmax(0,1fr));}}
        .pdm-grid img{width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.2,.7,.2,1);}
        .pdm-grid a:hover img,.pdm-grid a:focus-visible img{transform:scale(1.06);}
        .pdm-grid a::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(10,6,12,.3),transparent 45%);opacity:0;transition:opacity .3s;pointer-events:none;}
        .pdm-grid a:hover::after{opacity:1;}
        .pdm-grid a:focus-visible{outline:2px solid currentColor;outline-offset:2px;}
        .pdm-zoom{position:absolute;right:.5rem;bottom:.5rem;z-index:1;display:flex;height:28px;width:28px;align-items:center;justify-content:center;border-radius:999px;background:rgba(255,255,255,.92);color:#1c1c24;opacity:0;transform:translateY(4px);transition:opacity .3s,transform .3s;box-shadow:0 2px 8px rgba(10,6,12,.25);pointer-events:none;}
        .pdm-zoom svg{height:14px;width:14px;}
        .pdm-grid a:hover .pdm-zoom,.pdm-grid a:focus-visible .pdm-zoom{opacity:1;transform:none;}
        /* The lightbox rules (and its pdmIn/pdmFade keyframes) now live in
           shared/PhotoLightbox.jsx so EventDetail can use the same viewer without a
           second copy that could drift. z-index 200 keeps it above the child popup
           (120); it is portalled to <body> like the popup — see the route-enter
           containing-block note in the script below. */
${LIGHTBOX_CSS}
        @media(prefers-reduced-motion:reduce){
            .pdm-panel,[data-child-modal] [data-child-backdrop]{animation:none;}
            .pdm-grid img,.pdm-zoom{transition:none;}
        }
`

// ── Formatting helpers (the C#'s CultureInfo/format-string behaviour) ────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** DateTime.ToString("dd MMM yyyy", InvariantCulture); "" when there's no date. */
export function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}

/**
 * ToString("#,#", hi-IN) — Indian digit grouping (16,52,030), no decimals, and
 * EMPTY for zero ('#' emits no digit for 0). CostText leans on that empty
 * string: a 0-cost project hides the stat instead of printing "₹0".
 */
export function inr(n, currency) {
  return groupIntBlankZero(n, currency)
}

/**
 * A cost ready to print, SYMBOL INCLUDED — "₹16,52,030" / "Rs 8,160,001".
 * The symbol lives in the string rather than being hard-coded beside every use
 * of costText, which is what printed Sri Lankan rupees with a ₹. Still empty for
 * a zero cost, so a 0-cost project keeps HIDING the stat instead of showing 0.
 */
export function costText(n, currency) {
  const digits = groupIntBlankZero(n, currency)
  return digits ? moneySymbol(currency) + digits : ''
}

/** Strip HTML + collapse whitespace to a plain-text excerpt (for OG/X/email). */
export function excerpt(html, max) {
  if (!html || !String(html).trim()) return ''
  let text = String(html).replace(/<[^>]+>/g, ' ')
  const ta = document.createElement('textarea')   // HttpUtility.HtmlDecode
  ta.innerHTML = text
  text = ta.value
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length > max) text = text.slice(0, max).replace(/\s+$/, '') + '…'
  return text
}

// ── Share FALLBACK builders ──────────────────────────────────────────────────
// The share row itself is driven by the API's per-project share payload (see
// shared/projectShare.jsx). What is built here is the fallback that payload
// replaces — the club's own domain, a plain-text summary and the first photo —
// so the row still works on an API build that has no /share endpoint, or when
// the request for it fails.

/* The ClientDomain cleaner and the club-domain URL builder now live in
   shared/projectShare.jsx (shareUrlFor), so the event share row builds its
   links exactly the same way. */

/** One-line "Date · Venue" summary. */
function shareSummaryLine(dateText, location) {
  const meta = []
  if (dateText) meta.push(dateText)
  if (location) meta.push(location)
  return meta.join(' · ')
}

/**
 * What the API's `shareText` would have said, built from what the page knows.
 * The share URL is NOT appended here — useProjectShare adds it, because the
 * API's own text already ends with it and it must not appear twice.
 */
function buildShareText(p, clubName) {
  let sb = p.title
  if (clubName) sb += '\n' + clubName
  const line = shareSummaryLine(p.dateText, p.location)
  if (line) sb += '\n' + line
  const desc = excerpt(p.description, 300)
  if (desc) sb += '\n\n' + desc
  return sb
}

/** The single-sentence variant, for character-capped fields. */
function buildShareLine(p, clubName) {
  let sb = p.title
  if (clubName) sb += ' - ' + clubName
  const line = shareSummaryLine(p.dateText, p.location)
  if (line) sb += ' (' + line + ')'
  const desc = excerpt(p.description, 110)
  if (desc) sb += '. ' + desc
  return sb
}

/** The photo path on a `photoDetails` row, whichever name the API build uses. */
export function photoDetailPath(d) {
  if (!d) return ''
  return d.url || d.imagePath || ''
}

/**
 * Absolutised photo URLs and their per-photo captions, INDEX-ALIGNED.
 *
 * Both lists come off the same `photoDetails` rows, so a path media() rejects
 * takes its caption with it — filtering the two separately would shift every
 * caption after the bad one. An API build with no `photoDetails` falls back to
 * the bare `photos` array and renders no captions, exactly as before.
 *
 * Used for the main project AND for each child ("Project Update"), which carries
 * the same field.
 */
export function photoSet(p) {
  const rows = ((p && p.photoDetails) || [])
    .map((d) => ({ url: media(photoDetailPath(d)), cap: (d.description || '').trim() }))
    .filter((r) => r.url)
  if (rows.length > 0) {
    return { photos: rows.map((r) => r.url), captions: rows.map((r) => r.cap) }
  }
  return { photos: ((p && p.photos) || []).map(media).filter(Boolean), captions: [] }
}

// ── View-model builders (Page_Load + BuildChildren) ──────────────────────────

/**
 * Maps the API's child projects to the popup view-model.
 *
 * FORCED DIFFERENCE: the C# falls back to ProjectHierarchy.GetChildren(), which
 * reads parent_project_id straight from MySQL while the deployed API returns no
 * Children. A browser can't do that, so here only the API's `children` is used —
 * the fallback goes dormant the moment the API populates it anyway.
 */
function buildChildren(p, demo, main, currency) {
  let src = (p ? p.children : null) || []

  // LOCAL preview ONLY: ?demoChild=1 injects synthetic children so the section and
  // popup can be exercised before the API returns real children. Gated to local
  // requests, so it never runs in production.
  if (src.length === 0 && demo) {
    const today = new Date()
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())
    src = [
      { id: 999001, title: main.title + ' — 25 Jun 2026', description: main.description,
        location: main.location, projectDate: today, projectCost: 12000, directBeneficiaries: 80,
        manHours: 20, rotariansInvolved: 12, photos: main.photos.slice() },
      { id: 999002, title: main.title + ' — 18 May 2026',
        description: '<p>Second repeat instance of this ongoing project.</p>', location: 'Sector 5',
        projectDate: lastMonth, directBeneficiaries: 40 },
    ]
  }

  const list = []
  for (const c of src) {
    if (!c) continue
    // Children carry `photoDetails` too, so an update's photos get their own
    // captions in the viewer instead of borrowing the parent gallery's.
    const set = photoSet(c)
    const photos = set.photos
    const captions = set.captions
    if (photos.length === 0 && c.primaryPhotoPath) {
      const u = media(c.primaryPhotoPath)
      if (u) photos.push(u)
    }
    list.push({
      id: c.id,
      title: c.title || '',
      dateText: fmtDate(c.projectDate),
      // The RAW date as well as the formatted one: gold sets the day figure and
      // the month on separate baselines, which a pre-formatted string can't be
      // split back into safely.
      date: c.projectDate || null,
      location: c.location || '',
      descriptionHtml: wrappableHtml(c.description),
      costText: c.projectCost === null || c.projectCost === undefined ? '' : costText(c.projectCost, projectCurrency(c.currency, currency)),
      beneficiaries: c.directBeneficiaries || 0,
      manHours: c.manHours || 0,
      rotarians: c.rotariansInvolved || 0,
      photos,
      captions,
    })
  }
  return list
}

export function buildProject(p, club, demo) {
  const vm = {
    id: p.id,
    // The project's OWN Rotary year, not the club's selected one — the share
    // endpoint needs it to pick the right year-partitioned table, and an ongoing
    // project carries updates from earlier years than the one being browsed.
    yearId: p.yearId === null || p.yearId === undefined ? null : p.yearId,
    moduleKey: p.moduleKey,
    title: p.title || '',
    description: wrappableHtml(p.description),   // rich HTML — emit raw, but wrappable
    location: p.location || '',
    dateText: fmtDate(p.projectDate),

    // Stat raw values (for visibility checks) and formatted display strings.
    cost: p.projectCost === null || p.projectCost === undefined ? null : p.projectCost,
    beneficiaries: p.directBeneficiaries || 0,
    manHours: p.manHours || 0,
    rotarians: p.rotariansInvolved || 0,

    // Absolutised photo URLs (first entry is the main image) + the per-photo
    // captions the dashboard collects on upload, index-aligned. See photoSet().
    photos: photoSet(p).photos,
    photoCaptions: photoSet(p).captions,
  }
  // Grouped digits WITH the currency symbol (₹16,52,030 / LKR 8,160,001): the project's own
  // currency when one was picked (projectCurrency), else the club's.
  vm.currency = projectCurrency(p.currency, club && club.currency)
  vm.costText = vm.cost === null ? '' : costText(vm.cost, vm.currency)

  vm.metaDescription = excerpt(vm.description, 200)   // plain-text excerpt for OG cards
  vm.ogImage = vm.photos[0] || ''                     // absolute image URL for previews

  // Everything the share row needs if the API's /share payload is unavailable.
  // `url` is this project page on the club's OWN domain (never the rotaryindia
  // subdomain when a custom domain exists) — the same rule the API applies.
  vm.shareUrl = shareUrlFor(club)
  vm.shareFallback = {
    url: vm.shareUrl,
    title: vm.title,
    text: buildShareText(vm, club.clubDisplayName || club.clubName),
    singleLine: buildShareLine(vm, club.clubDisplayName || club.clubName),
    image: vm.ogImage,
  }
  vm.children = buildChildren(p, demo, vm, club && club.currency)
  return vm
}

/**
 * Load one project, INCLUDING its child projects when the API declines to send
 * them. Both the shared page and gold go through here so they cannot disagree.
 *
 * WHY THE FALLBACK EXISTS. The detail endpoint only returns `children` when the
 * PARENT is typed `ongoing`. Measured across clubs 1, 954 and 959: 52 of 53
 * `ongoing` parents came back complete, while every parent typed `one_time` or
 * `ongoing_repeat` came back with an empty `children` array — even though the
 * SAME API's v2/projects list reports childCount 3, 3 and 1 for them and carries
 * the child rows themselves, each with parentProjectId pointing at the parent.
 * Baroda's "TB Nutrition Kits Distribution" (959/2079, ongoing_repeat) is the
 * case that surfaced it: the card says "3 updates" and the detail page showed
 * none.
 *
 * So when `children` is empty we rebuild it from the list the API is willing to
 * give us. This is the browser-side equivalent of the ASP.NET tree's
 * ProjectHierarchy DB fallback, which cannot be ported literally because a
 * browser has no MySQL socket — but the public API turns out to be enough.
 *
 * GATED ON ongoingGroupTitle, which is the whole reason this is affordable. The
 * year's project list is 25 KB for a small club and 279 KB for a big one, the API
 * serves it UNCOMPRESSED, and CacheTimeInMinutes=0 means it is re-fetched on
 * every navigation — so scanning on every project page would add that to every
 * page view. ongoingGroupTitle is already in the payload just fetched and is set
 * on every parent (broken or working) and null on every child: measured over 88
 * top-level projects it caught 2 of 2 parents with no misses and fired on 7% of
 * pages. So 93% of project pages do no extra work at all, and the ones that do
 * are almost all really parents.
 *
 * A `projectType` filter would have made the scan smaller, and v2/projects takes
 * one — but it is broken: ?projectType=ongoing_repeat returns an EMPTY array for
 * a year that demonstrably holds four such rows, including the three children
 * this was meant to find. Do not reach for it.
 *
 * Scanning the PARENT'S OWN year only, not every year. All 7 recoverable
 * children measured sit in their parent's year. A child filed under a different
 * year than its parent is a separate, still-open data bug — chasing it would
 * mean a list call per year on every project page.
 */
/** The page's view model from the server's raw payload ({ detail, kids }); null when not found. */
export function projectFromRaw(raw, club) {
  if (!raw || !raw.detail) return null
  const vm = buildProject(raw.detail, club, false)
  if (vm.children.length === 0 && raw.kids && raw.kids.length > 0) {
    vm.children = buildChildren({ children: raw.kids }, false, vm, club && club.currency)
  }
  return vm
}

export async function loadProject(club, pid, demo) {
  const d = await api.getProjectDetail(club.clubId, pid, club.selectedYearId, true)
  if (!d) return null

  const vm = buildProject(d, club, demo)
  if (vm.children.length > 0 || demo) return vm

  const group = d.ongoingGroupTitle === null || d.ongoingGroupTitle === undefined
    ? '' : String(d.ongoingGroupTitle).trim()
  if (group === '') return vm

  const yearId = (d.yearId === null || d.yearId === undefined) ? club.selectedYearId : d.yearId
  const rows = await api.getProjects(club.clubId, yearId)
  const kids = (rows || []).filter((r) => r && r.parentProjectId === pid)
  if (kids.length === 0) return vm

  // The list row has a title and a date but no photos or description, so each
  // child still needs its own payload — the same shape `children` would have had.
  const full = new Array(kids.length)
  await pool(kids.map((k, i) => ({ k, i })), 4, (job) =>
    api.getProjectDetail(club.clubId, job.k.id, job.k.yearId || yearId, true).then((cd) => { full[job.i] = cd || job.k }))

  // buildChildren does the mapping either way — same view-model, one code path.
  vm.children = buildChildren({ children: full.filter(Boolean) }, false, vm, club && club.currency)
  return vm
}

/**
 * The Open Graph / X card meta the .aspx emits in HeadContent so Facebook,
 * LinkedIn & X show the project's title, description and image when this page
 * URL is shared. In the SPA they are written after first paint — crawlers that
 * don't run JS never see them; kept for parity with the server-rendered page.
 */
export function useOpenGraph(vm, clubName, share) {
  const shareUrl = (share && share.url) || (vm && vm.shareUrl) || ''
  // The API's 1200x630 share card beats the raw project photograph here: it is
  // already the right aspect for every card renderer and it carries the club's
  // name and district. Falls back to the first photo when there is no card.
  const shareImage = (share && share.image) || (vm && vm.ogImage) || ''
  useEffect(() => {
    if (!vm) return undefined
    const tags = [
      ['property', 'og:type', 'article'],
      ['property', 'og:title', vm.title],
      ['property', 'og:description', vm.metaDescription],
      ['property', 'og:url', shareUrl],
    ]
    if (shareImage) {
      tags.push(['property', 'og:image', shareImage])
      tags.push(['property', 'og:image:alt', vm.title])
    }
    tags.push(['property', 'og:locale', 'en_IN'])
    tags.push(['property', 'og:site_name', clubName || 'Rotary Club'])
    tags.push(['name', 'twitter:card', shareImage ? 'summary_large_image' : 'summary'])
    tags.push(['name', 'twitter:title', vm.title])
    tags.push(['name', 'twitter:description', vm.metaDescription])
    if (shareImage) tags.push(['name', 'twitter:image', shareImage])

    // UPSERT, not append. deploy/og.php now writes the same tags server-side for
    // crawlers, and that HTML is what the browser starts from — appending would
    // leave the live page carrying two og:title / og:image sets that disagree
    // (the server's, then this one). Reuse the existing element when there is
    // one, and only remove on cleanup the elements this hook actually created.
    const mine = []
    tags.forEach(([attr, key, content]) => {
      const value = content === null || content === undefined ? '' : String(content)
      let m = document.head.querySelector('meta[' + attr + '="' + key + '"]')
      if (!m) {
        m = document.createElement('meta')
        m.setAttribute(attr, key)
        document.head.appendChild(m)
        mine.push(m)
      }
      m.setAttribute('content', value)
    })
    return () => { mine.forEach((m) => m.remove()) }
    // shareUrl/shareImage are derived from vm + share; listing them keeps the
    // tags in step when the API's share payload arrives after first paint.
  }, [vm, clubName, shareUrl, shareImage])
}

// ── The child panel's contents ──────────────────────────────────────────────
// The original renders every child's panel hidden and clones panel.innerHTML
// into the modal body on "Read More" (a listener can't live in cloned markup, so
// its lightbox clicks are delegated). Here the SAME component renders both
// places — identical DOM, no innerHTML surgery, and the photo clicks can be
// ordinary handlers.
function ChildPanelBody({ c, onPhoto }) {
  return (
    <>
      <p className="pdm-kicker text-gold-cta">Project update</p>
      <h3 className="mt-1 font-heading text-xl font-extrabold leading-tight text-navy sm:text-2xl">{c.title}</h3>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        {c.dateText && (<span className="inline-flex items-center gap-1.5"><svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span className="font-semibold text-navy">{c.dateText}</span></span>)}
        {c.location && (<span className="inline-flex items-center gap-1.5"><svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span className="font-semibold text-navy">{c.location}</span></span>)}
      </div>
      {c.photos.length > 0 && (
        /* mosaic of lightbox anchors: href = the full image; they open in the
           .pdm-lb viewer (scoped to this panel's [data-lb-group], so gallery
           photos and popup photos never mix) */
        <div className="pdm-grid mt-4">
          {c.photos.map((ph, i) => (
            <a key={i} data-pdm-lb="" href={ph} aria-label={'View photo ' + (i + 1) + ' of ' + c.photos.length}
               onClick={(e) => { e.preventDefault(); onPhoto(c.photos, i, c.captions) }}>
              <img src={ph} alt="" loading="lazy" draggable={false} />
              <span className="pdm-zoom" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></span>
            </a>
          ))}
        </div>
      )}
      {(c.beneficiaries > 0 || c.rotarians > 0 || c.manHours > 0 || c.costText) && (
        <div className="pdm-stats">
          {c.costText && (
            <div className="pdm-stat">
              <span className="pdm-stat__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg></span>
              <span className="pdm-stat__n font-heading text-navy">{c.costText}</span>
              <span className="pdm-stat__l text-muted">Project cost</span>
            </div>
          )}
          {c.beneficiaries > 0 && (
            <div className="pdm-stat">
              <span className="pdm-stat__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
              <span className="pdm-stat__n font-heading text-navy">{inr(c.beneficiaries)}</span>
              <span className="pdm-stat__l text-muted">Beneficiaries</span>
            </div>
          )}
          {c.rotarians > 0 && (
            <div className="pdm-stat">
              <span className="pdm-stat__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
              <span className="pdm-stat__n font-heading text-navy">{inr(c.rotarians)}</span>
              <span className="pdm-stat__l text-muted">Rotarians</span>
            </div>
          )}
          {c.manHours > 0 && (
            <div className="pdm-stat">
              <span className="pdm-stat__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
              <span className="pdm-stat__n font-heading text-navy">{inr(c.manHours)}</span>
              <span className="pdm-stat__l text-muted">Man hours</span>
            </div>
          )}
        </div>
      )}
      {c.descriptionHtml && (
        <div className="pdm-sep">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Overview</p>
          <div className="text-[15px] leading-relaxed text-ink/80" dangerouslySetInnerHTML={{ __html: c.descriptionHtml }} />
        </div>
      )}
    </>
  )
}

export default function ProjectDetail({ data }) {
  const club = useClub()
  const { isWarm, isMadras } = useTheme()
  const location = useLocation()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const pid = parseInt(params.get('pid'), 10) || 0
  // Club Services (/projects?pr=CE) and Projects (/projects) are the SAME list
  // component and both link here, but the project payload carries nothing that
  // says which feed it came from — the meetings feed is a separate endpoint, not
  // an avenue. So AllProjects passes the origin through on its card links and
  // "Back" honours it; without this every Club Service item dead-ends on Projects.
  const fromMeetings = params.get('pr') === 'CE'
  const backHref = fromMeetings ? '/projects?pr=CE' : '/projects'
  const backLabel = fromMeetings ? 'Back to Club Services' : 'Back to all projects'

  // The server loads the project and, when needed, its updates (projectFromRaw; themes/shared/loaders.ts).
  const p = useMemo(() => projectFromRaw(data.project, club), [data.project, club])
  const notFound = !p
  // The popups portal into <body>, which exists only in the browser.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  usePageTitle(notFound ? 'Project Not Found' : (p ? p.title : null))

  // ── Share ────────────────────────────────────────────────────────────────
  // Driven by the API's own share payload; p.shareFallback keeps the row working
  // until it lands (and forever, on an API build without the endpoint).
  const share = useProjectShare({
    projectId: p ? p.id : 0,
    yearId: p ? p.yearId : null,
    fallback: p ? p.shareFallback : null,
  })
  const channels = shareChannels(share)

  // Rendered in ONE of two places: normally in the right column under the
  // stats, but on madras-legacy under the photographs instead (user call
  // 2026-08-24). Built once here so the two positions cannot drift.
  // One mapped row over shareChannels(), so a channel added in
  // shared/projectShare.jsx reaches every theme at once. The chrome stays
  // per-theme (the isWarm base classes); only the brand-colour hover and the
  // toast are bespoke CSS, because this port ships PRECOMPILED Tailwind and a
  // new arbitrary utility like hover:bg-[#25D366] would not exist in any
  // theme's built stylesheet.
  const shareRow = (
  <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
      <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      Share
    </p>
    <div className="pdm-sh">
      {channels.map((ch) => {
        const base = (isWarm
          ? 'flex h-9 w-9 items-center justify-center rounded-full bg-gold/10 text-gold-cta'
          : 'flex h-9 w-9 items-center justify-center rounded-full bg-navy/5 text-navy') + ' pdm-sh__b'
        const style = ch.brand ? { '--pdm-brand': ch.brand } : undefined
        const glyph = (
          <svg viewBox="0 0 24 24" aria-hidden="true"
               fill={ch.fill ? 'currentColor' : 'none'}
               stroke={ch.fill ? 'none' : 'currentColor'}
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ch.done ? SHARE_ICONS.check : ch.icon}
          </svg>
        )
        return ch.href ? (
          <a key={ch.key} href={ch.href} aria-label={ch.label} title={ch.label}
             className={base} style={style}
             /* mailto must navigate normally; everything else
                opens in the centred share window / a new tab */
             target={ch.key === 'mail' ? undefined : '_blank'}
             rel={ch.key === 'mail' ? undefined : 'noopener noreferrer'}
             onClick={ch.popup ? sharePopup : undefined}>
            {glyph}
          </a>
        ) : (
          <button key={ch.key} type="button" aria-label={ch.label} title={ch.label}
                  data-copy-link={ch.key === 'link' ? share.url : undefined}
                  className={base} style={style} onClick={ch.onClick}>
            {glyph}
            {ch.doneLabel && (
              <span className={'pdm-sh__t' + (ch.done ? ' is-on' : '')}>{ch.doneLabel}</span>
            )}
          </button>
        )
      })}
    </div>
  </div>
  )


  useOpenGraph(notFound ? null : p, club.clubName, share)

  // ── Child popup + image lightbox state ───────────────────────────────────
  const [openChild, setOpenChild] = useState(null)
  const [lb, setLb] = useState(null)          // { urls, idx } while the viewer is open
  const scrollerRef = useRef(null)
  const touchX = useRef(null)

  // `caps` = per-photo captions for THIS set. The viewer is shared with the child
  // popup, whose photos have no captions, so it travels with the urls instead of
  // being read off the project — otherwise a child's photo 2 would show the main
  // gallery's photo-2 caption.
  const openLb = (urls, start, caps) => {
    if (!urls || urls.length === 0) return
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }
  const lbStep = (d) => setLb((l) => (l ? { ...l, idx: (l.idx + d + l.urls.length) % l.urls.length } : l))

  // pre-warm the next slide
  useEffect(() => {
    if (lb && lb.urls.length > 1) new Image().src = lb.urls[(lb.idx + 1) % lb.urls.length]
  }, [lb])

  // The page stays locked while EITHER overlay is up — closing the lightbox must
  // not unlock the page when the child popup is still open underneath.
  useEffect(() => {
    document.body.style.overflow = (lb || openChild) ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [lb, openChild])

  useEffect(() => {
    function onKey(e) {
      // lightbox sits above the popup, so it gets the keys first
      if (lb) {
        if (e.key === 'Escape') setLb(null)
        else if (e.key === 'ArrowRight') lbStep(1)
        else if (e.key === 'ArrowLeft') lbStep(-1)
        return
      }
      if (openChild && e.key === 'Escape') setOpenChild(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lb, openChild])

  // a fresh update always starts at the top of the (long) panel
  useEffect(() => {
    if (openChild && scrollerRef.current) scrollerRef.current.scrollTop = 0
  }, [openChild])

  const photos = p ? p.photos : []
  const captions = p ? (p.photoCaptions || []) : []
  const children = p ? p.children : []

  useRotaryAnim([notFound, p, photos.length, children.length, openChild, lb])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />

      {notFound ? (

        /* ══ Not found ══ */
        <section className="bg-canvas">
          <div className="container-x py-24 text-center">
            <div className="reveal mx-auto max-w-md">
              <span className={isWarm ? 'mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gold/10 text-gold-cta' : 'mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-navy/5 text-navy'}>
                <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <h1 className="mt-5 font-heading text-2xl font-extrabold text-navy">Project not found</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">We couldn&rsquo;t find the project you were looking for. It may have been moved or is no longer available.</p>
              <a href={backHref} className={isWarm ? 'mt-6 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-gold-cta hover:gap-3' : 'mt-6 inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-navy-deep hover:gap-3'}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                {backLabel}
              </a>
            </div>
          </div>
        </section>

      ) : !p ? (
        // The Web Forms page renders server-side, so it is never in this state:
        // the project is either there or NotFound. Nothing is drawn until the
        // fetch resolves — flashing "Project not found" first would be a lie.
        null
      ) : (
        <>
          <Breadcrumb eyebrow={avenueLabel(p.moduleKey)} title={p.title} crumbLabel={p.title}
                      midLabel={fromMeetings ? 'Club Services' : 'Projects'} midHref={backHref} />

          <section className="bg-canvas">
            <div className="container-x py-10 lg:py-14">
              <div className="grid gap-8 lg:grid-cols-2">

                {/* ── LEFT: sticky gallery ── */}
                <div className="reveal reveal-left h-full min-w-0">
                  {/* data-lb-group scopes the lightbox sequence to THIS gallery; the hero
                      button carries data-lb-skip so photo 1 isn't duplicated (it's also
                      the first thumbnail) — it opens the sequence at that photo. */}
                  <div className="flex flex-col gap-3 lg:sticky lg:top-24" data-lb-group="">
                    {photos.length > 0 ? (
                      <>
                        <button type="button" data-pdm-lb={photos[0]} data-lb-skip="" onClick={() => openLb(photos, 0, captions)}
                                className={isWarm ? 'img-zoom group relative block overflow-hidden rounded-3xl border border-navy/10 bg-white shadow-card' : 'img-zoom group relative block overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-card'}>
                          {/* 16:9 and contained — never h-[300px]/md:h-[460px]
                              with cover, which cropped every portrait hero. */}
                          <img src={photos[0]} alt={p.title}
                               onError={wheelFallback} style={PHOTO_BOX}
                               className="w-full bg-white object-contain" />
                          {photos.length > 1 && (
                          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 9V3h-6"/><path d="M3 15v6h6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                            {photos.length} Photos
                          </span>
                          )}
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-navy/0 opacity-0 transition-all duration-300 group-hover:bg-navy/15 group-hover:opacity-100">
                            <span className="rounded-full bg-white/90 px-4 py-1.5 text-xs font-bold text-navy shadow">View Gallery</span>
                          </span>
                        </button>

                        {/* Caption the dashboard collected for THIS photo, under it.
                            Only photo 1 is on the page — the rest show theirs in the
                            viewer. Absent on API builds without `photoDetails`. */}
                        {captions[0] && (
                        <p className="text-sm leading-relaxed text-muted">{captions[0]}</p>
                        )}

                        {photos.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {photos.map((url, i) => (
                            <button key={i} type="button" data-pdm-lb={url}
                                    aria-label="Photo" onClick={() => openLb(photos, i, captions)}
                                    className={'h-16 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition ' + (i === 0 ? 'border-gold shadow-md' : 'border-transparent opacity-60 hover:opacity-100')}>
                              <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                        )}
                      </>
                    ) : (
                      <div className={isWarm ? 'flex h-[300px] w-full items-center justify-center rounded-3xl border border-navy/10 bg-gold/5 text-gold-cta/40 md:h-[460px]' : 'flex h-[300px] w-full items-center justify-center rounded-3xl border border-gray-200 bg-navy/5 text-navy/40 md:h-[460px]'}>
                        <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                      </div>
                    )}

                    {isMadras && shareRow}

                  </div>
                </div>

                {/* ── RIGHT: details ── */}
                <div className="reveal reveal-right h-full min-w-0">
                  <div className="flex h-full flex-col gap-5">

                    {/* avenue chip */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-white ' + avenueColor(p.moduleKey)}>
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                        {avenueLabel(p.moduleKey)}
                      </span>
                    </div>

                    <h1 className="font-heading text-2xl font-extrabold leading-tight text-navy md:text-[2rem] md:leading-[1.15]">
                      {p.title}
                    </h1>

                    {/* meta: location + date */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                      {p.dateText && (
                      <span className="inline-flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        <span className="font-semibold text-navy">{p.dateText}</span>
                      </span>
                      )}
                      {p.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        <span className="font-semibold text-navy">{p.location}</span>
                      </span>
                      )}
                    </div>

                    {p.description && (
                    <div>
                      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Overview</p>
                      <div className="text-[15px] leading-relaxed text-ink/80" dangerouslySetInnerHTML={{ __html: p.description }} />
                    </div>
                    )}

                    {/* ── 2x2 stat cards (only if value present) ── */}
                    {((p.cost !== null && p.cost > 0) || p.beneficiaries > 0 || p.rotarians > 0 || p.manHours > 0) && (
                    <div className="grid grid-cols-2" style={STAT_GRID}>
                      {p.cost !== null && p.cost > 0 && (
                      <div className={isWarm ? 'group relative overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40' : 'group relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-transform duration-300 hover:-translate-y-1'} style={STAT_BOX}>
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md" style={STAT_ICON}>
                          {/* the ₹ glyph is only right on an INR club; everyone else gets a neutral coin */}
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {isInr(p.currency)
                              ? <path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3M9 13c6.667 0 6.667-10 0-10"/>
                              : <><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h5M9.5 13.5h5"/></>}
                          </svg>
                        </span>
                        <div className="font-heading text-2xl font-extrabold leading-none text-navy">{p.costText}</div>
                        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Total Cost</div>
                      </div>
                      )}
                      {p.beneficiaries > 0 && (
                      <div className={isWarm ? 'group relative overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40' : 'group relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-transform duration-300 hover:-translate-y-1'} style={STAT_BOX}>
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-md" style={STAT_ICON}>
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"/><path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 15 6 6M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.7 2.7 0 0 0 16 4a2.7 2.7 0 0 0-5 1.8c0 1.1.8 2 1.5 2.7L16 12z"/></svg>
                        </span>
                        <div className="font-heading text-2xl font-extrabold leading-none text-navy">{inr(p.beneficiaries)}</div>
                        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Beneficiaries</div>
                      </div>
                      )}
                      {p.rotarians > 0 && (
                      <div className={isWarm ? 'group relative overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40' : 'group relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-transform duration-300 hover:-translate-y-1'} style={STAT_BOX}>
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-md" style={STAT_ICON}>
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        </span>
                        <div className="font-heading text-2xl font-extrabold leading-none text-navy">{inr(p.rotarians)}</div>
                        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Rotarians Involved</div>
                      </div>
                      )}
                      {p.manHours > 0 && (
                      <div className={isWarm ? 'group relative overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40' : 'group relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-transform duration-300 hover:-translate-y-1'} style={STAT_BOX}>
                        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md" style={STAT_ICON}>
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </span>
                        <div className="font-heading text-2xl font-extrabold leading-none text-navy">{inr(p.manHours)}</div>
                        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Man Hours</div>
                      </div>
                      )}
                    </div>
                    )}

                    {!isMadras && shareRow}

                  </div>
                </div>

              </div>

              {/* ══ Child projects (repeat instances of this ongoing project) ══ */}
              {children.length > 0 && (
              <>
              <div className="mt-14">
                <div className="mb-5">
                  <h2 className="font-heading text-xl font-bold text-navy sm:text-2xl" data-split>Project Updates</h2>
                  <div className="mt-2 h-1 w-12 rounded-full bg-gold"></div>
                  <p className="mt-1.5 text-sm text-muted">This is an ongoing project with {children.length} update{children.length === 1 ? '' : 's'}. Click “Read More” to view each one.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {children.map((c) => (
                  <div key={c.id} className={isWarm ? 'group flex flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40' : 'group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-transform duration-300 hover:-translate-y-1'}>
                    {c.photos.length > 0 && (
                    <div className="relative overflow-hidden bg-gray-100" style={PHOTO_BOX}>
                      <img src={c.photos[0]} alt="" loading="lazy" className="h-full w-full bg-white object-contain" />
                    </div>
                    )}
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="font-heading text-base font-bold leading-snug text-navy">{c.title}</h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        {c.dateText && (
                        <span className="inline-flex items-center gap-1"><svg className="h-3.5 w-3.5 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>{c.dateText}</span>
                        )}
                        {c.location && (
                        <span className="inline-flex items-center gap-1"><svg className="h-3.5 w-3.5 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>{c.location}</span>
                        )}
                      </div>
                      <div className="mt-auto pt-3">
                        <button type="button" data-child-open={c.id} onClick={() => setOpenChild(c)} className={isWarm ? 'inline-flex items-center gap-1.5 rounded-full bg-gold px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition-all hover:-translate-y-0.5 hover:bg-gold-cta' : 'inline-flex items-center gap-1.5 rounded-full bg-navy px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition-all hover:bg-gold hover:text-navy'}>
                          Read More
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  ))}
                </div>
              </div>

              {/* Hidden child detail panels: the same panel body is rendered into
                  the modal on "Read More" (the .aspx clones this markup). */}
              <div className="hidden">
                {children.map((c) => (
                <div key={c.id} data-child-panel={c.id}>
                  <ChildPanelBody c={c} onPhoto={openLb} />
                </div>
                ))}
              </div>

              {/* Child detail popup */}
              {/* PORTALLED to <body>. Every master renders content inside
                  <main class="route-enter">, whose animation (fill:both) leaves a
                  permanent transform + will-change:transform on <main> — both make
                  <main> the containing block for position:fixed descendants, so the
                  popup anchored to the page (scrolled off-screen) instead of the
                  viewport. Rendering it out from under <main> restores true fixed
                  positioning. */}
              {mounted && createPortal(
              <div data-child-modal="" role="dialog" aria-modal="true" aria-label="Project update details" className={'fixed inset-0 z-[120] items-center justify-center p-4 ' + (openChild ? 'flex' : 'hidden')}>
                <div data-child-backdrop="" onClick={() => setOpenChild(null)} className="absolute inset-0 bg-navy-deep/70 backdrop-blur-sm"></div>
                {/* close button sits OUTSIDE the scroll container so it stays put
                    while long update content scrolls under it */}
                <div className="pdm-panel relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <button type="button" data-child-close="" onClick={() => setOpenChild(null)} aria-label="Close" className={isWarm ? 'absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-gold/10 text-gold-cta transition-colors hover:bg-gold hover:text-white' : 'absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-navy/5 text-navy transition-colors hover:bg-navy hover:text-white'}>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                  <div data-child-scroll="" ref={scrollerRef} className="max-h-[88vh] overflow-y-auto p-6 sm:p-8">
                    <div data-child-body="" data-lb-group="">
                      {openChild && <ChildPanelBody c={openChild} onPhoto={openLb} />}
                    </div>
                  </div>
                </div>
              </div>, document.body)}
              </>
              )}

              {/* Image lightbox: serves BOTH the main gallery and the child popup's
                  photos, so it renders regardless of whether child projects exist.
                  Same <body> portal as the modal above (z above it, 200 vs 120). */}
              {mounted && createPortal(
              <div className={'pdm-lb' + (lb ? ' open' : '') + (lb && lb.urls.length < 2 ? ' single' : '')} data-pdm-lightbox="" role="dialog" aria-modal="true" aria-label="Image viewer"
                   onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
                   onTouchEnd={(e) => {
                     // swipe to change slides on touch screens
                     if (touchX.current === null) return
                     const dx = e.changedTouches[0].clientX - touchX.current; touchX.current = null
                     if (Math.abs(dx) > 40 && lb && lb.urls.length > 1) lbStep(dx < 0 ? 1 : -1)
                   }}>
                <div className="pdm-lb__bg" data-lb-close="" onClick={() => setLb(null)}></div>
                <img className="pdm-lb__img" data-lb-img="" src={lb ? lb.urls[lb.idx] : undefined}
                     alt={lb ? 'Photo ' + (lb.idx + 1) + ' of ' + lb.urls.length : ''} draggable={false} />
                <button type="button" className="pdm-lb__btn pdm-lb__close" data-lb-close="" onClick={() => setLb(null)} aria-label="Close image">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <button type="button" className="pdm-lb__btn pdm-lb__prev" data-lb-prev="" onClick={() => lbStep(-1)} aria-label="Previous image">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button type="button" className="pdm-lb__btn pdm-lb__next" data-lb-next="" onClick={() => lbStep(1)} aria-label="Next image">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                {lb && lb.caps && lb.caps[lb.idx] && (
                <p className="pdm-lb__cap" aria-live="polite">{lb.caps[lb.idx]}</p>
                )}
                <span className="pdm-lb__count" data-lb-count="" aria-live="polite">{lb ? (lb.idx + 1) + ' / ' + lb.urls.length : ''}</span>
              </div>, document.body)}

              {/* ── Back to the list this visitor came from (Projects or Club Services) ── */}
              <div className={isWarm ? 'mt-12 flex items-center justify-center border-t border-navy/10 pt-6' : 'mt-12 flex items-center justify-center border-t border-gray-200 pt-6'}>
                <a href={backHref} className={isWarm ? 'inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-gold-cta hover:gap-3' : 'inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-navy-deep hover:gap-3'}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                  {backLabel}
                </a>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  )
}
