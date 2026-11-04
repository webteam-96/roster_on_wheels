'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · PAST PRESIDENTS — the credits roll.
//
// The projector opens on the page title (PageHero), then the club's lineage
// runs down one lit spine like closing credits: the year (condensed gold) left
// of the spine, the president (expanded) right of it, grouped into decades
// whose outlined numerals rise out of their line. A gold beam runs down the
// spine as you scroll. Only PAST presidents: the sitting president is not on
// the roll (client, 2026-09-25). It ends at the earliest year on record, marked
// "First on the roll" (the API has no charter data, so the page never claims
// "charter").
//
// Data rules are Gold's: usePastPresidentsData (years strictly before the
// selected one, newest first) and Gold's name + year search. Rows are light
// (no per-row SplitText, batched riseIn) so a 60-year roll stays smooth.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, usePastPresidentsData } from '../../_shared/data.js'
import {
  usePageName, PageHero, SearchField, ResultCount, EmptyState, Loading, Button, PersonPhoto, yearText,
} from '../kit.jsx'
import {
  gsap, useScene, afterFonts, riseIn, titleIn, cleanups,
} from '../motion.js'
import './PastPresidents.css'

/** "2025-26" -> "2025–26" (display only; search matches the label as filed). */
const dash = (s) => String(s || '').replace(/-/g, '–')

export default function PastPresidents({ data }) {
  const club = useClub()
  const title = usePageName('Past Presidents')
  const list = usePastPresidentsData(data)          // null while loading; newest first
  const [query, setQuery] = useState('')
  const rollRef = useRef(null)
  const searchRef = useRef(null)

  const all = list || []
  const q = query.trim().toLowerCase()
  // Gold's rule: name + year label, substring.
  const shown = useMemo(() => (list || []).filter((p) =>
    !q || (p.name + ' ' + p.year).toLowerCase().indexOf(q) !== -1), [list, q])
  // The earliest dated year on the roll - only a mark when the roll spans 2+ years.
  const firstY = useMemo(() => {
    const ys = (list || []).map((p) => p.y).filter((y) => y !== null)
    return new Set(ys).size > 1 ? Math.min(...ys) : null
  }, [list])
  // Decades in roll order (newest first); unparseable labels already sink to the end.
  const decades = useMemo(() => {
    const by = new Map()
    shown.forEach((p) => {
      const k = p.y === null ? 'x' : String(Math.floor(p.y / 10) * 10)
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(p)
    })
    return [...by].map(([k, rows]) => ({ key: k, label: k === 'x' ? 'Other years' : k + 's', rows }))
  }, [shown])

  const showRoll = shown.length > 0

  // The beam runs down the spine; each batch of ~12 credits converges on it.
  useScene(rollRef, (c, ctx) => {
    const off = cleanups()
    const root = rollRef.current
    const beam = root.querySelector('.cin-pp-roll__beam')
    if (beam) {
      gsap.fromTo(beam, { scaleY: 0 }, {
        scaleY: 1, ease: 'none', scrollTrigger: { trigger: root, start: 'top 70%', end: 'bottom 70%', scrub: 0.6 },
      })
    }
    const dx = c.wide ? 48 : 0
    const dy = c.wide ? 0 : 28
    root.querySelectorAll('.cin-pp-dec').forEach((g) => {
      const head = g.querySelector('.cin-pp-dec__head')
      riseIn(head.querySelectorAll('.cin-pp-dec__node, .cin-pp-dec__n'), { trigger: head, y: 16, stagger: 0.1 })
      // each row on its own trigger: a shared one left the tenth row of a decade dark mid-screen for ~1.5s
      g.querySelectorAll('.cin-pp-row').forEach((row) => {
        const at = { trigger: row, start: 'top 94%', stagger: 0.05, duration: 0.9 }
        riseIn(row.querySelectorAll('.cin-pp-row__yr'), { ...at, x: -dx, y: dy })
        riseIn(row.querySelectorAll('.cin-pp-row__node'), { ...at, y: 0 })
        riseIn(row.querySelectorAll('.cin-pp-row__ph, .cin-pp-row__who'), { ...at, x: dx, y: dy })
      })
    })
    off(afterFonts(ctx, () => root.querySelectorAll('.cin-pp-dec__h').forEach((h) => titleIn(h, { start: 'top 90%' }))))
    return off.run
  }, [list, q])

  const clearSearch = () => {
    setQuery('')
    if (searchRef.current) searchRef.current.focus()
  }

  const yearLabel = yearText(club.selectedYearLabel)
  const shownQuery = query.trim()

  return (
    <div className="cin-pp">
      <PageHero
        title={title}
        meta={all.length ? (
          <>
            {all.length > 4 ? (
              <SearchField inputRef={searchRef} value={query} onChange={setQuery} label="Search past presidents by name or year" placeholder="Search by name or year" />
            ) : null}
            <ResultCount count={shown.length} total={all.length} noun="past president" />
          </>
        ) : null}
      />

      <div className="cin-sec cin-pp-body">
        {showRoll ? (
          <div className="cin-pp-roll" ref={rollRef}>
            <span className="cin-pp-roll__beam" aria-hidden="true" />
            {decades.map((d) => (
              <div className="cin-pp-dec" key={d.key}>
                <div className="cin-pp-dec__head">
                  <h2 className="cin-pp-dec__h" key={d.label}>{d.label}</h2>
                  <span className="cin-pp-dec__node" aria-hidden="true" />
                  <p className="cin-pp-dec__n">{d.rows.length + (d.rows.length === 1 ? ' president' : ' presidents')}</p>
                </div>
                <ol className="cin-pp-list">
                  {d.rows.map((p) => {
                    const first = firstY !== null && p.y === firstY
                    return (
                      <li className={'cin-pp-row' + (first ? ' is-first' : '')} key={p._i}>
                        <span className="cin-pp-row__yr">{dash(p.year) || '—'}</span>
                        <span className="cin-pp-row__node" aria-hidden="true" />
                        {/* the name is right beside it: the portrait is decoration */}
                        <span className="cin-pp-row__ph" aria-hidden="true">
                          <PersonPhoto src={p.img} name={p.name} alt="" className="cin-pp-row__img" monoClass="cin-pp-row__mono" width="112" height="112" />
                        </span>
                        <div className="cin-pp-row__who">
                          <h3 className="cin-pp-row__n">{p.name || 'Name not filed'}</h3>
                          {first ? <p className="cin-pp-row__first">First on the roll</p> : null}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            ))}
          </div>
        ) : null}

        {list === null ? <Loading label="Loading past presidents" /> : shown.length === 0 ? (
          <div className="cin-pp-state">
            {all.length === 0 ? (
              <EmptyState
                title="No past presidents on the roll yet"
                message={'Presidents from the years before ' + (yearLabel || 'this one') + ' will appear here once the club adds them.'}
              />
            ) : (
              <EmptyState
                title={'No past president matches “' + shownQuery + '”'}
                message="Check the spelling, or search by Rotary year, such as 2015."
                action={<Button variant="line" onClick={clearSearch}>Clear search</Button>}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
