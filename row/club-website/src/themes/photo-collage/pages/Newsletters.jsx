'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO COLLAGE · NEWSLETTERS — the clipboard.
//
// The latest issue is a ruled sheet held on a kraft clipboard by a bulldog clip,
// with a sticker counting the year's issues. Below it, every issue is the home
// page's ruled notebook card with a paper clip, grouped under handwritten month
// headings (pen underline drawn on scroll). Cards slide in from alternating
// sides and straighten (slideIn); the board drops and settles (settleIn).
//
// Data, ordering (newest first), the month grouping and the title search are
// Gold's (useNewslettersData / NewslettersGold). Big archives (> 6) also get a
// month filter and a live count.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useClub, useNewslettersData } from '../../_shared/data.js'
import {
  usePageName, PageHero, SectionHead, SearchField, FilterGroup, ResultCount, StatRow, EmptyState, Loading,
  Button, Chip, Underline, P, cleanText, yearDash,
} from '../kit.jsx'
import { useScene, house, settleIn, slideIn } from '../motion.js'
import './Newsletters.css'

const TOOLS_FROM = 7            // Gold shows its search once there are more than 6 issues
const TILT = [-2, 2.5, -1.2, 1.8]
const titleOf = (n) => cleanText(n.title) || 'Newsletter'
/** "August 2026" -> "Aug 2026" for the filter chips ("Undated" stays). */
const shortMonth = (label) => (/^\S+ \d{4}$/.test(label) ? label.slice(0, 3) + label.slice(label.indexOf(' ')) : label)

export default function Newsletters({ data }) {
  const club = useClub()
  const name = usePageName('Newsletters')
  const items = useNewslettersData(data)           // null while loading; newest first
  const [query, setQuery] = useState('')       // what the field shows
  const [q, setQ] = useState('')               // what the list shows: the query once typing pauses
  const [month, setMonth] = useState('')       // '' = every month
  const ref = useRef(null)

  useEffect(() => {
    const v = query.trim()
    if (!v) { setQ(''); return undefined }
    const t = setTimeout(() => setQ(v), 250)
    return () => clearTimeout(t)
  }, [query])

  const all = items || []
  const latest = all.length ? all[0] : null
  const tools = all.length >= TOOLS_FROM

  const months = useMemo(() => {
    const out = []
    for (const n of items || []) {
      const last = out[out.length - 1]
      if (last && last.value === n.monthLabel) last.count++
      else out.push({ value: n.monthLabel, label: shortMonth(n.monthLabel), count: 1 })
    }
    return out
  }, [items])
  const showMonths = tools && months.length > 2
  // a month picked in another Rotary year simply doesn't apply here
  const m = showMonths && months.some((o) => o.value === month) ? month : ''

  // Filtering re-derives the month groups (no heading left over an empty month).
  const groups = useMemo(() => {
    const needle = q.toLowerCase()
    const out = []
    ;(items || []).forEach((n, i) => {
      if (m && n.monthLabel !== m) return
      if (needle && String(n.title || '').toLowerCase().indexOf(needle) === -1) return
      const last = out[out.length - 1]
      if (!last || last.label !== n.monthLabel) out.push({ label: n.monthLabel, rows: [{ n, i }] })
      else last.rows.push({ n, i })
    })
    return out
  }, [items, m, q])
  const shown = groups.reduce((s, g) => s + g.rows.length, 0)

  useScene(ref, (c) => {
    const root = ref.current
    const undo = house(root, c)
    settleIn(root.querySelectorAll('.col-news-board-move'))
    slideIn(root.querySelectorAll('.col-news-move'))
    return undo
  }, [items, m, q])

  const clear = () => {
    setQuery('')
    setMonth('')
    const input = ref.current && ref.current.querySelector('.col-news-tools input')
    if (input) input.focus()
  }

  const yl = yearDash(club.selectedYearLabel)

  return (
    <div className="col-news" ref={ref}>
      <PageHero
        title={name}
        kicker={yl ? 'Rotary year ' + yl : undefined}
        tint="azure"
        lead={all.length ? 'The club’s bulletins for the year, newest first.' : undefined}
      />

      {items === null ? (
        <div className="col-sec"><Loading label="Loading newsletters" /></div>
      ) : !latest ? (
        <div className="col-sec">
          <EmptyState
            title="No newsletters yet"
            message={'Issues of the club’s bulletin will appear here once they are published' + (yl ? ' for Rotary year ' + yl : '') + '.'}
          />
        </div>
      ) : (
        <>
          {/* ══ the latest issue, on the clipboard ══ */}
          <section className="col-sec col-news-feat" aria-labelledby="col-news-latest">
            <div className="col-news-feat-in">
              <div className="col-news-board-move">
                <div className="col-news-board">
                  <svg className="col-news-bclip" viewBox="0 0 160 84" aria-hidden="true" focusable="false">
                    <path className="col-news-bclip-wire" d="M42 40 C 40 4, 120 4, 118 40" />
                    <rect className="col-news-bclip-plate" x="14" y="30" width="132" height="46" rx="9" />
                    <path className="col-news-bclip-bend" d="M14 52 H 146" />
                    <circle className="col-news-bclip-rivet" cx="42" cy="41" r="4" />
                    <circle className="col-news-bclip-rivet" cx="118" cy="41" r="4" />
                  </svg>
                  <div className="col-news-sheet">
                    <h2 id="col-news-latest" className="col-news-sheet-h">
                      <span className="col-news-kick">Latest issue</span>
                      <span className="col-news-sheet-title">{titleOf(latest)}</span>
                    </h2>
                    {latest.date ? <p className="col-news-sheet-date">{latest.date}</p> : null}
                    {latest.url
                      ? <Button href={latest.url} external className="col-news-read">Read newsletter <span aria-hidden="true">&#x2197;</span></Button>
                      : <p className="col-news-nofile">File not available</p>}
                  </div>
                </div>
              </div>
              <StatRow className="col-news-count" items={[{ value: all.length, label: all.length === 1 ? 'issue' : 'issues' }]} />
            </div>
          </section>

          {/* ══ every issue, by month ══ */}
          {all.length > 1 ? (
            <section className="col-sec col-news-arch" aria-labelledby="col-news-all">
              <SectionHead id="col-news-all" title="Every newsletter" kicker="Newest first" tint="azure" />
              {tools ? (
                <div className="col-news-tools">
                  <SearchField label="Search issues" value={query} onChange={setQuery} placeholder="Issue title" />
                  <ResultCount shown={shown} total={all.length} noun="issue" />
                  {showMonths ? (
                    <FilterGroup label="Filter by month" value={m} onChange={setMonth}
                      options={[{ value: '', label: 'All months' }, ...months]} />
                  ) : null}
                </div>
              ) : null}

              {shown === 0 ? (
                <EmptyState as="h3" title="No match"
                  message={'No issue' + (m ? ' from ' + m : '') + ' matches “' + q + '”.'}
                  action={<Button variant="ghost" onClick={clear}>Show every newsletter</Button>} />
              ) : groups.map((g) => (
                <div key={g.label} className="col-news-group">
                  <h3 className="col-news-month">{g.label}<Underline scroll /></h3>
                  <ul className="col-news-list">
                    {g.rows.map(({ n, i }) => {
                      const Card = n.url ? 'a' : 'div'
                      return (
                        <li key={i} className="col-news-item">
                          <div className="col-news-move">
                            <Card className="col-news-card"
                              {...(n.url ? { href: n.url, target: '_blank', rel: 'noopener noreferrer' } : null)}
                              style={{ '--col-r': TILT[i % 4] + 'deg', '--col-k': i % 2 ? -0.8 : 0.8 }}>
                              <svg className="col-news-clip" viewBox="0 0 26 62" aria-hidden="true" focusable="false"><path d={P.clip} /></svg>
                              {n === latest ? <Chip tone="gold" className="col-news-new">Latest</Chip> : null}
                              <span className="col-news-title">{titleOf(n)}</span>
                              {n.date ? <span className="col-news-date">{n.date}</span> : null}
                              {n.url ? (
                                <span className="col-news-cta">Read newsletter <span aria-hidden="true">&#x2197;</span><span className="col-sr"> (opens in a new tab)</span></span>
                              ) : <span className="col-news-nofile">File not available</span>}
                            </Card>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
