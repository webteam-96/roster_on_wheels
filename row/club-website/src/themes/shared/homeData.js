'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Port of Faster_ClubWebsite/HomePageBase.cs — the shared data layer behind all
// five Home pages. Every API call, fallback chain and view-model shape lives
// here so the themes cannot drift; each theme's Home binds these lists to its
// own markup.
//
// ONE FORCED DIFFERENCE: ProjectHierarchy.GetChildIds() reads parent_project_id
// straight from MySQL as a stand-in for the API field, which a browser can't do.
// The C# already prefers the API whenever ANY row carries parentProjectId > 0
// (which production now does — see the "parentProjectId = 0 bug" note), so the
// DB fallback is dormant there and simply absent here.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { mediaUrl, avenueFromModuleKey } from '@/site/media.js'
import { moneySymbol } from './money.js'
import { zoneLabel } from '@/site/zone.js'
import { appSettings, isLocalRequest } from '@/site/config.js'

/**
 * Local-only preview photos for the home event section, read from
 * VITE_PreviewEventImages (comma-separated). BLANK in every production build,
 * so the URLs are not even present in a shipped bundle — these are third-party
 * images and 1307 club sites must not publish them. Belt and braces: the use
 * site is ALSO behind isLocalRequest().
 */
const PREVIEW_EVENT_IMAGES = String(appSettings.PreviewEventImages || '')
  .split(',').map(function (u) { return u.trim() }).filter(Boolean)
import * as api from '@/site/clubApi.js'

// lucide-equivalent inline SVGs shared by every home layout
export const SVG_CALENDAR = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
export const SVG_TICKET = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 17v2M13 11v2"/></svg>'
export const SVG_NEWS = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/></svg>'
export const SVG_HEART = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"/><path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 15 6 6M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.7 2.7 0 0 0 16 4a2.7 2.7 0 0 0-5 1.8c0 1.1.8 2 1.5 2.7L16 12z"/></svg>'
export const SVG_BRIEFCASE = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>'
export const SVG_USERS = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
export const SVG_COINS = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>'
export const SVG_CLOCK = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'

const BANNER_PLACEHOLDER = '/img/banner.jpg'
const AD_PLACEHOLDER = '/img/ClubAdvirtisment.png'

// The bundled Rotary-theme banners that ship in /images. The C# probes the file
// system with Server.MapPath; the SPA can't stat files, so the shipped set is
// listed here instead (keep in step with public/images/theme-*.png).
const THEME_BANNER_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]

/**
 * Bundled Rotary-theme banner for the selected year, or null.
 * `dir` lets warm-modern supply its 16:5 full-bleed versions.
 */
export function themeBannerForYear(yearLabel, dir = 'images') {
  if (!yearLabel || !String(yearLabel).trim()) return null
  const m = String(yearLabel).match(/(\d{4})/)
  if (!m) return null
  const start = parseInt(m[1], 10)
  if (!THEME_BANNER_YEARS.includes(start)) return null
  return '/' + dir.replace(/^\/+/, '') + '/theme-' + start + '-' + (start + 1) + '.png'
}

function uploadsFallback(apiPath, kind) {
  if (!apiPath || !String(apiPath).trim()) return ''
  let file = String(apiPath).replace(/\/+$/, '')
  const slash = file.lastIndexOf('/')
  if (slash >= 0) file = file.slice(slash + 1)
  if (!file) return ''
  return appSettings.MediaBaseUrl + '/uploads/' + kind + '/' + file
}

/**
 * Ordered URL candidates for one banner/ad image, BEST FIRST — the first is used
 * as the img src, the rest become its data-fallbacks chain.
 *
 * The API hands out /Documents/WebsiteData/Group<id>/{BANNERS,ADVERTISEMENT}/<file>
 * for every image, but that path only resolves for SOME of them. There are two
 * upload generations behind it, and the FILENAME is what tells them apart
 * (measured live across six clubs, 25 images):
 *
 *   GUID name   "e2e31bc4-…-4cc109962da0.jpg"   /uploads/ 20/20   API path  3/20
 *   legacy name "Banners300420260238467932021PM.png"  /uploads/ 0/5   API path 5/5
 *
 * So demote the API's own URL only for the GUID generation, which is the one that
 * actually lives under /uploads/. Demoting BOTH — what this did before — made the
 * five legacy files 404 on every page load before the fallback recovered them.
 * The loser is always kept as a fallback rather than dropped, so a wrong guess
 * still renders and a backend fix wins automatically with no code change.
 *
 * The filename is a proxy for "which uploader wrote this file", not a rule the
 * backend guarantees. The real fix is server-side (Media:RedirectBaseUrl), after
 * which the API path resolves for everything and this ordering stops mattering.
 */
const GUID_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i

export function mediaCandidates(apiPath, kind, lastResort) {
  const apiUrl = mediaUrl(apiPath)
  const uploadsUrl = uploadsFallback(apiPath, kind)
  const documentsShape = !!apiPath && String(apiPath).toLowerCase().includes('/documents/')
  const guidNamed = GUID_FILENAME.test(String(apiPath || '').split('/').pop())

  const ordered = documentsShape && guidNamed && uploadsUrl
    ? [uploadsUrl, apiUrl, lastResort]
    : [apiUrl, uploadsUrl, lastResort]

  const seen = new Set()
  const list = []
  for (const u of ordered) {
    if (!u) continue
    const k = u.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    list.push(u)
  }
  // Never hand back an empty list — callers index [0] unconditionally.
  if (list.length === 0) list.push('')
  return list
}

const joinFallbacks = (urls) => urls.filter(Boolean).join('|')

/** Real link opens a new tab; "#" is inert. Spread onto the ad's/banner's <a>. */
export function adAnchorProps(url) {
  if (!url || url === '#') {
    return { onClick: (e) => { e.preventDefault() }, style: { cursor: 'default' }, 'aria-disabled': 'true', tabIndex: -1 }
  }
  return { target: '_blank', rel: 'noopener noreferrer' }
}

/** File extensions an ad document can have — used to tell "club.org" (a link the
 *  admin typed) from "poster.pdf" (a file they uploaded). */
const AD_FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|jpe?g|png|gif|webp|svg|bmp|tiff?)$/i
/** A bare host with no scheme: "www.club.org", "club.org/offer", "club.co.in?x=1" */
const BARE_HOST = /^[a-z0-9][\w-]*(\.[\w-]+)+([/?#]|$)/i

/**
 * Where an advertisement's <a href> points.
 *
 * `documentPath` carries EITHER an uploaded file (a PDF/poster) or a link the
 * admin typed into the dashboard. Three things the naive version got wrong:
 *
 *  1. A link typed WITHOUT a scheme — "www.club.org" — is a bare host, and a
 *     browser resolves that as a RELATIVE path. It used to be handed to
 *     mediaUrl(), so clicking the ad went to
 *     `<MediaBaseUrl>/www.club.org` and 404'd. Admins type links without
 *     "https://" constantly, so this broke most link ads.
 *     (Mirrors RotaryPage.ExternalUrl on the ASP.NET side.)
 *  2. A full URL was found with indexOf('http'), which also fires on a FILE
 *     path that merely contains those letters (".../http-banner.pdf" would be
 *     sliced into a nonsense URL). Matched as a real URL now.
 *  3. An uploaded file forced the /uploads/ path. But which base works depends
 *     on the uploader generation — mediaCandidates() already encodes that
 *     (GUID-named files live under /uploads/<kind>/, legacy-named ones under
 *     the API path, measured across six clubs). An <a> has no onerror to
 *     recover with, so its FIRST candidate must be the right one; reuse that
 *     ordering instead of a cruder always-/uploads/ guess.
 */
/** A newsletter's linkUrl: a URL or other scheme (mailto:) as typed, a typed host ("www.x.com/a") with
 *  https://, anything else (Documents/..., uploads/..., /x.pdf) a media path - same split as adLink. */
export function newsletterLink(linkUrl) {
  const raw = String(linkUrl).trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw
  if (raw.startsWith('//')) return 'https:' + raw
  const isFilePath = raw.startsWith('/') || /(^|\/)(documents|uploads)\//i.test(raw)
  if (!isFilePath && !AD_FILE_EXT.test(raw) && BARE_HOST.test(raw)) return 'https://' + raw
  return mediaUrl(raw)
}

function adLink(documentPath, kind = 'advertisement') {
  const raw = (documentPath == null ? '' : String(documentPath)).trim()
  if (!raw) return '#'

  const url = raw.match(/https?:\/\/[^\s"'<>]+/i)   // a real URL, even mid-sentence
  if (url) return url[0]
  if (raw.startsWith('//')) return 'https:' + raw   // protocol-relative

  // A server file path starts with a slash or names a known media folder;
  // anything else that looks like a domain is a link the admin typed.
  const isFilePath = raw.startsWith('/') || /(^|\/)(documents|uploads)\//i.test(raw)
  if (!isFilePath && !AD_FILE_EXT.test(raw) && BARE_HOST.test(raw)) return 'https://' + raw

  if (raw.endsWith('/')) return '#'                 // folder only — nothing was uploaded
  return mediaCandidates(raw, kind, '')[0] || '#'
}
export { adLink as _adLink }   // exported for selfcheck only

/**
 * Where a banner / advertisement slide points when the visitor clicks the image.
 *
 * The dashboard offers the admin EITHER of two things per slide, never both at
 * once in practice: a link they type (`linkUrl`) or a file they upload
 * (`documentPath` — a PDF, or a second image such as a full-size poster). Both
 * arrive on the same row, so this takes the typed link first and falls back to
 * the uploaded file; the result always opens in a new tab (adAnchorProps).
 *
 * Returns '' when the slide carries neither, so callers can render a plain <img>
 * instead of a dead anchor. `linkUrl` goes through adLink() too rather than being
 * used raw — admins type "www.club.org" without a scheme constantly, and a bare
 * host in an href resolves as a RELATIVE path (mirrors RotaryPage.ExternalUrl).
 *
 * `documentPath` is resolved against the SAME uploads/API candidate ordering the
 * image uses (mediaCandidates), so a GUID-named upload gets the /uploads/ URL
 * that actually resolves — an <a> has no onerror to recover with.
 */
export function slideLink(row, kind) {
  if (!row) return ''
  const typed = adLink(row.linkUrl, kind)
  if (typed !== '#') return typed
  const doc = adLink(row.documentPath, kind)
  return doc === '#' ? '' : doc
}

// ── Avenue label/color (mirrors src/data/projects.js) ───────────────────────
function avenueLabelOf(moduleKey) {
  switch (avenueFromModuleKey(moduleKey)) {
    case 'CP': return 'Community Service'
    case 'CS': return 'Club Service'
    case 'VS': return 'Vocational Service'
    case 'NGS': return 'New Generation Service'
    case 'IS': return 'International Service'
    case 'PII': return 'Public Image Initiative'
    case 'CE': return 'Club Events'
    default: return moduleKey || ''
  }
}

function avenueColorOf(moduleKey) {
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

/** Rotary year label "2025-26" -> [2025-07-01, 2026-07-01). */
function rotaryYearRange(label) {
  if (!label || !String(label).trim()) return null
  const m = String(label).match(/(\d{4})/)
  if (!m) return null
  const start = parseInt(m[1], 10)
  return [new Date(start, 6, 1), new Date(start + 1, 6, 1)]
}

/** HTML or plain text -> one line of plain text. Tags dropped, the handful of
 *  entities the API actually emits decoded, every run of whitespace (the
 *  non-breaking kind included - `\s` covers U+00A0) collapsed to one space. */
export function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&#0*160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n) => String(n).padStart(2, '0')
/** "dd MMM yyyy" — invariant, matching the C# formatting. */
export function formatDate(d) {
  return pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}
/** "h:mm tt" — invariant. */
/** "7:00 PM", plus the club's zone label when `zone` is given ("7:00 PM EDT"; see site/zone.js). */
export function formatTime(d, zone) {
  const h24 = d.getHours()
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  const label = zone ? zoneLabel(d, zone) : ''
  return h + ':' + pad2(d.getMinutes()) + ' ' + (h24 < 12 ? 'AM' : 'PM') + (label ? ' ' + label : '')
}

// ── The hook ────────────────────────────────────────────────────────────────
const EMPTY = {
  loading: true,
  banners: [], ads: [], featured: [], leaders: [], newsletters: [], events: [],
  projectStats: [], membershipStats: [], impactNumbers: { projects: 0, totalCost: 0, manHours: 0, beneficiaries: 0, currency: null },
  currency: null,
  meetingDay: '—', meetingTime: '—', meetingVenue: '—', mapUrl: '', mapEmbedUrl: '',
  eventsCount: 0, newslettersCount: 0, featuredCount: 0,
}

/**
 * Everything the Home pages need, in one call.
 * @param {object} opts
 *   featuredTake — classic passes 4 (its 4-up grid has no scroller); the other
 *                  themes leave it uncapped and carry the whole list in a scroller.
 *   newsletterTake — classic shows 4, the warm rail asks for 2.
 *   bannerDir — 'images' by default; warm-modern points at its 16:5 art.
 */
export function useHomeData(raw, { featuredTake = Infinity, newsletterTake = 4, bannerDir = 'images' } = {}) {
  const club = useClub()
  return useMemo(() => buildHomeData(raw, club, { featuredTake, newsletterTake, bannerDir }),
    [raw, club, featuredTake, newsletterTake, bannerDir])
}

/** The raw API results the home pages are built from; fetched on the server (themes/shared/loaders.ts). */
function buildHomeData(raw, club, { featuredTake, newsletterTake, bannerDir }) {
  if (!raw) return EMPTY
  const { selectedYearLabel, clubName } = club
  const {
    banners: rawBanners = [], ads: rawAds = [], impact = null, projects: allProjects = [], meetings = [],
    directory = [], about = null, upcoming = [], newsletters: rawNewsletters = [], ip = null, dg = null, bod = [],
  } = raw
  const newsletters = (rawNewsletters || []).slice(0, newsletterTake)
  {
      // ── Hero: banners + ads with the uploads-path fallback chains ────────
      const themeFallback = themeBannerForYear(selectedYearLabel, bannerDir) || BANNER_PLACEHOLDER

      // A banner/ad row can carry a click target (typed link OR uploaded
      // document) — see slideLink(). `url` is '' on a banner with neither, which
      // is how each theme decides between an <a> and a plain <img>; the ad list
      // keeps its older '#'-means-inert contract since every theme already
      // renders its ad slides as anchors.
      const banners = [...rawBanners]
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .filter((b) => b.bannerImagePath && String(b.bannerImagePath).trim())
        .map((b) => {
          const c = mediaCandidates(b.bannerImagePath, 'banner', themeFallback)
          return {
            src: c[0],
            fallbacks: joinFallbacks(c.slice(1)),
            url: slideLink(b, 'banner'),
            title: (b.description || '').trim(),
          }
        })
      if (banners.length === 0) {
        banners.push({ src: themeFallback, fallbacks: joinFallbacks([BANNER_PLACEHOLDER]), url: '', title: '' })
      }

      const ads = [...rawAds]
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .filter((a) => a.advertisementImagePath && String(a.advertisementImagePath).trim())
        .map((a) => {
          const c = mediaCandidates(a.advertisementImagePath, 'advertisement', AD_PLACEHOLDER)
          return {
            img: c[0],
            url: slideLink(a, 'advertisement') || '#',
            fallbacks: joinFallbacks(c.slice(1)),
            title: (a.description || '').trim(),
          }
        })
      if (ads.length === 0) {
        ads.push({ img: AD_PLACEHOLDER, url: '#', fallbacks: joinFallbacks([AD_PLACEHOLDER]), title: '' })
      }

      // ── Impact stats (projects excl. CS/CE + membership) ─────────────────
      // Count MAIN projects only, like the Projects page grid: a repeat-instance
      // child stays out of the Projects counter. Cost/hours/beneficiaries keep
      // including children — each instance is real impact.
      // > 0, not "is set": the API sends parentProjectId = 0 for many TOP-LEVEL rows.
      let projectCount
      if (allProjects.length > 0) {
        projectCount = allProjects.filter((p) => {
          if (p.parentProjectId > 0) return false
          const a = avenueFromModuleKey(p.moduleKey)
          return a !== 'CS' && a !== 'CE'
        }).length
      } else {
        projectCount = Math.max(0, (impact?.projectCount || 0) - meetings.length)
      }

      // v2/impact answers `currency` itself; club.currency (from v2/about) is the
      // same value and covers the case where impact 204s.
      const currency = (impact && impact.currency) || club.currency
      const impactNumbers = {
        currency,
        projects: projectCount,
        totalCost: Math.trunc(impact?.totalProjectCost || 0),
        manHours: impact?.totalManHours || 0,
        beneficiaries: impact?.totalDirectBeneficiaries || 0,
      }

      const projectStats = buildProjectStatTiles(impactNumbers)

      // Members counter = ACTIVE members only; honorary members are excluded.
      const members = directory.filter((m) => !m.isHonorary).length
      const membershipStats = [{ icon: SVG_USERS, value: members, prefix: '', label: 'Members', placeholder: '' }]

      // ── Home projects strip: every avenue EXCEPT Club Service and Club
      //    Events (club-internal housekeeping). Photo-first, then newest.
      const featured = allProjects
        .filter((p) => !(p.parentProjectId > 0))
        .filter((p) => { const a = avenueFromModuleKey(p.moduleKey); return a !== 'CS' && a !== 'CE' })
        .sort((a, b) => {
          const pa = a.primaryPhotoPath ? 1 : 0, pb = b.primaryPhotoPath ? 1 : 0
          if (pa !== pb) return pb - pa
          const da = a.projectDate ? new Date(a.projectDate).getTime() : -Infinity
          const db = b.projectDate ? new Date(b.projectDate).getTime() : -Infinity
          return db - da
        })
        .slice(0, featuredTake === Infinity ? undefined : featuredTake)
        .map((p) => ({
          id: p.id,
          title: p.title,
          desc: p.description,
          avenueLabel: avenueLabelOf(p.moduleKey),
          avenueColor: avenueColorOf(p.moduleKey),
          img: mediaUrl(p.primaryPhotoPath),
        }))

      // ── Meeting info + map ───────────────────────────────────────────────
      let meetingDay = '—', meetingTime = '—', meetingVenue = '—'
      if (about) {
        meetingDay = about.meetingDay || '—'
        meetingTime = !about.meetingFromTime ? '—'
          : about.meetingFromTime + (!about.meetingToTime ? ' onwards' : ' - ' + about.meetingToTime)
        // a part typed with its own trailing comma ("Thane,") must not print "Thane,, Thane"
        meetingVenue = [about.meetingAddress, about.city, about.state, about.pincode]
          .map((s) => String(s || '').trim().replace(/[\s,]+$/, '')).filter(Boolean).join(', ') || '—'
      }
      const mapQuery = meetingVenue === '—' ? (clubName || 'Rotary') : meetingVenue
      const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery)
      const mapEmbedUrl = 'https://maps.google.com/maps?q=' + encodeURIComponent(mapQuery) + '&z=16&output=embed'

      // ── Upcoming events (year-scoped, soonest single card) ───────────────
      const evRange = rotaryYearRange(selectedYearLabel)
      const events = upcoming
        .filter((ev) => ev.eventDate)
        .map((ev) => ({ ev, d: new Date(ev.eventDate) }))
        .filter(({ d }) => !evRange || (d >= evRange[0] && d < evRange[1]))
        .sort((a, b) => a.d - b.d)
        .slice(0, 1)
        .map(({ ev, d }) => ({
          id: ev.id,
          title: ev.title,
          venue: !ev.venue || !String(ev.venue).trim() ? 'Venue to be announced' : String(ev.venue).trim(),
          mon: MONTHS[d.getMonth()],
          day: pad2(d.getDate()),
          // ADDITIVE, like `bio` on the leaders above: handloom's event card
          // prints day / month / year as three stacked lines, and `date` is one
          // formatted string it would have to take apart again. The other six
          // themes never read this key.
          year: String(d.getFullYear()),
          date: formatDate(d),
          time: (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) ? '' : formatTime(d, club.timeZone),
          img: mediaUrl(ev.imagePath) || '/images/event/e-2.jpg',
          desc: !ev.description || !String(ev.description).trim() ? '' : String(ev.description).trim(),
        }))

      // ── LOCAL PREVIEW ONLY — never reaches a deployed site ───────────────
      // Two photographs supplied for previewing the home event section (user,
      // 2026-08-24). They are hotlinked from a third-party news site, so they
      // must NOT ship: 1307 club sites would be publishing someone else's
      // pictures from a server nobody here controls. isLocalRequest() is the
      // same gate ?theme= and DevHostOverride use, so a production build cannot
      // reach this. To put these on a real site, upload them to the event in the
      // dashboard — then they arrive through ev.imagePath like any other photo.
      if (isLocalRequest() && PREVIEW_EVENT_IMAGES.length) {
        events.forEach((e, i) => {
          if (PREVIEW_EVENT_IMAGES[i]) e.img = PREVIEW_EVENT_IMAGES[i]
        })
      }

      // ── Newsletters ──────────────────────────────────────────────────────
      // day / mon / year are ADDITIVE, same as `year` on the events above:
      // handloom's newsletter row prints the date as a stacked plate and `date`
      // is one formatted string it would have to take apart again. They are
      // '' when the API sends no publish date, which is what the row tests.
      const newsletterItems = newsletters.map((n) => {
        const d = n.publishDateTime ? new Date(n.publishDateTime) : null
        const ok = d && !isNaN(d)
        return {
          title: n.title,
          date: ok ? formatDate(d) : '',
          day: ok ? pad2(d.getDate()) : '',
          mon: ok ? MONTHS[d.getMonth()] : '',
          year: ok ? String(d.getFullYear()) : '',
          url: n.linkUrl ? newsletterLink(n.linkUrl) : mediaUrl(n.filePath),
        }
      })

      // ── Dignitaries & leaders (RI President / DG / President / Secretary) ─
      // `bio` on the two dignitaries is `description` off the same records the
      // /dignitary page prints in full - flattened to text, because the RI
      // President's arrives as <p> HTML with every word joined by &nbsp;
      // (see buildBioHtml). ADDITIVE, like the leaders' bio below: handloom's
      // leadership card shows the first lines when it has the width to.
      const leaders = []
      if (ip && ip.name) {
        leaders.push({ name: ip.name, role: ip.designation || 'RI President', img: mediaUrl(ip.profilePhotoPath), bio: plainText(ip.description), type: 1 })
      } else {
        leaders.push({ name: 'Not available', role: 'RI President', img: '/img/profile_pic.png', type: 1 })
      }
      if (dg && dg.memberName) {
        leaders.push({ name: dg.memberName, role: 'District Governor', img: mediaUrl(dg.profilePhoto), bio: plainText(dg.description), type: 2 })
      } else {
        leaders.push({ name: 'Not available', role: 'District Governor', img: '/img/profile_pic.png', type: 2 })
      }
      // `bio` is memberIntroduction off the v2/bod row — the same free text the
      // /dignitary page prints in full. Carried here so handloom's hero can show
      // the first few lines beside the portrait. ADDITIVE: the other six themes
      // never read it, and nothing iterates these keys.
      const pres = bod.find((b) => (b.designation || '').toLowerCase().includes('president'))
      if (pres) leaders.push({ name: pres.memberName, role: pres.designation, img: mediaUrl(pres.profilePhotoPath), bio: pres.memberIntroduction || '', type: 4 })
      const secy = bod.find((b) => (b.designation || '').toLowerCase().includes('secretary'))
      if (secy) leaders.push({ name: secy.memberName, role: secy.designation, img: mediaUrl(secy.profilePhotoPath), bio: secy.memberIntroduction || '', type: 5 })

      return ({
        loading: false,
        banners, ads, featured, leaders,
        newsletters: newsletterItems, events,
        projectStats, membershipStats, impactNumbers, currency,
        meetingDay, meetingTime, meetingVenue, mapUrl, mapEmbedUrl,
        eventsCount: events.length,
        newslettersCount: newsletterItems.length,
        featuredCount: featured.length,
        about, impact,
      })
  }
}

/**
 * The four project stat tiles for a set of raw impact numbers.
 *
 * The cost prefix follows the CLUB's currency, carried on `n.currency` (put
 * there by useHomeData / getImpactNumbersForYear) rather than passed as a second
 * argument — that keeps every existing call site working, including the two
 * themes that sum their own multi-year aggregate. Missing => INR, so the Indian
 * clubs are unchanged.
 */
export function buildProjectStatTiles(n) {
  return [
    { icon: SVG_BRIEFCASE, value: n.projects, prefix: '', label: 'Projects', placeholder: '' },
    { icon: SVG_COINS, value: n.totalCost, prefix: moneySymbol(n.currency), label: 'Total Cost', placeholder: '' },
    { icon: SVG_CLOCK, value: n.manHours, prefix: '', label: 'Man Hours', placeholder: '' },
    { icon: SVG_HEART, value: n.beneficiaries, prefix: '', label: 'Beneficiaries', placeholder: '' },
  ]
}

/**
 * The verdigris counter band sums the same per-year numbers across every Rotary
 * year for its "All years" default, so the aggregate stays an honest sum rather
 * than a re-estimate.
 */
export async function getImpactNumbersForYear(clubId, yearId) {
  const [impact, allProjects, meetings] = await Promise.all([
    api.getImpact(clubId, yearId),
    api.getProjects(clubId, yearId),
    api.getMeetings(clubId, yearId),
  ])
  let projects
  if (allProjects.length > 0) {
    projects = allProjects.filter((p) => {
      if (p.parentProjectId > 0) return false
      const a = avenueFromModuleKey(p.moduleKey)
      return a !== 'CS' && a !== 'CE'
    }).length
  } else {
    projects = Math.max(0, (impact?.projectCount || 0) - meetings.length)
  }
  return {
    currency: impact?.currency || null,
    projects,
    totalCost: Math.trunc(impact?.totalProjectCost || 0),
    manHours: impact?.totalManHours || 0,
    beneficiaries: impact?.totalDirectBeneficiaries || 0,
  }
}
