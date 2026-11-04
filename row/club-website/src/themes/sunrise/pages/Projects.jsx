'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · PROJECTS — the year's work, dealt onto the sky.
//
// Right under the page head (crumbs + h1) the four impact figures for the
// FILTERED set count up in gradient Unbounded like the home's figures. Then the
// avenue chips, the area / sub-area / type selects and the search; then the
// cards lift off a tilted plane row by row (revealBatch on wide screens, the
// scrubbed tiltRise on phones), each photo whole at its own ratio - no crop,
// no blurred fill (client, 2026-10-05). Twenty at a time,
// "Show more" deals the next twenty and hands keyboard focus to the first new card.
//
// Data + rules are Gold's (useProjectsData = useProjectsGold): which projects
// count, avenue codes, the canonical areas of focus, the per-project metric
// back-fill (metricsPhase: hidden | loading | ready - never four zeroes), the
// search haystack, ?pr= pre-selecting a tab and ?pr=CE = the Club Services feed
// (no tabs, no figures, detail links carry &pr=CE so "back" returns here).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub, useProjectsData, withYear, formatMoney, useProjectFacets, useAllYearsTotals } from '../../_shared/data.js'
import { PageHero, Card, Button, Chips, SearchField, StatRow, EmptyState, Loading, excerpt, noEmoji, yearText } from '../kit.jsx'
import { useScene, useRefreshOnImages, revealBatch, tiltRise } from '../motion.js'
import './Projects.css'
import { ScopeSwitch, useProjectScope } from '../../_shared/kit.jsx'

const PAGE = 20
const STAT_LABELS = ['Total cost', 'Beneficiaries', 'Rotarians involved', 'Man hours']

export default function Projects({ data }) {
  const club = useClub()
  const loc = useLocation()
  const pr = (new URLSearchParams(loc.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  // ?pr= pre-selects a tab; CE/CS are never tabs of their own (Gold).
  const initialAvenue = isMeetings || pr === 'CS' ? '' : pr

  // this year's projects or every year's (client, 2026-10-06) - ?all=1
  const [scope, setScope] = useProjectScope()
  const d = useProjectsData(isMeetings, scope, data.projects)
  const { projects, totalCount, avenueTabs } = d

  const [avenue, setAvenue] = useState(initialAvenue)
  const [area, setArea] = useState('')
  const [sub, setSub] = useState('')
  const [sc, setSc] = useState('')   // subcategory
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const gridRef = useRef(null)
  const barRef = useRef(null)
  const animFrom = useRef(0)        // cards from this index lift in; Infinity = only those below the fold
  const focusFrom = useRef(-1)      // after "Show more": focus this card's link
  const ids = useId()

  // A different ?pr= is a different page: every filter resets (Gold).
  useEffect(() => {
    setAvenue(initialAvenue); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setLimit(PAGE)
    animFrom.current = 0
  }, [initialAvenue, isMeetings])

  // each dropdown lists only what the other choices leave; one with nothing to offer is hidden (client, 2026-10-15)
  const { areaOptions, subAreaOptions, subCatOptions, typeOptions, subCatOf } = useProjectFacets(d, { avenue, area, sub, sc, type })

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter((c) => {
      const hay = (c.title + ' ' + c.desc + ' ' + c.area).toLowerCase()
      return (!avenue || c.avenue === avenue)
        && (!area || c.area === area)
        && (!sub || c.subArea === sub)
        && (!sc || subCatOf(c) === sc)
        && (!type || c.type === type)
        && (!q || hay.indexOf(q) !== -1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, avenue, area, sub, sc, type, query, d.metricsPhase, subCatOf])
  const allT = useAllYearsTotals(d, matched)   // all years: follows the filters too

  // Totals across the whole filtered set, not just the cards dealt so far.
  const totals = useMemo(() => {
    let c = 0, b = 0, r = 0, h = 0
    for (const card of matched) {
      const m = d.metricsOf(card)
      c += m.c; b += m.b; r += m.r; h += m.h
    }
    return { c, b, r, h }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, d.metricsPhase])

  const shown = matched.slice(0, limit)
  const sig = shown.map((p) => p.id).join(',')

  // Any filter change re-flows what you are looking at instantly; only cards
  // still below the fold lift in. Cards already scrolled past are never hidden.
  const refilter = () => { setLimit(PAGE); animFrom.current = Infinity }
  // The empty state (and its button) unmounts on clear: focus a control that stays -
  // the "All" chip, or the search where there are no avenue chips (Club Services).
  const clearAll = () => {
    setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); refilter()
    const bar = barRef.current
    const to = bar && (bar.querySelector('.sun-chip') || bar.querySelector('.sun-search input'))
    if (to) to.focus()
  }
  const more = () => {
    animFrom.current = limit
    focusFrom.current = limit
    setLimit((l) => l + PAGE)
  }

  useEffect(() => {
    const i = focusFrom.current
    if (i < 0 || !gridRef.current) return
    focusFrom.current = -1
    const link = gridRef.current.querySelectorAll('.sun-prj-grid > li')[i]
    const a = link && link.querySelector('.sun-card__link')
    if (a) a.focus({ preventScroll: true })
  }, [limit])

  useScene(gridRef, (c) => {
    const cards = Array.from(gridRef.current.querySelectorAll('.sun-prj-grid > li'))
    if (!cards.length) return
    // no photo drift: its 1.22 zoom would crop the whole photos (client: "not cut")
    if (!c.wide) { tiltRise(cards, null); return }
    const fold = window.innerHeight * 0.9
    revealBatch(cards.filter((el, i) => {
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && (i >= animFrom.current || r.top > fold)
    }))
  }, [sig])
  // a card's height is its photo's (ratio="auto"), known only once the photo loads
  useRefreshOnImages(gridRef, [sig])

  // masonry, Pinterest-like (client, 2026-10-06): the grid's rows are 8px and each card spans its own
  // height (+ the 22px gap), so a short card's column moves up under it - no holes beside tall
  // photos. Cards keep their left-to-right order and "Show more" adds below without moving the
  // ones above. offsetHeight: the layout height, not the entrance's tilted/scaled box
  useEffect(() => {
    const grid = gridRef.current && gridRef.current.querySelector('.sun-prj-grid')
    if (!grid || typeof ResizeObserver === 'undefined') return undefined
    const fit = (li) => { li.style.gridRowEnd = 'span ' + Math.ceil((li.offsetHeight + 22) / 8) }
    const items = Array.from(grid.children)
    items.forEach(fit)
    grid.classList.add('is-masonry')
    const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)))
    items.forEach((li) => ro.observe(li))
    return () => { ro.disconnect(); grid.classList.remove('is-masonry'); items.forEach((li) => { li.style.gridRowEnd = '' }) }
  }, [sig])

  // ── head ───────────────────────────────────────────────────────────────────
  const year = yearText(club.selectedYearLabel)
  // the counters (client, 2026-10-06): Projects · Cost · Beneficiaries · Rotarians involved · Man hours, the cost in
  // full. All years: the listed projects' own figures summed (useAllYearsTotals; no Rotarians figure).
  const allYears = d.scope === 'all'
  const at = allT
  const loadingStats = allYears ? !at : d.metricsPhase === 'loading'
  const showStats = !isMeetings && !d.loading && (allYears || d.metricsPhase !== 'hidden' || matched.length > 0)
  const cur = club.currency
  const figs = allYears ? { c: at ? at.c : 0, b: at ? at.b : 0, r: 0, h: at ? at.h : 0 } : totals
  const countItem = { label: matched.length === 1 ? 'Project' : 'Projects', value: matched.length }
  const stats = [countItem].concat(loadingStats
    ? (allYears ? [STAT_LABELS[0], STAT_LABELS[1], STAT_LABELS[3]] : STAT_LABELS).map((label) => ({ label, text: '…' }))
    : [
        figs.c > 0 ? { label: STAT_LABELS[0], text: formatMoney(figs.c, (allYears && at && at.currency) || cur) } : null,
        { label: STAT_LABELS[1], value: figs.b },
        allYears ? null : { label: STAT_LABELS[2], value: figs.r },
        { label: STAT_LABELS[3], value: figs.h },
      ].filter(Boolean))
  const filteredNow = !!(avenue || area || sub || sc || type || query.trim())

  // ── filters ────────────────────────────────────────────────────────────────
  const hasSelects = !isMeetings && (areaOptions.length + subAreaOptions.length + subCatOptions.length + typeOptions.length > 0)
  // each project opens in ITS OWN Rotary year (an all-years list mixes them)
  const detailHref = (p) => withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)
  const nounShort = isMeetings ? 'meeting' : 'project'

  return (
    <div className="sun-page sun-prj">
      <PageHero title={isMeetings ? 'Club Services' : 'Projects'}>
        {/* "Current year projects / All years projects" (client, 2026-10-06) */}
        {!isMeetings ? (
          <ScopeSwitch scope={scope} onChange={(v) => { setScope(v); setArea(''); setSub(''); setSc(''); setType(''); refilter() }} yearLabel={club.selectedYearLabel}
                       loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} />
        ) : null}
        {showStats ? (
          <div className="sun-prj-figs" aria-busy={loadingStats || undefined}>
            {loadingStats ? <p className="sun-sr" role="status">Adding up the figures</p> : null}
            <StatRow items={stats} currency={cur} className={'sun-prj-stats' + (loadingStats ? ' is-loading' : '')} />
          </div>
        ) : null}
      </PageHero>

      {!d.loading && projects.length > 0 ? (
        <section className="sun-wrap sun-prj-bar" ref={barRef} aria-label="Filter projects">
          {!isMeetings && avenueTabs.length > 0 ? (
            <Chips
              label="Filter by avenue"
              className="sun-prj-avenues"
              options={[{ value: '', label: 'All', count: totalCount },
                ...avenueTabs.map((a) => ({ value: a.code, label: a.label, count: a.count }))]}
              value={avenue}
              onChange={(v) => { setAvenue(v); setArea(''); setSub(''); setSc(''); setType(''); refilter() }}
            />
          ) : null}
          <div className="sun-tools sun-prj-tools">
            {hasSelects && areaOptions.length > 0 ? (
              <div className="sun-prj-field">
                <label htmlFor={ids + 'a'}>Area of focus</label>
                <select id={ids + 'a'} className="sun-select" value={area}
                        onChange={(e) => { setArea(e.target.value); setSub(''); setSc(''); refilter() }}>
                  <option value="">All areas of focus</option>
                  {areaOptions.map((a) => <option key={a.value} value={a.value}>{a.label} ({a.count})</option>)}
                </select>
              </div>
            ) : null}
            {hasSelects && subAreaOptions.length > 0 ? (
              <div className="sun-prj-field">
                <label htmlFor={ids + 's'}>Category</label>
                <select id={ids + 's'} className="sun-select" value={sub}
                        onChange={(e) => { setSub(e.target.value); refilter() }}>
                  <option value="">All categories</option>
                  {subAreaOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                </select>
              </div>
            ) : null}
            {hasSelects && subCatOptions.length > 0 ? (
              <div className="sun-prj-field">
                <label htmlFor={ids + 'c'}>Sub category</label>
                <select id={ids + 'c'} className="sun-select" value={sc}
                        onChange={(e) => { setSc(e.target.value); refilter() }}>
                  <option value="">All sub categories</option>
                  {subCatOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                </select>
              </div>
            ) : null}
            {hasSelects && typeOptions.length > 0 ? (
              <div className="sun-prj-field">
                <label htmlFor={ids + 't'}>Project type</label>
                <select id={ids + 't'} className="sun-select" value={type}
                        onChange={(e) => { setType(e.target.value); refilter() }}>
                  <option value="">All projects</option>
                  {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label} ({t.count})</option>)}
                </select>
              </div>
            ) : null}
            <SearchField
              className="sun-prj-search"
              label={'Search ' + nounShort + 's'}
              placeholder="Name, focus or description"
              value={query}
              onChange={(v) => { setQuery(v); refilter() }}
            />
            {/* the figures above already give the count (client, 2026-10-07): a reset in its place, the count kept for screen readers */}
            <p className="sun-sr" role="status">{matched.length + ' of ' + totalCount + ' ' + nounShort + 's'}</p>
            <Button variant="line" icon={false} className="sun-prj-clear" onClick={clearAll}
                    disabled={!(avenue || area || sub || sc || type || query) || undefined}>Clear filters</Button>
          </div>
        </section>
      ) : null}

      <section className="sun-wrap sun-block sun-prj-body" ref={gridRef} aria-label={isMeetings ? 'Meetings' : 'Projects'}>
        {d.loading ? <Loading label={isMeetings ? 'Loading meetings' : 'Loading projects'} />
          : projects.length === 0 ? (
            <EmptyState
              title={isMeetings ? 'No meetings recorded yet' : 'No projects published yet'}
              message={(isMeetings ? 'Meetings' : 'Projects') + ' the club publishes for '
                + (year ? 'Rotary year ' + year : 'this Rotary year') + ' will appear here.'}
            />
          ) : matched.length === 0 ? (
            <EmptyState
              title={'No ' + nounShort + 's match'}
              message="Try clearing the search or picking a different avenue."
              action={<Button variant="line" icon={false} onClick={clearAll}>Clear filters</Button>}
            />
          ) : (
            <>
              <ul className="sun-grid sun-prj-grid">
                {shown.map((p) => (
                  <li key={p.uid}>
                    <Card
                      href={detailHref(p)}
                      img={p.img || ''}
                      ratio="auto"
                      alt=""
                      level={2}
                      meta={p.avenueLabel || p.date ? (
                        <>
                          {p.avenueLabel ? <span>{p.avenueLabel}</span> : null}
                          {p.date ? <span className="sun-card__muted">{p.date}</span> : null}
                        </>
                      ) : null}
                      title={noEmoji(p.title) || 'Untitled ' + nounShort}
                      desc={excerpt(p.desc, 160)}
                    >
                      {/* child projects are not cards of their own; the count keeps them visible */}
                      {p.updates > 0 ? <p className="sun-prj-upd">{p.updates} update{p.updates === 1 ? '' : 's'}</p> : null}
                    </Card>
                  </li>
                ))}
              </ul>
              {matched.length > shown.length ? (
                <div className="sun-prj-more">
                  <p className="sun-count">Showing <b>{shown.length}</b> of {matched.length}</p>
                  <Button variant="line" icon={false} onClick={more}>
                    Show {Math.min(PAGE, matched.length - shown.length)} more
                  </Button>
                </div>
              ) : null}
            </>
          )}
      </section>
    </div>
  )
}
