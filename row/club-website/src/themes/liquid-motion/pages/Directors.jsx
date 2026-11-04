'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · DIRECTORS — the board for the selected Rotary year.
//
// Ink hero (title, search) -> ONE ink band: every director as an arch card in the
// club's OWN order (client, 2026-10-01: no "Office bearers" / "The board" split,
// no section headings, no introductions or Read buttons).
// Data: useDirectorsData() only (goldData.useDirectorsGold) - the order it gives.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useDirectorsData, useCurrentMenuName, usePageTitle } from '../../_shared/data.js'
import { PageHero, Band, SearchField, ResultCount, EmptyState, Loading, Portrait, Pill } from '../kit.jsx'
import { usePageMotion } from '../motion.js'
import './Directors.css'

/** A director: arch, role, name (no 01/02 number - client, 2026-10-01). */
function Member({ d }) {
  return (
    <li className="liq-bod-card liq-rv">
      <Portrait src={d.img} name={d.name} className="liq-bod-card__pic" />
      <p className="liq-bod-card__meta">
        {d.role ? <span className="liq-bod-card__role">{d.role}</span> : null}
      </p>
      <h3 className="liq-bod-card__name">{d.name}</h3>
    </li>
  )
}

export default function Directors({ data }) {
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Directors'
  usePageTitle(title)
  const directors = useDirectorsData(data) // null while loading, club's own order
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  // n = place in the club's own order, kept while a search filters the grid
  const all = useMemo(() => (directors || []).map((d, i) => ({ ...d, n: i + 1, key: i + '|' + d.role + '|' + d.name })), [directors])
  const q = query.trim().toLowerCase()
  const shown = all.filter((d) => !q || (d.name + ' ' + d.role).toLowerCase().indexOf(q) !== -1)
  // rebuild motion only when what is on screen changes, not on every keystroke
  usePageMotion(ref, [(directors ? 'y:' : 'n:') + shown.map((d) => d.key).join(',')])

  const clear = () => {
    setQuery('')
    const input = ref.current && ref.current.querySelector('.liq-search input')
    if (input) input.focus()
  }

  return (
    <div className="liq-bod" ref={ref}>
      <PageHero title={title}>
        {all.length > 0 ? (
          <div className="liq-bod-tools">
            <SearchField label="Search the board by name or designation" placeholder="Search the board" value={query} onChange={setQuery} />
            <ResultCount count={shown.length} total={all.length} one="board member" many="board members" />
          </div>
        ) : null}
      </PageHero>

      {directors === null ? (
        <Band tone="paper" aria-label="Board of directors"><Loading label="Loading the board" /></Band>
      ) : all.length === 0 ? (
        <Band tone="paper" aria-label="Board of directors">
          <EmptyState title="No board published" text="This club has not published its board of directors for the selected Rotary year." />
        </Band>
      ) : shown.length === 0 ? (
        <Band tone="paper" aria-label="Search results">
          <EmptyState title="No one matches" text={'No board member matches “' + query.trim() + '”.'}
                      action={<Pill variant="ink" onClick={clear}>Clear search</Pill>} />
        </Band>
      ) : (
        <Band tone="ink" aria-label="Board of directors">
          <ul className="liq-bod-grid">
            {shown.map((d) => <Member key={d.key} d={d} />)}
          </ul>
        </Band>
      )}
    </div>
  )
}
