'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · PROJECTS — the control room.
//
// A club's project list is an INDEX of work, and the honest headline for it is a
// number. So the page opens on navy with the count set enormous, states the four
// impact totals as a hairline ledger rather than four boxes, and puts the
// filters on text rails instead of pills — a control surface, not a shop front.
// The grid is asymmetric: the first tile of every page runs 2x2, so the page has
// a focal point instead of twenty identical rectangles.
//
// Every rule about WHAT is listed (main projects only, avenue mapping, the seven
// canonical areas of focus, the client-side metric back-fill) comes from
// buildProjectsView / useProjectsGold, shared verbatim with the classic page.
// This file owns the composition and nothing else.
//
// ?pr=CE is the legacy "Club Services" view — same component, different feed,
// no avenue tabs and no impact ledger, exactly as the shared page behaves.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { withYear } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useProjectsGold, useProjectFacets, useAllYearsTotals } from './goldData.js'
import { useProjectScope, ScopeSwitch } from '@/themes/_shared/kit.jsx'
import { GPageHead, GEmpty, Arrow, useRevealReplay, hideOnError, money, count } from './kit.jsx'

const PAGE_SIZE = 20

const Chevron = () => (
  <svg className="gpr-field__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
)

/** Page numbers to show: always 1 & last, plus a window around the current one. */
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

export default function ProjectsGold({ data }) {
  const club = useClub()
  const location = useLocation()

  const pr = (new URLSearchParams(location.search).get('pr') || '').trim().toUpperCase()
  const isMeetings = pr === 'CE'
  const menuName = useCurrentMenuName()
  const heading = (menuName && menuName.trim()) || (isMeetings ? 'Club Services' : 'Projects')
  usePageTitle(heading)

  // "Current year projects / All years projects" (client, 2026-10-28: the older themes too)
  const [scope, setScope] = useProjectScope()
  const d = useProjectsGold(isMeetings, scope, data.projects)
  const allYears = d.scope === 'all'
  const { projects, totalCount, avenueTabs } = d

  /** Detail link carries ?pr=CE on the Club Services view so the detail page's
   *  "Back" returns HERE — the payload has no marker to tell the two apart. */
  const detailHref = (p) =>
    withYear('/project?pid=' + p.id + (isMeetings ? '&pr=CE' : ''), p.yearId || club.selectedYearId)   // the card's OWN year

  // ?pr= pre-selects a tab; CE/CS are never tabs of their own.
  const initialAvenue = (isMeetings || pr === 'CS') ? '' : pr

  const [avenue, setAvenue] = useState(initialAvenue)
  const [area, setArea] = useState('')
  const [sub, setSub] = useState('')
  const [sc, setSc] = useState('')   // sub category
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const topRef = useRef(null)

  // A different ?pr= is a whole new page in the Web Forms original, so it resets
  // every filter, not just the pre-selected tab.
  useEffect(() => {
    setAvenue(initialAvenue); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); setPage(1)
  }, [initialAvenue])

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

  // Totals across the CURRENT filtered set — every page of it, not just this one.
  const totals = useMemo(() => {
    let c = 0, b = 0, r = 0, h = 0
    for (const card of matched) {
      const m = d.metricsOf(card)
      c += m.c; b += m.b; r += m.r; h += m.h
    }
    return { c, b, r, h }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, d.metricsPhase])
  // all years: the listed projects' own figures summed (no Rotarians figure); null while counting
  const allT = useAllYearsTotals(d, matched)

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const cur = Math.min(Math.max(page, 1), totalPages)
  const start = (cur - 1) * PAGE_SIZE
  const shown = matched.slice(start, start + PAGE_SIZE)

  const refilter = () => setPage(1)
  const goPage = (p) => {
    setPage(p)
    if (topRef.current) topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useRotaryAnim([d.loading, projects.length, matched.length, cur, scope])
  useRevealReplay('gpr-page', [d.loading, matched.length, cur])

  const loadingStats = allYears ? !allT : d.metricsPhase === 'loading'
  const showLedger = !isMeetings && (allYears || d.metricsPhase !== 'hidden')
  const fig = allYears ? (allT || { c: 0, b: 0, h: 0 }) : totals
  const pickScope = (v) => { setScope(v); setArea(''); setSub(''); setSc(''); setType(''); setPage(1) }
  const hasFilters = !isMeetings && (areaOptions.length + subAreaOptions.length + subCatOptions.length + typeOptions.length > 0)

  return (
    <div className="gpr-page">

      {/* ══ 01 · The count, then the ledger ══ */}
      {/* Neutral eyebrow on both views. The club's own menu label wins for the
          title (CurrentMenuName, as the C# does), and for many clubs the
          Projects menu ALSO matches ?pr=CE — so a "Club service" eyebrow above a
          "Projects" title contradicted itself. The sub line says which feed this
          actually is. The COUNT is the headline: figure and noun on one line,
          the same construction the Directory uses. */}
      <GPageHead
        crumbs={[{ label: heading }]}
        eyebrow="Our work"
        title={<><em>{totalCount}</em> {heading}</>}
        sub={(isMeetings ? 'Meetings recorded' : 'Projects delivered')
          + (allYears ? ' across every Rotary year' : club.selectedYearLabel ? ' in the ' + club.selectedYearLabel + ' Rotary year' : '') + '.'}
      >
        {!isMeetings && (
          <ScopeSwitch scope={scope} onChange={pickScope} loading={d.allLoading} done={d.allLoad.done} of={d.allLoad.of} />
        )}
        {showLedger && (
          /* Totals for the filtered set. They re-add on every filter change,
             which is the point of putting them at the top of the page rather
             than on each card. */
          <div className={'gpr-ledger' + (loadingStats ? ' is-loading' : '')}>
            {[
              ['Total cost', loadingStats ? '—' : money(fig.c, (allYears && allT && allT.currency) || club.currency)],
              ['Beneficiaries', loadingStats ? '—' : count(fig.b, club.currency)],
              allYears ? null : ['Rotarians involved', loadingStats ? '—' : count(totals.r, club.currency)],
              ['Man hours', loadingStats ? '—' : count(fig.h, club.currency)],
            ].filter(Boolean).map(([l, n]) => (
              <div className="gpr-ledger__f" key={l}>
                <div className="gpr-ledger__n">{n}</div>
                <div className="gpr-ledger__l">{l}</div>
              </div>
            ))}
          </div>
        )}
      </GPageHead>

      {/* ══ 02 · Filters — avenue chips over four pill fields ══ */}
      <section className="gpr-bar">
        <div className="gld-x gpr-bar__in">
          {!isMeetings && (
            <div className="gpr-tabs" role="tablist" aria-label="Filter by avenue">
              <button type="button" role="tab" aria-selected={avenue === ''}
                      className={'gpr-tab' + (avenue === '' ? ' is-on' : '')}
                      onClick={() => { setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); refilter() }}>
                All <span className="gpr-tab__n">{totalCount}</span>
              </button>
              {avenueTabs.map((a) => (
                <button key={a.code} type="button" role="tab" aria-selected={avenue === a.code}
                        className={'gpr-tab' + (avenue === a.code ? ' is-on' : '')}
                        onClick={() => { setAvenue(a.code); setArea(''); setSub(''); setSc(''); setType(''); refilter() }}>
                  {a.label} <span className="gpr-tab__n">{a.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className={'gpr-tools' + (hasFilters ? '' : ' gpr-tools--solo')}>
            {hasFilters && areaOptions.length > 0 && (
              <div className="gpr-tool">
                <label htmlFor="gpr-area">Area of focus</label>
                <div className="gpr-field">
                  <svg className="gpr-field__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                  <select id="gpr-area" value={area}
                          onChange={(e) => { setArea(e.target.value); setSub(''); setSc(''); refilter() }}>
                    <option value="">All areas of focus</option>
                    {areaOptions.map((a) => <option key={a.value} value={a.value}>{a.label} ({a.count})</option>)}
                  </select>
                  <Chevron />
                </div>
              </div>
            )}
            {hasFilters && subAreaOptions.length > 0 && (
              <div className="gpr-tool">
                <label htmlFor="gpr-sub">Category</label>
                <div className="gpr-field">
                  <svg className="gpr-field__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                  <select id="gpr-sub" value={sub} onChange={(e) => { setSub(e.target.value); refilter() }}>
                    <option value="">All categories</option>
                    {subAreaOptions.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
                  </select>
                  <Chevron />
                </div>
              </div>
            )}
            {hasFilters && subCatOptions.length > 0 && (
              <div className="gpr-tool">
                <label htmlFor="gpr-sc">Sub category</label>
                <div className="gpr-field">
                  <svg className="gpr-field__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                  <select id="gpr-sc" value={sc} onChange={(e) => { setSc(e.target.value); refilter() }}>
                    <option value="">All sub categories</option>
                    {subCatOptions.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
                  </select>
                  <Chevron />
                </div>
              </div>
            )}
            {hasFilters && typeOptions.length > 0 && (
              <div className="gpr-tool">
                <label htmlFor="gpr-type">Project type</label>
                <div className="gpr-field">
                  <svg className="gpr-field__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                  <select id="gpr-type" value={type} onChange={(e) => { setType(e.target.value); refilter() }}>
                    <option value="">All projects</option>
                    {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label} ({t.count})</option>)}
                  </select>
                  <Chevron />
                </div>
              </div>
            )}
            <div className="gpr-tool">
              <label htmlFor="gpr-q">Search</label>
              <div className="gpr-field">
                <svg className="gpr-field__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                {/* Live filter. Enter must not submit anything — in the Web Forms
                    original a postback reloaded the page and cleared the grid. */}
                <input id="gpr-q" type="text" value={query} autoComplete="off"
                       placeholder="Name, focus or description…"
                       onChange={(e) => { setQuery(e.target.value); refilter() }}
                       onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
                {query && (
                  <button type="button" aria-label="Clear search"
                          onClick={() => { setQuery(''); refilter() }}
                          style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--g-ink-3)', display: 'flex' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 03 · The index ══ */}
      <section className="gpr-body">
        <div className="gld-x">
          <span ref={topRef} style={{ display: 'block', scrollMarginTop: 'var(--gp-stick)' }} />

          {d.loading ? null : matched.length === 0 ? (
            <GEmpty
              title={projects.length === 0 ? 'Nothing recorded yet' : 'No matches'}
              message={projects.length === 0
                ? 'Published work for this Rotary year will appear here as the club files it.'
                : 'No project matches those filters. Try clearing the search or picking a different avenue.'}
              action={projects.length > 0 ? (
                <button type="button" className="gld-btn gld-btn--ghost"
                        onClick={() => { setAvenue(''); setArea(''); setSub(''); setSc(''); setType(''); setQuery(''); refilter() }}>
                  Clear filters <Arrow />
                </button>
              ) : null}
            />
          ) : (
            <>
              <div className="gpr-grid gld-stagger">
                {shown.map((p, i) => (
                  <a key={p.uid} href={detailHref(p)}
                     className={'gpr-card reveal' + (i === 0 && shown.length >= 5 ? ' gpr-card--feature' : '')}>
                    <span className="gpr-card__media">
                      <img src={p.img} alt="" loading="lazy" onError={hideOnError} />
                      {p.avenueLabel && <span className="gp-tag gpr-card__tag">{p.avenueLabel}</span>}
                      {/* Child projects ("updates") are not cards of their own -- they would
                          repeat the parent N times. The count keeps them visible from the
                          listing; the detail page is where they are read. */}
                      {p.updates > 0 && (
                        <span className="gp-tag gpr-card__upd">{p.updates} update{p.updates === 1 ? '' : 's'}</span>
                      )}
                    </span>
                    <span className="gpr-card__body">
                      <h3 className="gpr-card__t">{p.title}</h3>
                      {p.desc && <p className="gpr-card__d">{p.desc}</p>}
                      <span className="gpr-card__foot">
                        <span>{p.date}</span>
                        <Arrow />
                      </span>
                    </span>
                  </a>
                ))}
              </div>

              <div className="gp-count">
                Showing {start + 1}&ndash;{Math.min(start + PAGE_SIZE, matched.length)} of {matched.length}
              </div>
              {totalPages > 1 && (
                <div className="gp-pager" style={{ marginTop: 'var(--g-3)' }}>
                  <button type="button" onClick={() => goPage(cur - 1)} disabled={cur === 1} aria-label="Previous page">&lsaquo;</button>
                  {windowed(cur, totalPages).map((p, i) => (
                    p === '…'
                      ? <span key={'g' + i}>…</span>
                      : <button key={p} type="button" className={p === cur ? 'is-on' : ''}
                                aria-current={p === cur ? 'page' : undefined}
                                onClick={() => goPage(p)}>{p}</button>
                  ))}
                  <button type="button" onClick={() => goPage(cur + 1)} disabled={cur === totalPages} aria-label="Next page">&rsaquo;</button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

    </div>
  )
}
