'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · PROJECTS — "the work, filtered".
// The ink hero carries the menu label, the search, the avenue chips (a pressed
// chip floods) and the other filters the listing supports. An azure band adds up
// the FILTERED projects on four rolling odometers - they roll again to the new
// totals whenever a filter changes. Then the ink band of liquid photos: up to 12
// results use the home's two staggered, interlocking columns (WebGL ripple on
// desktop), more use a calm 3-column grid with batched reveals and paging.
// Data: useProjectsData(isMeetings) only (goldData.useProjectsGold) - the same
// feed, filters, counts and metric back-fill as ProjectsGold; ?pr= contract too.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import {
  useClub, useProjectsData, useCurrentMenuName, usePageTitle, withYear, formatMoney, groupInt, useProjectFacets, useAllYearsTotals } from '../../_shared/data.js'
import {
  PageHero, Band, SectionHead, ProjectCard, Chips, SearchField, StatRow, EmptyState, Loading, Pill,
  clean, yearText,
} from '../kit.jsx'
import { usePageMotion, useScene, gsap, scrollToY } from '../motion.js'
import './Projects.css'
import { ScopeSwitch, useProjectScope } from '../../_shared/kit.jsx'

const PAGE_SIZE = 24       // 3 / 2 / 1 columns all end on a full row
const STAGGER_MAX = 12     // up to this many results: the home's interlocking columns (and WebGL)

/** Page numbers to show: always 1 and the last, plus a window around the current one (as Gold). */
function windowed(cur, total) {
  const out = []
  let last = 0
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || (p >= cur - 2 && p <= cur + 2)) {
      if (last && p - last > 1) out.push('…')
      out.push(p); last = p
    }
  }
  return out
}

/** "New Generation Service" -> ['New', 'Generation Service'] for the giant two-line title. */
function twoLines(s) {
  const w = clean(s).split(' ')
  return [w[0], w.slice(1).join(' ')]
}

export default function Projects({ data }) {
  const club = useClub()
  const location = useLocation()
  const pr = (new URLSearchParams(location.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || (isMeetings ? 'Club Services' : 'Projects')
  usePageTitle(title)

  // this year's projects or every year's (client, 2026-10-06) - ?all=1
  const [scope, setScope] = useProjectScope()
  const d = useProjectsData(isMeetings, scope, data.projects)
  const { projects, totalCount, avenueTabs } = d

  // ?pr= pre-selects a tab; CE/CS are never tabs of their own (as Gold).
  const initialAvenue = (isMeetings || pr === 'CS') ? '' : pr
  const [avenue, setAvenue] = useState(initialAvenue)
  const [area, setArea] = useState('')
  const [sub, setSub] = useState('')
  const [sc, setSc] = useState('')   // subcategory
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')           // the query the list filters on, settled after typing
  const [page, setPage] = useState(1)

  // A different ?pr= is a new page: every filter resets (as Gold).
  useEffect(() => {
    setAvenue(initialAvenue); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setQ(''); setPage(1)
  }, [initialAvenue])
  // Filter once typing pauses, so the photos don't re-wipe on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setQ(query.trim().toLowerCase()); setPage(1) }, 250)
    return () => clearTimeout(t)
  }, [query])

  // each dropdown lists only what the other choices leave; one with nothing to offer is hidden (client, 2026-10-15)
  const { areaOptions, subAreaOptions, subCatOptions, typeOptions, subCatOf } = useProjectFacets(d, { avenue, area, sub, sc, type })

  const matched = useMemo(() => projects.filter((c) => {
    const hay = (c.title + ' ' + c.desc + ' ' + c.area).toLowerCase()
    return (!avenue || c.avenue === avenue)
      && (!area || c.area === area)
      && (!sub || c.subArea === sub)
      && (!sc || subCatOf(c) === sc)
      && (!type || c.type === type)
      && (!q || hay.indexOf(q) !== -1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projects, avenue, area, sub, sc, type, q, d.metricsPhase, subCatOf])
  const allT = useAllYearsTotals(d, matched)   // all years: follows the filters too

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const cur = Math.min(Math.max(page, 1), totalPages)
  const start = (cur - 1) * PAGE_SIZE
  const shown = matched.slice(start, start + PAGE_SIZE)
  // every result list is a Pinterest-style masonry now (client, 2026-10-06) - no interlocking two-column stagger
  const stagger = false && matched.length <= STAGGER_MAX
  const gridKey = [avenue, area, sub, sc, type, q, cur].join('|')

  // Totals across the whole FILTERED set, every page of it (as Gold).
  const statsOn = !isMeetings && (d.loading || projects.length > 0)
  // the counters (client, 2026-10-06): Projects · Cost · Beneficiaries · Rotarians involved · Man hours, the cost in
  // full. All years: the listed projects' own figures summed (useAllYearsTotals; no Rotarians figure).
  const allYears = d.scope === 'all'
  const statsReady = !d.loading && (allYears ? !!allT : d.metricsPhase === 'ready')
  const t = { c: 0, b: 0, r: 0, h: 0 }
  if (statsReady && allYears) { t.c = allT.c; t.b = allT.b; t.h = allT.h }
  else if (statsReady) {
    for (const card of matched) {
      const m = d.metricsOf(card)
      t.c += m.c; t.b += m.b; t.r += m.r; t.h += m.h
    }
  }
  // A dash until the back-fill lands (never four zeroes); the `live` odometers
  // then roll to the totals, and again to the new totals on every filter change.
  const fig = (v) => (statsReady ? v : '—')
  const stats = [
    { label: matched.length === 1 ? 'Project' : 'Projects', value: d.loading ? '—' : groupInt(matched.length, club.currency) },
    { label: 'Total cost', value: fig(formatMoney(t.c, (allYears && allT && allT.currency) || club.currency)) },
    { label: 'Beneficiaries', value: fig(groupInt(t.b, club.currency)) },
    allYears ? null : { label: 'Rotarians involved', value: fig(groupInt(t.r, club.currency)) },
    { label: 'Man-hours', value: fig(groupInt(t.h, club.currency)) },
  ].filter(Boolean)
  const noFigures = false // the project count always shows

  const ref = useRef(null)
  const topRef = useRef(null)
  usePageMotion(ref, [d.loading, gridKey])
  // the two photo columns drift against each other (the home's projects move)
  useScene(ref, (c) => {
    if (!c.wide) return
    gsap.utils.toArray('.liq-prj-grid--stagger > .liq-pcard').forEach((el, i) => gsap.fromTo(el.querySelector('.liq-pcard__in'),
      { y: i % 2 ? 120 : 40 },
      { y: i % 2 ? -120 : -40, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } }))
  }, [d.loading, gridKey])

  // Masonry: the grid runs on 4px rows and each card spans its own height, so cards of any height pack tightly while
  // the reading order stays left to right. Re-measured as photos land / fonts load / the window resizes; phones (one
  // column) need no spans.
  const gridRef = useRef(null)
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return undefined
    const ROW = 4
    const mq = window.matchMedia('(min-width: 600px)')
    const fit = (el) => {
      if (!mq.matches) { el.style.gridRowEnd = ''; return }
      const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--liq-prj-gap')) || 48
      el.style.gridRowEnd = 'span ' + Math.ceil((el.offsetHeight + gap) / ROW)   // offsetHeight: layout height, not a card mid-reveal
    }
    const cards = () => grid.querySelectorAll(':scope > .liq-pcard')
    const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)))
    cards().forEach((el) => { ro.observe(el); fit(el) })
    const all = () => cards().forEach(fit)
    mq.addEventListener('change', all)
    return () => { ro.disconnect(); mq.removeEventListener('change', all) }
  }, [gridKey, d.loading, shown.length])

  const noun = isMeetings ? 'meeting' : 'project'
  const nouns = noun + 's'
  const tab = avenueTabs.find((a) => a.code === avenue)
  const filtered = !!(avenue || area || sub || sc || type || query.trim())
  const big = tab ? twoLines(tab.label) : [filtered ? 'Matching' : 'All', nouns]
  const hasFilters = !isMeetings && (areaOptions.length + subAreaOptions.length + subCatOptions.length + typeOptions.length > 0)

  const clearAll = () => { setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setQ(''); setPage(1) }
  const goPage = (n) => {
    setPage(n)
    const el = topRef.current
    if (!el) return
    scrollToY(Math.max(0, el.getBoundingClientRect().top + window.scrollY - 120))
    el.focus({ preventScroll: true })
  }
  // each project opens in ITS OWN Rotary year (an all-years list mixes them)
  const href = (p) => withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)

  return (
    <div className="liq-prj" ref={ref}>
      <PageHero title={title}>
        {/* "Current year projects / All years projects" (client, 2026-10-06) */}
        {!isMeetings ? (
          <ScopeSwitch scope={scope} onChange={(v) => { setScope(v); setArea(''); setSub(''); setSc(''); setType(''); setPage(1) }} yearLabel={club.selectedYearLabel}
                       loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} />
        ) : null}
      </PageHero>

      {/* search + filters sit under the breadcrumb band, not in it (client, 2026-09-29: a short breadcrumb) */}
      <Band tone="ink" tight edge={false} className="liq-prj-filters" aria-label={'Find ' + nouns}>
        <div className="liq-prj-ctl">
          <SearchField label={'Search ' + nouns + ' by name, focus or description'} value={query}
                       onChange={setQuery} placeholder="Name, focus or description" />
          {!d.loading && !isMeetings && avenueTabs.length > 0 ? (
            <Chips label="Filter by avenue" value={avenue}
                   onChange={(v) => { setAvenue(v); setArea(''); setSub(''); setSc(''); setType(''); setPage(1) }}
                   options={[{ value: '', label: 'All', count: totalCount },
                     ...avenueTabs.map((a) => ({ value: a.code, label: a.label, count: a.count }))]} />
          ) : null}
          {!d.loading && hasFilters ? (
            <div className="liq-prj-tools">
              {areaOptions.length > 0 ? (
                <div className="liq-prj-field">
                  <label htmlFor="liq-prj-area">Area of focus</label>
                  <select id="liq-prj-area" className="liq-prj-sel" value={area}
                          onChange={(e) => { setArea(e.target.value); setSub(''); setSc(''); setPage(1) }}>
                    <option value="">All areas of focus</option>
                    {areaOptions.map((a) => <option key={a.value} value={a.value}>{a.label} ({a.count})</option>)}
                  </select>
                </div>
              ) : null}
              {subAreaOptions.length > 0 ? (
                <div className="liq-prj-field">
                  <label htmlFor="liq-prj-sub">Category</label>
                  <select id="liq-prj-sub" className="liq-prj-sel" value={sub}
                          onChange={(e) => { setSub(e.target.value); setPage(1) }}>
                    <option value="">All categories</option>
                    {subAreaOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                  </select>
                </div>
              ) : null}
              {subCatOptions.length > 0 ? (
                <div className="liq-prj-field">
                  <label htmlFor="liq-prj-sc">Sub category</label>
                  <select id="liq-prj-sc" className="liq-prj-sel" value={sc}
                          onChange={(e) => { setSc(e.target.value); setPage(1) }}>
                    <option value="">All sub categories</option>
                    {subCatOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                  </select>
                </div>
              ) : null}
              {typeOptions.length > 0 ? (
                <div className="liq-prj-field">
                  <label htmlFor="liq-prj-type">Project type</label>
                  <select id="liq-prj-type" className="liq-prj-sel" value={type}
                          onChange={(e) => { setType(e.target.value); setPage(1) }}>
                    <option value="">All projects</option>
                    {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}
          {!d.loading ? (
            <div className="liq-prj-sum">
              {/* the figures already give the count (client, 2026-10-07): an always-there reset, the count kept for screen readers */}
              <p className="liq-sr" role="status">{matched.length + ' of ' + projects.length + ' ' + nouns}</p>
              <Pill variant="ghost" icon={false} className="liq-prj-clear" onClick={clearAll} disabled={!filtered || undefined}>Clear filters</Pill>
            </div>
          ) : null}
        </div>
      </Band>

      {statsOn ? (
        <Band tone="azure" tight className="liq-prj-stats" aria-labelledby="liq-prj-stats-h">
          <h2 className="liq-kicker liq-rv" id="liq-prj-stats-h">
            {'Impact'}
          </h2>
          {!statsReady ? <Loading label="Adding up the figures" /> : null}
          {noFigures
            ? (
              <p className="liq-prj-nofig">
                {matched.length ? 'No impact figures have been filed for the ' + nouns + ' shown.' : 'Nothing to add up for these filters.'}
              </p>
            )
            : <StatRow items={stats} live />}
        </Band>
      ) : null}

      <Band tone="ink" edge={statsOn} className="liq-prj-list" aria-labelledby="liq-prj-h">
        <SectionHead big={big} id="liq-prj-h" />
        {d.loading ? <Loading label={'Loading ' + nouns} />
          : projects.length === 0 ? (
            <EmptyState as="h3" title={'No ' + nouns + ' published yet'}
                        text={'Published work for this Rotary year will appear here as the club files it.'} />
          ) : matched.length === 0 ? (
            <EmptyState as="h3" title={'No ' + nouns + ' match'} text="Try another search, or pick a different avenue."
                        action={<Pill variant="light" onClick={clearAll}>Show all {nouns}</Pill>} />
          ) : (
            <>
              <div className="liq-prj-top" ref={topRef} tabIndex={-1}>
                {totalPages > 1
                  ? <p className="liq-count">Showing <b>{start + 1}–{Math.min(start + PAGE_SIZE, matched.length)}</b> of {matched.length}</p>
                  : null}
              </div>
              <div key={gridKey} ref={gridRef} className={'liq-prj-grid ' + (stagger ? 'liq-prj-grid--stagger' : 'liq-prj-grid--list liq-prj-grid--masonry')}>
                {shown.map((p, i) => {
                  const upd = p.updates > 0 ? p.updates + (p.updates === 1 ? ' update' : ' updates') : ''
                  const meta = p.date || upd
                    ? <>{p.date}{upd ? <b className="liq-prj-upd">{(p.date ? ' · ' : '') + upd}</b> : null}</>
                    : null
                  return (
                    <ProjectCard key={p.uid} href={href(p)} title={p.title} img={p.img} avenue={p.avenueLabel}
                                 date={meta} desc={p.desc} n={start + i + 1}
                                 portrait={stagger && (i % 4 === 1 || i % 4 === 2)} more
                                 className={stagger ? '' : 'liq-rv'} />
                  )
                })}
              </div>
              {totalPages > 1 ? (
                <nav className="liq-prj-pager" aria-label="Pages">
                  <Pill variant="ghost" back disabled={cur === 1} onClick={() => goPage(cur - 1)}>Previous</Pill>
                  <ol className="liq-prj-pages">
                    {windowed(cur, totalPages).map((n, i) => (
                      <li key={n === '…' ? 'g' + i : n}>
                        {n === '…'
                          ? <span className="liq-prj-gap" aria-hidden="true">…</span>
                          : (
                            <button type="button" className="liq-chip liq-prj-pg" aria-current={n === cur ? 'page' : undefined}
                                    onClick={() => goPage(n)}>
                              <span className="liq-sr">Page </span>{n}
                            </button>
                          )}
                      </li>
                    ))}
                  </ol>
                  <Pill variant="ghost" disabled={cur === totalPages} onClick={() => goPage(cur + 1)}>Next</Pill>
                </nav>
              ) : null}
            </>
          )}
      </Band>
    </div>
  )
}
