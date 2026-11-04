'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · Projects — the year's work, laid out to search.
//
// A list people scan and search, so it stays vertical (DESIGN.md). The azure
// sky hero carries the count and, on the right, the impact totals as the
// sample's shape skyline: totals of the CURRENT filter from the per-project
// metric back-fill — resting shapes while it loads, zeros dropped, and the big
// outlined count instead when nothing is filed (or on the ?pr=CE feed). A white
// panel of filters stands on the hero's hills; below it the cards rise row by
// row and their photos wipe open, the middle column set lower like the
// sample's staggered project cards.
//
// Every rule (main projects only, avenue tabs, areas, types, metrics) comes from
// useProjectsData (= goldData.useProjectsGold); the filtering is Gold's.
// ?pr=CE is the club-service feed (no avenue chips, no figures); ?pr=CP|VS|…
// pre-selects that avenue; a new ?pr= resets every filter.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub, useProjectsData, withYear, formatMoney, useProjectFacets, useAllYearsTotals } from '../../_shared/data.js'
import {
  PageHero, SectionHead, ChipGroup, SearchField, ResultCount, PhotoCard, StatRow, EmptyState, Loading, Button,
  avenueTone, htmlText, cut, yearText,
} from '../kit.jsx'
import { gsap, useScene, afterFonts, useRefreshOnImages, titleIn, rise, revealBatch, wipeIn } from '../motion.js'
import './Projects.css'
import { ScopeSwitch, useProjectScope } from '../../_shared/kit.jsx'

const STEP = 20

/** Gold's filter: avenue, area, category, subcategory (scOf), type, and free text over title + description + area. */
function filterList(list, avenue, area, sub, sc, scOf, type, query) {
  const q = query.trim().toLowerCase()
  return list.filter((c) => {
    const hay = (c.title + ' ' + c.desc + ' ' + c.area).toLowerCase()
    return (!avenue || c.avenue === avenue)
      && (!area || c.area === area)
      && (!sub || c.subArea === sub)
      && (!sc || scOf(c) === sc)
      && (!type || c.type === type)
      && (!q || hay.indexOf(q) !== -1)
  })
}

/** `v` once it has been still for `ms`. */
function useSettled(v, ms) {
  const [s, setS] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setS(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return s
}

const Chev = () => <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
const Hills = () => <svg className="hj-proj-upd__ico" viewBox="0 0 20 12" aria-hidden="true"><path d="M0 12 5.5 4l3.5 4.5L13 1l7 11Z" fill="currentColor" /></svg>
const Down = () => <svg className="hj-ico" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" /></svg>

function Select({ id, label, value, onChange, disabled, all, options }) {
  return (
    <div className="hj-proj-field">
      <label className="hj-proj-field__l" htmlFor={id}>{label}</label>
      <div className="hj-proj-sel">
        <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">{all}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
        </select>
        <Chev />
      </div>
    </div>
  )
}

export default function Projects({ data }) {
  const club = useClub()
  const location = useLocation()
  const pr = (new URLSearchParams(location.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  // this year's projects or every year's (client, 2026-10-06) - ?all=1
  const [scope, setScope] = useProjectScope()
  const d = useProjectsData(isMeetings, scope, data.projects)
  const { projects, totalCount, avenueTabs } = d
  const cur = club.currency
  const yr = yearText(club.selectedYearLabel)
  const noun = isMeetings ? 'meeting' : 'project'
  const n = projects.length

  // ?pr= pre-selects a tab; CE/CS are never tabs of their own (as Gold).
  const initialAvenue = (isMeetings || pr === 'CS') ? '' : pr
  const [avenue, setAvenue] = useState(initialAvenue)
  const [area, setArea] = useState('')
  const [sub, setSub] = useState('')
  const [sc, setSc] = useState('')   // subcategory
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(STEP)
  // Which cards the scene hides and raises: 0 = all (a fresh list), k = the ones
  // "show more" just added, null = none (a filter answers instantly).
  const [revealFrom, setRevealFrom] = useState(0)
  const ref = useRef(null)
  const gridRef = useRef(null)
  const focusAt = useRef(-1)

  // A different ?pr= is a different page: every filter resets.
  useEffect(() => {
    setAvenue(initialAvenue); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setCount(STEP); setRevealFrom(0)
  }, [pr]) // eslint-disable-line react-hooks/exhaustive-deps
  // A new year (or feed) reloads the list: it rises again.
  useEffect(() => { if (d.loading) { setCount(STEP); setRevealFrom(0) } }, [d.loading])

  const refilter = () => { setCount(STEP); setRevealFrom(null) }

  // each dropdown lists only what the other choices leave; one with nothing to offer is hidden (client, 2026-10-15)
  const { areaOptions, subAreaOptions, subCatOptions, typeOptions, subCatOf } = useProjectFacets(d, { avenue, area, sub, sc, type })
  const matched = useMemo(() => filterList(projects, avenue, area, sub, sc, subCatOf, type, query),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, avenue, area, sub, sc, type, query, d.metricsPhase, subCatOf])
  const allT = useAllYearsTotals(d, matched)   // all years: follows the filters too
  // The figures follow the search once typing pauses, so they re-add once, not per keystroke.
  const qStill = useSettled(query, 300)
  const forTotals = useMemo(() => (qStill === query ? matched : filterList(projects, avenue, area, sub, sc, subCatOf, type, qStill)),
    [matched, projects, avenue, area, sub, sc, type, query, qStill])

  // Totals across the whole filtered set (every card, not just those shown).
  const fig = useMemo(() => {
    let c = 0, b = 0, r = 0, h = 0
    for (const card of forTotals) {
      const m = d.metricsOf(card)
      c += m.c; b += m.b; r += m.r; h += m.h
    }
    return { c, b, r, h, m: forTotals.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forTotals, d.metricsPhase])

  // On the projects feed 'hidden' with rows in hand is only the render before the
  // back-fill starts: rest then too, so the count never flashes in first.
  const plural0 = (k) => (k === 1 ? 'Project' : 'Projects')
  // the counters (client, 2026-10-06): Projects · Cost · Beneficiaries · Rotarians involved · Man hours, the cost in
  // full. All years: the listed projects' own figures summed (useAllYearsTotals; no Rotarians figure).
  const allYears = d.scope === 'all'
  const at = allT
  const resting = !isMeetings && !d.loading && n > 0 && (allYears ? !at : d.metricsPhase !== 'ready')
  const figs = allYears ? { c: at ? at.c : 0, b: at ? at.b : 0, r: 0, h: at ? at.h : 0 } : fig
  const statItems = (isMeetings || d.loading || n === 0) ? [] : [
    { value: matched.length, label: plural0(matched.length), shape: 'dome', tone: 'turq', keep: true },
    { value: figs.c, label: 'Total cost', shape: 'pill', tone: 'gold', fmt: (v) => formatMoney(v, (allYears && at && at.currency) || cur) },
    { value: figs.b, label: 'Beneficiaries', shape: 'circle', tone: 'white' },
    allYears ? null : { value: figs.r, label: 'Rotarians involved', shape: 'arch', tone: 'cran' },
    { value: figs.h, label: 'Man hours', shape: 'square', tone: 'royal' },
  ].filter(Boolean).map((s) => (resting && !s.keep ? { ...s, value: 0, text: '—' } : s))
    .filter((s) => s.keep || resting || s.value > 0)

  const plural = (k) => (k === 1 ? noun : noun + 's')
  const showTally = isMeetings && !d.loading && n > 0 && statItems.length === 0   // projects: the switch replaces the count
  const aside = d.loading ? null : statItems.length ? (
    <div className="hj-proj-stats" aria-busy={resting ? 'true' : undefined}>
      <StatRow items={statItems} currency={cur} />
      {/* no "Totals for all N projects" line (client, 2026-10-06); a note only while adding up, or when filtered */}
      {resting || (fig.m !== n && !allYears) ? (
        <p className="hj-proj-stats__note">
          {resting ? 'Adding up the figures for every project…'
            : 'Totals for the ' + fig.m + ' matching ' + plural(fig.m)}
        </p>
      ) : null}
    </div>
  ) : showTally ? (
    <div className="hj-proj-tally" aria-hidden="true" style={{ '--hj-d': String(n).length }}>
      <p className="hj-proj-tally__n"><span className="hj-proj-tally__o">{n}</span><span className="hj-proj-tally__f">{n}</span></p>
      <p className="hj-proj-tally__l">{plural(n)}{yr ? ' · ' + yr : ''}</p>
    </div>
  ) : null


  const tab = avenueTabs.find((a) => a.code === avenue)
  const listTitle = tab ? tab.label : isMeetings ? 'All meetings' : 'All projects'
  const hasFilters = !isMeetings && (areaOptions.length + subAreaOptions.length + subCatOptions.length + typeOptions.length > 0)
  const shown = matched.slice(0, count)

  /** Detail links carry ?pr=CE on the club-service feed so the detail page's "back" returns here. */
  // each project opens in ITS OWN Rotary year (an all-years list mixes them)
  const detailHref = (p) => withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)
  const clearAll = () => { setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); refilter() }
  const more = () => { focusAt.current = shown.length; setRevealFrom(shown.length); setCount((c) => c + STEP) }

  // "Show more": keyboard focus moves to the first card it added.
  useEffect(() => {
    const i = focusAt.current
    if (i < 0) return
    focusAt.current = -1
    const li = gridRef.current && gridRef.current.children[i]
    const a = li && li.querySelector('a')
    if (a) a.focus()
  }, [count])

  const listSig = [d.loading, isMeetings, club.selectedYearId, avenue, area, sub, sc, type, query, count, revealFrom].join('|')
  useRefreshOnImages(ref, [listSig])

  // the filter panel settles onto the hills once the list is in
  useScene(ref, () => {
    rise(ref.current.querySelector('.hj-proj-panel'), null, { from: { y: 50 } })
  }, [d.loading, isMeetings, n > 0])

  // the outlined count fills in, left to right
  useScene(ref, () => {
    const f = ref.current.querySelector('.hj-proj-tally__f')
    if (f) gsap.fromTo(f, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.6, delay: 0.35, ease: 'expo.inOut', clearProps: 'clipPath' })
  }, [showTally, n])

  // the list heading: letters rise out of the skew (remounts with the selection)
  useScene(ref, (c, ctx) => afterFonts(ctx, () => titleIn(ref.current.querySelector('.hj-proj-head .hj-h2'))), [listTitle, d.loading, n > 0])

  // cards rise by rows and photos wipe open: for a fresh list and for "show more"
  useScene(ref, () => {
    if (revealFrom == null || !gridRef.current) return
    const items = [...gridRef.current.children].slice(revealFrom)
    if (!items.length) return
    revealBatch(items, { y: 48, stagger: 0.08 })
    items.forEach((li) => {
      const m = li.querySelector('.hj-card__m')
      if (m) wipeIn(m, { trigger: li, start: 'top 92%' })
    })
  }, [listSig])

  return (
    <div className="hj-page hj-ground--cream hj-proj" ref={ref}>
      <PageHero tone="azure" title={isMeetings ? 'Club Services' : 'Projects'} aside={aside}>
        {/* "Current year projects / All years projects" (client, 2026-10-06) */}
        {!isMeetings ? (
          <ScopeSwitch scope={scope} onChange={(v) => { setScope(v); setArea(''); setSub(''); setSc(''); setType(''); refilter() }} yearLabel={club.selectedYearLabel}
                       loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} />
        ) : null}
      </PageHero>

      {!d.loading && n > 0 && (
        <div className="hj-wrap hj-proj-tools">
          <div className="hj-proj-panel" role="search" aria-label={'Filter ' + noun + 's'}>
            {!isMeetings && avenueTabs.length > 0 && (
              <ChipGroup label="Filter by avenue" value={avenue} onChange={(v) => { setAvenue(v); setArea(''); setSub(''); setSc(''); setType(''); refilter() }}
                         options={[{ value: '', label: 'All', count: totalCount },
                           ...avenueTabs.map((a) => ({ value: a.code, label: a.label, count: a.count, tone: avenueTone(a.code) }))]} />
            )}
            <div className="hj-proj-fields">
              {hasFilters && areaOptions.length > 0 && (
                <Select id="hj-proj-area" label="Area of focus" value={area} all="All areas of focus" options={areaOptions}
                        onChange={(v) => { setArea(v); refilter() }} />
              )}
              {hasFilters && subAreaOptions.length > 0 && (
                <Select id="hj-proj-sub" label="Category" value={sub} all="All categories" options={subAreaOptions}
                        onChange={(v) => { setSub(v); refilter() }} />
              )}
              {hasFilters && subCatOptions.length > 0 && (
                <Select id="hj-proj-sc" label="Sub category" value={sc} all="All sub categories" options={subCatOptions}
                        onChange={(v) => { setSc(v); refilter() }} />
              )}
              {hasFilters && typeOptions.length > 0 && (
                <Select id="hj-proj-type" label="Project type" value={type} all="All projects" options={typeOptions}
                        onChange={(v) => { setType(v); refilter() }} />
              )}
              <div className="hj-proj-field hj-proj-field--q">
                <span className="hj-proj-field__l" aria-hidden="true">Search</span>
                <SearchField value={query} onChange={(v) => { setQuery(v); refilter() }}
                             label={'Search ' + noun + 's'} placeholder="Name, focus or description" />
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="hj-wrap hj-sec hj-endpad hj-proj-list" aria-labelledby={!d.loading && n > 0 ? 'hj-proj-list-t' : undefined}>
        {d.loading ? <Loading label={'Loading ' + noun + 's'} />
          : n === 0 ? (
            <EmptyState title="Nothing recorded yet"
                        message="Published work for this Rotary year will appear here as the club files it." />
          ) : (
            <>
              <div className="hj-proj-head">
                <SectionHead key={listTitle} k={yr ? 'Rotary year ' + yr : undefined} title={listTitle} id="hj-proj-list-t" />
                <ResultCount count={matched.length} total={n} noun={noun} />
              </div>
              {matched.length === 0 ? (
                <EmptyState as="h3" title="No matches"
                            message={isMeetings ? 'Nothing matches that search. Try other words.'
                              : 'No project matches those filters. Try clearing the search or picking a different avenue.'}
                            action={<Button variant="ink" onClick={clearAll}>Clear filters</Button>} />
              ) : (
                <>
                  <ul className="hj-proj-grid" ref={gridRef}>
                    {shown.map((p) => (
                      <PhotoCard key={p.uid} as="li" href={detailHref(p)} img={p.img}
                                 chip={p.avenueLabel || undefined} chipTone={avenueTone(p.avenue)}
                                 meta={p.date || undefined} title={p.title || 'Untitled'}
                                 desc={cut(htmlText(p.desc), 150) || undefined}
                                 imgProps={{ width: 400, height: 300 }}>
                        {p.updates > 0 ? <p className="hj-proj-upd"><Hills />{p.updates} update{p.updates === 1 ? '' : 's'}</p> : null}
                      </PhotoCard>
                    ))}
                  </ul>
                  {matched.length > shown.length && (
                    <div className="hj-proj-more">
                      <p className="hj-count">{shown.length} of {matched.length} shown</p>
                      <Button variant="ink" onClick={more} icon={<Down />}>
                        Show {Math.min(STEP, matched.length - shown.length)} more
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
      </section>
    </div>
  )
}
