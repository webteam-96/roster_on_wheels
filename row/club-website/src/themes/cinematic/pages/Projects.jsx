'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · PROJECTS — "the reel".
// The year's work as a programme of frames. The hero states the count as the
// headline; under it the four impact totals for whatever is filtered (condensed
// gold, counting up again on every filter change), the avenue chips, search and
// Gold's three filters. The grid is film frames: the newest leads as a wide
// feature frame with parallax inside it, and every row slides in from the right
// like frames running into the gate. Eighteen at a time (plus the lead frame), "Show more" adds a strip.
//
// Data + rules: useProjectsData (goldData.useProjectsGold) exactly as Gold uses
// it — ?pr=CE is the club-service feed (no tabs, no totals, no filters but
// search), ?pr=CP|VS|NGS|IS|PII pre-selects that avenue, the totals follow the
// metrics back-fill phase (hidden | loading -> '—' | ready).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub, useProjectsData, withYear, formatMoney, groupInt, plainText, useProjectFacets, useAllYearsTotals } from '../../_shared/data.js'
import {
  usePageName, PageHero, Button, ChipGroup, SearchField, ResultCount, StatRow, Pill, FrameCard,
  EmptyState, Loading, Arrow, cutText,
} from '../kit.jsx'
import { useScene, useRefreshOnImages, riseIn, parallax, rowsOf } from '../motion.js'
import { ScopeSwitch, useProjectScope } from '../../_shared/kit.jsx'
import './Projects.css'

// 18 fills whole rows at every width (1, 2 or 3 across), so a strip never ends on a lone
// frame; the first strip carries one more because the lead frame takes a row of its own
// (was 20: 1 + 19 left one frame alone and "Show 1 more" put the next one under it - client, 2026-09-28).
const PAGE = 18
const STAT_LABELS = ['Total cost', 'Beneficiaries', 'Rotarians involved', 'Man hours']

// ── one strip of up to PAGE frames (Show more mounts another, so only it enters) ──
function Strip({ items, feature, hrefOf }) {
  const ref = useRef(null)
  const sig = items.map((p) => p.id).join(',') + (feature ? ':f' : '')
  useScene(ref, () => {
    const cards = [...ref.current.children]
    const feat = feature ? cards[0] : null
    if (feat) {
      riseIn(feat, { y: 60 })
      parallax(feat.querySelector('.cin-card__pic'), { amount: 4 })
    }
    rowsOf(feat ? cards.slice(1) : cards).forEach((row) => {
      riseIn(row, { x: 80, y: 0, stagger: 0.08, duration: 1.1, start: 'top 92%' })
    })
  }, [sig])
  useRefreshOnImages(ref, [sig])

  return (
    <ul ref={ref} className="cin-prj-grid">
      {items.map((p, i) => (
        <FrameCard key={p.uid} layout="grid" whole img={p.img} title={p.title} href={hrefOf(p)}
          className={feature && i === 0 ? 'cin-prj-feat' : ''}
          meta={(
            <>
              {p.avenueLabel ? <Pill>{p.avenueLabel}</Pill> : null}
              {p.date ? <span className="cin-prj-date">{p.date}</span> : null}
              {p.updates > 0 ? <span className="cin-prj-upd">{p.updates} update{p.updates === 1 ? '' : 's'}</span> : null}
            </>
          )}
          text={cutText(plainText(p.desc), feature && i === 0 ? 320 : 180)}>
          {/* the whole card is the link (the title's stretched ::after); this is its visible cue */}
          <span className="cin-prj-read" aria-hidden="true">Read more <Arrow /></span>
        </FrameCard>
      ))}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Projects({ data }) {
  const club = useClub()
  const loc = useLocation()
  const pr = (new URLSearchParams(loc.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  const name = usePageName(isMeetings ? 'Club Services' : 'Projects')

  // this year's projects or every year's (client, 2026-10-06) - ?all=1
  const [scope, setScope] = useProjectScope()
  const d = useProjectsData(isMeetings, scope, data.projects)
  const { projects, totalCount, avenueTabs } = d

  // ?pr= pre-selects a tab; CE/CS are never tabs of their own (Gold).
  const initialAvenue = (isMeetings || pr === 'CS') ? '' : pr
  const [avenue, setAvenue] = useState(initialAvenue)
  const [area, setArea] = useState('')
  const [sub, setSub] = useState('')
  const [sc, setSc] = useState('')   // subcategory
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [more, setMore] = useState(0)          // strips added with "Show more"
  const listRef = useRef(null)
  const focusAt = useRef(-1)

  // A different ?pr= is a new page: every filter resets, not just the tab.
  useEffect(() => {
    setAvenue(initialAvenue); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setMore(0)
  }, [pr]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Totals across the whole filtered set (every strip, not just the shown ones).
  const totals = useMemo(() => {
    let c = 0, b = 0, r = 0, h = 0
    for (const card of matched) {
      const m = d.metricsOf(card)
      c += m.c; b += m.b; r += m.r; h += m.h
    }
    return { c, b, r, h }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, d.metricsPhase])

  // Show more: move focus to the first frame of the new strip.
  useEffect(() => {
    if (focusAt.current < 0 || !listRef.current) return
    const a = listRef.current.querySelectorAll('.cin-card__t a')[focusAt.current]
    focusAt.current = -1
    if (a) a.focus({ preventScroll: true })
  }, [more])

  const refilter = (fn) => (v) => { fn(v); setMore(0) }
  const clearAll = () => { setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setMore(0) }
  // each project opens in ITS OWN Rotary year (an all-years list mixes them)
  const hrefOf = (p) => withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)

  const cur = club.currency
  const noun = isMeetings ? 'meeting' : 'project'
  const filtered = !!(avenue || area || sub || sc || type || query.trim())

  // The ledger: '—' while the per-project figures back-fill, then only the
  // non-zero totals (never a row of zeroes); none at all -> no ledger.
  // the counters (client, 2026-10-06): Projects · Cost · Beneficiaries · Rotarians involved · Man hours, the cost in
  // full. All years: the listed projects' own figures summed (useAllYearsTotals; no Rotarians figure).
  const allYears = d.scope === 'all'
  const countStat = { label: matched.length === 1 ? 'Project' : 'Projects', value: matched.length, format: (n) => groupInt(n, cur) }
  let stats = null
  if (!isMeetings && allYears) {
    const t = allT
    stats = [countStat].concat(t ? [
      { label: STAT_LABELS[0], value: t.c, format: (n) => formatMoney(n, t.currency || cur) },
      { label: STAT_LABELS[1], value: t.b, format: (n) => groupInt(n, cur) },
      { label: STAT_LABELS[3], value: t.h, format: (n) => groupInt(n, cur) },
    ].filter((s) => s.value > 0) : [STAT_LABELS[0], STAT_LABELS[1], STAT_LABELS[3]].map((label) => ({ label, text: '—' })))
  } else if (!isMeetings && d.metricsPhase === 'loading') {
    stats = [countStat].concat(STAT_LABELS.map((label) => ({ label, text: '—' })))
  } else if (!isMeetings && d.metricsPhase === 'ready') {
    stats = [countStat].concat([
      { label: STAT_LABELS[0], value: totals.c, format: (n) => formatMoney(n, cur) },
      { label: STAT_LABELS[1], value: totals.b, format: (n) => groupInt(n, cur) },
      { label: STAT_LABELS[2], value: totals.r, format: (n) => groupInt(n, cur) },
      { label: STAT_LABELS[3], value: totals.h, format: (n) => groupInt(n, cur) },
    ].filter((s) => s.value > 0))
  } else if (!isMeetings && !d.loading && matched.length) {
    stats = [countStat]
  }

  const avenueOptions = [{ value: '', label: 'All', count: totalCount }]
    .concat(avenueTabs.map((a) => ({ value: a.code, label: a.label, count: a.count })))
  const lead = matched.length >= 5
  const first = PAGE + (lead ? 1 : 0)
  const shown = matched.slice(0, first + more * PAGE)
  const strips = [shown.slice(0, first)]
  for (let i = first; i < shown.length; i += PAGE) strips.push(shown.slice(i, i + PAGE))

  // the head counts the avenue on show (the menu's dropdown opens /projects?pr=VS): "2 projects", not
  // the club's 21 (client, 2026-10-06)
  const headCount = avenue ? projects.filter((c) => c.avenue === avenue).length : totalCount

  return (
    <div className="cin-prj">
      <PageHero
        title={name}
        meta={isMeetings ? (d.loading ? null : (
          <p className="cin-prj-total">
            <b>{headCount}</b>
            <span>{headCount === 1 ? noun : noun + 's'}</span>
          </p>
        )) : (
          /* the switch replaces the project count (client, 2026-10-06) */
          <ScopeSwitch scope={scope} onChange={(v) => { setScope(v); setArea(''); setSub(''); setSc(''); setType(''); setMore(0) }} yearLabel={club.selectedYearLabel}
                       loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} />
        )}
      />

      {d.loading ? <Loading label={'Loading ' + noun + 's'} /> : projects.length === 0 ? (
        <div className="cin-sec">
          <EmptyState title="Nothing recorded yet"
            message={'Published ' + noun + 's for this Rotary year will appear here as the club files them.'} />
        </div>
      ) : (
        <section className="cin-sec cin-prj-index" aria-labelledby="cin-prj-h">
          <h2 className="cin-sr" id="cin-prj-h">{isMeetings ? 'All meetings' : 'All projects'}</h2>

          {stats && stats.length ? (
            <div className="cin-prj-ledger">
              {/* no "Totals for the year" label (client, 2026-10-06); a caption only when it needs explaining */}
              {filtered && !allYears ? <p className="cin-prj-cap">{'Totals for the matching ' + noun + 's'}</p> : null}
              <StatRow items={stats} />
            </div>
          ) : null}

          <div className="cin-prj-controls">
            {!isMeetings ? (
              <ChipGroup label="Filter by avenue" options={avenueOptions} value={avenue} onChange={(v) => { setAvenue(v); setArea(''); setSub(''); setSc(''); setType(''); setMore(0) }} />
            ) : null}
            <div className="cin-prj-tools">
              <SearchField value={query} onChange={refilter(setQuery)} label={'Search ' + noun + 's'}
                placeholder="Name, focus or description" className="cin-prj-search" />
              {!isMeetings && areaOptions.length > 0 ? (
                <label className="cin-prj-field">
                  <span className="cin-prj-field__l">Area of focus</span>
                  <select className="cin-select" value={area} onChange={(e) => { setArea(e.target.value); setSub(''); setSc(''); setMore(0) }}>
                    <option value="">All areas of focus</option>
                    {areaOptions.map((a) => <option key={a.value} value={a.value}>{a.label} ({a.count})</option>)}
                  </select>
                </label>
              ) : null}
              {!isMeetings && subAreaOptions.length > 0 ? (
                <label className="cin-prj-field">
                  <span className="cin-prj-field__l">Category</span>
                  <select className="cin-select" value={sub} onChange={(e) => { setSub(e.target.value); setMore(0) }}>
                    <option value="">All categories</option>
                    {subAreaOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                  </select>
                </label>
              ) : null}
              {!isMeetings && subCatOptions.length > 0 ? (
                <label className="cin-prj-field">
                  <span className="cin-prj-field__l">Sub category</span>
                  <select className="cin-select" value={sc} onChange={(e) => { setSc(e.target.value); setMore(0) }}>
                    <option value="">All sub categories</option>
                    {subCatOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                  </select>
                </label>
              ) : null}
              {!isMeetings && typeOptions.length > 0 ? (
                <label className="cin-prj-field">
                  <span className="cin-prj-field__l">Project type</span>
                  <select className="cin-select" value={type} onChange={(e) => { setType(e.target.value); setMore(0) }}>
                    <option value="">All projects</option>
                    {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label} ({t.count})</option>)}
                  </select>
                </label>
              ) : null}
              {/* a reset ends the row (client, 2026-10-07) */}
              <Button variant="line" magnet={false} className="cin-prj-clear" onClick={clearAll}
                      disabled={!(avenue || area || sub || sc || type || query) || undefined}>Clear filters</Button>
            </div>
            {/* the count is in the band; this one only announces filter results to screen readers */}
            <ResultCount className="cin-sr" count={matched.length} total={projects.length} noun={noun} />
          </div>

          {matched.length === 0 ? (
            <EmptyState as="h3" title="No matches"
              message={isMeetings ? 'No meeting matches that search. Try a different word.'
                : 'No project matches those filters. Try clearing the search or picking a different avenue.'}
              action={<Button variant="line" onClick={clearAll}>Clear filters <Arrow /></Button>} />
          ) : (
            <div ref={listRef} className="cin-prj-list">
              {strips.map((items, i) => (
                <Strip key={i} items={items} feature={i === 0 && lead} hrefOf={hrefOf} />
              ))}
              <div className="cin-prj-more">
                <p className="cin-prj-shown">Showing {shown.length} of {matched.length}</p>
                {shown.length < matched.length ? (
                  <Button variant="line" onClick={() => { focusAt.current = shown.length; setMore((m) => m + 1) }}>
                    Show {Math.min(PAGE, matched.length - shown.length)} more
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
