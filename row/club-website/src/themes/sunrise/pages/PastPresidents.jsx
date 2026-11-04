'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · PAST PRESIDENTS — the sun path.
//
// The roll stands like the Directory (client, 2026-10-15): every past president
// in the theme's arch window over its own horizon line, five across on desktop,
// newest first, the Rotary year under the name; the portraits rise into their
// arches like suns, row by row (the Directory's motion). The earliest president
// is marked as the charter president only when the club's own About text states
// a charter year that matches.
//
// Data rules are Gold's: usePastPresidentsData (years strictly before the
// selected one, newest first, unparseable labels last) and Gold's name + year
// search. Past presidents only: the sitting president is not on this page
// (client, 2026-09-29).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, usePastPresidentsData, useAboutData, currentRotaryYearStart, plainText } from '../../_shared/data.js'
import { PageHero, SearchField, ResultCount, EmptyState, Loading, Button, Arch, yearText } from '../kit.jsx'
import { gsap, ScrollTrigger, useScene, useRefreshOnImages } from '../motion.js'
import './Directory.css'
import './PastPresidents.css'

/** "2019-2020" / "2019-20" -> "2019–20" (display only; search matches the label as filed). */
const yr = yearText
const startOf = (label) => Number((String(label || '').match(/\d{4}/) || [])[0]) || null

/** "was chartered on May 20, 1991" / "chartered in 1985" in the club's About text, else 0. */
function charterYear(html) {
  const m = /\bchartered\s+(?:on|in)\b[^.]{0,40}?\b(19\d{2}|20\d{2})\b/i.exec(plainText(html))
  const y = m ? +m[1] : 0
  return y >= 1905 && y <= new Date().getFullYear() ? y : 0
}

export default function PastPresidents({ data }) {
  const club = useClub()
  const list = usePastPresidentsData(data)          // null while loading; newest first
  const about = useAboutData(data)                  // the charter year
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  // Past years only. The hook drops the selected year's president, but keeps
  // every row when that year's label is unknown (years API down): then the
  // selected year is the computed current one, as ClubProvider picks it.
  const before = startOf(club.selectedYearLabel) || currentRotaryYearStart()
  const all = useMemo(() => (list || []).filter((p) => p.y === null || p.y < before), [list, before])
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => (q ? all.filter((p) => (p.name + ' ' + p.year).toLowerCase().indexOf(q) !== -1) : all), [all, q])

  // The earliest dated year on the roll is marked "Charter president", only when the About text agrees.
  const firstY = useMemo(() => {
    const ys = all.map((p) => p.y).filter((y) => y !== null)
    return ys.length ? Math.min(...ys) : null
  }, [all])
  const charter = useMemo(() => charterYear(about.html), [about.html])
  const firstMark = firstY === null ? ''
    : charter && (firstY === charter || firstY === charter - 1) ? 'Charter president' : ''   // no "Earliest on record" (client, 2026-10-15)

  const yearText = yr(club.selectedYearLabel)

  const key = [club.selectedYearId, firstMark, shown.map((p) => p._i).join(',')].join('|')
  useRefreshOnImages(ref, [key])
  // portraits rise into their arches like suns, a row at a time (the Directory's rise)
  useScene(ref, () => {
    const pool = Array.from(ref.current.querySelectorAll('.sun-dir-card')).filter((el) => el.getBoundingClientRect().bottom > 0)
    if (!pool.length) return
    const part = (nodes, sel) => nodes.map((el) => el.querySelector(sel)).filter(Boolean)
    gsap.set(part(pool, '.sun-arch__win'), { clipPath: 'inset(100% 0% 0% 0%)' })
    gsap.set(part(pool, '.sun-arch__win > *'), { yPercent: 35, scale: 1.15 })
    gsap.set(part(pool, '.sun-arch__halo'), { scale: 0.4, opacity: 0 })
    gsap.set(part(pool, '.sun-dir-card__txt'), { y: 24, opacity: 0 })
    ScrollTrigger.batch(pool, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) => {
        const o = { duration: 1.1, stagger: 0.09, ease: 'power2.out', overwrite: true }
        gsap.to(part(batch, '.sun-arch__win'), { ...o, clipPath: 'inset(0% 0% 0% 0%)', clearProps: 'clipPath' })
        gsap.to(part(batch, '.sun-arch__win > *'), { ...o, yPercent: 0, scale: 1, clearProps: 'transform,translate,scale' })
        gsap.to(part(batch, '.sun-arch__halo'), { ...o, duration: 1.4, scale: 1, opacity: 1, clearProps: 'transform,opacity,scale' })
        gsap.to(part(batch, '.sun-dir-card__txt'), { ...o, delay: 0.25, y: 0, opacity: 1, clearProps: 'transform,opacity,translate' })
      },
    })
  }, [key])

  const clearSearch = () => {
    setQuery('')
    const input = ref.current && ref.current.querySelector('.sun-search input')
    if (input) input.focus()
  }
  const shownQuery = query.trim()

  return (
    <div className="sun-page sun-pp" ref={ref}>
      <PageHero title="Past presidents">
        {all.length ? (
          <div className="sun-tools">
            {all.length > 4 ? (
              <SearchField label="Search past presidents by name or year" placeholder="Search by name or year" value={query} onChange={setQuery} />
            ) : null}
            <ResultCount count={shown.length} total={all.length} noun="past president" />
          </div>
        ) : null}
      </PageHero>

      <div className="sun-wrap sun-block sun-dir-body sun-pp-body">
        {list === null ? <Loading label="Loading past presidents" /> : all.length === 0 ? (
          <EmptyState
            title="No past presidents on the roll yet"
            message={'Presidents from the years before ' + (yearText || 'this one') + ' will appear here once the club adds them.'}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title={'No past president matches “' + shownQuery + '”'}
            message="Check the spelling, or search by Rotary year, such as 2015."
            action={<Button variant="line" icon={false} onClick={clearSearch}>Clear search</Button>}
          />
        ) : (
          <ul className="sun-dir-grid">
            {shown.map((p) => {
              const mark = firstMark && p.y === firstY ? firstMark : ''
              const name = String(p.name || '').trim() || 'Name not recorded'
              return (
                <li className={'sun-dir-card sun-pp-card' + (mark ? ' is-first' : '')} key={p._i}>
                  {/* the name is right below: the portrait is decoration */}
                  <Arch decorative src={p.img} name={name} />
                  <div className="sun-dir-card__txt">
                    <h2 className="sun-dir-card__name">{name}</h2>
                    <p className="sun-pp-card__yr">{p.year ? <><span className="sun-sr">Rotary year </span>{yr(p.year)}</> : 'Year not recorded'}</p>
                    {mark ? <p className="sun-pp-card__mark">{mark}</p> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
