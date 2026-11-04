'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · DIRECTORY — the cast list.
//
// The projector opens on the page title (PageHero), then the roster reads like
// a film's cast: a floating film strip of the initials present (sticky, so a
// 300-member club can re-cut from anywhere), and one "scene" per letter whose
// big condensed gold slate rises out of its line while the cast cards under it
// rise in. Small rosters (one Gold page or less) skip the scenes: a flat grid.
//
// Data and the search rule are Gold's (useDirectoryData, name + profession);
// cards show exactly what Gold shows: photo (or initials), name, profession.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useDirectoryData } from '../../_shared/data.js'
import {
  usePageName, PageHero, SearchField, ResultCount, ChipGroup, EmptyState, Loading, Button, PersonPhoto,
} from '../kit.jsx'
import {
  useScene, afterFonts, riseIn, titleIn, cleanups, headerH, scrollToY, prefersReducedMotion,
} from '../motion.js'
import './Directory.css'

// Rosters longer than Gold's one page (30) are split into letter scenes.
const SCENES_FROM = 31

/** The letter a member files under: A–Z (accents folded), anything else '#'. */
function letterOf(name) {
  const c = String(name || '').trim().normalize('NFD').charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

export default function Directory({ data }) {
  const title = usePageName('Directory')
  const members = useDirectoryData(data)            // null while loading
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState('')      // '' = all letters
  const bodyRef = useRef(null)
  const azRef = useRef(null)
  const searchRef = useRef(null)

  const list = members || []
  const q = query.trim().toLowerCase()
  const letters = useMemo(() => [...new Set((members || []).map((m) => letterOf(m.name)))]
    .sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b)), [members])
  // Gold's rule (name + profession, substring), plus the letter filter.
  const matched = useMemo(() => (members || []).filter((m) =>
    (!letter || letterOf(m.name) === letter) &&
    (!q || (m.name + ' ' + m.work).toLowerCase().indexOf(q) !== -1)), [members, letter, q])
  const scenes = list.length >= SCENES_FROM
  const groups = useMemo(() => {
    if (!scenes) return [{ key: 'all', members: matched }]
    const by = new Map()
    matched.forEach((m) => {
      const l = letterOf(m.name)
      if (!by.has(l)) by.set(l, [])
      by.get(l).push(m)
    })
    return letters.filter((l) => by.has(l)).map((l) => ({ key: l, members: by.get(l) }))
  }, [scenes, matched, letters])

  // The strip rolls in once the letters are known.
  useScene(azRef, () => {
    riseIn(azRef.current.querySelectorAll('.cin-chip'), { x: 48, y: 0, stagger: 0.025, duration: 0.9, trigger: false, delay: 0.4 })
  }, [letters.join('')])

  // Every re-cut (load, letter, search) replays the scene: slates rise out of
  // their line, each scene's cards rise in one batch (tiny stagger - hundreds).
  useScene(bodyRef, (c, ctx) => {
    const off = cleanups()
    const root = bodyRef.current
    root.querySelectorAll('.cin-dir-grid').forEach((g) => {
      riseIn(g.children, { trigger: g, start: 'top 92%', y: 30, stagger: 0.02, duration: 0.8 })
    })
    off(afterFonts(ctx, () => root.querySelectorAll('.cin-dir-letter').forEach((h) => titleIn(h, { start: 'top 92%' }))))
    return off.run
  }, [list.length, letter, q])

  // A letter picked from deep in the list: bring the top of the list back under the strip.
  const pick = (v) => {
    setLetter(v)
    const el = bodyRef.current
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY - headerH()
    if (window.scrollY > y + 4) scrollToY(y, prefersReducedMotion())
  }

  const clearAll = () => {
    setQuery('')
    setLetter('')
    if (searchRef.current) searchRef.current.focus()
  }

  const Name = scenes ? 'h3' : 'h2'
  const shownQuery = query.trim()

  return (
    <div className="cin-dir">
      <PageHero
        title={title}
        meta={list.length ? (
          <>
            <SearchField inputRef={searchRef} value={query} onChange={setQuery} label="Search members by name or profession" placeholder="Name or profession" />
            <ResultCount count={matched.length} total={list.length} noun="member" />
          </>
        ) : null}
      />

      {members === null ? <Loading label="Loading members" /> : list.length === 0 ? (
        <div className="cin-sec">
          <EmptyState title="No members published" message="This club has not published its member directory yet." />
        </div>
      ) : (
        <div className="cin-sec cin-dir-body" ref={bodyRef}>
          {letters.length > 1 ? (
            <div className="cin-dir-az" ref={azRef}>
              <ChipGroup
                label="Filter members by first letter"
                className="cin-dir-az__chips"
                options={[{ value: '', label: 'All' }, ...letters.map((l) => ({ value: l, label: l }))]}
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
            <div className="cin-dir-list">
              {groups.map((g) => (
                <div className={'cin-dir-group' + (scenes ? '' : ' is-flat')} key={g.key}>
                  {scenes ? <h2 className="cin-dir-letter" key={g.key}>{g.key}</h2> : null}
                  <ul className="cin-dir-grid">
                    {g.members.map((m) => (
                      <li className="cin-dir-card" key={m.i}>
                        {/* the name is right below: the portrait is decoration */}
                        <span className="cin-dir-card__ph" aria-hidden="true">
                          <PersonPhoto src={m.img} name={m.name} alt="" className="cin-dir-card__img" monoClass="cin-dir-card__mono" width="160" height="160" />
                        </span>
                        <div className="cin-dir-card__txt">
                          <Name className="cin-dir-card__n">{m.name}</Name>
                          {m.work ? <p className="cin-dir-card__w">{m.work}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
