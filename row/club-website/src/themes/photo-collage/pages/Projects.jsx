'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage · PROJECTS — the home wall, extended to the whole year.
//
// PageHero holds the tools (avenue tabs with counts, area / sub-area / type as
// native selects on paper strips, search, a live count). Under it the filtered
// totals are stickers (a handwritten "adding up…" note while the per-project
// metric back-fill runs — never four zeroes), then the year's projects as taped
// prints over paper notes. Changing a filter re-deals the prints; "Show more"
// deals only the new ones and moves focus to the first of them.
//
// Data + rules: useProjectsData (goldData.useProjectsGold -> buildProjectsView)
// used exactly as ProjectsGold uses it. ?pr=CE = the club-service feed (no tabs,
// no area/type filters, no totals); ?pr=CP|VS|NGS|IS|PII pre-selects a tab.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub, useProjectsData, withYear, useProjectFacets, useAllYearsTotals } from '../../_shared/data.js'
import {
  PageHero, StatRow, Print, Note, Chip, TextLink, Button, FilterGroup, SearchField,
  EmptyState, Loading, TAPE_CYCLE, usePageName, yearDash, cleanText, excerpt,
} from '../kit.jsx'
import { useScene, useRefreshOnImages, decor, revealBatch, develop, captionIn, stickersIn } from '../motion.js'
import './Projects.css'
import { ScopeSwitch, useProjectScope } from '../../_shared/kit.jsx'

const STEP = 24
const TILT = [-2.5, 2, -1.5, 3, -3, 1.5]
const AV_TONE = { CP: 'azure', CS: 'royal', VS: 'gold', NGS: 'violet', IS: 'turq', PII: 'cran', CE: 'kraft' }

/** A native <select> on a taped paper strip (same look as SearchField). */
function PaperSelect({ label, value, onChange, disabled, children }) {
  const id = 'col-pj-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <div className={'col-pj-field' + (disabled ? ' is-off' : '')}>
      <label htmlFor={id} className="col-pj-field-label">{label}</label>
      <select id={id} className="col-pj-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  )
}

/** The filtered totals as stickers. Keyed by the figures, so each filter's totals pop and count up afresh. */
function Totals({ items, currency, phase, note }) {
  const ref = useRef(null)
  const sig = items.map((s) => s.value).join('|')
  const any = items.some((s) => Number(s.value) > 0)
  useScene(ref, (c) => {
    decor(ref.current)
    return stickersIn(ref.current.querySelectorAll('.col-stk'), { wide: c.wide })
  }, [sig, phase])
  if (phase !== 'loading' && !any) return null
  return (
    <section ref={ref} className="col-sec col-pj-totals" aria-labelledby="col-pj-totals-h">
      {/* no "what these projects add up to" title (client, 2026-10-06); a line only when the figures need explaining */}
      <h2 id="col-pj-totals-h" className="col-sr">Project totals</h2>
      {note ? <p className="col-pj-totals-h">{note}</p> : null}
      {phase === 'loading' ? (
        <p className="col-pj-counting" role="status">Adding up the numbers…</p>
      ) : (
        <StatRow key={sig} items={items} currency={currency} />
      )}
    </section>
  )
}

export default function Projects({ data }) {
  const club = useClub()
  const loc = useLocation()
  const pr = (new URLSearchParams(loc.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  const name = usePageName(isMeetings ? 'Club Services' : 'Projects')

  // this year's projects or every year's (client, 2026-10-06) - ?all=1
  const [scope, setScope] = useProjectScope()
  const d = useProjectsData(isMeetings, scope, data.projects)
  const { projects, avenueTabs } = d

  // ?pr= pre-selects a tab; CE/CS are never tabs of their own (as Gold).
  const initialAvenue = (isMeetings || pr === 'CS') ? '' : pr
  const [avenue, setAvenue] = useState(initialAvenue)
  const [area, setArea] = useState('')
  const [sub, setSub] = useState('')
  const [sc, setSc] = useState('')   // subcategory
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(STEP)

  // A different ?pr= is a new page: every filter resets (as Gold).
  useEffect(() => {
    setAvenue(initialAvenue); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setLimit(STEP)
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

  // Totals across the whole filtered set, not just the cards shown (as Gold).
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
  const matchSig = useMemo(() => matched.map((p) => p.id).join(','), [matched])

  const reset = (fn) => (v) => { fn(v); setLimit(STEP) }
  const clearAll = () => { setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setLimit(STEP) }

  // Deal the prints: a new result set re-deals all of them; "Show more" deals only
  // the new ones (re-dealing the cards above would flash them out and back in).
  const gridRef = useRef(null)
  const dealt = useRef({ sig: '', limit: 0 })
  useScene(gridRef, () => {
    const root = gridRef.current
    const from = dealt.current.sig === matchSig ? Math.min(dealt.current.limit, limit) : 0
    dealt.current = { sig: matchSig, limit }
    const cards = Array.from(root.querySelectorAll('.col-pj-card'))
    revealBatch(cards.slice(from))
    develop(root.querySelectorAll('.col-print-photo img'))
    captionIn(root.querySelectorAll('.col-print-cap'))
  }, [matchSig, limit])
  useRefreshOnImages(gridRef, [matchSig, limit])

  // Pinterest-style masonry (client, 2026-10-06): the grid runs on 4px rows and every card spans as many rows as
  // its own height, so cards of any height pack tightly while the reading order stays left to right (CSS columns
  // would pour the newest projects down the first column). Re-measured whenever a card's height changes (photos
  // landing, fonts, resizes). One column on phones, so no spans there.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return undefined
    const ROW = 4
    const mq = window.matchMedia('(min-width: 600px)')
    const fit = (li) => {
      if (!mq.matches) { li.style.gridRowEnd = ''; return }
      const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--col-pj-gap')) || 48
      // offsetHeight: the layout height, not the box of a card still tilting in on its entrance
      li.style.gridRowEnd = 'span ' + Math.ceil((li.offsetHeight + gap) / ROW)
    }
    const all = () => grid.querySelectorAll(':scope > .col-pj-card').forEach(fit)
    const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)))
    grid.querySelectorAll(':scope > .col-pj-card').forEach((li) => ro.observe(li))
    all()
    mq.addEventListener('change', all)
    return () => { ro.disconnect(); mq.removeEventListener('change', all) }
  }, [matchSig, limit])

  // "Show more": focus the first new card's link.
  const focusAt = useRef(null)
  const more = () => { focusAt.current = shown.length; setLimit((l) => l + STEP) }
  useEffect(() => {
    if (focusAt.current == null || !gridRef.current) return
    const link = gridRef.current.querySelectorAll('.col-pj-card .col-link')[focusAt.current]
    focusAt.current = null
    if (link) link.focus()
  }, [limit])

  const Y = yearDash(club.selectedYearLabel)
  // each project opens in ITS OWN Rotary year (an all-years list mixes them)
  const detailHref = (p) => withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)
  const withImg = projects.filter((p) => p.img)
  const heroPrints = withImg.slice(1, 4).map((p) => ({ src: p.img, caption: excerpt(p.title, 32) }))
  const hasFilters = !isMeetings && (areaOptions.length + subAreaOptions.length + subCatOptions.length + typeOptions.length > 0)
  // the counters (client, 2026-10-06): Projects · Cost · Beneficiaries · Rotarians involved · Man hours.
  // all years: the listed projects' own figures summed (useAllYearsTotals; no Rotarians figure).
  const allYears = d.scope === 'all'
  const at = allT
  const figs = allYears ? { c: at ? at.c : 0, b: at ? at.b : 0, r: 0, h: at ? at.h : 0 } : totals
  const statItems = [
    { value: matched.length, label: matched.length === 1 ? 'Project' : 'Projects' },
    { value: figs.c, label: 'Total cost', money: true },
    { value: figs.b, label: 'Beneficiaries' },
    allYears ? null : { value: figs.r, label: 'Rotarians involved' },
    { value: figs.h, label: 'Man hours' },
  ].filter(Boolean)
  const totalsPhase = allYears ? (at ? 'ready' : 'loading') : d.metricsPhase
  const filteredNow = !!(avenue || area || sub || sc || type || query.trim())
  const totalsNote = filteredNow && !allYears ? 'Totals for the ' + matched.length + ' matching' : ''
  const noun = isMeetings ? 'entry' : 'project'
  const plural = isMeetings ? 'entries' : 'projects'

  return (
    <div className="col-pj">
      <PageHero
        title={name}
        kicker={Y ? 'Rotary year ' + Y : undefined}
        lead={(isMeetings ? 'Meetings recorded' : 'Projects delivered') + (Y ? ' in Rotary year ' + Y : '') + '.'}
        img={withImg.length ? withImg[0].img : undefined}
        tint="cran"
        prints={heroPrints}
      >
        {/* "Current year projects / All years projects" (client, 2026-10-06) */}
        {!isMeetings ? (
          <ScopeSwitch scope={scope} onChange={(v) => { setScope(v); setArea(''); setSub(''); setSc(''); setType(''); setLimit(STEP) }} yearLabel={club.selectedYearLabel}
                       loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} />
        ) : null}
        {!d.loading && projects.length > 0 ? (
          <>
            {!isMeetings && avenueTabs.length > 0 ? (
              <FilterGroup
                label="Filter by avenue"
                value={avenue}
                onChange={(v) => { setAvenue(v); setArea(''); setSub(''); setSc(''); setType(''); setLimit(STEP) }}
                options={[{ value: '', label: 'All', count: projects.length }]
                  .concat(avenueTabs.map((a) => ({ value: a.code, label: a.label, count: a.count })))}
              />
            ) : null}
            <div className={'col-pj-tools' + (hasFilters ? '' : ' is-solo')}>
              {hasFilters && areaOptions.length > 0 ? (
                <PaperSelect label="Area of focus" value={area} onChange={(v) => { setArea(v); setSub(''); setSc(''); setLimit(STEP) }}>
                  <option value="">All areas of focus</option>
                  {areaOptions.map((a) => <option key={a.value} value={a.value}>{a.label} ({a.count})</option>)}
                </PaperSelect>
              ) : null}
              {hasFilters && subAreaOptions.length > 0 ? (
                <PaperSelect label="Category" value={sub} onChange={reset(setSub)}>
                  <option value="">All categories</option>
                  {subAreaOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                </PaperSelect>
              ) : null}
              {hasFilters && subCatOptions.length > 0 ? (
                <PaperSelect label="Sub category" value={sc} onChange={reset(setSc)}>
                  <option value="">All sub categories</option>
                  {subCatOptions.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.count})</option>)}
                </PaperSelect>
              ) : null}
              {hasFilters && typeOptions.length > 0 ? (
                <PaperSelect label="Project type" value={type} onChange={reset(setType)}>
                  <option value="">All projects</option>
                  {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label} ({t.count})</option>)}
                </PaperSelect>
              ) : null}
              {/* the figures above already give the count (client, 2026-10-07): a reset beside the search, the count kept for screen readers */}
              <div className="col-pj-find">
                <SearchField label={'Search ' + plural} value={query} onChange={reset(setQuery)} placeholder="Name, focus or description" />
                <Button variant="ghost" className="col-pj-clear" onClick={clearAll}
                        disabled={!(avenue || area || sub || sc || type || query) || undefined}>Clear filters</Button>
              </div>
            </div>
            <p className="col-sr" role="status">{matched.length + ' of ' + projects.length + ' ' + plural}</p>
          </>
        ) : null}
      </PageHero>

      {!isMeetings && totalsPhase !== 'hidden' && !d.loading ? (
        <Totals items={statItems} currency={(allYears && at && at.currency) || club.currency} phase={totalsPhase} note={totalsNote} />
      ) : null}

      <section className="col-sec col-pj-body" aria-label={name}>
        {d.loading ? (
          <Loading label={'Loading ' + plural} count={3} />
        ) : projects.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            message={'Published work for ' + (Y ? 'Rotary year ' + Y : 'this Rotary year') + ' will appear here as the club files it.'}
          />
        ) : matched.length === 0 ? (
          <EmptyState
            title="No matches"
            message="Nothing matches those filters. Try clearing the search or picking a different avenue."
            action={<Button variant="ghost" onClick={clearAll}>Clear filters</Button>}
          />
        ) : (
          <>
            <ul className="col-pj-grid" ref={gridRef}>
              {shown.map((p, i) => {
                const title = cleanText(p.title) || 'Project'
                const desc = excerpt(p.desc, 150)
                return (
                  <li key={p.uid} className="col-pj-card">
                    <Print src={p.img} caption={title} captionAs="h3" ratio="auto" tape={TAPE_CYCLE[i % 4]} r={TILT[i % TILT.length]} k={i % 2 ? -0.8 : 0.8}>
                      <Note className="col-pj-note">
                        {p.date || p.avenueLabel ? (
                          <p className="col-pj-meta">
                            {p.date ? <span>{p.date}</span> : null}
                            {p.avenueLabel ? <Chip tone={AV_TONE[p.avenue] || 'ink'}>{p.avenueLabel}</Chip> : null}
                          </p>
                        ) : null}
                        {desc ? <p className="col-pj-desc">{desc}</p> : null}
                        {p.updates > 0 ? <p className="col-pj-upd">{p.updates} update{p.updates === 1 ? '' : 's'}</p> : null}
                        <TextLink href={detailHref(p)} sr={title}>View project</TextLink>
                      </Note>
                    </Print>
                  </li>
                )
              })}
            </ul>
            {matched.length > shown.length ? (
              <div className="col-pj-more">
                <p className="col-pj-more-n">Showing {shown.length} of {matched.length}</p>
                <Button variant="ink" onClick={more}>Show more {plural}</Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
