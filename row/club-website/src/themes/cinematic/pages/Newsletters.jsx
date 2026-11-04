'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · NEWSLETTERS — the press kit.
//
// The latest newsletter premieres: its royal panel opens like a projector (slit
// of light to full frame) with a clapperboard slate that snaps shut on its
// date. The rest of the year is the archive, one reel per month: the month's
// caption rises out of its line and its tiles wipe open from the bottom edge.
// Wording is "newsletter" throughout, never "issue" (client, 2026-09-25).
// A search (long runs only, as Gold) re-cuts the whole list, latest included.
//
// Data, ordering and month grouping are Gold's (useNewslettersData ->
// buildItems): { title, date 'dd MMM yyyy' | '', url, monthLabel }.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useNewslettersData } from '../../_shared/data.js'
import {
  usePageName, PageHero, SectionHead, PanelCard, Button, DateStamp, Pill, SearchField, ResultCount,
  EmptyState, Loading, Arrow, clubNames, yearText,
} from '../kit.jsx'
import { useScene, afterFonts, gsap, projectorOpen, wipeIn, titleIn, cleanups, EXPO } from '../motion.js'
import './Newsletters.css'

const isPdf = (url) => /\.pdf($|[?#])/i.test(url || '')
const nameOf = (n) => String(n.title || '').trim() || 'Newsletter'
const stampOf = (n) => {
  const [day, mon, year] = n.date ? n.date.split(' ') : []
  return day ? <DateStamp day={day} mon={mon} year={year} /> : null
}

function ReadButton({ n, ...rest }) {
  // the file type is told to screen readers only; no visible "PDF" tag (client)
  return (
    <Button href={n.url} external {...rest}>
      Read newsletter<span className="cin-sr">: {nameOf(n)}{isPdf(n.url) ? ', PDF' : ''}</span>
    </Button>
  )
}

export default function Newsletters({ data }) {
  const club = useClub()
  const title = usePageName('Newsletters')
  const items = useNewslettersData(data)             // null while loading, newest first
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  const all = items || []
  const latest = all[0] || null
  const q = query.trim().toLowerCase()
  const yearLabel = yearText(club.selectedYearLabel)

  // No search: the latest has the feature, the archive is everything after it.
  // Searching: every matching newsletter, latest included - month captions are
  // re-derived so none is left standing over an empty month (Gold's rule).
  const shown = useMemo(() => (q ? all.filter((n) => String(n.title || '').toLowerCase().indexOf(q) !== -1) : all.slice(1)), [all, q])
  const groups = useMemo(() => {
    const out = []
    shown.forEach((n) => {
      const last = out[out.length - 1]
      if (last && last.label === n.monthLabel) last.rows.push(n)
      else out.push({ label: n.monthLabel, rows: [n] })
    })
    return out
  }, [shown])

  const sig = all.map((n) => n.url + '|' + n.date).join(',')
  useScene(ref, (c, ctx) => {
    const off = cleanups()
    const root = ref.current
    const feat = root.querySelector('.cin-nl-feature')
    if (feat) {
      const tl = gsap.timeline({ delay: 0.3 })
      tl.add(projectorOpen(feat, { duration: 1.3 }), 0)
      tl.from(feat.querySelectorAll('.cin-nl-feature__txt > *'), {
        y: 30, opacity: 0, duration: 0.9, ease: EXPO, stagger: 0.08, clearProps: 'transform,opacity',
      }, 0.55)
      const clap = feat.querySelector('.cin-nl-slate__clap')
      if (clap) tl.fromTo(clap, { rotation: -12 }, { rotation: 0, duration: 0.45, ease: 'power4.in', clearProps: 'transform' }, 0.95)
    }
    root.querySelectorAll('.cin-nl-grid').forEach((g) => wipeIn(g.children, { trigger: g }))
    off(afterFonts(ctx, () => root.querySelectorAll('.cin-nl-month__t').forEach((h) => titleIn(h))))
    return off.run
  }, [sig, q])

  return (
    <div className="cin-nl">
      <PageHero
        title={title}
        meta={all.length ? (
          <>
            {all.length > 6 ? <SearchField value={query} onChange={setQuery} label="Search newsletters by title" placeholder="Search newsletters" /> : null}
            <ResultCount count={q ? shown.length : all.length} total={all.length} noun="newsletter" />
          </>
        ) : null}
      />

      {items === null ? <Loading label="Loading newsletters" /> : all.length === 0 ? (
        <div className="cin-sec">
          <EmptyState title="No newsletters published yet"
            message={'The club’s newsletters will appear here as they are published' + (yearLabel ? ' for ' + yearLabel : '') + '.'} />
        </div>
      ) : (
        <div className="cin-nl-body" ref={ref}>
          {!q ? (
            <section className="cin-sec cin-nl-lead" aria-labelledby="cin-nl-lead-h">
              <h2 className="cin-nl-kicker" id="cin-nl-lead-h">Latest newsletter</h2>
              <article className="cin-panel cin-nl-feature" key={latest.url + latest.title}>
                <div className="cin-nl-feature__txt">
                  <h3 className="cin-nl-feature__t">{nameOf(latest)}</h3>
                  <p className="cin-nl-feature__by">
                    {clubNames(club.clubDisplayName).full}{yearLabel ? ' · ' + yearLabel : ''}
                  </p>
                  <div className="cin-nl-feature__foot">
                    {latest.url ? <ReadButton n={latest} /> : <span className="cin-nl-type">No file attached</span>}
                  </div>
                </div>
                {latest.date ? (
                  <div className="cin-nl-slate">
                    <span className="cin-nl-slate__clap" aria-hidden="true" />
                    <p className="cin-nl-slate__l">Published</p>
                    {stampOf(latest)}
                  </div>
                ) : null}
              </article>
            </section>
          ) : null}

          {groups.length ? (
            <section className="cin-sec cin-nl-arch" aria-labelledby="cin-nl-arch-h">
              <SectionHead id="cin-nl-arch-h" title={q ? 'Matching newsletters' : 'Past newsletters'} />
              {groups.map((g) => (
                <div className="cin-nl-group" key={g.label}>
                  <div className="cin-nl-month">
                    <h3 className="cin-nl-month__t">{g.label}</h3>
                    <span className="cin-nl-month__rule" aria-hidden="true" />
                  </div>
                  <ul className="cin-nl-grid">
                    {g.rows.map((n, i) => (
                      <PanelCard key={n.url + '|' + i} as="li" level={4} className="cin-nl-tile" title={nameOf(n)}
                        kicker={stampOf(n)}
                        foot={n.url ? <ReadButton n={n} variant="line" small magnet={false} className="cin-nl-tile__go" />
                          : <span className="cin-nl-type">No file attached</span>}>
                        {n === latest ? <Pill className="cin-nl-latest">Latest</Pill> : null}
                      </PanelCard>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : q ? (
            <div className="cin-sec">
              <EmptyState title={'No newsletter matches “' + query.trim() + '”'} message="The search looks at newsletter titles. Check the spelling, or try a shorter word."
                action={<Button variant="line" onClick={() => setQuery('')}>Show all newsletters <Arrow /></Button>} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
