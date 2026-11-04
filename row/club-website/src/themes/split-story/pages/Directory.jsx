'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Directory — the roll, told A to Z.
//
// Long rosters are a Split: one chapter per initial. The sticky panel's giant
// gold letter rises in (ScrollFloat) as each initial crosses mid-screen, with
// that letter's head-count and its first and last names underneath, like a
// dictionary's guide words. The panel's rail becomes an A–Z plate with the
// current letter lit. Searching drops the Split for a flat grid, and so do
// small rosters (one Gold page or less).
//
// Data and the search rule come from Gold (useDirectoryData, name + profession).
// The cards show exactly what Gold shows: photo (or initials), name, profession.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useDirectoryData, usePageTitle, useCurrentMenuName } from '../../_shared/data.js'
import {
  PageHero, Split, Chapter, PersonCard, Chips, SearchField, ResultCount, EmptyState, Loading, Button,
} from '../kit.jsx'
import { useScene, useRefreshOnImages, revealBatch, titleOnScroll } from '../motion.js'
import './Directory.css'

// Rosters longer than Gold's one page (30) are told letter by letter.
const SPLIT_FROM = 31

/** The letter a member files under: A–Z (accents folded), anything else '#'. */
function letterOf(name) {
  const c = String(name || '').trim().normalize('NFD').charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

/** First and last name of a letter's group ("guide words"). */
function guide(ms) {
  const a = ms[0].name, b = ms[ms.length - 1].name
  return ms.length > 1 && a !== b ? [a, b].filter(Boolean).join(' – ') : a
}

export default function Directory({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Directory'
  usePageTitle(title)
  const members = useDirectoryData(data)            // null while loading
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState('')      // '' = every letter
  const ref = useRef(null)

  const list = members || []
  const q = query.trim().toLowerCase()
  const letters = useMemo(() => [...new Set((members || []).map((m) => letterOf(m.name)))]
    .sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b)), [members])
  const active = letters.includes(letter) ? letter : ''
  // Gold's rule (name + profession, substring) plus the letter filter.
  const matched = useMemo(() => (members || []).filter((m) =>
    (!active || letterOf(m.name) === active) &&
    (!q || (m.name + ' ' + m.work).toLowerCase().indexOf(q) !== -1)), [members, active, q])
  const split = !q && list.length >= SPLIT_FROM
  const groups = useMemo(() => {
    if (!split) return []
    const by = new Map()
    matched.forEach((m) => {
      const l = letterOf(m.name)
      if (!by.has(l)) by.set(l, [])
      by.get(l).push(m)
    })
    return letters.filter((l) => by.has(l)).map((l) => ({ key: l, members: by.get(l) }))
  }, [split, matched, letters])

  useRefreshOnImages(ref, [members, active, q])
  // Cards fade up in batches (hundreds: no per-card timelines). The letter marks rise
  // once. Rebuilt on load, a letter pick, and entering or leaving search, but not on
  // every keystroke, so results do not blink while typing.
  useScene(ref, (c, ctx) => {
    const r = ref.current
    revealBatch(r.querySelectorAll('.spl-dir-grid > li'), { y: 30, stagger: 0.05 })
    r.querySelectorAll('.spl-dir-mark > span').forEach((el) => titleOnScroll(ctx, el))
  }, [members, active, !!q])

  const clearAll = () => {
    setQuery('')
    setLetter('')
    const input = document.getElementById('spl-dir-search')
    if (input) input.focus()
  }

  const grid = (items, nameAs) => (
    <ul className="spl-grid spl-dir-grid">
      {items.map((m) => (
        <li key={m.i}><PersonCard name={m.name} role={m.work} img={m.img} nameAs={nameAs} /></li>
      ))}
    </ul>
  )

  let body
  if (members === null) {
    body = <Loading label="Loading members" />
  } else if (list.length === 0) {
    body = (
      <section className="spl-section"><div className="spl-x">
        <EmptyState title="No members published" message="This club has not published its member directory yet." />
      </div></section>
    )
  } else if (matched.length === 0) {
    const shown = query.trim()
    body = (
      <section className="spl-section"><div className="spl-x">
        <EmptyState
          title={'No members match “' + shown + '”' + (active ? ' under ' + active : '')}
          message="Check the spelling, or search by profession instead."
          action={<Button variant="ghost" arrow={false} onClick={clearAll}>Show all members</Button>}
        />
      </div></section>
    )
  } else if (split) {
    body = (
      <Split className="spl-dir-split" rail={groups.map((g) => g.key)} deps={[members, active]}>
        {groups.map((g) => (
          <Chapter
            key={g.key}
            id={'spl-dir-' + (g.key === '#' ? 'other' : g.key.toLowerCase())}
            title={g.key}
            className="spl-dir-ch"
            state={{ value: g.members.length, fmt: 'plain', suffix: g.members.length === 1 ? ' member' : ' members', caption: guide(g.members) }}
          >
            <p className="spl-dir-mark" aria-hidden="true"><span>{g.key}</span></p>
            {grid(g.members, 'h3')}
          </Chapter>
        ))}
      </Split>
    )
  } else {
    body = <section className="spl-section spl-dir-flat"><div className="spl-x">{grid(matched, 'h2')}</div></section>
  }

  return (
    <div className="spl-dir" ref={ref}>
      <PageHero
        title={title}
        eyebrow={club.clubDisplayName || undefined}
        stat={list.length ? { value: list.length, label: list.length === 1 ? 'Member' : 'Members' } : null}
      >
        {list.length ? (
          <div className="spl-dir-tools">
            <SearchField id="spl-dir-search" label="Search by name or profession" value={query} onChange={setQuery} placeholder="Name or profession" />
            {letters.length > 1 ? (
              <Chips
                className="spl-dir-az"
                label="Filter members by first letter"
                items={[{ value: '', label: 'All' }, ...letters.map((l) => ({ value: l, label: l, ariaLabel: l === '#' ? 'Other initials' : undefined }))]}
                value={active}
                onChange={setLetter}
              />
            ) : null}
            <ResultCount className="spl-dir-count" count={matched.length} total={list.length} noun={['member', 'members']} />
          </div>
        ) : null}
      </PageHero>
      {body}
    </div>
  )
}
