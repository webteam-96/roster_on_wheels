'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · DIRECTORY — the people on the walk.
//
// A people-search page, so it stays vertical. A turquoise sky with the search
// and a live count; every member is a small arch portrait standing on its own
// hill (a mound tinted in the letter's chapter colour). Long rosters (over 40)
// are cut into letter chapters: each opens with a sun carrying the letter that
// rises out of its own ridge, and a sticky A–Z bar filters to one letter.
//
// Data and the search rule are Gold's (useDirectoryData; name + work,
// case-insensitive substring). Cards show exactly Gold's fields: photo (or
// initials), name, work (profession, else designation - the hook decides).
// Motion: one ScrollTrigger.batch for every card (arch opens from the ground,
// photo settles, card rises) + one trigger per letter sun. Nothing is hidden
// in CSS; reduced motion shows the finished page.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useDirectoryData } from '../../_shared/data.js'
import { PageHero, SearchField, ResultCount, ChipGroup, Portrait, Ridge, EmptyState, Loading, Button } from '../kit.jsx'
import { useScene, gsap, ScrollTrigger, scrollToEl, headerH, prefersReducedMotion } from '../motion.js'
import './Directory.css'

// Letter chapters + the A–Z bar only pay off on a long roster.
const AZ_FROM = 41
const TONES = ['cran', 'gold', 'azure', 'turq', 'violet', 'royal']

/** The letter a member files under: A–Z (accents folded), anything else '#'. */
function letterOf(name) {
  const c = String(name || '').trim().normalize('NFD').charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

function Member({ m, tone }) {
  return (
    <li className="hj-dir-card" data-tone={tone}>
      {/* the name is right below: the portrait is decoration */}
      <div className="hj-dir-card__a" aria-hidden="true"><Portrait src={m.img} name={m.name} alt="" /></div>
      <h3 className="hj-dir-card__n">{m.name}</h3>
      {m.work ? <p className="hj-dir-card__w">{m.work}</p> : null}
    </li>
  )
}

export default function Directory({ data }) {
  const club = useClub()
  const members = useDirectoryData(data)            // null while loading
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState('')      // '' = every letter
  const rootRef = useRef(null)
  const bodyRef = useRef(null)

  const list = useMemo(() => (members || []).map((m) => ({ ...m, l: letterOf(m.name) })), [members])
  const letters = useMemo(() => [...new Set(list.map((m) => m.l))]
    .sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b)), [list])
  const toneOf = (l) => TONES[Math.max(0, letters.indexOf(l)) % TONES.length]
  const grouped = list.length >= AZ_FROM && letters.length > 1

  const q = query.trim().toLowerCase()
  const matched = useMemo(() => list.filter((m) =>
    (!letter || m.l === letter) &&
    (!q || (m.name + ' ' + m.work).toLowerCase().indexOf(q) !== -1)), [list, letter, q])

  const groups = useMemo(() => {
    if (!grouped) return null
    const by = new Map(letters.map((l) => [l, []]))
    matched.forEach((m) => by.get(m.l).push(m))
    return letters.filter((l) => by.get(l).length).map((l) => ({ l, items: by.get(l) }))
  }, [grouped, letters, matched])

  // Cards rise a row at a time while their arches open from the ground; each
  // letter's sun climbs out of its ridge. On a fresh roster every card on or
  // below the screen animates; while filtering only the cards below the fold do,
  // so what you are looking at re-flows instantly. One batch for all cards.
  useScene(bodyRef, (c, ctx) => {
    const root = bodyRef.current
    const fold = window.innerHeight * 0.92
    const filtering = !!(q || letter)
    const keep = (el) => { const r = el.getBoundingClientRect(); return filtering ? r.top > fold : r.bottom > 0 }

    root.querySelectorAll('.hj-dir-grp__hd').forEach((hd) => {
      if (!keep(hd)) return
      const st = () => ({ trigger: hd, start: 'top 92%', once: true })
      gsap.fromTo(hd.querySelector('.hj-dir-grp__sun'), { yPercent: 120 }, { yPercent: 0, duration: 1.3, ease: 'expo.out', clearProps: 'transform', scrollTrigger: st() })
      gsap.fromTo(hd.querySelector('.hj-dir-grp__n'), { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9, delay: 0.2, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: st() })
    })

    const cards = Array.from(root.querySelectorAll('.hj-dir-card')).filter(keep)
    if (!cards.length) return
    const arch = (el) => el.querySelector('.hj-arch')
    gsap.set(cards, { y: 40, opacity: 0 })
    gsap.set(cards.map(arch), { clipPath: 'inset(100% 0% 0% 0%)' })
    ScrollTrigger.batch(cards, {
      start: 'top 92%',
      once: true,
      // ctx.add: tweens made later still belong to this scene and revert with it
      onEnter: (batch) => ctx.add(() => {
        const o = { stagger: 0.07, overwrite: true }
        gsap.to(batch, { ...o, y: 0, opacity: 1, duration: 0.9, ease: 'expo.out', clearProps: 'transform,opacity' })
        gsap.to(batch.map(arch), { ...o, clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2, delay: 0.08, ease: 'expo.out', clearProps: 'clipPath' })
        const imgs = batch.map((el) => el.querySelector('.hj-arch img')).filter(Boolean)
        if (imgs.length) gsap.fromTo(imgs, { scale: 1.35 }, { scale: 1, duration: 1.6, ease: 'expo.out', stagger: 0.07, clearProps: 'transform,scale' })
      }),
    })
  }, [list.length, letter, q, grouped])

  // Search runs over everyone; a letter replaces the search. One filter at a time.
  const onSearch = (v) => { setQuery(v); if (v.trim()) setLetter('') }
  const pick = (v) => {
    setLetter(v)
    setQuery('')
    const el = bodyRef.current
    if (el && el.getBoundingClientRect().top < headerH()) scrollToEl(el, prefersReducedMotion())
  }
  const clearAll = () => {
    setQuery('')
    setLetter('')
    const input = rootRef.current && rootRef.current.querySelector('.hj-search input')
    if (input) input.focus()
  }

  const shownQuery = query.trim()

  return (
    <div className="hj-page hj-dir" ref={rootRef}>
      <PageHero
        tone="turq"
        title="Directory"
      >
        {list.length ? (
          <div className="hj-dir-tools">
            <SearchField value={query} onChange={onSearch} label="Search members by name or profession" placeholder="Search by name or profession" />
            <ResultCount count={matched.length} total={list.length} noun="member" />
          </div>
        ) : null}
      </PageHero>

      <section className="hj-wrap hj-sec hj-dir-body" ref={bodyRef}>
        {members === null ? <Loading label="Loading members" /> : list.length === 0 ? (
          <EmptyState title="No members published" message="This club has not published its member directory yet." />
        ) : (
          <>
            {grouped ? (
              <div className="hj-dir-az">
                <ChipGroup
                  label="Show members by first letter"
                  options={[{ value: '', label: 'All' }, ...letters.map((l) => ({ value: l, label: l, tone: toneOf(l) }))]}
                  value={letter}
                  onChange={pick}
                />
              </div>
            ) : null}

            {matched.length === 0 ? (
              <EmptyState
                title={shownQuery ? 'No member matches “' + shownQuery + '”' : 'No members to show'}
                message="Check the spelling, or search by profession instead."
                action={<Button variant="ink" onClick={clearAll}>Show all members</Button>}
              />
            ) : groups ? (
              groups.map((g) => {
                const id = 'hj-dir-l-' + (g.l === '#' ? 'other' : g.l)
                const tone = toneOf(g.l)
                return (
                  <section key={g.l} className="hj-dir-grp" data-tone={tone} aria-labelledby={id}>
                    <div className="hj-dir-grp__hd">
                      <h2 className="hj-dir-grp__t" id={id}>
                        <span className="hj-dir-grp__sun">
                          {g.l === '#' ? <><span aria-hidden="true">#</span><span className="hj-sr">Other</span></> : g.l}
                        </span>
                      </h2>
                      <p className="hj-dir-grp__n">{g.items.length} {g.items.length === 1 ? 'member' : 'members'}</p>
                      <div className="hj-dir-grp__hill" aria-hidden="true">
                        <Ridge preset="far" seed={letters.indexOf(g.l) * 0.9} fill="color-mix(in srgb, var(--hj-c) 16%, #fff)" rim="var(--hj-c)" />
                      </div>
                    </div>
                    <ul className="hj-dir-grid">
                      {g.items.map((m) => <Member key={m.i} m={m} tone={tone} />)}
                    </ul>
                  </section>
                )
              })
            ) : (
              <>
                <h2 className="hj-sr">Members</h2>
                <ul className="hj-dir-grid">
                  {matched.map((m) => <Member key={m.i} m={m} tone={toneOf(m.l)} />)}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  )
}
