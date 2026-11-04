'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · DIRECTORS — the board plate.
//
// A board is not a flat set of peers, and the API already tells us so: rows come
// back with the club's OWN designation order, President first. The page honours
// that instead of flattening it — the two principals get large plates, and the
// rest of the board follows as a numbered ledger of ringed portraits. The number
// is the club's order, not an arbitrary index.
//
// The search moved up into the masthead (user's call), so the plates now have
// the row to themselves and the page's one control is where you look first.
//
// The conic gold ring is the same device the home page's dignitary deck uses, so
// this reads as the same site even though nothing about the layout matches.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useDirectorsGold, initials, plainText } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay, portraitFallback, isPlaceholderPhoto } from './kit.jsx'

/** The two offices that lead the plate row, in this order. A club that files
 *  neither simply gets the ledger — nothing is invented to fill the space. */
const LEAD = ['president', 'secretary']

export default function DirectorsGold({ data }) {
  const club = useClub()
  const directors = useDirectorsGold(data)
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Directors')

  const [query, setQuery] = useState('')

  const { leads, rest } = useMemo(() => {
    const all = directors || []
    const taken = new Set()
    const leads = []
    for (const kw of LEAD) {
      const idx = all.findIndex((d, i) => !taken.has(i)
        && String(d.role || '').toLowerCase().indexOf(kw) >= 0)
      if (idx >= 0) { taken.add(idx); leads.push(all[idx]) }
    }
    return { leads, rest: all.filter((_, i) => !taken.has(i)) }
  }, [directors])

  const q = query.trim().toLowerCase()
  const shown = q
    ? rest.filter((d) => (d.name + ' ' + d.role).toLowerCase().indexOf(q) !== -1)
    : rest

  useRotaryAnim([directors, shown.length])
  useRevealReplay('gbd-page', [directors, shown.length])

  return (
    <div className="gbd-page">

      {/* ══ 01 · Masthead — the standard band ══ */}
      {/* The club's own menu label wins for the title, as the C# does. No sub
          line: the eyebrow already carries the year, and everything else worth
          saying about the board is the board itself, below. */}
      <GPageHead
        crumbs={[{ label: menuName || 'Directors' }]}
        eyebrow={'Board of directors' + (club.selectedYearLabel ? ' · ' + club.selectedYearLabel : '')}
        title={menuName && menuName.trim() ? menuName : 'Directors'}
        aside={rest.length > 0 ? (
          <div className="gp-head__find">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            {/* Enter is swallowed — live filter, and a submit reloads. */}
            <input type="text" value={query} autoComplete="off"
                   aria-label="Search directors by name or designation"
                   placeholder="Search the board…"
                   onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
          </div>
        ) : null}
      />

      {/* ══ 02 · The principals, then the rest of the board ══ */}
      <section className="gbd-body">
        <div className="gld-x">
          {directors === null ? null : rest.length === 0 && leads.length === 0 ? (
            <GEmpty title="No board published"
                    message="This club has not published its board of directors for the selected Rotary year."
                    icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>} />
          ) : (
            <>
              <div className="gbd-lead gld-stagger">
                {leads.map((d) => (
                  <article className="gbd-plate reveal" key={d.role + d.name}>
                    <div className="gbd-plate__ph">
                      <img src={isPlaceholderPhoto(d.img) ? '/images/logo/wheel.png' : d.img}
                           className={isPlaceholderPhoto(d.img) ? 'is-ph' : undefined}
                           alt="" loading="lazy" onError={portraitFallback} />
                    </div>
                    <div className="gbd-plate__b">
                      <span className="gbd-plate__r">{d.role}</span>
                      <h2 className="gbd-plate__n">{d.name}</h2>
                      {d.bio && <p className="gbd-plate__x">{plainText(d.bio)}</p>}
                    </div>
                  </article>
                ))}
              </div>

              {rest.length === 0 ? null : shown.length === 0 ? (
                <GEmpty title="No match"
                        message={'No director matches “' + query.trim() + '”.'}
                        action={<button type="button" className="gld-btn gld-btn--ghost" onClick={() => setQuery('')}>Clear search <Arrow /></button>} />
              ) : (
                <div className="gbd-grid gld-stagger">
                  {shown.map((d, i) => (
                    <article className="gbd-card reveal" key={d.name + d.role + i}>
                      <span className="gp-idx gbd-card__no">{String(i + 1).padStart(2, '0')}</span>
                      <span className="gbd-ring">
                        {isPlaceholderPhoto(d.img)
                          ? <span aria-hidden="true">{initials(d.name)}</span>
                          : <img src={d.img} alt="" loading="lazy" onError={portraitFallback} />}
                      </span>
                      <h3 className="gbd-card__n">{d.name}</h3>
                      <p className="gbd-card__r">{d.role}</p>
                      <span className="gbd-card__u" aria-hidden="true" />
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

    </div>
  )
}
