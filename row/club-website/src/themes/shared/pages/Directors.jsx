'use client'
// Port of Directors.aspx + Directors.aspx.cs — the board of directors grid with
// a client-side name/designation filter.
import { useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, initials } from '@/themes/shared/rotaryPage.js'
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

const MAX = Number.MAX_SAFE_INTEGER

export default function Directors({ data }) {
  const club = useClub()
  const { isWarm } = useTheme()

  // The .aspx ships the filter as an inline <script>; a <script> tag in JSX
  // never executes, so the same behaviour is driven from React state here. It
  // still only toggles the `hidden` class on the cards / no-results line, so the
  // rendered DOM stays the same. `applied` mirrors the fact that the original
  // only runs applyFilter() on input/click — before that the no-results line
  // keeps its initial `hidden`, even for a club with zero directors.
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState(false)

  const directors = (data.bod || [])
    .map((b, i) => ({
      Name: b.memberName,
      Role: b.designation,
      Img: media(b.profilePhotoPath),
      _i: i,
      _d: b.designationSortOrder === null || b.designationSortOrder === undefined ? MAX : b.designationSortOrder,
      _s: b.sortOrder === null || b.sortOrder === undefined ? MAX : b.sortOrder,
    }))
    .sort((a, b) => a._d - b._d || a._s - b._s || a._i - b._i)

  const q = (query || '').trim().toLowerCase()
  const matches = directors.map((d) => {
    const name = String(d.Name || '').toLowerCase()
    const role = String(d.Role || '').toLowerCase()
    return !q || name.indexOf(q) !== -1 || role.indexOf(q) !== -1
  })
  const visible = matches.filter(Boolean).length

  useRotaryAnim([directors.length, isWarm])

  return (
    <>
      <Breadcrumb eyebrow="Our Leadership" title="Directors" crumbLabel="Directors" titleClass="uppercase tracking-wide" />

      <div className="bg-canvas">
        <div className="container-x py-12">

          {/* Search box (client-side filter). Intentionally a plain div: the
               master page already wraps the page in a server-side form, and a
               nested HTML form would be invalid and stripped by the browser. */}
          <div className="mx-auto mb-10 flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center">
            <label className={isWarm ? 'flex flex-1 items-center gap-3 rounded-full border border-navy/15 bg-white px-5 py-3 shadow-sm focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20' : 'flex flex-1 items-center gap-3 rounded-full border border-gray-200 bg-white px-5 py-3 shadow-sm focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20'}>
              <svg className="h-5 w-5 shrink-0 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input id="directorSearch" type="text" aria-label="Search directors by name or designation"
                     placeholder="Search by name or designation..." autoComplete="off"
                     value={query}
                     onChange={(e) => { setQuery(e.target.value); setApplied(true) }}
                     /* Enter must not submit the Web Forms <form> (reloads the page); filter is live. */
                     onKeyDown={(e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); setApplied(true) } }}
                     className="w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none" />
            </label>
            <button type="button" id="directorSearchBtn"
                    onClick={(e) => { e.preventDefault(); setApplied(true) }}
                    className={isWarm ? 'inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-7 py-3 text-sm font-bold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gold-cta hover:shadow-md sm:w-auto' : 'inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-7 py-3 text-sm font-bold text-navy shadow-sm transition-all hover:bg-gold-light hover:shadow-md sm:w-auto'}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              Search
            </button>
          </div>

          {/* ══ Directors grid ══ */}
          <div id="directorsGrid" className={isWarm ? 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4' : 'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'}>
            {directors.map((d, i) => (
              <article key={i} data-director-card=""
                       data-name={String(d.Name || '').toLowerCase()}
                       data-role={String(d.Role || '').toLowerCase()}
                       /* style.display, not a ' hidden' className suffix — see
                          PastPresidents.jsx: rewriting className strips rotary-anim's
                          `is-visible` and the card never fades back in (warm only
                          carries .reveal, but the rewrite is avoidable on both). */
                       style={{ display: matches[i] ? undefined : 'none' }}
                       className={isWarm ? 'reveal group relative flex h-full flex-col overflow-hidden arch-mask border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover' : 'spotlight-card group relative h-44 overflow-hidden rounded-2xl border border-gray-200 bg-navy shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-cardHover'}>
                {/* WARM: arch-topped portrait card — photo fills the arch, role plate below. */}
                {isWarm ? (
                  <>
                    <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-white">
                      <img src={!d.Img ? '/img/noimg.png' : d.Img} alt={d.Name} loading="lazy"
                           onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/img/noimg.png' }}
                           className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-105" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white/70 to-transparent"></div>
                    </div>
                    <div className="flex flex-1 flex-col items-center px-4 pb-6 pt-3 text-center">
                      <h3 className="font-heading text-lg font-extrabold leading-tight text-navy transition-colors group-hover:text-gold-cta">{d.Name}</h3>
                      <span className="mt-1 text-[11px] font-bold uppercase tracking-wider text-gold-cta">{d.Role}</span>
                      <span className="mt-3 block h-1 w-8 rounded-full bg-gold/60 transition-all duration-300 group-hover:w-14 group-hover:bg-gold"></span>
                    </div>
                  </>
                ) : (
                  <>
                    {/* faint Rotary wheel watermark over the navy panel */}
                    <img src="/images/logo/wheel.png" alt="" aria-hidden="true" className="pointer-events-none absolute -left-3 -top-3 h-16 w-16 opacity-20" />

                    {/* initials fallback (behind the photo) */}
                    <div className="absolute inset-y-0 left-0 flex h-full w-1/2 items-center justify-center">
                      <span className="font-heading text-4xl font-extrabold tracking-wide text-gold/90">{initials(d.Name)}</span>
                    </div>

                    {/* portrait photo, hides itself on error to reveal the initials */}
                    {d.Img ? (
                      <img src={d.Img} alt={d.Name} loading="lazy"
                           onError={(e) => { e.currentTarget.style.display = 'none' }}
                           className="absolute inset-y-0 left-0 h-full w-1/2 object-cover object-top" />
                    ) : null}

                    {/* white content panel with curved left edge + gold seam line */}
                    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 340 176" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M150,0 C110,45 190,131 150,176 L340,176 L340,0 Z" fill="#ffffff" />
                      <path d="M150,0 C110,45 190,131 150,176" fill="none" stroke="#F7A600" strokeWidth="3" />
                    </svg>

                    {/* person badge */}
                    <span className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-navy text-white shadow-md">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </span>

                    {/* content */}
                    <div className="absolute inset-y-0 right-0 z-10 flex w-[56%] flex-col justify-center pl-5 pr-5">
                      <h3 className="font-heading text-lg font-extrabold leading-tight text-navy">{d.Name}</h3>
                      <span className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted">{d.Role}</span>
                      <div className="mt-1.5 h-0.5 w-8 rounded-full bg-gold"></div>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>

          {/* no-results message */}
          <p id="directorsNoResults" className={applied && visible === 0 ? 'py-16 text-center text-muted' : 'hidden py-16 text-center text-muted'}>
            No directors found matching your search.
          </p>

        </div>
      </div>
    </>
  )
}
