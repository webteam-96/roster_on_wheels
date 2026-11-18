// ─────────────────────────────────────────────────────────────────────────────
// GOLD — Stage B data layer.
//
// Every redesigned Gold page is a different COMPOSITION of the same content the
// shared pages already show. The rules that decide WHAT that content is (which
// projects count, which past presidents are "past", how a Rotary year bounds the
// event list, how a bio becomes HTML) are not design — they are the port's
// contract with the API, and they must not fork.
//
// So this file owns no rules of its own: it imports each one from the page that
// already implements it and only assembles the results into the shape a Gold
// page renders from. If a rule changes there, Gold changes with it.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClub, currentRotaryYearLabel } from '../../context/ClubProvider.jsx'
import * as api from '../../api/clubService.js'
import { media, initials, externalUrl, wrappableHtml } from '../../shared/rotaryPage.js'
import { formatDate } from '../../shared/homeData.js'
import { buildProjectsView, pool, normKey, projectFacets } from '../AllProjects.jsx'
import { loadProject } from '../ProjectDetail.jsx'
import { buildItems as buildNewsletterItems } from '../Newsletter.jsx'
import { rotaryYearRange } from '../UpcomingEvent.jsx'
import { parseStartYear } from '../PastPresidents.jsx'
import { buildBioHtml } from '../diginitary.jsx'
import { dateText as eventDateText, buildDescription } from '../EventDetail.jsx'

export { initials }

// Invariant date labels — the same shapes AllSpecialDates.aspx.cs formats.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n) => String(n).padStart(2, '0')

export const monthName = (m) => MONTHS[m - 1]
/** "dd MMM" */
export const dayLabelOf = (y, m, d) => pad2(d) + ' ' + MONTHS_ABBR[m - 1]
/** "dd MMMM yyyy" */
export const fullDayLabelOf = (y, m, d) => pad2(d) + ' ' + MONTHS[m - 1] + ' ' + y

/** Admin rich HTML -> plain text. A detached div parses but never executes, and
 *  the &nbsp; runs pasted copy joins words with are collapsed so text wraps. */
export function plainText(html) {
  if (!html || !String(html).trim()) return ''
  const el = document.createElement('div')
  el.innerHTML = String(html)
  return (el.textContent || '').replace(/\s+/g, ' ').trim()
}

// ── About ────────────────────────────────────────────────────────────────────
/**
 * The whole About page off ONE payload: the club's own copy, its crest, the
 * meeting details and its contact row. President/Secretary come from the BOD
 * feed (cached — the Directors page and the home deck read the same call).
 */
export function useAboutGold() {
  const club = useClub()
  const { clubId, selectedYearId: yearId } = club
  const [d, setD] = useState({ loading: true, html: '', logo: '', contacts: [], socials: [] })

  useEffect(() => {
    if (!clubId) return undefined
    let cancelled = false
    ;(async () => {
      const [about, bod] = await Promise.all([
        api.getAbout(clubId, yearId),
        api.getBod(clubId, yearId),
      ])
      if (cancelled) return

      const a = about || {}
      const contacts = a.contacts || []
      const pick = (k) => (contacts.map((c) => (c ? c[k] : null))
        .find((v) => v && String(v).trim()) || '').trim()

      // Same assembly the home page's meeting tile uses (homeData.useHomeData):
      // "from - to" when both times are filed, "from onwards" when only one is.
      const time = !a.meetingFromTime ? ''
        : a.meetingFromTime + (!a.meetingToTime ? ' onwards' : ' - ' + a.meetingToTime)
      const venue = [a.meetingAddress, a.city, a.state, a.pincode]
        .filter((x) => x && String(x).trim()).join(', ')

      const officer = (kw) => (bod || []).find(
        (b) => String(b.designation || '').toLowerCase().indexOf(kw) >= 0)

      setD({
        loading: false,
        html: a.content && String(a.content).trim() ? wrappableHtml(a.content) : '',
        logo: media(a.clubLogoPath) || media(a.rotaryLogoPath) || '',
        email: pick('email'),
        phone: pick('phone'),
        meetingDay: a.meetingDay || '',
        meetingTime: time,
        meetingVenue: venue,
        mapUrl: 'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(venue || club.clubName || 'Rotary'),
        socials: (a.socials || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim()),
        president: officer('president'),
        secretary: officer('secretary'),
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, yearId])

  return d
}

// ── Projects listing ─────────────────────────────────────────────────────────
const PROJECTS_EMPTY = {
  loading: true, projects: [], totalCount: 0,
  avenueTabs: [], areaOptions: [], subAreaOptions: [], typeOptions: [],
}

/**
 * The listing payload plus the per-project metric back-fill.
 *
 * v2/projects still omits cost/beneficiaries/rotarians/man-hours, so the figures
 * are fetched per project (concurrency-limited, and every response is cached) —
 * exactly what the shared page does. `metrics` is null until that finishes, so
 * the caller can show a resting state instead of four zeroes.
 */
export function useProjectsGold(isMeetings, scope = 'year') {
  const club = useClub()
  const [state, setState] = useState(PROJECTS_EMPTY)
  const [metrics, setMetrics] = useState(null)
  const [metricsPhase, setPhase] = useState('hidden')   // hidden | loading | ready
  // scope 'all' (the Theme 8 "All years projects" view, 2026-10-06): every Rotary year's projects, newest year
  // first, shown as they arrive; totals come from ONE all-years v2/impact call (the per-project detail fetch that
  // fills the one-year totals would be ~1,400 requests for a club like rctcv). Meetings stay one-year.
  const all = scope === 'all' && !isMeetings
  const [allLoad, setAllLoad] = useState({ done: 0, of: 0 })
  const [allTotals, setAllTotals] = useState(null)
  const yearIds = (club.years || []).map((y) => y.id).join(',')

  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    setState(PROJECTS_EMPTY)
    if (all) {
      const years = [...(club.years || [])]
      setAllLoad({ done: 0, of: years.length })
      if (!years.length) { setState({ ...PROJECTS_EMPTY, loading: false }); return () => { cancelled = true } }
      const rows = []
      let done = 0
      // newest year first, four at a time; the list redraws as each year lands
      const order = years.sort((a, b) => (parseInt(b.yearLabel, 10) || 0) - (parseInt(a.yearLabel, 10) || 0))
      pool(order, 4, (y) => api.getProjects(club.clubId, y.id).then((list) => {
        if (cancelled) return
        for (const p of list || []) rows.push({ ...p, _yearId: y.id })
        done++
        setAllLoad({ done, of: order.length })
        setState(buildProjectsView(rows, false))
      }))
      return () => { cancelled = true }
    }
    ;(async () => {
      const source = isMeetings
        ? await api.getMeetings(club.clubId, club.selectedYearId)
        : await api.getProjects(club.clubId, club.selectedYearId)
      if (!cancelled) setState(buildProjectsView(source, isMeetings))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.clubId, all ? null : club.selectedYearId, isMeetings, all, yearIds])   // all years ignores the picked year

  useEffect(() => {
    setAllTotals(null)
    if (!all || !club.clubId) return undefined
    let cancelled = false
    api.getImpact(club.clubId, null).then((im) => {
      if (cancelled) return
      // a failed or empty v2/impact settles on nothing recorded, never an endless '…'
      setAllTotals(im ? { c: +im.totalProjectCost || 0, b: +im.totalDirectBeneficiaries || 0, h: +im.totalManHours || 0, currency: im.currency || null } : { c: 0, b: 0, h: 0, currency: null })
    })
    return () => { cancelled = true }
  }, [all, club.clubId])

  const { projects } = state
  const serverHasStats = useMemo(
    () => projects.some((p) => p.cost || p.beneficiaries || p.rotarians || p.manHours),
    [projects]
  )

  useEffect(() => {
    setMetrics(null)
    if (all) { setPhase('hidden'); return undefined }   // all years: totals come from allTotals instead
    if (isMeetings || !club.clubId) { setPhase('hidden'); return undefined }
    if (serverHasStats) { setPhase('ready'); return undefined }
    if (projects.length === 0) { setPhase('hidden'); return undefined }

    let cancelled = false
    setPhase('loading')
    const acc = {}
    pool(projects, 8, (p) =>
      api.getProjectDetail(club.clubId, p.id, p.yearId || club.selectedYearId).then((d) => {
        if (!d) return   // skip this project on error
        acc[p.id] = {
          c: +d.projectCost || 0, b: +d.directBeneficiaries || 0,
          r: +d.rotariansInvolved || 0, h: +d.manHours || 0,
          s: normKey(d.subCategory),   // the subcategory filter: v2/projects does not carry it
        }
      })
    ).then(() => {
      if (cancelled) return
      setMetrics(acc)
      setPhase('ready')
    })
    return () => { cancelled = true }
  }, [projects, isMeetings, serverHasStats, club.clubId, club.selectedYearId, all])

  /** Per-card metrics: the client-fetched values win once they land. */
  const metricsOf = (p) => {
    const m = metrics && metrics[p.id]
    return m || { c: p.cost, b: p.beneficiaries, r: p.rotarians, h: p.manHours }
  }

  /** A card's sub category key: the list's own (other avenues), else the per-project back-fill's
   *  (Community Service; '' until it lands, and all years never fetches it). */
  const subCatOf = useCallback((p) => p.subCat || (metrics && metrics[p.id] && metrics[p.id].s) || '', [metrics])

  // (a card's own Rotary year is p.yearId: all-years lists mix years, so its detail link must carry it)
  return { ...state, metricsPhase, metricsOf, subCatOf, scope: all ? 'all' : 'year', allTotals, allLoading: all && allLoad.done < allLoad.of, allLoad }
}

/**
 * The Projects page's dropdowns for the current choices (see projectFacets), plus the sub
 * category lookup its filter uses. All years runs no per-project back-fill (615 Community
 * Service projects for rctcv), so there a Community Service sub category is fetched only
 * for the picked category's projects - a handful, cached - once a category is chosen.
 */
/**
 * The all-years figures for what the filters leave: the sum of those projects' own detail figures
 * (8 at a time; getProjectDetail caches, so changing filters back is instant). Unfiltered too, so
 * every avenue adds up to "All" - v2/impact has no filter parameter and also counts the update
 * (child) and Club Service rows that are not cards. null = still counting. One-year view: null.
 */
export function useAllYearsTotals(d, matched) {
  const club = useClub()
  const sig = d.scope === 'all' && !d.allLoading ? matched.map((p) => p.uid).join(',') : ''
  const [sum, setSum] = useState(null)
  useEffect(() => {
    if (!sig) return undefined
    let cancelled = false
    const t = { c: 0, b: 0, h: 0 }
    pool(matched, 8, (p) => api.getProjectDetail(club.clubId, p.id, p.yearId).then((x) => {
      if (x) { t.c += +x.projectCost || 0; t.b += +x.directBeneficiaries || 0; t.h += +x.manHours || 0 }
    })).then(() => { if (!cancelled) setSum({ ...t, sig }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, club.clubId])
  return sum && sum.sig === sig && d.allTotals ? { ...sum, currency: d.allTotals.currency } : null
}

export function useProjectFacets(d, sel) {
  const club = useClub()
  const [extra, setExtra] = useState({})   // project uid (id@year) -> sub category key ('' = none)
  const need = d.scope === 'all' && sel.sub
    ? d.projects.filter((p) => p.subArea === sel.sub && (!sel.avenue || p.avenue === sel.avenue)
      && !p.subCat && (p.avenue === 'CP' || p.area) && !(p.uid in extra))
    : []
  const needKey = need.map((p) => p.uid).join(',')
  useEffect(() => {
    if (!need.length || !club.clubId) return undefined
    // each answer is kept as it lands: a re-run (more years arrived, another category) skips what is already in
    pool(need, 8, (p) => api.getProjectDetail(club.clubId, p.id, p.yearId || club.selectedYearId)
      .then((x) => setExtra((e) => ({ ...e, [p.uid]: x ? normKey(x.subCategory) : '' }))))
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needKey, club.clubId])
  const subCatOf = useCallback((p) => d.subCatOf(p) || extra[p.uid] || '', [d.subCatOf, extra])
  return { ...projectFacets(d.projects, sel, subCatOf), subCatOf }
}

// ── Project detail ───────────────────────────────────────────────────────────
export function useProjectGold(pid, demoChild) {
  const club = useClub()
  const [p, setP] = useState(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (club.loading) return undefined
    if (pid <= 0) { setP(null); setNotFound(true); return undefined }
    let cancelled = false
    setNotFound(false)
    setP(null)
    // loadProject, not getProjectDetail: it adds the child-project recovery the
    // API's detail endpoint skips for non-`ongoing` parents. Shared with the
    // other five themes so gold cannot show a different set of updates.
    loadProject(club, pid, demoChild).then((vm) => {
      if (cancelled) return
      if (!vm) { setNotFound(true); return }
      setP(vm)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.loading, club.clubId, club.selectedYearId, pid, demoChild])

  return { p, notFound }
}

// ── Directory ────────────────────────────────────────────────────────────────
export function useDirectoryGold() {
  const { clubId } = useClub()
  const [members, setMembers] = useState(null)   // null = still loading

  useEffect(() => {
    if (!clubId) return undefined
    let cancelled = false
    api.getDirectory(clubId).then((rows) => {
      if (cancelled) return
      setMembers((rows || []).map((m, i) => ({
        i,
        name: m.memberName || '',
        // The directory shows what a member DOES; designation is the fallback
        // when no profession is filed (Directory.aspx.cs).
        work: (!m.profession || !String(m.profession).trim()) ? (m.designation || '') : m.profession,
        img: media(m.profilePhotoPath),
      })))
    })
    return () => { cancelled = true }
  }, [clubId])

  return members
}

// ── Board of directors ───────────────────────────────────────────────────────
const MAX = Number.MAX_SAFE_INTEGER

export function useDirectorsGold() {
  const club = useClub()
  const [directors, setDirectors] = useState(null)

  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    api.getBod(club.clubId, club.selectedYearId).then((bod) => {
      if (cancelled) return
      // designationSortOrder is the club's own board order (President first);
      // rows with no order sink to the end but keep API order among themselves.
      setDirectors((bod || [])
        .map((b, i) => ({
          name: b.memberName || '',
          role: b.designation || '',
          img: media(b.profilePhotoPath),
          bio: b.memberIntroduction || '',
          _i: i,
          _d: b.designationSortOrder === null || b.designationSortOrder === undefined ? MAX : b.designationSortOrder,
          _s: b.sortOrder === null || b.sortOrder === undefined ? MAX : b.sortOrder,
        }))
        .sort((a, b) => a._d - b._d || a._s - b._s || a._i - b._i))
    })
    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearId])

  return directors
}

// ── Past presidents ──────────────────────────────────────────────────────────
export function usePastPresidentsGold() {
  const club = useClub()
  const [list, setList] = useState(null)

  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    api.getPastPresidents(club.clubId).then((honour) => {
      if (cancelled) return
      // PAST presidents = years STRICTLY BEFORE the selected one; the selected
      // year's president is that year's SITTING president, not a past one.
      const selectedStart = parseStartYear(club.selectedYearLabel)
      let rows = honour || []
      if (selectedStart !== null) {
        rows = rows.filter((p) => {
          const s = parseStartYear(p.yearLabel)
          return s !== null && s < selectedStart
        })
      }
      setList(rows
        .map((p, i) => ({
          name: p.memberName || '',
          year: p.yearLabel || '',
          img: media(p.profilePhotoPath),
          _i: i,
          y: parseStartYear(p.yearLabel),
        }))
        // The API returns this roll in RECORD order, not year order — sort so
        // every club reads newest-first; unparseable labels sink to the bottom.
        .sort((a, b) => (b.y === null ? -Infinity : b.y) - (a.y === null ? -Infinity : a.y) || a._i - b._i))
    })
    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearLabel])

  return list
}

// ── Newsletters ──────────────────────────────────────────────────────────────
export function useNewslettersGold() {
  const { clubId, selectedYearId: yearId } = useClub()
  const [items, setItems] = useState(null)

  useEffect(() => {
    if (!clubId) return undefined
    let cancelled = false
    api.getNewsletters(clubId, yearId, 500).then((rows) => {
      if (!cancelled) setItems(buildNewsletterItems(rows || []))
    })
    return () => { cancelled = true }
  }, [clubId, yearId])

  return items
}

// ── Gallery ──────────────────────────────────────────────────────────────────
export const GALLERY_PAGE_SIZE = 24

export function useGalleryGold(page) {
  const club = useClub()
  const [g, setG] = useState(null)

  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    api.getGallery(club.clubId, club.selectedYearId, page, GALLERY_PAGE_SIZE)
      .then((res) => { if (!cancelled) setG(res) })
    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearId, page])

  const totalCount = g ? (g.totalCount || 0) : 0
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / GALLERY_PAGE_SIZE) : 1
  return {
    loading: g === null,
    totalCount,
    totalPages,
    currentPage: Math.min(Math.max(page, 1), totalPages),
    photos: (g && g.photos ? g.photos : []).map((p) => ({
      img: media(p.imagePath),
      title: p.projectTitle || '',
      projectId: p.projectId,
      module: p.moduleName || '',
    })),
  }
}

// ── Upcoming events ──────────────────────────────────────────────────────────
export function useEventsGold() {
  const { clubId, selectedYearLabel } = useClub()
  const [events, setEvents] = useState(null)

  useEffect(() => {
    if (!clubId) return undefined
    let cancelled = false
    // The feed is year-independent, so scope it to the SELECTED Rotary year by
    // event date — changing the year filters the list, and an event only ever
    // appears under its own year.
    const range = rotaryYearRange(selectedYearLabel)
    api.getUpcomingEvents(clubId, 99).then((rows) => {
      if (cancelled) return
      setEvents((rows || [])
        .filter((ev) => ev.eventDate)
        .map((ev) => ({ ev, d: new Date(ev.eventDate) }))
        .filter(({ d }) => range === null || (d >= range[0] && d < range[1]))
        .sort((a, b) => a.d - b.d)
        .map(({ ev, d }) => {
          const parts = formatDate(d).split(' ')   // "dd MMM yyyy"
          return {
            id: ev.id,
            title: ev.title || '',
            desc: ev.description || '',
            day: parts[0],
            mon: parts[1],
            year: parts[2],
            // The agenda groups by month and says how far off the next one is,
            // so it needs the month's full name and the raw timestamp.
            monthLabel: monthName(d.getMonth() + 1) + ' ' + d.getFullYear(),
            ts: d.getTime(),
            weekday: d.toLocaleDateString('en-GB', { weekday: 'long' }),
            date: formatDate(d),
            venue: (ev.venue && String(ev.venue).trim()) || '',
            img: media(ev.imagePath),
            reg: externalUrl(ev.registrationLink),
          }
        }))
    })
    return () => { cancelled = true }
  }, [clubId, selectedYearLabel])

  return events
}

// ── One event ────────────────────────────────────────────────────────────────
export function useEventGold(id) {
  const { clubId } = useClub()
  const [ev, setEv] = useState(null)          // null = loading, false = not found

  useEffect(() => {
    if (!clubId) return undefined
    let cancelled = false
    ;(async () => {
      // /upcoming-events only ever returns FUTURE dates, but this page is linked
      // from the Calendar and the events list, which both surface past ones —
      // without the fallback every such link 404s into "Event not found".
      let found = (await api.getUpcomingEvents(clubId, 99)).find((x) => x.id === id)
      if (!found) found = (await api.getPastEvents(clubId, null, 99)).find((x) => x.id === id)
      if (cancelled) return
      if (!found) { setEv(false); return }
      const d = found.eventDate ? new Date(found.eventDate) : null
      const parts = d ? formatDate(d).split(' ') : ['--', '', '']
      setEv({
        title: found.title || '',
        venue: (found.venue && String(found.venue).trim()) || '',
        when: eventDateText(d),
        day: parts[0],
        mon: parts[1],
        year: parts[2],
        weekday: d ? d.toLocaleDateString('en-GB', { weekday: 'long' }) : '',
        img: media(found.imagePath),
        reg: externalUrl(found.registrationLink),
        descHtml: buildDescription(found.description),
      })
    })()
    return () => { cancelled = true }
  }, [clubId, id])

  return ev
}

// ── Calendar month ───────────────────────────────────────────────────────────
export function useCalendarGold(year, month) {
  const club = useClub()
  const [monthData, setMonthData] = useState({})
  const [flags, setFlags] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const m = await api.getCalendarMonth(club.clubId, year, month)
      const f = await api.getCalendarMonthFlags(club.clubId, year, month)
      if (cancelled) return
      setMonthData(m || {})
      setFlags(f || {})
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [club.clubId, year, month])

  const lists = useMemo(() => {
    const birthdays = [], anniversaries = [], events = []
    for (const day of Object.keys(monthData).map(Number).sort((a, b) => a - b)) {
      const c = monthData[day] || {}
      const dayLabel = dayLabelOf(year, month, day)
      for (const p of (c.birthdays || []))
        birthdays.push({ day, dayLabel, name: p.memberName || '', img: media(p.profilePhotoPath) })
      for (const p of (c.anniversaries || []))
        anniversaries.push({ day, dayLabel, name: p.memberName || '', img: media(p.profilePhotoPath) })
      for (const ev of (c.events || []))
        events.push({
          day, dayLabel, id: ev.id, title: ev.title || '',
          venue: (ev.venue && String(ev.venue).trim()) || '',
        })
    }
    return { birthdays, anniversaries, events }
  }, [monthData, year, month])

  return { loading, flags, ...lists }
}

// ── Dignitary profile ────────────────────────────────────────────────────────
const DIG_EMPTY = { loading: true, found: false }

/** Type 1 = RI President, 2 = District Governor, 4 = Club President, 5 = Secretary. */
export function useDignitaryGold(type) {
  const club = useClub()
  const [vm, setVm] = useState(DIG_EMPTY)
  // Only when the API returned no year list do we fall back — to the CURRENT
  // Rotary year computed from the date, never a hardcoded one that goes stale.
  const yearLabel = !club.selectedYearLabel ? currentRotaryYearLabel() : club.selectedYearLabel

  useEffect(() => {
    if (!club.clubId) return undefined
    let cancelled = false
    ;(async () => {
      let next = { loading: false, found: false, year: yearLabel }

      if (type === 2) {
        const dg = await api.getDistrictGovernor(club.clubId, club.selectedYearId)
        if (dg && dg.memberName) {
          next = {
            loading: false, found: true,
            year: dg.yearLabel || yearLabel,
            name: dg.memberName,
            role: 'District Governor',
            designation: 'District Governor ' + (dg.yearLabel || yearLabel),
            img: media(dg.profilePhoto),
            bio: dg.description,
          }
        }
      } else if (type === 4 || type === 5) {
        const kw = type === 4 ? 'president' : 'secretary'
        const bod = await api.getBod(club.clubId, club.selectedYearId)
        const m = (bod || []).find((b) => String(b.designation || '').toLowerCase().indexOf(kw) >= 0)
        if (m) {
          // Personal email/phone are deliberately NOT shown for the club
          // President and Secretary (user request 2026-07-06).
          next = {
            loading: false, found: true, year: yearLabel,
            name: m.memberName, role: m.designation, designation: m.designation,
            img: media(m.profilePhotoPath), bio: m.memberIntroduction,
          }
        }
      } else {
        const ip = await api.getInternationalPresident(club.clubId, club.selectedYearId)
        if (ip && ip.name) {
          next = {
            loading: false, found: true,
            year: ip.yearLabel || yearLabel,
            name: ip.name,
            role: 'RI President',
            designation: ip.designation || 'RI President',
            img: media(ip.profilePhotoPath),
            bio: ip.description,
          }
        }
      }

      if (!cancelled) setVm({ ...next, bioHtml: buildBioHtml(next.bio) })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.clubId, club.selectedYearId, yearLabel, type])

  return vm
}
