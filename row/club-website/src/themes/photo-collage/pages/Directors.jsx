'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO COLLAGE · DIRECTORS — the board pinned into the scrapbook.
//
// The two principals (President, Secretary — found by Gold's keyword rule) get
// big taped portraits, each with a kraft role tag hanging below on a short
// string; the tags swing as the page scrolls. The rest of the board follows in
// the club's own order (useDirectorsData sorts it) as mid-size portraits with
// the role handwritten and the name in Shrikhand. Bios show as an excerpt with a
// <details> "Read more". A search over the rest of the board (Gold's rule:
// name + designation) re-deals the grid.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useDirectorsData } from '../../_shared/data.js'
import { isPlaceholderPhoto } from '../../_shared/kit.jsx'
import { useScene, house, develop, revealBatch } from '../motion.js'
import {
  usePageName, PageHero, Portrait, Button, SearchField, EmptyState, Loading,
  TAPE_CYCLE, yearDash,
} from '../kit.jsx'
import './Directors.css'

// The offices that lead the page, in this order (Gold's rule).
const LEAD = ['president', 'secretary']
// A search strip over a handful of cards is noise.
const SEARCH_FROM = 7
const TILT = [-3, 2, -1, 3]
const hasPhoto = (d) => !isPlaceholderPhoto(d.img)

export default function Directors({ data }) {
  const club = useClub()
  const name = usePageName('Directors')
  const directors = useDirectorsData(data)            // null while loading; board order already sorted
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const gridRef = useRef(null)

  const { leads, rest } = useMemo(() => {
    const all = directors || []
    const taken = new Set()
    const leads = []
    for (const kw of LEAD) {
      const idx = all.findIndex((d, i) => !taken.has(i) && String(d.role || '').toLowerCase().indexOf(kw) >= 0)
      if (idx >= 0) { taken.add(idx); leads.push({ ...all[idx], kw }) }
    }
    return { leads, rest: all.filter((_, i) => !taken.has(i)) }
  }, [directors])

  // one section for the whole board (client, 2026-09-29): the president and secretary lead it
  const board = useMemo(() => [...leads, ...rest], [leads, rest])
  const q = query.trim().toLowerCase()
  const shown = q ? board.filter((d) => (d.name + ' ' + d.role).toLowerCase().indexOf(q) !== -1) : board

  // the page: principals dealt in, tag strings drawn, tags swing, titles wipe
  useScene(rootRef, (c) => house(rootRef.current, c), [directors])
  // the board grid re-deals whenever the search changes it
  useScene(gridRef, () => {
    revealBatch(gridRef.current.querySelectorAll('.col-bod-card'))
    develop(gridRef.current.querySelectorAll('img.col-portrait-img'))
  }, [directors, q])

  const Y = yearDash(club.selectedYearLabel)
  const photos = rest.filter(hasPhoto)
  const heroImg = (leads.find(hasPhoto) || photos[0] || {}).img
  const prints = photos.slice(0, 3).map((d) => ({ src: d.img, caption: d.name, ratio: '4 / 5' }))
  const count = q ? shown.length + ' of ' + board.length + (board.length === 1 ? ' director matches' : ' directors match') : ''

  return (
    <div className="col-bod" ref={rootRef}>
      <PageHero
        title={name}
        kicker={Y ? 'Rotary year ' + Y : null}
        lead={directors && directors.length ? 'Meet the club’s board of directors.' : null}
        img={heroImg}
        tint="violet"
        prints={prints}
      />

      {directors === null ? (
        <section className="col-sec col-bod-state"><Loading label="Loading the board" count={3} /></section>
      ) : !directors.length ? (
        <section className="col-sec col-bod-state">
          <EmptyState title="No board published"
            message={'This club has not published its board of directors for ' + (Y ? 'Rotary year ' + Y : 'the selected Rotary year') + '.'} />
        </section>
      ) : (
        <>
          {board.length ? (
            <section className="col-sec col-bod-board" aria-label="The board">
              {board.length >= SEARCH_FROM ? (
                <div className="col-bod-tools">
                  <SearchField label="Search the board" value={query} onChange={setQuery} placeholder="Name or role" />
                  <p className="col-count" role="status" aria-live="polite">{count}</p>
                </div>
              ) : null}
              {shown.length ? (
                <ul className="col-bod-grid" ref={gridRef}>
                  {shown.map((d, i) => (
                    <li key={d._i + (d.kw || '')} className="col-bod-card">
                      <div className="col-bod-card-photo">
                        <Portrait src={d.img} name={d.name} alt="" r={TILT[i % 4]} k={i % 2 ? -0.7 : 0.8} tape={TAPE_CYCLE[i % 4]} />
                      </div>
                      <div className="col-bod-card-text">
                        {d.role ? <p className="col-bod-role">{d.role}</p> : null}
                        <h3 className="col-bod-name">{d.name}</h3>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No match" message={'No one on the board matches “' + query.trim() + '”.'}
                  action={<Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button>} />
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
