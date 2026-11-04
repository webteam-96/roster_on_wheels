'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · DIRECTORS — the board at sunrise.
// One centred grid of arch portraits that rise like suns, row by row (People):
// photo, designation and name only - no introductions, buttons or links
// (client, 2026-09-29). The president and the secretary lead it; the rest of
// the board follows in the club's own order.
// Data: useDirectorsData() only (goldData.useDirectorsGold - null while
// loading, sorted by the club's designation order). Lead picking = DirectorsGold.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useDirectorsData } from '../../_shared/data.js'
import { PageHero, Button, Person, People, SearchField, ResultCount, EmptyState, Loading } from '../kit.jsx'
import { useRefreshOnImages } from '../motion.js'

/** The two offices that lead the board, in this order (same rule as DirectorsGold). */
const LEAD = ['president', 'secretary']

/** The board in the club's own order, with the president and then the secretary moved to the front. */
function boardOrder(all) {
  const list = (all || []).map((d, i) => ({ ...d, key: i + '|' + d.name + '|' + d.role }))
  const taken = new Set()
  const leads = []
  LEAD.forEach((kw) => {
    const i = list.findIndex((d, j) => !taken.has(j) && String(d.role || '').toLowerCase().indexOf(kw) >= 0)
    if (i >= 0) { taken.add(i); leads.push(list[i]) }
  })
  return [...leads, ...list.filter((_, j) => !taken.has(j))]
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Directors({ data }) {
  const directors = useDirectorsData(data)
  const [query, setQuery] = useState('')
  const pageRef = useRef(null)
  useRefreshOnImages(pageRef, [directors])

  const board = useMemo(() => boardOrder(directors), [directors])
  const q = query.trim().toLowerCase()
  const shown = board.filter((d) => !q || (d.name + ' ' + d.role).toLowerCase().indexOf(q) !== -1)

  const clear = () => {
    setQuery('')
    const input = pageRef.current && pageRef.current.querySelector('.sun-search input')
    if (input) input.focus()
  }

  return (
    <div ref={pageRef} className="sun-page sun-bod">
      {/* the two officers alone need no search */}
      <PageHero title="Directors">
        {board.length > LEAD.length ? (
          <div className="sun-tools">
            <SearchField label="Search the board by name or designation" placeholder="Search the board" value={query} onChange={setQuery} />
            <ResultCount count={shown.length} total={board.length} noun="director" />
          </div>
        ) : null}
      </PageHero>

      {directors === null ? (
        <div className="sun-wrap sun-block"><Loading label="Loading the board" /></div>
      ) : board.length === 0 ? (
        <div className="sun-wrap sun-block">
          <EmptyState title="No board published" message="This club has not published its board of directors for the selected Rotary year." />
        </div>
      ) : shown.length === 0 ? (
        <div className="sun-wrap sun-block">
          <EmptyState title="No match" message={'No director matches “' + query.trim() + '”.'}
            action={<Button variant="line" icon={false} onClick={clear}>Clear search</Button>} />
        </div>
      ) : (
        <section className="sun-wrap sun-block" aria-label="Board of directors">
          {/* no rise while a search is re-flowing the rows; names are h2 (no section heading above them) */}
          <People animate={!q} deps={[shown.map((d) => d.key).join(',')]}>
            {shown.map((d) => <Person key={d.key} src={d.img} name={d.name} role={d.role} level={2} />)}
          </People>
        </section>
      )}
    </div>
  )
}
