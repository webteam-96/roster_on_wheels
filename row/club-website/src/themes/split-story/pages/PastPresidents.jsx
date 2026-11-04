'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Past presidents — laid out like the Directory (client, 2026-10-27:
// "too much space, keep the same design like Directory"). One chapter per decade,
// newest first: a big decade mark, then a grid of the Directory's person cards
// (photo or initials, Rotary year, name). The sticky panel shows the decade with
// its head-count and the years it spans. The earliest president on the roll is
// marked — as the charter president when the club's About text agrees.
// WHICH years appear is the hook's rule (strictly before the selected year).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, usePastPresidentsData, useAboutData, usePageTitle, useCurrentMenuName } from '../../_shared/data.js'
import { PageHero, Split, Chapter, PersonCard, Button, SearchField, ResultCount, EmptyState, Loading, charterYear, yearText } from '../kit.jsx'
import { useScene, useRefreshOnImages, revealBatch, titleOnScroll } from '../motion.js'
import './Directory.css'
import './PastPresidents.css'

const OTHER_T = 'Other years'
const yr = yearText
const trim = (s) => String(s || '').trim()

export default function PastPresidents({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Past presidents'
  usePageTitle(title)
  const list = usePastPresidentsData(data)          // null while loading; newest first, unparseable years last
  const about = useAboutData(data)                  // the charter year
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  const all = list || []
  const selYear = yr(club.selectedYearLabel)

  // The earliest year on the roll is marked; "Charter president" only when the About text agrees.
  const charter = useMemo(() => charterYear(about.html), [about.html])
  const parsed = all.filter((p) => p.y !== null)
  const firstY = parsed.length ? parsed[parsed.length - 1].y : null
  const firstMark = firstY === null ? '' : charter && (firstY === charter || firstY === charter - 1) ? 'Charter president' : 'Earliest on record'

  // Gold's live filter: name or year label.
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => (q ? all.filter((p) => (p.name + ' ' + p.year).toLowerCase().indexOf(q) !== -1) : all), [all, q])

  // One chapter per decade, newest first (the hook's order keeps each decade contiguous).
  const groups = useMemo(() => {
    const out = []
    shown.forEach((p) => {
      const t = p.y === null ? OTHER_T : Math.floor(p.y / 10) * 10 + 's'
      const g = out[out.length - 1]
      if (g && g.title === t) g.rows.push(p)
      else out.push({ title: t, id: 'spl-pp-' + (p.y === null ? 'other' : Math.floor(p.y / 10) * 10), rows: [p] })
    })
    return out
  }, [shown])

  const key = [club.selectedYearId, firstMark, shown.map((p) => p._i).join(',')].join('|')
  const loading = list === null || about.loading

  useRefreshOnImages(ref, [key, loading])
  // the Directory's motion: cards fade up in batches, the decade marks rise once
  useScene(ref, (c, ctx) => {
    const r = ref.current
    revealBatch(r.querySelectorAll('.spl-dir-grid > li'), { y: 30, stagger: 0.05 })
    r.querySelectorAll('.spl-dir-mark > span').forEach((el) => titleOnScroll(ctx, el))
  }, [key, loading])

  const clear = () => {
    setQuery('')
    const el = document.getElementById('spl-pp-search')
    if (el) el.focus()
  }

  const span = (rows) => {
    const a = yr(rows[0].year), b = yr(rows[rows.length - 1].year)
    return rows.length > 1 && a !== b ? [a, b].filter(Boolean).join(' – ') : a
  }

  return (
    <div className="spl-dir spl-pp" ref={ref}>
      <PageHero title={title} eyebrow="Roll of honour"
                lead={parsed.length > 1 ? 'From ' + yr(parsed[0].year) + ' back to ' + yr(parsed[parsed.length - 1].year) + ', newest first.' : null}
                stat={!loading && all.length ? { value: all.length, label: all.length === 1 ? 'Past president' : 'Past presidents' } : null}>
        {all.length > 4 ? (
          <div className="spl-pp-find">
            <SearchField id="spl-pp-search" label="Search past presidents" placeholder="Name or year" value={query} onChange={setQuery} />
            <ResultCount count={shown.length} total={all.length} noun={['past president', 'past presidents']} />
          </div>
        ) : null}
      </PageHero>

      {loading ? (
        <section className="spl-section"><div className="spl-x"><Loading label="Loading the roll of honour" /></div></section>
      ) : all.length === 0 ? (
        <section className="spl-section"><div className="spl-x">
          <EmptyState title="No roll of honour yet"
                      message={'Past presidents for the years before ' + (selYear || 'this one') + ' will appear here once the club adds them.'} />
        </div></section>
      ) : shown.length === 0 ? (
        <section className="spl-section"><div className="spl-x">
          <EmptyState title="No match" message={'Nobody on the roll of honour matches “' + query.trim() + '”.'}
                      action={<Button variant="royal" arrow={false} onClick={clear}>Clear search</Button>} />
        </div></section>
      ) : (
        <Split rail={groups.map((g) => g.title)} deps={[key]} className="spl-dir-split spl-pp-split">
          {groups.map((g) => (
            <Chapter key={g.id} id={g.id} title={g.title} className="spl-dir-ch"
                     state={{ value: g.rows.length, fmt: 'plain', suffix: g.rows.length === 1 ? ' president' : ' presidents', caption: span(g.rows) }}>
              <p className="spl-dir-mark" aria-hidden="true"><span>{g.title}</span></p>
              <ul className="spl-grid spl-dir-grid">
                {g.rows.map((p) => {
                  const mark = p.y !== null && p.y === firstY ? firstMark : ''
                  return (
                    <li key={p._i}>
                      <PersonCard name={trim(p.name) || 'Name not recorded'} img={p.img}
                                  role={[yr(p.year), mark].filter(Boolean).join(' · ')} />
                    </li>
                  )
                })}
              </ul>
            </Chapter>
          ))}
        </Split>
      )}
    </div>
  )
}
