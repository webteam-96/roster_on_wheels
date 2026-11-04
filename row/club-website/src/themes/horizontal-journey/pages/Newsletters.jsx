'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · NEWSLETTERS — printed covers on the walk.
//
// A violet dusk hero (search + live count when the year has more than six
// issues). The latest issue stands on the hills of its own little dusk sky,
// swinging in from a tilt while the sun behind it sets as you scroll past;
// every other issue is a printed cover (the sample's gold / white covers: PDF
// tag, name + edition split, hills + sun art, date) grouped under month
// headings that open on a drawn hill line, with the month's short name as a
// giant outlined word drifting behind. Covers fan in, lift 10px on hover.
//
// Data and rules are Gold's (useNewslettersData = Newsletter.jsx buildItems:
// newest first, month labels, url = link or file). Search is Gold's (title,
// case-insensitive; month groups re-derived so none is left empty). While a
// search runs the "latest" block steps aside and the grid holds every match.
// Nothing is hidden in CSS; reduced motion shows the finished page.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useNewslettersData, externalUrl } from '../../_shared/data.js'
import { PageHero, SectionHead, SearchField, ResultCount, EmptyState, Loading, Button, Ridge, yearText, coverTitle } from '../kit.jsx'
import { useScene, afterFonts, gsap, titleIn, rise, parallax, fanIn } from '../motion.js'
import './Newsletters.css'

const SEARCH_FROM = 7   // Gold shows its search once a year has more than six issues

const isPdf = (u) => /\.pdf($|[?#])/i.test(String(u || ''))
// A typed link without a scheme would otherwise resolve inside this site; media paths are already absolute.
const hrefOf = (u) => (u && !String(u).startsWith('/') ? externalUrl(u) : u || '')

/**
 * One printed cover. A link (new tab) when the issue has a file or link;
 * `decor` = a mouse-only repeat of a real link nearby (aria-hidden, untabbable).
 */
function Cover({ nl, tone, latest, decor }) {
  const t = coverTitle(nl.title)
  const href = hrefOf(nl.url)
  const pdf = isPdf(nl.url)
  const cls = 'hj-nl-cv__box hj-nl-cv--' + tone
  const body = (
    <>
      <span className="hj-nl-cv__tag" aria-hidden="true">{pdf ? 'PDF' : 'Link'}</span>
      {latest ? <span className="hj-nl-cv__new" aria-hidden="true">Latest</span> : null}
      <span className={'hj-nl-cv__name' + (t.name.length > 22 ? ' is-long' : '')}>{t.name}</span>
      {t.ed ? <span className="hj-nl-cv__ed">{t.ed}</span> : null}
      <span className="hj-nl-cv__art" aria-hidden="true" />
      <span className="hj-nl-cv__date">
        {nl.date ? <span>{nl.date}</span> : <span />}
        {href ? <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 11 11 5M6 5h5v5" /></svg> : null}
      </span>
    </>
  )
  if (!href) return <div className={cls}>{body}</div>
  const label = (latest ? 'Latest issue: ' : '') + (nl.title || 'Newsletter') + (nl.date ? ', ' + nl.date : '') + (pdf ? ' (PDF, opens in a new tab)' : ' (opens in a new tab)')
  return (
    <a className={cls} href={href} target="_blank" rel="noopener noreferrer"
       {...(decor ? { 'aria-hidden': 'true', tabIndex: -1 } : { 'aria-label': label })}>
      {body}
    </a>
  )
}

export default function Newsletters({ data }) {
  const club = useClub()
  const items = useNewslettersData(data)            // null while loading, newest first
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  const n = items ? items.length : 0
  const latest = n ? items[0] : null
  const q = query.trim().toLowerCase()
  const searching = q !== ''

  // Month groups over what is shown: every match while searching, else the
  // back issues (the latest has its own block). Re-derived so no month
  // heading is ever left without a cover under it.
  const groups = useMemo(() => {
    const src = !items ? [] : q ? items.filter((x) => String(x.title || '').toLowerCase().indexOf(q) !== -1) : items.slice(1)
    const out = []
    for (const x of src) {
      const last = out[out.length - 1]
      if (!last || last.label !== x.monthLabel) out.push({ label: x.monthLabel, abbr: x.monAbbr, rows: [x] })
      else last.rows.push(x)
    }
    return out
  }, [items, q])
  const matched = searching ? groups.reduce((s, g) => s + g.rows.length, 0) : n

  // The latest cover swings in from a tilt while its title rises; the sun
  // behind it sets as you scroll by. Each month's title rises out of the skew,
  // its outlined month word drifts, and its covers fan in. While searching the
  // results appear as they are (typing must not replay a show).
  useScene(ref, (c, ctx) => afterFonts(ctx, () => {
    const root = ref.current
    const lead = root.querySelector('.hj-nl-lead')
    if (lead) {
      const st = { trigger: lead, start: 'top 82%', once: true }
      titleIn(lead.querySelector('.hj-nl-lead__t'), { trigger: lead, start: 'top 82%', scrub: false })
      gsap.fromTo(lead.querySelector('.hj-nl-lead__cv'),
        { rotation: -16, xPercent: 34, yPercent: 16, opacity: 0 },
        { rotation: 0, xPercent: 0, yPercent: 0, opacity: 1, duration: 1.4, ease: 'expo.out', clearProps: 'transform,opacity', scrollTrigger: st })
      rise(lead.querySelectorAll('.hj-nl-lead__k, .hj-nl-lead__meta, .hj-nl-lead__go'), lead, { stagger: 0.08, start: 'top 82%' })
      parallax(lead.querySelector('.hj-nl-lead__sun'), { from: -20, to: 120, trigger: lead })
    }
    titleIn(root.querySelector('.hj-nl-arch .hj-h2'), { start: 'top 92%', scrub: false })
    if (searching) return
    root.querySelectorAll('.hj-nl-mo').forEach((g) => {
      titleIn(g.querySelector('.hj-nl-mo__t'), { start: 'top 92%', scrub: false })
      parallax(g.querySelector('.hj-nl-mo__big'), { from: 0, to: -14, prop: 'xPercent', trigger: g })
      fanIn(g.querySelectorAll('.hj-nl-cv'))
    })
  }), [items, searching])

  const clear = () => {
    setQuery('')
    const input = ref.current && ref.current.querySelector('.hj-search input')
    if (input) input.focus()
  }

  const yl = yearText(club.selectedYearLabel)
  const leadHref = latest ? hrefOf(latest.url) : ''
  const leadMeta = latest ? [latest.date, yl ? 'Rotary year ' + yl : ''].filter(Boolean).join(' · ') : ''
  const archTitle = searching ? 'Search results' : 'Back issues'

  return (
    <div ref={ref} className="hj-page hj-ground--cream hj-endpad hj-nl">
      <PageHero tone="violet" title="Newsletters">
        {n > 0 ? (
          <div className="hj-nl-find">
            {n >= SEARCH_FROM ? <SearchField value={query} onChange={setQuery} label="Search newsletters by title" placeholder="Search issues…" /> : null}
            <ResultCount count={matched} total={n} noun="issue" />
          </div>
        ) : null}
      </PageHero>

      {items === null ? (
        <div className="hj-wrap hj-sec"><Loading label="Loading newsletters" /></div>
      ) : n === 0 ? (
        <div className="hj-wrap hj-sec">
          <EmptyState title="No newsletters yet"
                      message={'Issues of the club bulletin' + (yl ? ' for ' + yl : '') + ' will appear here once they are published. Earlier issues may be under another Rotary year in the year menu.'} />
        </div>
      ) : (
        <>
          {!searching && latest ? (
            <section className="hj-wrap hj-sec hj-nl-lead" aria-labelledby="hj-nl-lead-t">
              <div className="hj-nl-lead__sky">
                <span className="hj-stars" aria-hidden="true" />
                <span className="hj-nl-lead__sun" aria-hidden="true" />
                <div className="hj-nl-lead__hills" aria-hidden="true">
                  <Ridge preset="far" />
                  <Ridge preset="near" seed={0.7} className="hj-rg--ground" />
                </div>
                {/* the button beside it is the accessible way in; the cover repeats it for the mouse */}
                <div className="hj-nl-lead__cv"><Cover nl={latest} tone={0} decor /></div>
              </div>
              <div className="hj-nl-lead__txt">
                <p className="hj-kicker hj-nl-lead__k">Latest issue</p>
                <h2 key={latest.title} id="hj-nl-lead-t" className="hj-nl-lead__t">{latest.title || 'Newsletter'}</h2>
                {leadMeta ? <p className="hj-nl-lead__meta">{leadMeta}</p> : null}
                {leadHref ? (
                  <p className="hj-nl-lead__go">
                    <Button href={leadHref} external icon="out">
                      {isPdf(latest.url) ? 'Read this issue' : 'Open this issue'}
                      {isPdf(latest.url) ? <span className="hj-sr">, PDF</span> : null}
                    </Button>
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {searching || n > 1 ? (
            <section className="hj-wrap hj-sec hj-nl-arch" aria-labelledby="hj-nl-arch-t">
              <SectionHead key={archTitle} k={searching ? 'Search' : 'The archive'} title={archTitle} id="hj-nl-arch-t" />
              {matched === 0 ? (
                <EmptyState title={'No issue matches “' + query.trim() + '”'} message="Try another word from the title."
                            action={<Button variant="ink" size="sm" onClick={clear}>Clear search</Button>} />
              ) : groups.map((g) => (
                <div className="hj-nl-mo" key={g.label}>
                  <div className="hj-nl-mo__hd">
                    {g.abbr ? <span className="hj-nl-mo__big" aria-hidden="true">{g.abbr}</span> : null}
                    <h3 key={g.label} className="hj-nl-mo__t">{g.label}</h3>
                    <p className="hj-nl-mo__n">{g.rows.length} {g.rows.length === 1 ? 'issue' : 'issues'}</p>
                  </div>
                  <div className="hj-nl-mo__line" aria-hidden="true">
                    <Ridge preset="pnFar" seed={g.label.length * 0.37} fill="rgba(144,31,147,.08)" rim="rgba(144,31,147,.5)" />
                  </div>
                  <ul className="hj-nl-grid">
                    {g.rows.map((x, i) => (
                      <li className="hj-nl-cv" key={i + '|' + x.title}>
                        <Cover nl={x} tone={i % 2} latest={x === latest} />
                      </li>
                    ))}
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
