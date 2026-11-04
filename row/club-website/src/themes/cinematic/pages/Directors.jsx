'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · DIRECTORS — "the billing".
// A film poster bills its leads above the title and the ensemble below it. The
// board does the same: the president and the secretary share top billing, side
// by side (portraits opening like a projector in a lit frame, names rising in
// expanded letters), and the rest of the board follows in the club's own order
// as leader cards dealt onto the table. No hover animation on the photos (client, 2026-09-25).
// Photo, name and designation only - no introductions (client, 2026-09-25).
// Data: useDirectorsData() only (goldData.useDirectorsGold, sorted by the
// club's designation order). Lead picking matches DirectorsGold.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useDirectorsData } from '../../_shared/data.js'
import {
  usePageName, PageHero, SectionHead, Button, PersonCard, PersonPhoto, SearchField, ResultCount,
  EmptyState, Loading,
} from '../kit.jsx'
import {
  gsap, useScene, afterFonts, useRefreshOnImages, cleanups, titleIn, dealIn, projectorOpen,
} from '../motion.js'
import './Directors.css'

/** The two offices that get billing, in this order (same rule as DirectorsGold). */
const LEAD = ['president', 'secretary']

function splitBoard(all) {
  const list = (all || []).map((d, i) => ({ ...d, key: i + '|' + d.name + '|' + d.role }))
  const taken = new Set()
  const leads = []
  for (const kw of LEAD) {
    const i = list.findIndex((d, j) => !taken.has(j) && String(d.role || '').toLowerCase().indexOf(kw) >= 0)
    if (i >= 0) { taken.add(i); leads.push(list[i]) }
  }
  // No president/secretary filed: the club's first-ordered office takes the billing.
  if (!leads.length && list.length) { taken.add(0); leads.push(list[0]) }
  return { leads, rest: list.filter((_, j) => !taken.has(j)) }
}

const longestWord = (s) => Math.max(4, ...String(s || '').split(/\s+/).map((w) => w.length))

// ── top billing: president and secretary, one row ────────────────────────────
function Lead({ d }) {
  const ref = useRef(null)
  useScene(ref, (c, ctx) => {
    const root = ref.current
    const off = cleanups()
    const tl = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top 80%', once: true } })
    tl.add(projectorOpen(root.querySelector('.cin-dirs-lead__frame'), { duration: 1.3 }), 0)
      .fromTo(root.querySelector('.cin-dirs-lead__glow'), { opacity: 0, scale: 0.7 },
        { opacity: 1, scale: 1, duration: 1.8, ease: 'power2.out', clearProps: 'opacity,transform' }, 0.25)
      .fromTo(root.querySelector('.cin-dirs-lead__beam'), { scaleX: 0 },
        { scaleX: 1, duration: 1.1, ease: 'expo.inOut', clearProps: 'transform' }, 0.5)
    // the text enters on its own trigger: on phones it sits a screen below the photo that starts the timeline
    const rest = root.querySelectorAll('.cin-dirs-lead__role')
    if (rest.length) {
      gsap.from(rest, {
        y: 26, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, clearProps: 'transform,opacity',
        scrollTrigger: { trigger: root.querySelector('.cin-dirs-lead__txt'), start: 'top 88%', once: true },
      })
    }
    off(afterFonts(ctx, () => titleIn(root.querySelector('.cin-dirs-lead__name'), { start: 'top 90%' })))
    return off.run
  }, [d.key])

  return (
    <article ref={ref} className="cin-dirs-lead">
      <div className="cin-dirs-lead__ph">
        <span className="cin-dirs-lead__glow" aria-hidden="true" />
        <div className="cin-dirs-lead__frame">
          <PersonPhoto key={d.img || d.name} src={d.img} name={d.name} alt={d.name} className="cin-dirs-lead__img" monoClass="cin-dirs-lead__mono" width="480" height="600" />
        </div>
      </div>
      <div className="cin-dirs-lead__txt">
        {d.role ? <p className="cin-dirs-lead__role">{d.role}</p> : null}
        <h2 className="cin-dirs-lead__name" key={d.name} style={{ '--lw': longestWord(d.name) }}>{d.name}</h2>
        <span className="cin-dirs-lead__beam" aria-hidden="true" />
      </div>
    </article>
  )
}

// ── the ensemble: leader cards - photo, designation, name ────────────────────
function DirCard({ d }) {
  return <PersonCard as="li" level={3} className="cin-dirs-card" name={d.name} role={d.role} img={d.img} />
}

function Board({ people, searching }) {
  const ref = useRef(null)
  const sig = people.map((d) => d.key).join(',')
  useScene(ref, (c) => {
    const cards = [...ref.current.querySelectorAll('.cin-dirs-card')]
    // Dealt a row at a time as the table scrolls in; not while typing a search.
    if (!searching) for (let i = 0; i < cards.length; i += 4) dealIn(cards.slice(i, i + 4), { trigger: cards[i] })
  }, [sig, searching])

  return (
    <section ref={ref} className="cin-sec cin-dirs-board" aria-labelledby="cin-dirs-board-h">
      <SectionHead id="cin-dirs-board-h" title="The board" />
      <ul className="cin-dirs-grid">
        {people.map((d) => <DirCard key={d.key} d={d} />)}
      </ul>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Directors({ data }) {
  const name = usePageName('Directors')
  const directors = useDirectorsData(data)
  const [query, setQuery] = useState('')
  const pageRef = useRef(null)
  const searchRef = useRef(null)
  useRefreshOnImages(pageRef, [directors])

  const { leads, rest } = useMemo(() => splitBoard(directors), [directors])
  const q = query.trim().toLowerCase()
  const hit = (d) => !q || (d.name + ' ' + d.role).toLowerCase().indexOf(q) !== -1
  const leadsShown = leads.filter(hit)
  const restShown = rest.filter(hit)
  const total = leads.length + rest.length
  const found = leadsShown.length + restShown.length


  const clear = () => {
    setQuery('')
    if (searchRef.current) searchRef.current.focus()
  }

  return (
    <div ref={pageRef} className="cin-dirs">
      <PageHero title={name}
        meta={rest.length ? (
          <>
            <SearchField inputRef={searchRef} value={query} onChange={setQuery} label="Search the board by name or designation" placeholder="Search the board" />
            <ResultCount count={found} total={total} noun="director" />
          </>
        ) : null} />

      {directors === null ? <Loading label="Loading the board" />
        : total === 0 ? (
          <div className="cin-sec">
            <EmptyState title="No board published" message="This club has not published its board of directors for the selected Rotary year." />
          </div>
        ) : found === 0 ? (
          <div className="cin-sec">
            <EmptyState title="No match" message={'No director matches “' + query.trim() + '”.'}
              action={<Button variant="line" onClick={clear}>Clear search</Button>} />
          </div>
        ) : (
          <>
            {leadsShown.length ? (
              <section className={'cin-dirs-leads' + (leadsShown.length === 1 ? ' is-one' : '')} aria-label="Club leaders">
                {leadsShown.map((d) => <Lead key={d.key} d={d} />)}
              </section>
            ) : null}
            {restShown.length ? <Board people={restShown} searching={!!q} /> : null}
          </>
        )}
    </div>
  )
}
