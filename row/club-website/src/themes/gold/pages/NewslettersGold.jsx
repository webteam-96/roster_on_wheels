'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · NEWSLETTERS — the reading room.
//
// One issue is CURRENT and the rest are an archive, and a grid of identical
// cards says neither. So the page says both explicitly: the latest issue gets a
// navy spread with a paper cover plate, and everything else becomes a CONTENTS
// PAGE — month captions, ruled rows, dotted leaders running out to the date.
// That is what a bound volume of back issues actually looks like, and it scans
// a hundred issues far better than a hundred tiles.
//
// Ordering, the "all issues for this year" cap and the month grouping come from
// Newsletter.jsx's buildItems, shared verbatim.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useClub } from '@/site/ClubContext.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useNewslettersGold } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay } from './kit.jsx'

const PDF_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
  </svg>
)

export default function NewslettersGold({ data }) {
  const club = useClub()
  const items = useNewslettersGold(data)
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Newsletters')

  const [query, setQuery] = useState('')
  const all = items || []
  const latest = all.length > 0 ? all[0] : null

  // Filtering re-derives the month captions rather than hiding rows under a
  // caption that no longer has any: a search leaving "JUNE 2026" with nothing
  // beneath it is the bug the shared page has to patch around in script.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []
    for (const n of all) {
      if (q && String(n.title || '').toLowerCase().indexOf(q) === -1) continue
      const last = out[out.length - 1]
      if (!last || last.label !== n.monthLabel) out.push({ label: n.monthLabel, rows: [n] })
      else last.rows.push(n)
    }
    return out
  }, [all, query])

  const matchedCount = groups.reduce((n, g) => n + g.rows.length, 0)

  useRotaryAnim([items, matchedCount])
  useRevealReplay('gnl-page', [items, matchedCount])

  return (
    <div className="gnl-page">

      {/* ══ 01 · Masthead — the standard band ══ */}
      {/* The sub line only claims an archive once there is one; while the feed
          is still loading (items === null) `all` is empty too, so it stays off
          rather than promising issues that may not exist. */}
      <GPageHead
        crumbs={[{ label: menuName || 'Newsletters' }]}
        eyebrow="Club bulletin"
        title={menuName && menuName.trim() ? menuName : 'Newsletters'}
        sub={all.length > 0 ? 'Every issue the club has filed, newest first.' : null}
      />

      {/* ══ 02 · On the stand now ══ */}
      {/* The guard is on the SECTION, not inside it: this band is navy, so while
          the feed is still loading an empty one painted a bare dark slab under
          the masthead. */}
      {items !== null && (
      <section className="gnl-feature">
        <div className="gld-x">
          {latest ? (
            <div className="gnl-feature__in">
              <div className="reveal">
                <p className="gnl-feature__e">Current issue</p>
                <h2 className="gnl-feature__t">{latest.title}</h2>
                <p className="gnl-feature__d">
                  {club.clubDisplayName}
                  {latest.date ? ' · ' + latest.date : ''}
                  {club.selectedYearLabel ? ' · ' + club.selectedYearLabel : ''}
                </p>
                <a href={latest.url} target="_blank" rel="noopener noreferrer" className="gld-btn gld-btn--gold">
                  Read this issue <Arrow />
                </a>
              </div>
              {/* The cover plate is decorative — the real link is the button, and
                  the plate repeats it rather than being the only way in. */}
              <a className="gnl-plate reveal" href={latest.url} target="_blank" rel="noopener noreferrer"
                 aria-label={'Open ' + latest.title}>
                <span className="gnl-plate__k">Newsletter</span>
                <span className="gnl-plate__t">{latest.title}</span>
                <span className="gnl-plate__r" aria-hidden="true" />
              </a>
            </div>
          ) : (
            <div>
              <p className="gnl-feature__e">Newsletters</p>
              <h2 className="gnl-feature__t">Nothing published yet</h2>
              <p className="gnl-feature__d">
                Issues of this club&rsquo;s bulletin will appear here as they are filed
                {club.selectedYearLabel ? ' for ' + club.selectedYearLabel : ''}.
              </p>
            </div>
          )}
        </div>
      </section>
      )}

      {/* ══ 03 · The contents page ══ */}
      {all.length > 0 && (
        <section className="gnl-body">
          <div className="gld-x">
            <div className="gld-shead reveal">
              <div className="gld-shead__main">
                <p className="gld-shead__e">The archive</p>
                <h2 className="gld-shead__t">
                  <span className="gld-w" style={{ '--wi': 0 }}><span>Back</span></span>{' '}
                  <span className="gld-w gld-w--em" style={{ '--wi': 1 }}><span>issues</span></span>
                </h2>
                <span className="gld-shead__r" aria-hidden="true" />
              </div>
              {all.length > 6 && (
                <div className="gp-head__find" style={{ width: '320px', flex: '0 1 320px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input type="text" value={query} autoComplete="off"
                         aria-label="Search issues by title" placeholder="Search issues…"
                         onChange={(e) => setQuery(e.target.value)}
                         onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
                </div>
              )}
            </div>

            {matchedCount === 0 ? (
              <GEmpty title="No match"
                      message={'No issue matches “' + query.trim() + '”.'}
                      action={<button type="button" className="gld-btn gld-btn--ghost" onClick={() => setQuery('')}>Clear search <Arrow /></button>}
                      icon={PDF_ICON} />
            ) : (
              <div className="gnl-index">
                {groups.map((g) => (
                  <div key={g.label}>
                    <p className="gnl-group">{g.label}<span aria-hidden="true" /></p>
                    {g.rows.map((n, i) => (
                      <a className="gnl-row" key={n.title + i} href={n.url} target="_blank" rel="noopener noreferrer">
                        <span className="gnl-row__t">{n.title}</span>
                        {n === latest && <span className="gnl-badge">Latest</span>}
                        <span className="gnl-row__lead" aria-hidden="true" />
                        <span className="gnl-row__d">{n.date}</span>
                        <span className="gnl-row__go" aria-hidden="true"><Arrow /></span>
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

    </div>
  )
}
