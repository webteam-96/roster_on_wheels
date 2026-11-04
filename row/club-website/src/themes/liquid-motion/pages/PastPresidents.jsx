'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · PAST PRESIDENTS: the lineage.
//
// Ink breadcrumb band (menu label, search with a live count). Only the years
// BEFORE the selected one are listed - the sitting president is not shown here
// (client, 2026-09-29; the board page has them). The ink band holds the roll of honour, grouped by decade. On desktop each
// decade's giant outlined numeral ("1990s") sticks in a left column, sweeps
// in as the decade arrives and fills with gold like a glass while its
// presidents scroll past. Rows follow the home's figure list: a hairline that
// draws, the year in gold, a small arch portrait (initials when there is no
// photo) and the name. (No closing "where the roll begins" band - client, 2026-09-29.)
//
// Data rules are Gold's: usePastPresidentsData (years strictly before the
// selected one, newest first, unparseable labels last) and Gold's name + year
// search. The API has no charter data, so the page says "Earliest on record",
// never "charter". Rows are liq-rv only (batched), so a roll of 60 years stays smooth.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import {
  useClub, useCurrentMenuName, usePageTitle, usePastPresidentsData,
} from '../../_shared/data.js'
import {
  PageHero, Band, SearchField, ResultCount, EmptyState, Loading, Portrait, Pill,
  clean, yearText,
} from '../kit.jsx'
import { usePageMotion, useScene, gsap } from '../motion.js'
import './PastPresidents.css'

const plural = (n) => (n === 1 ? 'president' : 'presidents')
/** "2020-21" / "2020-2021" -> "2020–21"; other labels as filed. */
const yr = (label) => yearText(clean(label))

export default function PastPresidents({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Past Presidents'
  usePageTitle(title)
  const list = usePastPresidentsData(data)          // null while loading; newest first
  const [q, setQ] = useState('')
  const ref = useRef(null)

  const all = list || []
  const needle = q.trim().toLowerCase()
  // Gold's search: name + year label, substring
  const shown = useMemo(() => (list || []).filter((p) =>
    !needle || (p.name + ' ' + p.year).toLowerCase().indexOf(needle) !== -1), [list, needle])

  // the earliest dated year on the roll (co-presidents can share it)
  const firstY = useMemo(() => {
    const ys = (list || []).map((p) => p.y).filter((y) => y !== null)
    return ys.length ? Math.min(...ys) : null
  }, [list])

  // decades in roll order (newest first); unparseable labels already sit at the end
  const decades = useMemo(() => {
    const by = new Map()
    shown.forEach((p) => {
      const k = p.y === null ? 'x' : String(Math.floor(p.y / 10) * 10)
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(p)
    })
    return [...by].map(([k, rows]) => ({ k, label: k === 'x' ? 'Other years' : k + 's', rows }))
  }, [shown])

  const selYear = yr(club.selectedYearLabel)

  const loading = list === null
  const none = !loading && all.length === 0
  usePageMotion(ref, [list, needle])

  // the moment: each decade numeral sweeps in, then fills with gold while its presidents scroll past
  useScene(ref, (c) => {
    const root = ref.current
    if (!c.wide) return
    root.querySelectorAll('.liq-pp-dec').forEach((g) => {
      const glyph = g.querySelector('.liq-pp-dec__glyph')
      const ink = g.querySelector('.liq-pp-dec__ink')
      if (glyph) {
        gsap.fromTo(glyph, { xPercent: -18 }, {
          xPercent: 0, ease: 'none',
          scrollTrigger: { trigger: g, start: 'top bottom', end: 'clamp(top 45%)', scrub: true },
        })
      }
      if (ink) {
        gsap.fromTo(ink, { clipPath: 'inset(100% 0% 0% 0%)' }, {
          clipPath: 'inset(0% 0% 0% 0%)', ease: 'none',
          scrollTrigger: { trigger: g, start: 'clamp(top 60%)', end: 'clamp(bottom 60%)', scrub: true },
        })
      }
    })
  }, [list, needle])

  const clearSearch = () => {
    setQ('')
    const input = document.getElementById('liq-pp-q')
    if (input) input.focus()
  }

  return (
    <div className="liq-pp" ref={ref}>
      <PageHero title={title}>
        {all.length > 4 ? (
          <div className="liq-pp-find">
            <SearchField id="liq-pp-q" label="Search past presidents by name or year" value={q} onChange={setQ}
                         placeholder="Search by name or year" />
            <ResultCount count={shown.length} total={all.length} one="past president" many="past presidents" />
          </div>
        ) : null}
      </PageHero>

      {loading || none ? (
        <Band tone="paper" className="liq-pp-nowband">
          {loading ? <Loading label="Loading past presidents" /> : none ? (
            <EmptyState title="No past presidents on the roll yet"
              text={'Presidents from the years before ' + (selYear || 'this one') + ' will appear here once the club adds them.'} />
          ) : null}
        </Band>
      ) : null}

      {!loading && all.length > 0 ? (
        <Band tone="ink2" className="liq-pp-band" aria-label="Past presidents">
          {shown.length ? (
            <div className="liq-pp-roll">
              {decades.map((d) => (
                <div className={'liq-pp-dec' + (d.k === 'x' ? ' liq-pp-dec--x' : '')} key={d.k}>
                  <div className="liq-pp-dec__head">
                    <h3 className="liq-pp-dec__h liq-rv">
                      <span className="liq-sr">{d.label}</span>
                      <span className="liq-pp-dec__glyph" aria-hidden="true">
                        <span className="liq-pp-dec__line">{d.label}</span>
                        <span className="liq-pp-dec__ink">{d.label}</span>
                      </span>
                    </h3>
                    <p className="liq-pp-dec__n liq-rv">{d.rows.length + ' ' + plural(d.rows.length)}</p>
                  </div>
                  <ol className="liq-pp-list">
                    {d.rows.map((p) => {
                      const first = all.length > 1 && p.y !== null && p.y === firstY
                      return (
                        <li className={'liq-pp-row liq-rv' + (first ? ' liq-pp-row--first' : '')} key={p._i}>
                          <span className="liq-pp-row__line liq-line" aria-hidden="true" />
                          <p className="liq-pp-row__yr">{yr(p.year) || '—'}</p>
                          <Portrait src={p.img} name={p.name} className="liq-pp-row__pic" />
                          <div className="liq-pp-row__who">
                            <h4 className="liq-pp-row__n">{clean(p.name) || 'Name not filed'}</h4>
                            {first ? <p className="liq-pp-row__tag">Earliest on record</p> : null}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState as="h3" title={'No past president matches “' + q.trim() + '”'}
              text="Check the spelling, or search by Rotary year, such as 2015."
              action={<Pill variant="light" onClick={clearSearch}>Clear search</Pill>} />
          )}
        </Band>
      ) : null}

    </div>
  )
}
