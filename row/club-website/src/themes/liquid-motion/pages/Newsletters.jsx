'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · NEWSLETTERS — "on the stand".
// The ink breadcrumb band carries the menu label. Then ONE gold band (the home's
// newsletter band, continued): the latest issue set huge - its title rising in,
// its day rolling like an odometer (no text behind it, client 2026-09-29) - and
// the back issues as the home's
// liquid-fill rows (an ink flood starts where the pointer enters). Long years
// (> 8 back issues) group by month with the month label sticking on desktop.
// Data: useNewslettersData() only (Newsletter.jsx buildItems: newest first,
// {title, date, url, monthLabel, dayNum, monAbbr}). Search matches Gold (> 6 issues).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useCurrentMenuName, usePageTitle, useNewslettersData } from '../../_shared/data.js'
import {
  PageHero, Band, Pill, RowLink, EmptyState, Loading, Odometer, Chars, SearchField, ResultCount,
  clean, longestWord, yearText,
} from '../kit.jsx'
import { usePageMotion, useScene, gsap, titleIn } from '../motion.js'
import './Newsletters.css'

const titleOf = (n) => clean(n.title) || 'Newsletter'
const action = (url) => (/\.pdf($|[?#])/i.test(url) ? 'PDF' : 'Open')

/** One archive row: the kit's liquid-fill link, or a quiet non-link row when the issue has no file. */
function Issue({ n, latest }) {
  const meta = [n.date, latest ? 'Latest' : ''].filter(Boolean).join(' · ')
  if (!n.url) {
    return (
      <div className="liq-row liq-nws-off">
        <span className="liq-row__t">{titleOf(n)}</span>
        {meta ? <span className="liq-row__m">{meta}</span> : null}
        <span className="liq-row__go">No file</span>
      </div>
    )
  }
  return <RowLink href={n.url} external title={titleOf(n)} meta={meta} action={action(n.url)} />
}

function Rows({ list, latest }) {
  return (
    <ul className="liq-rows">
      {list.map((n, i) => <li className="liq-rv" key={(n.url || n.title) + i}><Issue n={n} latest={n === latest} /></li>)}
    </ul>
  )
}

export default function Newsletters({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Newsletters'
  usePageTitle(title)

  const items = useNewslettersData(data) // null while loading
  const [q, setQ] = useState('')
  const all = items || []
  const latest = all[0] || null
  // the field shows only above 6 issues; a year switch to a short list must not keep an unclearable filter
  const query = all.length > 6 ? q.trim().toLowerCase() : ''

  // searching lists every match (latest included); otherwise the latest is the feature and the rest follow
  const list = useMemo(() => (query
    ? all.filter((n) => String(n.title || '').toLowerCase().includes(query))
    : all.slice(1)), [items, query]) // eslint-disable-line react-hooks/exhaustive-deps
  // month groups (re-derived after filtering, so no caption is left without rows)
  const groups = useMemo(() => {
    const out = []
    for (const n of list) {
      const last = out[out.length - 1]
      if (last && last.label === n.monthLabel) last.rows.push(n)
      else out.push({ label: n.monthLabel, rows: [n] })
    }
    return out
  }, [list])
  const grouped = list.length > 8 && groups.length > 1

  const ref = useRef(null)
  usePageMotion(ref, [items, query])
  // the moment: the latest title's chars rise and unfold as the gold band arrives
  useScene(ref, () => {
    const t = ref.current.querySelector('.liq-nws-feat__t')
    if (!t) return
    titleIn(t, { tl: gsap.timeline({ scrollTrigger: { trigger: t, start: 'top 90%', once: true } }), at: 0 })
  }, [items, !!query])

  const lt = latest ? titleOf(latest) : ''
  const lw = longestWord(lt)
  const year = latest && latest.date ? latest.date.split(' ')[2] || '' : ''
  const yr = yearText(club.selectedYearLabel)

  return (
    <div className="liq-nws" ref={ref}>
      <PageHero title={title}>
        {all.length ? (
          <div className="liq-nws-tools">
            {all.length > 6 ? <SearchField label="Search issues by title" value={q} onChange={setQ} placeholder="Search issues" /> : null}
            <ResultCount count={query ? list.length : all.length} total={all.length} one="issue" many="issues" />
          </div>
        ) : null}
      </PageHero>

      {items === null ? (
        <Band tone="paper"><Loading label="Loading newsletters" /></Band>
      ) : !all.length ? (
        <Band tone="paper">
          <EmptyState title={'No newsletters' + (yr ? ' for ' + yr : '') + ' yet'}
                      text="Issues of the club’s bulletin will appear here as they are published."
                      action={<Pill href="/" variant="ink" back>Back to home</Pill>} />
        </Band>
      ) : (
        <Band tone="gold" className="liq-nws-band" aria-label="Issues">
          {!query ? (
            <section className="liq-nws-feat" aria-labelledby="liq-nws-latest-h">
              <h2 className="liq-kicker liq-rv" id="liq-nws-latest-h">Latest issue</h2>
              <div className="liq-nws-feat__grid">
                {latest.date ? (
                  <p className="liq-nws-plate liq-rv">
                    <span className="liq-nws-plate__d"><Odometer value={latest.dayNum} /></span>
                    <span className="liq-nws-plate__m">{latest.monAbbr} {year}</span>
                  </p>
                ) : null}
                <div className="liq-nws-feat__main">
                  {/* Chars keep words whole, so only titles whose longest word fits the fit get them */}
                  <h3 className={'liq-nws-feat__t' + (lt.length > 40 ? ' liq-nws-feat__t--long' : '')} style={{ '--liq-lw': Math.min(lw, 16) }}>
                    {lw <= 16 ? <Chars text={lt} /> : lt}
                  </h3>
                  <p className="liq-nws-feat__by liq-rv">{club.clubDisplayName}</p>
                  <div className="liq-nws-feat__act liq-rv">
                    {latest.url
                      ? <Pill href={latest.url} variant="ink" external>{action(latest.url) === 'PDF' ? 'Read this issue (PDF)' : 'Read this issue'}</Pill>
                      : <p className="liq-nws-feat__none">No file is attached to this issue yet.</p>}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {list.length ? (
            <section className="liq-nws-arch" aria-labelledby="liq-nws-arch-h">
              <h2 className="liq-kicker liq-rv" id="liq-nws-arch-h">{query ? 'Matching issues' : 'Back issues'}</h2>
              {grouped ? groups.map((g) => (
                <div className="liq-nws-group" key={g.label}>
                  <h3 className="liq-nws-month liq-rv">
                    {g.label}{' '}<span className="liq-nws-month__n">{g.rows.length} {g.rows.length === 1 ? 'issue' : 'issues'}</span>
                  </h3>
                  <Rows list={g.rows} latest={latest} />
                </div>
              )) : <Rows list={list} latest={latest} />}
            </section>
          ) : query ? (
            <EmptyState title={'No issue matches “' + q.trim() + '”'} text="Try another word from the title."
                        action={<Pill variant="ink" icon={false} onClick={() => setQ('')}>Clear search</Pill>} />
          ) : null}
        </Band>
      )}
    </div>
  )
}
