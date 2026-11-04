'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO COLLAGE · DIRECTORY — the club's contact sheet.
//
// Every member is a small taped portrait print (photo, or their initials on
// kraft), tilted a few degrees, with the name handwritten under the photo and
// what they do in small ink. The prints are dealt onto the sheet a batch at a
// time as it scrolls (house() -> revealBatch, one ScrollTrigger.batch: the
// roster can be 300 long, so no per-card scrubs). Searching re-deals the sheet.
// (No first-letter strip - client, 2026-09-29; the head carries one count card.)
//
// Data and the search rule are Gold's (useDirectoryData; name + profession,
// case-insensitive substring). Cards show exactly Gold's fields: photo (or
// initials), name, profession (designation when none is filed).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDirectoryData } from '../../_shared/data.js'
import { isPlaceholderPhoto } from '../../_shared/kit.jsx'
import {
  usePageName, PageHero, SearchField, ResultCount, Portrait, EmptyState, Loading, Button, TAPE_CYCLE,
} from '../kit.jsx'
import { useScene, house } from '../motion.js'
import './Directory.css'

// The sheet's tilts and sway, cycled (DESIGN: −3 / 2 / −1 / 3°).
const TILT = [-3, 2, -1, 3]
const SWAY = [0.8, -0.9, 1, -0.7]

export default function Directory({ data }) {
  const name = usePageName('Directory')
  const members = useDirectoryData(data)            // null while loading
  const [query, setQuery] = useState('')        // what the field shows
  const [q, setQ] = useState('')                // what the sheet shows: the query once typing pauses
  const rootRef = useRef(null)
  const bodyRef = useRef(null)

  // Filter (and re-deal) once typing pauses, not on every keystroke; clearing is instant.
  useEffect(() => {
    const v = query.trim()
    if (!v) { setQ(''); return undefined }
    const t = setTimeout(() => setQ(v), 250)
    return () => clearTimeout(t)
  }, [query])

  const list = members || []
  const matched = useMemo(() => {
    const needle = q.toLowerCase()
    return (members || []).filter((m) =>
      !needle || (m.name + ' ' + m.work).toLowerCase().indexOf(needle) !== -1)
  }, [members, q])

  // Up to three members' own photos: prints in the head + the photo in the title's letters.
  const faces = useMemo(() => (members || []).filter((m) => !isPlaceholderPhoto(m.img)).slice(0, 3), [members])

  // The house style: the portraits (data-col-deal) are dealt in batches; every
  // new roster, letter or search re-deals the sheet.
  useScene(bodyRef, (c) => house(bodyRef.current, c), [members, q])

  const clearAll = () => {
    setQuery('')
    const input = rootRef.current && rootRef.current.querySelector('.col-search input')
    if (input) input.focus()
  }

  return (
    <div className="col-dir" ref={rootRef}>
      <PageHero title={name} img={faces[0] ? faces[0].img : undefined} tint="azure"
        card={list.length ? (q
          ? { value: matched.length, label: 'of ' + list.length + (list.length === 1 ? ' member' : ' members') }
          : { value: list.length, label: list.length === 1 ? 'member' : 'members' }) : null}>
        {list.length ? (
          <>
            <SearchField label="Search members" placeholder="Name or profession" value={query} onChange={setQuery} />
            {/* the card shows the count; this copy only announces search results to screen readers */}
            <div className="col-sr"><ResultCount shown={matched.length} total={list.length} noun="member" /></div>
          </>
        ) : null}
      </PageHero>

      <section className="col-sec col-dir-body" ref={bodyRef} aria-label="Members">
        {members === null ? <Loading label="Loading members" count={4} /> : list.length === 0 ? (
          <EmptyState title="No members published" message="This club has not published its member directory yet." />
        ) : (
          <>
            {matched.length === 0 ? (
              <EmptyState
                title={'No one matches “' + q + '”'}
                message="Check the spelling, or search by profession instead."
                action={<Button variant="ghost" onClick={clearAll}>Show all members</Button>}
              />
            ) : (
              <ul className="col-dir-grid">
                {matched.map((m, i) => (
                  <li key={m.i}>
                    <Portrait
                      src={m.img}
                      name={m.name}
                      alt=""
                      r={TILT[i % 4]}
                      k={SWAY[i % 4]}
                      tape={TAPE_CYCLE[i % 4]}
                      deal
                      caption={<>
                        <span className="col-dir-name">{m.name}</span>
                        {m.work ? <span className="col-dir-work">{m.work}</span> : null}
                      </>}
                    />
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
