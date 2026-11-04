'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · DIRECTORY — a horizon of arches.
//
// Every member stands in the theme's arch window over its own horizon line - five
// across on desktop, each portrait filling its column (client, 2026-09-29) - and
// the portraits rise into their arches like suns, row by row, as the roster
// scrolls up (one ScrollTrigger.batch - the list can be 300 long). A glass pill
// of the initials that exist filters the roster and stays under the header on
// wider screens, so a long club can be re-cut from anywhere.
//
// Data and the search rule are Gold's (useDirectoryData; name + profession,
// case-insensitive substring). Cards show exactly Gold's fields: photo (or
// initials), name, profession (designation when none is filed).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useDirectoryData } from '../../_shared/data.js'
import { PageHero, SearchField, ResultCount, Chips, EmptyState, Loading, Button, Arch } from '../kit.jsx'
import { useScene, gsap, ScrollTrigger, scrollToY, headerHeight, prefersReducedMotion } from '../motion.js'
import './Directory.css'

// Short rosters don't need the letter pill.
const AZ_FROM = 13

/** The letter a member files under: A–Z (accents folded), anything else '#'. */
function letterOf(name) {
  const c = String(name || '').trim().normalize('NFD').charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

export default function Directory({ data }) {
  const members = useDirectoryData(data)            // null while loading
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState('')      // '' = every letter
  const rootRef = useRef(null)
  const bodyRef = useRef(null)

  const list = members || []
  const q = query.trim().toLowerCase()
  const letters = useMemo(() => [...new Set((members || []).map((m) => letterOf(m.name)))]
    .sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b)), [members])
  const matched = useMemo(() => (members || []).filter((m) =>
    (!letter || letterOf(m.name) === letter) &&
    (!q || (m.name + ' ' + m.work).toLowerCase().indexOf(q) !== -1)), [members, letter, q])
  const filtering = !!(q || letter)

  // Portraits rise into their arches like suns, a row at a time. On a fresh
  // roster every card on or below the screen rises; while searching, only the
  // cards still below the fold do - what you are looking at re-flows instantly.
  // Cards already scrolled past are never hidden.
  useScene(bodyRef, () => {
    const fold = window.innerHeight * 0.92
    const pool = Array.from(bodyRef.current.querySelectorAll('.sun-dir-card')).filter((el) => {
      const r = el.getBoundingClientRect()
      return filtering ? r.top > fold : r.bottom > 0
    })
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
  }, [list.length, letter, q])

  // A letter picked from deep in the roster: bring the top of the roster back under the header.
  const pick = (v) => {
    setLetter(v)
    const el = bodyRef.current
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY - headerHeight()
    if (window.scrollY > y + 4) scrollToY(y, prefersReducedMotion())
  }

  const clearAll = () => {
    setQuery('')
    setLetter('')
    const input = rootRef.current && rootRef.current.querySelector('.sun-search input')
    if (input) input.focus()
  }

  const shownQuery = query.trim()

  return (
    <div className="sun-page sun-dir" ref={rootRef}>
      <PageHero title="Directory">
        {list.length ? (
          <div className="sun-tools">
            <SearchField label="Search members by name or profession" placeholder="Search by name or profession" value={query} onChange={setQuery} />
            <ResultCount count={matched.length} total={list.length} noun="member" />
          </div>
        ) : null}
      </PageHero>

      <section className="sun-wrap sun-block sun-dir-body" ref={bodyRef} aria-label="Members">
        {members === null ? <Loading label="Loading members" /> : list.length === 0 ? (
          <EmptyState title="No members published" message="This club has not published its member directory yet." />
        ) : (
          <>
            {list.length >= AZ_FROM && letters.length > 1 ? (
              <div className="sun-dir-az">
                <Chips
                  label="Show members by first letter"
                  options={[{ value: '', label: 'All' }, ...letters.map((l) => ({ value: l, label: l, aria: l === '#' ? 'Other names' : undefined }))]}
                  value={letter}
                  onChange={pick}
                />
              </div>
            ) : null}

            {matched.length === 0 ? (
              <EmptyState
                title={shownQuery ? 'No members match “' + shownQuery + '”' + (letter ? ' under ' + letter : '') : 'No members under ' + letter}
                message="Check the spelling, or search by profession instead."
                action={<Button variant="line" onClick={clearAll}>Show all members</Button>}
              />
            ) : (
              <ul className="sun-dir-grid">
                {matched.map((m) => (
                  <li className="sun-dir-card" key={m.i}>
                    {/* the name is right below: the portrait is decoration */}
                    <Arch decorative src={m.img} name={m.name} />
                    <div className="sun-dir-card__txt">
                      <h2 className="sun-dir-card__name">{m.name}</h2>
                      {m.work ? <p className="sun-dir-card__work">{m.work}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  )
}
