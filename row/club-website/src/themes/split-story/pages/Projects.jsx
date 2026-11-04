'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Projects — the year's work as a dealt hand. The royal hero states
// the count in gold and carries every control the hook supports (avenue chips
// with counts, area of focus → sub area, project type, search, a live result
// count). Under it the four impact totals for WHATEVER is filtered, counting up
// again on every change, then the cards: each photo opens through the theme's
// iris or diagonal wipe as it lands, so switching avenue re-deals the grid.
// Twenty-four at a time; "Show more" deals the next hand.
//
// Data + rules: useProjectsData (goldData.useProjectsGold) exactly as
// ProjectsGold uses it — ?pr=CE is the club-service feed (no avenue chips, no
// totals, no filters but search), ?pr=CP|VS|NGS|IS|PII pre-selects that avenue,
// the totals follow the metric back-fill phase (hidden | loading → '—' | ready,
// zero totals dropped, never a row of zeroes).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub, useProjectsData, useCurrentMenuName, usePageTitle, withYear, plainText, useProjectFacets, useAllYearsTotals } from '../../_shared/data.js'
import { PageHero, Chips, SearchField, StatRow, Card, Tag, Button, EmptyState, Loading, Chevron, excerpt, yearText } from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, revealBatch } from '../motion.js'
import './Projects.css'
import { ScopeSwitch, useProjectScope } from '../../_shared/kit.jsx'

// 24 divides into 1, 2, 3 and 4 columns, so a new hand never leaves a hole in the last row.
const PAGE = 24
const STAT_LABELS = ['Total cost', 'Beneficiaries', 'Rotarians involved', 'Man hours']

/**
 * The deal: each photo frame opens once as it enters - iris and diagonal wipe
 * alternately (the shapes of motion.js photosIn), PLAYED rather than scrubbed, so
 * a grid that is already on screen deals itself in on every filter change and
 * never rests half-clipped.
 */
function dealIn(frames) {
  gsap.utils.toArray(frames).forEach((f, i) => {
    const iris = i % 2 === 0
    const st = { trigger: f, start: 'top 92%', once: true }
    gsap.fromTo(f,
      { clipPath: iris ? 'circle(8% at 50% 50%)' : 'polygon(0% 0%, 0% 0%, -30% 100%, -30% 100%)' },
      { clipPath: iris ? 'circle(75% at 50% 50%)' : 'polygon(0% 0%, 130% 0%, 100% 100%, -30% 100%)',
        duration: 1.1, delay: (i % 4) * 0.07, ease: 'power3.inOut', clearProps: 'clipPath', scrollTrigger: st })
    const img = f.querySelector('img')
    if (img) gsap.fromTo(img, { scale: 1.25 }, { scale: 1, duration: 1.5, delay: (i % 4) * 0.07, ease: 'power3.out', clearProps: 'transform', scrollTrigger: st })
  })
}

/** A labelled native select on royal (area of focus, sub area, project type). */
function Select({ id, label, all, value, options, onChange }) {
  return (
    <div className="spl-proj-field">
      <label htmlFor={id}>{label}</label>
      <div className="spl-proj-select">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{all}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
        </select>
        <Chevron />
      </div>
    </div>
  )
}

/** One hand of cards. "Show more" mounts another, so only the new hand deals in. */
function Hand({ items, hrefOf }) {
  const ref = useRef(null)
  const sig = items.map((p) => p.id).join(',')
  useScene(ref, () => {
    const r = ref.current
    revealBatch(r.children, { y: 48, stagger: 0.07 })
    dealIn(r.querySelectorAll('.spl-card-media'))
  }, [sig])
  useRefreshOnImages(ref, [sig])

  return (
    <ul className="spl-grid spl-proj-grid" style={{ '--spl-min': '300px' }} ref={ref}>
      {items.map((p) => {
        const title = plainText(p.title) || p.title
        const desc = excerpt(plainText(p.desc), 150)
        return (
          <li key={p.uid} className="spl-proj-item">
            <Card href={hrefOf(p)} img={p.img} alt="" tag={p.avenueLabel || undefined} title={title} meta={p.date || undefined}>
              {desc ? <p className="spl-proj-desc">{desc}</p> : null}
              {/* Child projects are not cards of their own (ProjectsGold): the count keeps them visible. */}
              {p.updates > 0 ? (
                <p className="spl-proj-foot"><Tag tone="gold">{p.updates} update{p.updates === 1 ? '' : 's'}</Tag></p>
              ) : null}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}

export default function Projects({ data }) {
  const club = useClub()
  const loc = useLocation()
  const pr = (new URLSearchParams(loc.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || (isMeetings ? 'Club Services' : 'Projects')
  usePageTitle(title)

  // this year's projects or every year's (client, 2026-10-06) - ?all=1
  const [scope, setScope] = useProjectScope()
  const d = useProjectsData(isMeetings, scope, data.projects)
  const { projects, totalCount, avenueTabs } = d

  // ?pr= pre-selects a tab; CE/CS are never tabs of their own (ProjectsGold).
  const initialAvenue = (isMeetings || pr === 'CS') ? '' : pr
  const [avenue, setAvenue] = useState(initialAvenue)
  const [area, setArea] = useState('')
  const [sub, setSub] = useState('')
  const [sc, setSc] = useState('')   // subcategory
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const listRef = useRef(null)
  const focusAt = useRef(-1)

  // A different ?pr= is a whole new page: every filter resets, not just the tab.
  useEffect(() => {
    setAvenue(initialAvenue); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setLimit(PAGE)
  }, [initialAvenue])
  // A new year's list starts with one hand again.
  useEffect(() => { setLimit(PAGE) }, [projects])

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

  // Totals across the whole filtered set (every hand, not just the dealt ones).
  const totals = useMemo(() => {
    let c = 0, b = 0, r = 0, h = 0
    for (const card of matched) {
      const m = d.metricsOf(card)
      c += +m.c || 0; b += +m.b || 0; r += +m.r || 0; h += +m.h || 0
    }
    return { c, b, r, h }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, d.metricsPhase])

  // "Show more": focus moves to the first card of the new hand.
  useEffect(() => {
    if (focusAt.current < 0 || !listRef.current) return
    const a = listRef.current.querySelectorAll('.spl-card-title a')[focusAt.current]
    focusAt.current = -1
    if (a) a.focus({ preventScroll: true })
  }, [limit])

  const refilter = (fn) => (v) => { fn(v); setLimit(PAGE) }
  const clearAll = () => { setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setLimit(PAGE) }
  // each project opens in ITS OWN Rotary year (an all-years list mixes them)
  const hrefOf = (p) => withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)

  const cur = club.currency
  const noun = isMeetings ? 'meeting' : 'project'
  const nouns = [noun, noun + 's']
  const year = yearText(club.selectedYearLabel)
  const filtered = !!(avenue || area || sub || sc || type || query.trim())
  const loadingStats = !isMeetings && d.metricsPhase === 'loading'

  // The ledger: '—' while the per-project figures back-fill, then only the
  // non-zero totals; none at all -> no ledger.
  // the counters (client, 2026-10-06): Projects · Cost · Beneficiaries · Rotarians involved · Man hours, the cost in
  // full. All years: the listed projects' own figures summed (useAllYearsTotals; no Rotarians figure).
  const allYears = d.scope === 'all'
  const countStat = { label: matched.length === 1 ? 'Project' : 'Projects', value: matched.length, currency: cur }
  let stats = null
  if (!isMeetings && allYears) {
    const t = allT
    stats = [countStat].concat(t ? [
      { label: STAT_LABELS[0], value: t.c, fmt: 'moneyFull', currency: t.currency || cur },
      { label: STAT_LABELS[1], value: t.b, currency: cur },
      { label: STAT_LABELS[3], value: t.h, currency: cur },
    ].filter((s) => s.value > 0) : [STAT_LABELS[0], STAT_LABELS[1], STAT_LABELS[3]].map((label) => ({ label, value: '—' })))
  } else if (loadingStats) {
    stats = [countStat].concat(STAT_LABELS.map((label) => ({ label, value: '—' })))
  } else if (!isMeetings && d.metricsPhase === 'ready') {
    stats = [countStat].concat([
      { label: STAT_LABELS[0], value: totals.c, fmt: 'moneyFull', currency: cur }, // full amount (client, 2026-10-06)
      { label: STAT_LABELS[1], value: totals.b, currency: cur },
      { label: STAT_LABELS[2], value: totals.r, currency: cur },
      { label: STAT_LABELS[3], value: totals.h, currency: cur },
    ].filter((s) => s.value > 0))
  } else if (!isMeetings && !d.loading && matched.length) {
    stats = [countStat]
  }

  const avenueItems = [{ value: '', label: 'All', count: totalCount }]
    .concat(avenueTabs.map((a) => ({ value: a.code, label: a.label, count: a.count })))
  const shown = matched.slice(0, limit)
  const hands = []
  for (let i = 0; i < shown.length; i += PAGE) hands.push(shown.slice(i, i + PAGE))
  const ready = !d.loading && projects.length > 0

  return (
    <div className="spl-proj">
      <PageHero
        title={title}
        eyebrow="Our work"
        lead={(isMeetings ? 'Meetings recorded' : 'Projects delivered') + (year ? ' in the ' + year + ' Rotary year' : '') + '.'}
        stat={!d.loading && totalCount > 0 ? { value: totalCount, label: totalCount === 1 ? (isMeetings ? 'Meeting' : 'Project') : (isMeetings ? 'Meetings' : 'Projects') } : null}
      >
        {/* the switch replaces the project count (client, 2026-10-06) */}
        {!isMeetings ? (
          <ScopeSwitch scope={scope} onChange={(v) => { setScope(v); setArea(''); setSub(''); setSc(''); setType(''); setLimit(PAGE) }} yearLabel={club.selectedYearLabel}
                       loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} />
        ) : null}
        {ready ? (
          <div className="spl-proj-controls">
            {!isMeetings && avenueTabs.length > 0 ? (
              <Chips label="Filter by avenue" items={avenueItems} value={avenue} onChange={(v) => { setAvenue(v); setArea(''); setSub(''); setSc(''); setType(''); setLimit(PAGE) }} />
            ) : null}
            <div className="spl-proj-tools">
              <SearchField id="spl-proj-q" label={'Search ' + nouns[1]} value={query} onChange={refilter(setQuery)}
                           placeholder="Name, focus or description" />
              {!isMeetings && areaOptions.length > 0 ? (
                <Select id="spl-proj-area" label="Area of focus" all="All areas of focus" value={area} options={areaOptions}
                        onChange={(v) => { setArea(v); setSub(''); setSc(''); setLimit(PAGE) }} />
              ) : null}
              {!isMeetings && subAreaOptions.length > 0 ? (
                <Select id="spl-proj-sub" label="Category" all="All categories" value={sub} options={subAreaOptions}
                        onChange={refilter(setSub)} />
              ) : null}
              {!isMeetings && subCatOptions.length > 0 ? (
                <Select id="spl-proj-sc" label="Sub category" all="All sub categories" value={sc} options={subCatOptions}
                        onChange={refilter(setSc)} />
              ) : null}
              {!isMeetings && typeOptions.length > 0 ? (
                <Select id="spl-proj-type" label="Project type" all="All projects" value={type} options={typeOptions}
                        onChange={refilter(setType)} />
              ) : null}
              {/* the figures already give the count (client, 2026-10-07): a reset ends the row, the count kept for screen readers */}
              <Button variant="light" arrow={false} className="spl-proj-clear" onClick={clearAll}
                      disabled={!(avenue || area || sub || sc || type || query) || undefined}>Clear filters</Button>
            </div>
            <p className="spl-sr" role="status">{matched.length + ' of ' + projects.length + ' ' + nouns[1]}</p>
          </div>
        ) : null}
      </PageHero>

      <section className="spl-section spl-proj-body" aria-labelledby="spl-proj-h">
        <div className="spl-x">
          <h2 className="spl-sr" id="spl-proj-h">{isMeetings ? 'All meetings' : 'All projects'}</h2>

          {d.loading ? <Loading label={'Loading ' + nouns[1]} /> : projects.length === 0 ? (
            <EmptyState title="Nothing recorded yet"
                        message={'Published ' + nouns[1] + ' for this Rotary year will appear here as the club files them.'} />
          ) : (
            <>
              {stats && stats.length ? (
                <div className="spl-proj-ledger">
                  {/* no "Totals for the year" label (client, 2026-10-06); a caption only when it needs explaining */}
                  {filtered && !allYears ? <h3 className="spl-proj-cap">{'Totals for the matching ' + nouns[1]}</h3> : null}
                  <StatRow items={stats} />
                  <p className="spl-proj-note" role="status">{loadingStats ? 'Adding up the figures…' : ''}</p>
                </div>
              ) : null}

              {matched.length === 0 ? (
                <EmptyState headingAs="h3" title="No matches"
                            message={isMeetings ? 'No meeting matches that search. Try a different word.'
                              : 'No project matches those filters. Try clearing the search or picking a different avenue.'}
                            action={<Button variant="ghost" arrow={false} onClick={clearAll}>Clear filters</Button>} />
              ) : (
                <div className="spl-proj-list" ref={listRef}>
                  {hands.map((items, i) => <Hand key={i} items={items} hrefOf={hrefOf} />)}
                  <div className="spl-proj-more">
                    <p className="spl-proj-shown">Showing {shown.length} of {matched.length} {matched.length === 1 ? noun : nouns[1]}</p>
                    {shown.length < matched.length ? (
                      <Button variant="ghost" arrow={false} onClick={() => { focusAt.current = shown.length; setLimit((l) => l + PAGE) }}>
                        Show {Math.min(PAGE, matched.length - shown.length)} more
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
