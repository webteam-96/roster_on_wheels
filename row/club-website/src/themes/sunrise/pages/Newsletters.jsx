'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · NEWSLETTERS — the bulletin sheet.
//
// The home's newsletter sheet, grown into a page: one cream (night) / white
// (day) sheet on the sky. The latest issue stands at its head as a large cover
// beside its title and the one "Open PDF" action; every earlier issue follows
// as a shelf of night-sky covers, a sun rising from each one's foot. As the page
// scrolls the sheet lifts off the sky and the covers stand up row by row, their
// suns rising (liftSheet / standUp - the sample's newsletter motion).
//
// Data and the search rule are Gold's (useNewslettersData = buildItems: newest
// first, every issue of the selected year; search = title, case-insensitive).
// Issues without a file or link are left out - there is nothing to open.
// ─────────────────────────────────────────────────────────────────────────────
import { useId, useMemo, useRef, useState } from 'react'
import { useClub, useNewslettersData } from '../../_shared/data.js'
import { PageHero, Sheet, Cover, Button, SearchField, ResultCount, EmptyState, Loading, noEmoji, openHref, ext, ArrowUpRight, yearText } from '../kit.jsx'
import { useScene, liftSheet, standUp } from '../motion.js'
import './Newsletters.css'

// Short archives don't need a search box.
const SEARCH_FROM = 13

const isPdf = (u) => /\.pdf(\?|#|$)/i.test(u || '')
/** linkUrl is typed by admins: a bare host would otherwise open as a site path. */
const hrefOf = openHref
const nameOf = (n) => noEmoji(n.title) || 'Newsletter'
/** buildItems' month caption ("August 2026"), blank when the API sent no usable date. */
const monthOf = (n) => (n.monthLabel && n.monthLabel !== 'Undated' && !/NaN|undefined/.test(n.monthLabel) ? n.monthLabel : '')

function Issue({ n }) {
  const pdf = isPdf(n.url)
  return (
    <li className="sun-nl-issue">
      <a href={hrefOf(n.url)} {...ext}>
        <Cover name={nameOf(n)} sub={monthOf(n)} />
        <span className="sun-nl-issue__foot">
          {n.date ? <span className="sun-nl-issue__date">{n.date}</span> : <span />}
          <span className="sun-nl-issue__cta" aria-hidden="true">{pdf ? 'Open PDF' : 'Open'}<ArrowUpRight /></span>
        </span>
        <span className="sun-sr">{pdf ? ' (PDF, opens in a new tab)' : ' (opens in a new tab)'}</span>
      </a>
    </li>
  )
}

export default function Newsletters({ data }) {
  const club = useClub()
  const items = useNewslettersData(data)             // null while loading
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const bodyRef = useRef(null)
  const leadId = useId()
  const moreId = useId()

  const all = useMemo(() => (items || []).filter((n) => n && n.url), [items])
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => (q ? all.filter((n) => String(n.title || '').toLowerCase().indexOf(q) !== -1) : all), [all, q])
  const lead = q ? null : shown[0] || null        // while searching, every match is an equal
  const rest = lead ? shown.slice(1) : shown
  const year = yearText(club.selectedYearLabel)

  // The sheet lifts off the sky; the covers stand up, a row at a time, their suns rising.
  useScene(bodyRef, () => {
    const root = bodyRef.current
    const sheet = root.querySelector('.sun-sheet')
    if (!sheet) return
    // a sheet taller than the screen tilted from its foot would throw its head far back
    if (sheet.offsetHeight < window.innerHeight * 1.2) liftSheet(sheet)
    const lc = root.querySelector('.sun-nl-lead__cover')
    if (lc) standUp(lc.querySelector('.sun-cover'), lc)
    const grid = root.querySelector('.sun-nl-grid')
    if (!grid) return
    const lis = Array.from(grid.children)
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
    for (let i = 0; i < lis.length; i += cols) {
      const row = lis.slice(i, i + cols)
      standUp(row.map((li) => li.querySelector('.sun-cover')), row[0])
    }
  }, [items, q])

  // the button leaves with the empty state: hand focus to the search field, not <body>
  const clearSearch = () => {
    setQuery('')
    const input = ref.current && ref.current.querySelector('.sun-search input')
    if (input) input.focus()
  }

  return (
    <div className="sun-page sun-nl" ref={ref}>
      <PageHero title="Newsletters">
        {all.length ? (
          <div className="sun-tools">
            {all.length >= SEARCH_FROM ? (
              <SearchField label="Search issues by title" placeholder="Search issues" value={query} onChange={setQuery} />
            ) : null}
            <ResultCount count={shown.length} total={all.length} noun="issue" />
          </div>
        ) : null}
      </PageHero>

      <section className="sun-wrap sun-block sun-nl-body" ref={bodyRef} aria-label="Newsletter issues">
        {items === null ? <Loading label="Loading newsletters" /> : all.length === 0 ? (
          <EmptyState
            title="No newsletters yet"
            message={'Issues of the club’s bulletin will appear here as they are published' + (year ? ' for Rotary year ' + year : '') + '.'}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title={'No issue matches “' + query.trim() + '”'}
            message="Check the spelling, or clear the search to see every issue."
            action={<Button variant="line" icon={false} onClick={clearSearch}>Clear search</Button>}
          />
        ) : (
          <Sheet className="sun-nl-sheet">
            {lead ? (
              <div className="sun-nl-lead">
                <div className="sun-nl-lead__txt">
                  <p className="sun-eyebrow">Latest issue</p>
                  <h2 className="sun-nl-lead__title" id={leadId}>{nameOf(lead)}</h2>
                  {lead.date ? <p className="sun-nl-lead__date">Published {lead.date}</p> : null}
                  <Button href={hrefOf(lead.url)} variant="dark" external aria-describedby={leadId}>
                    {isPdf(lead.url) ? 'Open PDF' : 'Read this issue'}
                  </Button>
                </div>
                {/* the same link for the pointer; the button above is the way in for keyboards and readers */}
                <a className="sun-nl-lead__cover" href={hrefOf(lead.url)} {...ext} tabIndex={-1} aria-hidden="true">
                  <Cover name={nameOf(lead)} sub={monthOf(lead)} />
                </a>
              </div>
            ) : null}
            {rest.length ? (
              <div className="sun-nl-more">
                <h2 className="sun-nl-h" id={moreId}>{lead ? 'Earlier issues' : 'Matching issues'}</h2>
                <ul className="sun-nl-grid" aria-labelledby={moreId}>
                  {rest.map((n, i) => <Issue key={n.url + '|' + i} n={n} />)}
                </ul>
              </div>
            ) : null}
          </Sheet>
        )}
      </section>
    </div>
  )
}
