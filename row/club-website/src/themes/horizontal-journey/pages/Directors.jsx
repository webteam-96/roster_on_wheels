'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · DIRECTORS — the board as a ridge line.
//
// Royal sky over the hero; its front ridge falls into the turquoise valley of
// the home's "Our leaders" chapter. There the president and the secretary
// stand on a drawn ridge as large arch portraits and rise open from it as you
// arrive. The valley closes on ridges into the paper ground, where the rest
// of the board follows in the club's own order as smaller arches, each on its
// own little hill. Names and roles only - no bios (client, 2026-09-29).
//
// Data: useDirectorsData() only (goldData.useDirectorsGold: null while
// loading, then rows sorted by the club's designation order). Picking the two
// leads is DirectorsGold's rule; a club that files neither gets the grid only.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useClub, useDirectorsData } from '../../_shared/data.js'
import {
  PageHero, SearchField, ResultCount, EmptyState, Loading, Button, Portrait,
  yearText,
} from '../kit.jsx'
import {
  useScene, revealBatch, archOpen, refreshSoon, useRefreshOnImages,
} from '../motion.js'
import './Directors.css'

/** Arch portrait; aria-hidden by its wrapper because the name is right beside it. */
const Arch = ({ d }) => <Portrait src={d.img} name={d.name} alt="" />

export default function Directors({ data }) {
  const club = useClub()
  const directors = useDirectorsData(data)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  // everyone in ONE grid, in the club's own order (client, 2026-10-05: no President / Secretary band, no "The board" head)
  const all = useMemo(() => (directors || []).map((d, i) => ({ ...d, key: i + '|' + d.name + '|' + d.role })), [directors])
  const q = query.trim().toLowerCase()
  const shown = all.filter((d) => !q || (d.name + ' ' + d.role).toLowerCase().indexOf(q) !== -1)
  const total = all.length
  const found = shown.length

  // Filtering moves cards that may still be waiting for their reveal.
  useEffect(() => { refreshSoon() }, [q])
  useRefreshOnImages(ref, [directors])

  // Keyed on the data, not the search: typing must not replay every entrance.
  // Cards a search unmounts come back as fresh, fully visible nodes.
  useScene(ref, () => {
    const cards = ref.current.querySelectorAll('.hj-bod-card')
    revealBatch(cards)
    cards.forEach((card) => archOpen(card.querySelector('.hj-arch'), { trigger: card, start: 'top 90%' }))
  }, [directors])

  const year = yearText(club.selectedYearLabel)
  const clear = () => {
    setQuery('')
    const input = ref.current && ref.current.querySelector('.hj-search input')
    if (input) input.focus()
  }

  return (
    <div className="hj-page hj-bod" ref={ref}>
      <PageHero tone="royal" title="Directors">
        {total > 0 ? (
          <div className="hj-bod-find">
            <SearchField value={query} onChange={setQuery} label="Search directors by name or designation"
                         placeholder="Search the board…" />
            <ResultCount count={found} total={total} noun="board member" />
          </div>
        ) : null}
      </PageHero>

      {directors === null ? (
        <div className="hj-wrap hj-sec"><Loading label="Loading the board" /></div>
      ) : total === 0 ? (
        <div className="hj-wrap hj-sec">
          <EmptyState title="No board published"
                      message="This club has not published its board of directors for the selected Rotary year." />
        </div>
      ) : found === 0 ? (
        <div className="hj-wrap hj-sec">
          <EmptyState title={'No board member matches “' + query.trim() + '”'}
                      action={<Button variant="ink" onClick={clear}>Clear search</Button>} />
        </div>
      ) : (
        <section className="hj-wrap hj-sec hj-bod-board" aria-label="Board of directors">
          <ul className="hj-bod-grid">
            {shown.map((d) => (
              <li className="hj-bod-card" key={d.key}>
                <div className="hj-bod-card__ph" aria-hidden="true"><Arch d={d} /></div>
                {d.role ? <p className="hj-bod-card__r">{d.role}</p> : null}
                <h3 className="hj-bod-card__n">{d.name}</h3>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
