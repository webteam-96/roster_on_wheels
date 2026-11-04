'use client'
// Port of AllProjects.aspx + AllProjects.aspx.cs — the Projects listing and the
// legacy "Club Services" (?pr=CE) meetings view.
//
// TWO FORCED DIFFERENCES, both noted again at the point of use:
//  1) ProjectHierarchy.GetChildIds() reads parent_project_id straight from MySQL
//     as a stand-in for the API field, which a browser can't do. The C# already
//     prefers the API whenever ANY row carries parentProjectId > 0 (production
//     does), so the DB fallback is dormant there and simply absent here.
//  2) The page's inline <script> filtered/paged the grid by toggling classes on
//     the rendered cards. A <script> tag in JSX never executes, so the same
//     logic runs as React state here — same class strings, same data-* attrs,
//     same 20-per-page windowed pager, same filtered stats bar.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { groupInt, formatMoney } from '@/themes/shared/money.js'
import { useTheme } from '@/site/theme.js'
import * as api from '@/site/clubApi.js'
import { media, withYear, avenueCode, avenueLabel, avenueColor, apiBase, wheelFallback, PHOTO_BOX } from '@/themes/shared/rotaryPage.js'
import Breadcrumb, { enc } from '@/themes/shared/Breadcrumb.jsx'
import { formatDate } from '@/themes/shared/homeData.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useProjectsGold, useProjectFacets, useAllYearsTotals } from '@/themes/gold/pages/goldData.js'
import { useProjectScope, ScopeSwitch } from '@/themes/_shared/kit.jsx'

// whole photo (object-contain): the theme's .img-zoom hover scale would crop it again; inline beats it
const NO_ZOOM = { transform: 'none' }

// Avenue codes hidden from the Projects page (mirrors src/pages/Projects.jsx).
// "Club Events" (CE) duplicates the dedicated Meetings page and "Club
// Service" (CS) is excluded by request.
const HiddenAvenues = ['CE', 'CS']

// Canonical avenue ordering for the filter tabs.
const AvenueOrder = ['CP', 'VS', 'NGS', 'IS', 'PII']

const PAGE_SIZE = 20

// ── Normalisation helpers (AllProjects.aspx.cs) ─────────────────────────────
// Free-text/area & category values arrive inconsistently cased and padded (e.g.
// "DISEASE PREVENTION AND TREATMENT "). Normalise to a stable key for
// grouping/filtering, and prettify for display.
function normKey(raw) {
  if (raw === null || raw === undefined || !String(raw).trim()) return ''
  return String(raw).trim().replace(/\s+/g, ' ').toUpperCase()
}

function prettyText(key) {
  if (!key) return ''
  // TextInfo.ToTitleCase over the lower-cased key.
  let s = String(key).toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (_m, p, c) => p + c.toUpperCase())
  // lower-case the usual small connecting words for a natural label
  s = s.replace(/ And /g, ' and ').replace(/ Of /g, ' of ').replace(/ The /g, ' the ')
       .replace(/ For /g, ' for ').replace(/ In /g, ' in ').replace(/ On /g, ' on ')
  return s
}

// ── Project type (one_time / ongoing) ───────────────────────────────────────
function typeKey(raw) {
  return raw === null || raw === undefined || !String(raw).trim() ? '' : String(raw).trim().toLowerCase()
}

function typeLabel(key) {
  switch (key) {
    case 'one_time': return 'Onetime Projects'
    case 'ongoing': return 'Ongoing / Repeat Projects'
    default: return prettyText(normKey(key))
  }
}

function typeOrder(key) {
  switch (key) { case 'one_time': return 0; case 'ongoing': return 1; default: return 2 }
}

// ── Rotary's seven canonical Areas of Focus ─────────────────────────────────
// The API's free-text areaOfFocus is mapped onto these by keyword so the
// Area-of-Focus filter shows only the official areas (not legacy/avenue-
// specific labels like "Vocational Awards" or "News Paper coverage").
//
// Match on whole words (not raw substrings) so a short keyword like "WASH"
// can't false-match "WASHINGTON"/"CAR WASH". The Canonical list order encodes
// priority: the first area with a whole-word keyword hit wins.
const Canonical = [
  { key: 'peacebuilding', label: 'Peacebuilding and Conflict Prevention', match: ['PEACE', 'CONFLICT'] },
  { key: 'disease',       label: 'Disease Prevention and Treatment',      match: ['DISEASE'] },
  { key: 'water',         label: 'Water, Sanitation and Hygiene',         match: ['WATER', 'SANITATION', 'HYGIENE', 'WASH'] },
  { key: 'maternal',      label: 'Maternal and Child Health',             match: ['MATERNAL', 'CHILD HEALTH'] },
  { key: 'education',     label: 'Basic Education and Literacy',          match: ['EDUCATION', 'LITERACY'] },
  { key: 'economic',      label: 'Community Economic Development',        match: ['ECONOMIC'] },
  { key: 'environment',   label: 'Environment',                           match: ['ENVIRONMENT'] },
].map((c) => ({ ...c, re: new RegExp('\\b(?:' + c.match.join('|') + ')\\b') }))

function canon(normArea) {
  if (!normArea) return null
  for (const c of Canonical) if (c.re.test(normArea)) return c
  return null
}

/** Canonical area KEY for a raw areaOfFocus, or "" when it isn't a Rotary area. */
function areaKeyOf(rawArea) {
  const c = canon(normKey(rawArea))
  return c ? c.key : ''
}

function labelForAreaKey(key) {
  const c = Canonical.find((x) => x.key === key)
  return c ? c.label : key
}

// Sort the dropdown by Rotary's canonical order, not alphabetically.
function canonOrder(key) {
  for (let i = 0; i < Canonical.length; i++) if (Canonical[i].key === key) return i
  return Number.MAX_SAFE_INTEGER
}

// avenueLabel/avenueColor accept a module key, so round-trip the avenue code
// back through a representative module key for the tab label.
function moduleKeyOf(code) {
  switch (code) {
    case 'CP': return 'community_service'
    case 'VS': return 'vocational_service'
    case 'NGS': return 'new_generation_service'
    case 'IS': return 'international_service'
    case 'PII': return 'public_image'
    default: return code
  }
}

/**
 * Card footer date cell: calendar icon + formatted date, or empty (so a project
 * with no date shows nothing rather than a lone icon). An HTML string in the
 * C# (DateCell), so it stays one here and is injected as-is.
 */
function dateCell(d) {
  if (!d) return ''
  return '<svg class="h-3.5 w-3.5 shrink-0 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' + enc(d)
}

/**
 * "8 updates" pill for a project that owns child projects.
 *
 * Every class here is already on the avenue chip a few pixels to its left, so
 * it is guaranteed to exist in each theme's PRE-COMPILED stylesheet — this repo
 * has no Tailwind build, and a class that isn't already compiled is an inert
 * string. Gold has its own card markup and its own rule (.gpr-card__upd).
 *
 * bg-navy/text-white rather than the brighter bg-gold/text-navy: every theme
 * remaps those two tokens to its own palette, and on warm-modern gold resolves
 * to coral with brown text -- 2.7:1, unreadable at 10px. Navy-on-white clears
 * 9:1 in all five shared themes.
 *
 * BOTTOM-right, not top-right, and that is not cosmetic. The avenue chip sits at
 * top-LEFT and its width is the label's: "New Generation Service" measures 182px
 * on verdigris, which at the 1280px breakpoint (287px card) leaves the top row
 * 3px SHORT -- the two chips overlap. The bottom edge of the media box is empty
 * on every theme (warm's date is bottom-left, at the other end), so putting it
 * there makes the collision impossible instead of merely unlikely.
 */
export function UpdatesPill({ n }) {
  if (!(n > 0)) return null
  return (
    <span className="absolute bottom-3 right-3 rounded-full bg-navy px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow">
      {n} update{n === 1 ? '' : 's'}
    </span>
  )
}

// DateTime.MinValue stand-in: dateless (or unparseable) projects sink to the
// bottom of the newest-first sort. A real -Infinity would make the comparator
// return NaN when two dateless rows meet, which breaks the sort.
const NO_DATE = -8.64e15
function dateVal(p) {
  if (!p.projectDate) return NO_DATE
  const t = new Date(p.projectDate).getTime()
  return Number.isNaN(t) ? NO_DATE : t
}

// ── Client-side metric fetch helpers (from the page's inline <script>) ───────
function pool(items, limit, worker) {
  let i = 0
  function next() { return i >= items.length ? Promise.resolve() : Promise.resolve(worker(items[i++])).then(next) }
  const runners = []
  for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(next())
  return Promise.all(runners)
}

// `currency` omitted => INR, so every existing caller (and the Indian clubs)
// render exactly as before. See shared/money.js.
function fmtInt(n, currency) { return groupInt(n, currency) }
function fmtCost(n, currency) { return formatMoney(n, currency, { compact: true }) }

// Page numbers to show: always 1 & last, plus a window around the current page.
function windowed(cur, total) {
  const out = []
  let last = 0
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || (p >= cur - 2 && p <= cur + 2)) {
      if (last && p - last > 1) out.push('...')
      out.push(p); last = p
    }
  }
  return out
}


/**
 * BindProjects() — one API payload in, everything the listing needs out.
 *
 * Lifted out of the effect below so the GOLD theme's own Projects page (which
 * has a completely different composition but the identical data contract) reads
 * the same rules instead of restating them. The two views must always agree on
 * what counts as a project, which avenue it belongs to, and which filter options
 * exist; one function is the only way to guarantee that.
 */
/** A row filed the Community Service way: a Rotary area of focus, or the Community Service avenue. */
const isAreaRow = (p) => !!areaKeyOf(p.areaOfFocus) || avenueCode(p.moduleKey) === 'CP'

export function buildProjectsView(source, isMeetings) {
  // Show & count MAIN projects only — a child project (a repeat instance of an
  // ongoing project, carrying its main's id in parentProjectId) is hidden from the
  // grid and the counts; it appears inside its main project's detail page instead.
  // NOTE: a project is a child only when parentProjectId is > 0. The API sends
  // parentProjectId = 0 (not null) for many top-level rows — 55 of RC Madras East's
  // 342 projects in 2025-26 — so testing "is set" alone hid them. That is how the
  // real "Feeding the Needy" parent (7295, the one owning 48 repeat instances)
  // vanished from the grid while its childless ongoing_repeat duplicate (170329,
  // parentProjectId = null) stayed, making the updates look lost.
  // (The C#'s ProjectHierarchy DB fallback for a not-yet-deployed API can't run in
  // a browser — see the header note.)
  const list = source
    .filter((p) => !(p.parentProjectId > 0))
    // Newest work first (user call 2026-07-23): order by project date,
    // latest date at the top. Dateless projects sink to the bottom
    // (MinValue); the sort is stable, so they keep API order among themselves.
    .sort((a, b) => dateVal(b) - dateVal(a))
    .map((p) => ({
      id: p.id,
      // The project's own Rotary year: the all-years tag, else the row's own (v2/projects rows carry it) -
      // its detail is fetched/linked under that year (ids repeat across years, see clubService.js)
      yearId: p._yearId != null ? p._yearId : (p.yearId || null),
      uid: p.id + '@' + (p._yearId != null ? p._yearId : (p.yearId || '')),
      // How many child projects (repeat instances / "updates") hang off this
      // one. They are deliberately NOT grid cards of their own — they would
      // duplicate the parent N times — but hiding them with no trace is what
      // made clubs report "my updates never appeared". The card carries the
      // count so the work is visible from the listing and the detail page is
      // where it is read. v2/projects supplies childCount; it agrees with the
      // detail payload's children.length (verified across all of club 1's years).
      updates: p.childCount > 0 ? p.childCount : 0,
      title: p.title || '',
      desc: p.description || '',
      avenue: avenueCode(p.moduleKey),
      avenueLabel: avenueLabel(p.moduleKey),
      avenueColor: avenueColor(p.moduleKey),
      // Canonical Rotary Area-of-Focus KEY (one of the 7, or "" when the
      // raw value isn't a Rotary area) drives the area dropdown + data-area.
      area: areaKeyOf(p.areaOfFocus),
      // Sub-area = the project "category" (e.g. Heart Surgeries) — drives the
      // cascading sub-area dropdown + data-subarea. Only Community Service files a Rotary
      // area + category + subCategory; the dashboard files the other avenues one level up:
      // their category ("Career Guidance", "RYLA (National)") in areaOfFocus and their sub
      // category ("Career Guidance & Career Fair") in category (347 projects, 4 clubs, 2026-10-15).
      subArea: normKey(isAreaRow(p) ? p.category : p.areaOfFocus),
      // the sub category the list already carries (other avenues); Community Service's comes from
      // the per-project detail (subCategory) - see goldData's subCatOf
      subCat: isAreaRow(p) ? '' : normKey(p.category),
      // Project type (one_time / ongoing) — drives the Project-Type filter.
      type: typeKey(p.projectType),
      // Project date shown beside "Read More" (was the yellow area text).
      date: p.projectDate ? formatDate(new Date(p.projectDate)) : '',
      img: media(p.primaryPhotoPath),
      // Per-project impact metrics for the filtered stats bar. 0 until the API
      // returns them on v2/projects (see PublicProjectDto) — the bar then shows.
      cost: p.projectCost || 0,
      beneficiaries: p.directBeneficiaries || 0,
      rotarians: p.rotariansInvolved || 0,
      manHours: p.manHours || 0,
    }))
    .filter((p) => isMeetings || !HiddenAvenues.includes(p.avenue))

  // Area-of-Focus dropdown = only the canonical Rotary areas actually present,
  // in Rotary's canonical order. (Projects view only — Club Services carry none.)
  const areaCounts = new Map()
  for (const p of list) if (p.area) areaCounts.set(p.area, (areaCounts.get(p.area) || 0) + 1)
  const areas = [...areaCounts].map(([k, n]) => ({ value: k, label: labelForAreaKey(k), count: n }))
  areas.sort((a, b) => canonOrder(a.value) - canonOrder(b.value))

  // Sub-area dropdown options: distinct (area, category) pairs, each tagged with
  // its parent area key so the dropdown cascades from the selected Area of Focus.
  const subCounts = new Map()
  for (const p of list) {
    if (!p.area || !p.subArea) continue
    // Composite key: a sub-area is a multi-word category ("HEART SURGERIES"),
    // so it is split on the FIRST separator only.
    const k = p.area + '|' + p.subArea
    subCounts.set(k, (subCounts.get(k) || 0) + 1)
  }
  const subs = [...subCounts].map(([k, n]) => {
    const i = k.indexOf('|')
    const areaKey = k.slice(0, i), value = k.slice(i + 1)
    return { areaKey, value, label: prettyText(value), count: n }
  })
  subs.sort((a, b) => {
    const x = a.label.toUpperCase(), y = b.label.toUpperCase()
    return x < y ? -1 : x > y ? 1 : 0
  })

  // Project-Type dropdown (Onetime / Ongoing-Repeat) — only the types actually
  // present, in a fixed order. Projects with no type appear only under "All".
  const typeCounts = new Map()
  for (const p of list) if (p.type) typeCounts.set(p.type, (typeCounts.get(p.type) || 0) + 1)
  const types = [...typeCounts].map(([k, n]) => ({ value: k, label: typeLabel(k), count: n }))
  types.sort((a, b) => typeOrder(a.value) - typeOrder(b.value))

  // Avenue filter tabs only apply to the projects view, not Club Services.
  let tabs = []
  if (!isMeetings) {
    const present = new Map()
    for (const p of list) present.set(p.avenue, (present.get(p.avenue) || 0) + 1)
    tabs = AvenueOrder.filter((c) => present.has(c)).map((code) => ({
      code,
      label: avenueLabel(moduleKeyOf(code)),
      count: present.get(code),
    }))
  }

  return {
    loading: false,
    projects: list,
    totalCount: list.length,
    avenueTabs: tabs,
    areaOptions: areas,
    subAreaOptions: subs,
    typeOptions: types,
  }
}

export { pool, fmtInt, fmtCost, windowed, PAGE_SIZE, normKey }

/**
 * The Theme 8 project filters, faceted (client, 2026-10-15): each dropdown lists only
 * what the OTHER choices leave, so no offered option answers 0 projects, and a dropdown
 * left with nothing is hidden by its theme. sel = { avenue, area, sub, sc, type } (the
 * category is `sub`, the subcategory `sc`); scOf(card) = the card's subcategory key.
 * The avenue chips are not faceted: a theme clears the dropdowns when the avenue changes.
 */
export function projectFacets(list, sel, scOf) {
  const is = (c, skip) => (!sel.avenue || c.avenue === sel.avenue)
    && (skip === 'area' || !sel.area || c.area === sel.area)
    && (skip === 'sub' || !sel.sub || c.subArea === sel.sub)
    && (skip === 'sc' || !sel.sc || scOf(c) === sel.sc)
    && (skip === 'type' || !sel.type || c.type === sel.type)
  const count = (skip, keyOf, label) => {
    const m = new Map()
    for (const c of list) { const k = keyOf(c); if (k && is(c, skip)) m.set(k, (m.get(k) || 0) + 1) }
    return [...m].map(([value, n]) => ({ value, label: label(value), count: n }))
  }
  const alpha = (a, b) => a.label.localeCompare(b.label)
  return {
    areaOptions: count('area', (c) => c.area, labelForAreaKey).sort((a, b) => canonOrder(a.value) - canonOrder(b.value)),
    subAreaOptions: count('sub', (c) => c.subArea, prettyText).sort(alpha),
    subCatOptions: count('sc', scOf, prettyText).sort(alpha),
    typeOptions: count('type', (c) => c.type, typeLabel).sort((a, b) => typeOrder(a.value) - typeOrder(b.value)),
  }
}

export default function AllProjects({ data }) {
  const club = useClub()
  const { isWarm } = useTheme()
  const location = useLocation()

  // Backward-compat: legacy URLs are AllProjects.aspx?pr=CP (Club Projects)
  // and AllProjects.aspx?pr=CE (Club Services / meetings).
  const pr = (new URLSearchParams(location.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  // Prefer the club's own menu label for this page (e.g. "Meetings") so the
  // heading + title match exactly what the user clicked, instead of the generic
  // "Club Services" / "Projects". Falls back to the generic label. (<Breadcrumb>
  // already applies CurrentMenuName() and SetTitle(), so only the fallback is
  // passed in here.)
  const pageHeading = isMeetings ? 'Club Services' : 'Projects'

  /**
   * Card link into ProjectDetail. Carries ?pr=CE on the Club Services view so the
   * detail page's "Back" returns HERE and not to /projects — the two views share
   * this component and the project payload has no marker to tell them apart.
   */
  const detailHref = (p) =>
    withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)

  /** Avenue code (CP/VS/NGS/IS/PII) used to pre-select a tab; "" = All. */
  const initialAvenue = (isMeetings || HiddenAvenues.includes(pr)) ? '' : pr

  // "Current year projects / All years projects" (client, 2026-10-28: the older themes too). Loading,
  // the per-project totals and the all-years fetch are the shared hook's (Gold and Theme 8 use it).
  const [scope, setScope] = useProjectScope()
  const d = useProjectsGold(isMeetings, scope, data.projects)
  const { projects, totalCount, avenueTabs } = d
  const allYears = d.scope === 'all'

  // ── Filter / pager state (the inline <script>) ────────────────────────────
  const [activeAvenue, setActiveAvenue] = useState(initialAvenue)
  const [activeArea, setActiveArea] = useState('')
  const [activeSub, setActiveSub] = useState('')
  const [activeSc, setActiveSc] = useState('')   // sub category
  const [activeType, setActiveType] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const topRef = useRef(null)

  // A different ?pr= is a whole new page load in the Web Forms original, so it
  // resets every filter — not just the pre-selected avenue tab.
  useEffect(() => {
    setActiveAvenue(initialAvenue)
    setActiveArea(''); setActiveSub(''); setActiveSc(''); setActiveType(''); setQuery(''); setPage(1)
  }, [initialAvenue])

  // Any filter change resets to page 1.
  const refilter = () => setPage(1)

  // ── Filtered-impact stats bar ────────────────────────────────────────────
  const metricsOf = d.metricsOf
  // each dropdown lists only what the other choices leave; one with nothing to offer is hidden (client, 2026-10-15)
  const { areaOptions, subAreaOptions, subCatOptions, typeOptions, subCatOf } = useProjectFacets(d,
    { avenue: activeAvenue, area: activeArea, sub: activeSub, sc: activeSc, type: activeType })
  // a new avenue clears the dropdowns (the avenue tabs are not faceted)
  const pickAvenue = (v) => { setActiveAvenue(v); setActiveArea(''); setActiveSub(''); setActiveSc(''); setActiveType(''); refilter() }
  const pickScope = (v) => { setScope(v); setActiveArea(''); setActiveSub(''); setActiveSc(''); setActiveType(''); refilter() }

  // Recompute the filtered set (avenue tab + area + category + sub category + type + search).
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter((card) => {
      const hay = (card.title + ' ' + card.desc + ' ' + card.area).toLowerCase()
      return (!activeAvenue || card.avenue === activeAvenue) &&
             (!activeArea || card.area === activeArea) &&
             (!activeSub || card.subArea === activeSub) &&
             (!activeSc || subCatOf(card) === activeSc) &&
             (!activeType || card.type === activeType) &&
             (!q || hay.indexOf(q) !== -1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, activeAvenue, activeArea, activeSub, activeSc, activeType, query, subCatOf])

  // Sum the four metrics across the CURRENT filtered set (all matched pages).
  const totals = useMemo(() => {
    let c = 0, b = 0, r = 0, h = 0
    for (const card of matched) {
      const m = metricsOf(card)
      c += m.c; b += m.b; r += m.r; h += m.h
    }
    return { c, b, r, h }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, metricsOf])
  // all years: the listed projects' own figures summed (no Rotarians figure); null while counting
  const allT = useAllYearsTotals(d, matched)
  const shown = allYears ? (allT || { c: 0, b: 0, r: 0, h: 0 }) : totals
  const statsPhase = allYears ? (allT ? 'ready' : 'loading') : d.metricsPhase

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const cur = Math.min(Math.max(page, 1), totalPages)
  const start = (cur - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE
  const visible = useMemo(() => new Set(matched.slice(start, end).map((p) => p.uid)), [matched, start, end])

  const info = matched.length === 0 ? '' :
    'Showing ' + (start + 1) + '–' + Math.min(end, matched.length) + ' of ' + matched.length + ' projects'

  function scrollToTop() {
    if (topRef.current && topRef.current.scrollIntoView) topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Tab styling differs per theme (warm uses coral pills, classic navy).
  const ACTIVE = isWarm ? 'bg-gold text-white shadow-sm' : 'bg-navy text-white shadow-sm'
  const INACTIVE = isWarm
    ? 'border border-navy/15 bg-white text-ink/70 hover:border-gold/50 hover:text-gold-cta'
    : 'border border-gray-200 bg-white text-ink/70 hover:border-navy/30 hover:text-navy'

  function pageBtn(label, target, active, key) {
    const cls = active
      ? (isWarm ? 'min-w-[2.5rem] rounded-full bg-gold px-3.5 py-2 text-sm font-bold text-white shadow-sm'
                : 'min-w-[2.5rem] rounded-full bg-navy px-3.5 py-2 text-sm font-bold text-white shadow-sm')
      : (isWarm ? 'min-w-[2.5rem] rounded-full border border-navy/15 bg-white px-3.5 py-2 text-sm font-semibold text-ink/70 transition-colors hover:border-gold/50 hover:text-gold-cta'
                : 'min-w-[2.5rem] rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-ink/70 transition-colors hover:border-navy/30 hover:text-navy')
    if (target === null) {
      return <button key={key} type="button" disabled className={cls + ' cursor-not-allowed opacity-40'}>{label}</button>
    }
    return (
      <button key={key} type="button" className={cls}
              onClick={() => { setPage(target); scrollToTop() }}>{label}</button>
    )
  }

  const statsClass = 'mx-auto mb-8 ' + (statsPhase === 'hidden' ? 'hidden ' : '') +
    'max-w-4xl grid-cols-2 gap-3 sm:gap-4 ' + (allYears ? 'sm:grid-cols-3' : 'sm:grid-cols-4') +
    (statsPhase === 'hidden' ? '' : ' grid') + (statsPhase === 'loading' ? ' animate-pulse' : '')

  // The stat medallion gradient differs per theme.
  const statIconClass = isWarm
    ? 'relative mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-cta text-white shadow-md shadow-gold/30 transition-transform duration-300 group-hover:scale-110'
    : 'relative mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-light text-navy shadow-md shadow-gold/30 transition-transform duration-300 group-hover:scale-110'

  const loadingStats = statsPhase === 'loading'

  // The search control itself, so the two layouts below (Club Services' toolbar
  // card and the Projects view's centred box) place one element instead of
  // duplicating the input — a second copy would need its own state wiring.
  const searchPill = (
    <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-3 shadow-sm focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
      <svg className="h-5 w-5 shrink-0 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" data-project-search aria-label="Search projects by name, area of focus or description"
             placeholder="Search projects by name, focus or description..."
             value={query}
             onChange={(e) => { setQuery(e.target.value); refilter() }}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); refilter() } }}
             className="w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none" autoComplete="off" />
    </label>
  )

  useRotaryAnim([d.loading, projects.length, matched.length, cur, scope])

  return (
    <>
      <Breadcrumb eyebrow="Our Work" title={pageHeading} crumbLabel={pageHeading} titleClass="uppercase tracking-wide" />

      <section className="bg-canvas py-12">
        <div className="container-x">
          <span data-project-top className="block" ref={topRef}></span>

          {/* ══ "Current year projects / All years projects" (client, 2026-10-28) ══ */}
          {!isMeetings && (
          <div className="mb-6 flex justify-center text-center text-navy">
            <ScopeSwitch scope={scope} onChange={pickScope} loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} className="items-center" />
          </div>
          )}

          {/* ══ Avenue filter tabs (projects view only, not Club Services) ══ */}
          {!isMeetings && (
          <div className="mb-6 flex flex-wrap justify-center gap-2" data-project-tabs>
            <button type="button" data-avenue="" onClick={() => pickAvenue('')}
                    className={'project-tab rounded-full px-4 py-2 text-sm font-semibold transition-all ' + (activeAvenue === '' ? ACTIVE : INACTIVE)}>
              All ({totalCount})
            </button>
            {avenueTabs.map((a) => (
            <button key={a.code} type="button" data-avenue={a.code} onClick={() => pickAvenue(a.code)}
                    className={'project-tab rounded-full px-4 py-2 text-sm font-semibold transition-all ' + (activeAvenue === a.code ? ACTIVE : INACTIVE)}>
              {a.label} ({a.count})
            </button>
            ))}
          </div>
          )}

          {/* ══ Filters: Area of Focus + Category + Sub category + Project Type (faceted) + Search ══ */}
          {!isMeetings && (areaOptions.length + subAreaOptions.length + subCatOptions.length + typeOptions.length > 0) && (
          <div className="mx-auto mb-4 flex max-w-4xl flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
            {areaOptions.length > 0 && (
            <div className="relative w-full sm:flex-1">
              <svg className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              <select data-project-area aria-label="Filter by Area of Focus" value={activeArea}
                      onChange={(e) => {
                        setActiveArea(e.target.value); refilter()
                      }}
                      className="h-12 w-full cursor-pointer appearance-none truncate rounded-full border border-gray-200 bg-white pl-11 pr-9 text-sm font-semibold text-ink/80 shadow-sm transition-colors hover:border-navy/30 focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20">
                <option value="">All Areas of Focus</option>
                {areaOptions.map((a) => (
                <option key={a.value} value={a.value}>{a.label} ({a.count})</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            )}
            {subAreaOptions.length > 0 && (
            <div className="relative w-full sm:flex-1">
              <svg className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              <select data-project-subarea aria-label="Filter by category" value={activeSub}
                      onChange={(e) => { setActiveSub(e.target.value); refilter() }}
                      className="h-12 w-full cursor-pointer appearance-none truncate rounded-full border border-gray-200 bg-white pl-11 pr-9 text-sm font-semibold text-ink/80 shadow-sm transition-colors hover:border-navy/30 focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20">
                <option value="">All categories</option>
                {subAreaOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            )}
            {subCatOptions.length > 0 && (
            <div className="relative w-full sm:flex-1">
              <svg className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              <select data-project-subcategory aria-label="Filter by sub category" value={activeSc}
                      onChange={(e) => { setActiveSc(e.target.value); refilter() }}
                      className="h-12 w-full cursor-pointer appearance-none truncate rounded-full border border-gray-200 bg-white pl-11 pr-9 text-sm font-semibold text-ink/80 shadow-sm transition-colors hover:border-navy/30 focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20">
                <option value="">All sub categories</option>
                {subCatOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            )}
            {typeOptions.length > 0 && (
            <div className="relative w-full sm:flex-1">
              <svg className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              <select data-project-type aria-label="Filter by Project Type" value={activeType}
                      onChange={(e) => { setActiveType(e.target.value); refilter() }}
                      className="h-12 w-full cursor-pointer appearance-none truncate rounded-full border border-gray-200 bg-white pl-11 pr-9 text-sm font-semibold text-ink/80 shadow-sm transition-colors hover:border-navy/30 focus:border-gold/60 focus:outline-none focus:ring-2 focus:ring-gold/20">
                <option value="">All Projects</option>
                {typeOptions.map((t) => (
                <option key={t.value} value={t.value}>{t.label} ({t.count})</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            )}
          </div>
          )}

          {/* ══ Search ══ */}
          {/* Filtering is live (on input). Pressing Enter must NOT submit the
              surrounding form — in the Web Forms original a postback reloaded the page
              and cleared the filtered grid, which looked like an error — so the
              onKeyDown below swallows Enter. */}
          {isMeetings ? (
          /* Club Services has no avenue tabs and no stats bar, so the count and
             the search share ONE toolbar card — the shape the Directory page
             already uses — rather than a bare figure floating above a centred
             box. The count is of MATCHED rows, so it tracks the search. */
          <div className={isWarm ? 'mb-8 flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-4 shadow-card lg:flex-row lg:items-center' : 'mb-8 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-card lg:flex-row lg:items-center'}>
            <div className="flex shrink-0 items-center gap-3">
              <span className={isWarm ? 'flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold-cta' : 'flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy'}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
              </span>
              <div>
                <p className="font-heading text-2xl font-extrabold leading-none text-navy">{matched.length}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{matched.length === 1 ? 'Club Service' : 'Club Services'}</p>
              </div>
            </div>
            <div className="w-full flex-1">{searchPill}</div>
          </div>
          ) : (
          <div className="mx-auto mb-8 max-w-md">{searchPill}</div>
          )}

          {/* ══ Filtered impact stats (Cost / Beneficiaries / Rotarians / Man Hours) ══
               Totals for the CURRENTLY FILTERED set of projects; recomputed on every
               Avenue / Area / Sub-area / Type / Search change. Hidden until the metrics
               are available (see PublicProjectDto). */}
          {!isMeetings && (
          <div data-project-stats className={statsClass}>
            <div className="group relative overflow-hidden rounded-2xl border border-navy/10 bg-gradient-to-br from-white to-gold/[0.05] p-5 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover">
              <span aria-hidden="true" className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-gold/10 blur-xl"></span>
              <div className={statIconClass}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>
              </div>
              <div data-stat-cost className="relative font-heading text-xl font-extrabold tracking-tight text-navy sm:text-2xl">{loadingStats ? '…' : fmtCost(shown.c, (allYears && allT && allT.currency) || club.currency)}</div>
              <div className="relative mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Total Cost</div>
            </div>
            <div className="group relative overflow-hidden rounded-2xl border border-navy/10 bg-gradient-to-br from-white to-gold/[0.05] p-5 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover">
              <span aria-hidden="true" className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-gold/10 blur-xl"></span>
              <div className={statIconClass}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              </div>
              <div data-stat-beneficiaries className="relative font-heading text-xl font-extrabold tracking-tight text-navy sm:text-2xl">{loadingStats ? '…' : fmtInt(shown.b, club.currency)}</div>
              <div className="relative mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Beneficiaries</div>
            </div>
            {!allYears && (
            <div className="group relative overflow-hidden rounded-2xl border border-navy/10 bg-gradient-to-br from-white to-gold/[0.05] p-5 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover">
              <span aria-hidden="true" className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-gold/10 blur-xl"></span>
              <div className={statIconClass}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div data-stat-rotarians className="relative font-heading text-xl font-extrabold tracking-tight text-navy sm:text-2xl">{loadingStats ? '…' : fmtInt(shown.r, club.currency)}</div>
              <div className="relative mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Rotarians Involved</div>
            </div>
            )}
            <div className="group relative overflow-hidden rounded-2xl border border-navy/10 bg-gradient-to-br from-white to-gold/[0.05] p-5 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover">
              <span aria-hidden="true" className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full bg-gold/10 blur-xl"></span>
              <div className={statIconClass}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div data-stat-manhours className="relative font-heading text-xl font-extrabold tracking-tight text-navy sm:text-2xl">{loadingStats ? '…' : fmtInt(shown.h, club.currency)}</div>
              <div className="relative mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Man Hours</div>
            </div>
          </div>
          )}

          {/* ══ Project grid ══ */}
          <div data-project-grid data-api-base={apiBase} data-club-id={club.clubId}
               data-year-id={club.selectedYearId === null || club.selectedYearId === undefined ? '' : club.selectedYearId}
               className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {projects.map((p) => {
              const m = metricsOf(p)
              // style.display, not a ' hidden' className suffix — see PastPresidents.jsx:
              // rewriting className strips rotary-anim's `is-visible` and the card
              // never fades back in.
              return (
              <article key={p.uid} className="reveal h-full" style={{ display: visible.has(p.uid) ? undefined : 'none' }} data-project-card
                       data-pid={p.id}
                       data-avenue={p.avenue}
                       data-title={p.title}
                       data-desc={p.desc}
                       data-area={p.area}
                       data-subarea={p.subArea}
                       data-type={p.type}
                       data-cost={m.c}
                       data-beneficiaries={m.b}
                       data-rotarians={m.r}
                       data-manhours={m.h}>
                {isWarm ? (
                /* WARM card: photo-first with bottom gradient + date on the image,
                   gold read-more text link (matches the home marquee language). */
                <a href={detailHref(p)} className="block h-full">
                  <div className="group flex h-full flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-gold/40 hover:shadow-cardHover">
                    <div className="img-zoom relative bg-gradient-to-br from-navy via-navy-deep to-navy" style={PHOTO_BOX}>
                      {/* bg-white + object-contain: club photographs are portrait
                          as often as landscape, and cover cut the heads off group
                          shots. The white also hides the wrapper's gradient, which
                          would otherwise show as the letterbox. */}
                      <img src={p.img} alt={p.title} loading="lazy" className="h-full w-full bg-white object-contain" style={NO_ZOOM} onError={wheelFallback} />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-deep/80 via-transparent to-transparent"></div>
                      <span className={'absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow ' + p.avenueColor}>{p.avenueLabel}</span>
                      <UpdatesPill n={p.updates} />
                      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white/90" dangerouslySetInnerHTML={{ __html: dateCell(p.date) }}></span>
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="line-clamp-2 font-heading text-base font-bold leading-snug text-navy transition-colors group-hover:text-gold-cta">{p.title}</h3>
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{p.desc}</p>
                      <div className="mt-auto pt-4">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-cta transition-all duration-300 group-hover:gap-2.5">Read More
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </a>
                ) : (
                <a href={detailHref(p)} className="block h-full">
                  <div className="spotlight-card group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-cardHover">
                    <div className="img-zoom relative bg-navy/5" style={PHOTO_BOX}>
                      <img src={p.img} alt={p.title} loading="lazy" className="h-full w-full bg-white object-contain" style={NO_ZOOM} onError={wheelFallback} />
                      <span className={'absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow ' + p.avenueColor}>{p.avenueLabel}</span>
                      <UpdatesPill n={p.updates} />
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="line-clamp-2 font-heading text-[15px] font-bold leading-snug text-navy">{p.title}</h3>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{p.desc}</p>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                        {/* Project date shown beside Read More (replaces the old yellow area-of-focus text). */}
                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-muted" dangerouslySetInnerHTML={{ __html: dateCell(p.date) }}></span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-navy px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition-all duration-300 group-hover:bg-gold group-hover:text-navy">Read More
                          <svg className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </a>
                )}
              </article>
              )
            })}
          </div>

          {/* ══ No results ══ */}
          <div data-project-empty className={(matched.length === 0 ? '' : 'hidden ') + 'flex flex-col items-center gap-3 py-20 text-center text-muted'}>
            <svg className="h-10 w-10 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6A2 2 0 0 1 18.45 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>
            <p>No results found.</p>
          </div>

          {/* ══ Pagination (20 projects per page) ══ */}
          <div data-project-info className="mt-10 text-center text-xs font-semibold uppercase tracking-wide text-muted">{info}</div>
          <div data-project-pager className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {totalPages > 1 && (
            <>
              {pageBtn('‹', cur > 1 ? cur - 1 : null, false, 'prev')}
              {windowed(cur, totalPages).map((p, i) => (
                p === '...'
                  ? <span key={'gap' + i} className="px-1 text-sm text-muted">…</span>
                  : pageBtn(String(p), p, p === cur, 'p' + p)
              ))}
              {pageBtn('›', cur < totalPages ? cur + 1 : null, false, 'next')}
            </>
            )}
          </div>

        </div>
      </section>
    </>
  )
}
