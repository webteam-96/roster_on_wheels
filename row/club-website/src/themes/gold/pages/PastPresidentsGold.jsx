'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · PAST PRESIDENTS — the spine.
//
// A roll of honour is inherently CHRONOLOGICAL, so it is drawn that way: a gold
// spine down the page with each Rotary year hung off it, alternating sides on
// wide screens and stacking to one side on phones. The year leads — it is what
// anyone scanning this page is actually looking for — and the medallion portrait
// follows it.
//
// Which years appear is not this page's decision: usePastPresidentsGold applies
// the same "strictly before the selected year" rule the shared page does, so
// the sitting president never shows up in their own roll of honour.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { usePastPresidentsGold, initials } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

export default function PastPresidentsGold({ data }) {
  const club = useClub()
  const list = usePastPresidentsGold(data)
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Past Presidents')

  const [query, setQuery] = useState('')
  const all = list || []
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) => (p.name + ' ' + p.year).toLowerCase().indexOf(q) !== -1)
  }, [all, query])

  useRotaryAnim([list, shown.length])
  useRevealReplay('gpp-page', [list, shown.length])

  return (
    <div className="gpp-page">

      {/* ══ 01 · Masthead — the count of years IS the headline fact ══ */}
      <GPageHead
        crumbs={[{ label: menuName || 'Past Presidents' }]}
        eyebrow="Roll of honour"
        title="Past presidents"
        sub={(
          <>
            <b>{all.length}</b> years of leadership
            {club.selectedYearLabel ? ' recorded before ' + club.selectedYearLabel : ''}.
          </>
        )}
        aside={all.length > 4 ? (
          <div className="gp-head__find">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            {/* Live filter; Enter must not submit. */}
            <input type="text" value={query} autoComplete="off"
                   aria-label="Search past presidents by name or year"
                   placeholder="Search by name or year…"
                   onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
          </div>
        ) : null}
      />

      {/* ══ 02 · The spine ══ */}
      <section className="gpp-body">
        <div className="gld-x">
          {list === null ? null : shown.length === 0 ? (
            <GEmpty
              title={all.length === 0 ? 'No roll of honour yet' : 'No match'}
              message={all.length === 0
                ? 'Past presidents for the years before this one will appear here once the club files them.'
                : 'Nobody on the roll of honour matches “' + query.trim() + '”.'}
              action={all.length > 0 ? (
                <button type="button" className="gld-btn gld-btn--ghost" onClick={() => setQuery('')}>
                  Clear search <Arrow />
                </button>
              ) : null}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" /></svg>}
            />
          ) : (
            <div className="gpp-line">
              {shown.map((p, i) => (
                <div className="gpp-item reveal" key={p.year + p.name + i} style={{ '--r': i + 1 }}>
                  <div className="gpp-card">
                    {/* Monogram underneath, portrait on top — a photo that 404s
                        uncovers the initials instead of the ring's gold fill. */}
                    <span className="gpp-med" aria-hidden="true">
                      <i>{initials(p.name)}</i>
                      {p.img && <img src={p.img} alt="" loading="lazy" onError={hideOnError} />}
                    </span>
                    <div className="gpp-card__b">
                      <div className="gpp-card__y">{p.year}</div>
                      <h3 className="gpp-card__n">{p.name}</h3>
                      <p className="gpp-card__r">President</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  )
}
