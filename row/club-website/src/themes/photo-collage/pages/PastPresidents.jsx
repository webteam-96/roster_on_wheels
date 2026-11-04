'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO COLLAGE · PAST PRESIDENTS — the club's yearbook.
//
// The head of the roll is this year's president: a big portrait held by a paper
// clip, with a kraft "President 2026–27" tag swinging below it, and a sticker
// counting the presidents on record. Then the roll itself, one yearbook page per
// decade, newest first. Each decade opens with its label ("2010s") in Shrikhand
// filled with a photo. On wide screens the label stays stuck at the top
// (position:sticky, never a pin) while that decade's portraits are dealt in
// beside it. Most rows have no photo (an API gap), so the Shrikhand initials on
// kraft are the normal case, not the fallback. The earliest year on the roll is
// marked "First on the roll", or "Charter president" when the club's own About
// text states a charter year that matches.
//
// Data rules are Gold's: usePastPresidentsData (years strictly before the
// selected one, newest first, unparseable years last), Gold's name + year
// search, and useAboutData's president (the /dignitary?Type=4 person). A roll of
// 60+ is only batch-dealt (house -> revealBatch); nothing scrubs per card.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useClub, usePastPresidentsData, useAboutData, plainText } from '../../_shared/data.js'
import { isPlaceholderPhoto } from '../../_shared/kit.jsx'
import { useScene, house } from '../motion.js'
import {
  usePageName, PageHero, Portrait, Button, SearchField, ResultCount, EmptyState, Loading,
  TAPE_CYCLE, yearDash,
} from '../kit.jsx'
import './PastPresidents.css'

// The yearbook's tilts and sway, cycled (DESIGN: −3 / 2 / −1 / 3°).
const TILT = [-3, 2, -1, 3]
const SWAY = [0.8, -0.9, 1, -0.7]
// A search strip over a handful of portraits is noise (Gold shows it above 4).
const SEARCH_FROM = 5
// "was chartered on May 20, 1991" / "chartered in 1985" (the About text's own words).
const CHARTER_RE = /\bchartered\s+(?:on|in)\b[^.]{0,40}?\b(1[89]\d{2}|20\d{2})\b/i

const hasPhoto = (src) => !isPlaceholderPhoto(src)
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)

export default function PastPresidents({ data }) {
  const club = useClub()
  const title = usePageName('Past Presidents')
  const list = usePastPresidentsData(data)          // null while loading; newest first
  const about = useAboutData(data)                  // the sitting president + the charter year
  const [query, setQuery] = useState('')        // what the field shows
  const [q, setQ] = useState('')                // what the roll shows: the query once typing pauses
  const rootRef = useRef(null)
  const bodyRef = useRef(null)

  // Filter (and re-deal) once typing pauses; clearing is instant.
  useEffect(() => {
    const v = query.trim()
    if (!v) { setQ(''); return undefined }
    const t = setTimeout(() => setQ(v), 250)
    return () => clearTimeout(t)
  }, [query])

  const all = list || []
  const yr = yearDash(club.selectedYearLabel)

  // Gold's search rule: name + year label, case-insensitive substring.
  const shown = useMemo(() => {
    const needle = q.toLowerCase()
    return (list || []).filter((p) => !needle || (p.name + ' ' + p.year).toLowerCase().indexOf(needle) !== -1)
  }, [list, q])

  // The earliest year on the roll: "Charter president" when the About text's
  // charter year agrees (chartered in 1991 = Rotary year 1990–91 or 1991–92),
  // "First on the roll" when the roll spans 2+ years, else no mark.
  const firstMark = useMemo(() => {
    const ys = (list || []).map((p) => p.y).filter((y) => y !== null)
    if (!ys.length) return null
    const y = Math.min(...ys)
    const m = CHARTER_RE.exec(plainText(about.html))
    const charter = m ? +m[1] : 0
    if (charter && (y === charter || y === charter - 1)) return { y, label: 'Charter president' }
    return new Set(ys).size > 1 ? { y, label: 'First on the roll' } : null
  }, [list, about.html])

  // Photos the roll actually holds (most rows have none): the hero's prints and letters.
  const faces = useMemo(() => all.filter((p) => hasPhoto(p.img)).slice(0, 3), [all])

  // (no sitting-president block: this page lists only the years before the selected one - client, 2026-09-29)
  const heroImg = faces[0] ? faces[0].img : ''

  useScene(bodyRef, (c) => {
    const root = bodyRef.current
    const undo = house(root, c)
    return undo
  }, [list, q, firstMark ? firstMark.label : ''])

  const clearSearch = () => {
    setQuery('')
    const input = rootRef.current && rootRef.current.querySelector('.col-search input')
    if (input) input.focus()
  }

  const lead = all.length
    ? plural(all.length, 'president', 'presidents') + ' on record' + (yr ? ' before ' + yr : '') + ', newest first.'
    : 'The club’s presidents, year by year.'


  return (
    <div className="col-pp" ref={rootRef}>
      <PageHero
        title={title}
        kicker="Roll of honour"
        lead={lead}
        img={heroImg || undefined}
        tint="violet"
        prints={faces.map((p) => ({ src: p.img, caption: yearDash(p.year), ratio: '4 / 5' }))}
      >
        {all.length >= SEARCH_FROM ? (
          <>
            <SearchField label="Search past presidents" placeholder="Name or year" value={query} onChange={setQuery} />
            <ResultCount shown={shown.length} total={all.length} noun="past president" />
          </>
        ) : null}
      </PageHero>

      <div className="col-pp-body" ref={bodyRef}>
        {/* ══ the roll: one yearbook page per decade ══ */}
        <div className="col-sec col-pp-roll">
          {list === null ? <Loading label="Loading past presidents" count={4} /> : all.length === 0 ? (
            <EmptyState
              title="No past presidents on the roll yet"
              message={'Presidents from the years before ' + (yr || 'this one') + ' will appear here once the club adds them.'}
            />
          ) : shown.length === 0 ? (
            <EmptyState
              title={'No past president matches “' + q + '”'}
              message="Check the spelling, or search by Rotary year, such as 2015."
              action={<Button variant="ghost" onClick={clearSearch}>Clear search</Button>}
            />
          ) : (
            <section className="col-pp-all" aria-label={plural(shown.length, 'past president', 'past presidents')}>
              <ol className="col-pp-grid">
                {shown.map((p, i) => {
                  const mark = firstMark && p.y === firstMark.y ? firstMark.label : ''
                  const name = p.name || 'Name not filed'
                  const year = yearDash(p.year)
                  return (
                    <li key={p._i} className={mark ? 'is-first' : undefined}>
                      <Portrait
                        src={p.img}
                        name={name}
                        r={TILT[i % 4]}
                        k={SWAY[i % 4]}
                        tape={mark ? 'gold' : TAPE_CYCLE[i % 4]}
                        deal
                        caption={<>
                          {mark ? <span className="col-pp-mark">{mark}</span> : null}
                          {year ? <span className="col-pp-yr"><span className="col-sr">President </span>{year}</span> : null}
                          <span className="col-pp-nm" aria-hidden="true">{name}</span>
                        </>}
                      />
                    </li>
                  )
                })}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
