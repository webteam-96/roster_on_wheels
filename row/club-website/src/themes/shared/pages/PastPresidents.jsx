'use client'
// Port of PastPresidents.aspx + PastPresidents.aspx.cs — the roll of honour grid
// with a client-side name/year filter.
import { useEffect, useRef, useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, initials } from '@/themes/shared/rotaryPage.js'
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

/**
 * Extracts the 4-digit start year from a Rotary year label such as "2020-21"
 * or "2020-2021". Returns null when no year can be parsed.
 */
export function parseStartYear(yearLabel) {
  if (!yearLabel) return null
  const m = String(yearLabel).match(/\d{4}/)
  return m ? parseInt(m[0], 10) : null
}

export default function PastPresidents({ data }) {
  const club = useClub()
  const { isWarm } = useTheme()
  const inputRef = useRef(null)

  // The .aspx ships the filter as an inline <script>; a <script> tag in JSX
  // never executes, so the same behaviour is driven from React state here — it
  // still only toggles the `hidden` class on the cards / grid / messages.
  const [query, setQuery] = useState('')

  const presidents = (() => {
    let honour = data.pastPresidents || []

    // The roll of honour lists only PAST presidents relative to the selected
    // Rotary year: years STRICTLY BEFORE the selected year. The selected year's
    // own president is that year's sitting president, not a past president, so
    // selecting e.g. 2023-24 shows 2022-23 and earlier (not 2023-24 itself).
    const selectedStart = parseStartYear(club.selectedYearLabel)
    if (selectedStart !== null) {
      honour = honour.filter((p) => {
        const start = parseStartYear(p.yearLabel)
        return start !== null && start < selectedStart
      })
    }

    const pres = honour
      .map((p, i) => ({
        Name: p.memberName,
        Year: p.yearLabel,
        Img: media(p.profilePhotoPath),
        _i: i,
        _y: parseStartYear(p.yearLabel),
      }))
      // The API returns this roll in record order, NOT year order — e.g. club 696
      // hands back its 1972-80 block first and only then 2025-26 descending. Sort
      // here so every club reads newest-first (2025-26, 2024-25, 2023-24, …).
      // Labels we can't parse sort to the bottom rather than jumping to the top;
      // OrderByDescending is stable, so co-presidents of one year keep API order.
      .sort((a, b) => (b._y === null ? -Infinity : b._y) - (a._y === null ? -Infinity : a._y) || a._i - b._i)

    return pres
  })()

  const count = presidents.length

  const q = query.trim().toLowerCase()
  const matches = presidents.map((p) =>
    q === '' ||
    String(p.Name || '').toLowerCase().indexOf(q) !== -1 ||
    String(p.Year || '').toLowerCase().indexOf(q) !== -1
  )
  const shown = matches.filter(Boolean).length
  const noResults = shown === 0 && q !== ''

  useRotaryAnim([count, isWarm])

  return (
    <>
      <Breadcrumb eyebrow="Roll of Honour" title="Past Presidents" crumbLabel="Past Presidents" titleClass="uppercase tracking-wide" />

      {/* ══ Past presidents grid ══ */}
      <section className="bg-canvas">
        <div className="container-x py-12">
          <div className={isWarm ? 'mb-8 flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-4 shadow-card lg:flex-row lg:items-center' : 'mb-8 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-card lg:flex-row lg:items-center'}>
            <div className="flex shrink-0 items-center gap-3">
              <span className={isWarm ? 'flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold-cta' : 'flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy'}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
              </span>
              <div>
                <p className="font-heading text-2xl font-extrabold leading-none text-navy">{shown}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{shown === 1 ? 'Past President' : 'Past Presidents'}</p>
              </div>
            </div>
            <div className="w-full flex-1">
              <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-3 shadow-sm focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
                <svg className="h-5 w-5 shrink-0 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input id="ppSearch" ref={inputRef} type="text" aria-label="Search past presidents by name or year"
                       placeholder="Search by name or year..." autoComplete="off"
                       value={query}
                       onChange={(e) => setQuery(e.target.value)}
                       /* Enter must NOT submit the Web Forms <form> (that reloads the page);
                          this is a live client-side filter, so swallow Enter. */
                       onKeyDown={(e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault() } }}
                       className="w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none" />
                <button id="ppClear" type="button" aria-label="Clear search"
                        onClick={() => { setQuery(''); if (inputRef.current) inputRef.current.focus() }}
                        className={q === '' ? 'hidden text-muted hover:text-navy' : 'text-muted hover:text-navy'}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </label>
            </div>
          </div>

          <div id="ppGrid" className={(isWarm ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4' : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4') + (noResults ? ' hidden' : '')}>
            {/* Cards are filtered with style.display, NOT by appending ' hidden' to
                className: rotary-anim's initReveal adds `is-visible` to .reveal and
                then unobserves it, so any React re-render that rewrites className
                strips that class — and the __ra_reveal guard stops it ever being
                re-observed. The card is then invisible until a full page reload
                (searching and clearing used to blank the whole roll of honour).
                Directory.jsx filters the same way for the same reason. */}
            {presidents.map((p, i) => (
              <div key={i} className="reveal h-full" style={{ display: matches[i] ? undefined : 'none' }} data-pp-card=""
                   data-name={String(p.Name || '').toLowerCase()}
                   data-year={String(p.Year || '').toLowerCase()}>
                {/* WARM: roll-of-honour medallion card — gold-ringed medallion (photo or laurel
                     emblem), name, script year, and an award-flourish divider on every card. */}
                {isWarm ? (
                  <article className="group relative flex h-full flex-col items-center overflow-hidden rounded-2xl border border-navy/10 bg-white px-4 pb-6 pt-8 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover">
                    {/* soft gold crown of light behind the medallion */}
                    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-gold/10 to-transparent"></span>
                    {/* medallion: photo when present, else the neutral placeholder silhouette */}
                    <div className="relative mb-4">
                      <span aria-hidden="true" className="pointer-events-none absolute -inset-1.5 rounded-full bg-gradient-to-br from-gold/30 via-gold-cta/10 to-transparent blur-[3px] transition-opacity duration-300 group-hover:opacity-80"></span>
                      <img src={!p.Img ? '/img/noimg.png' : p.Img} alt={p.Name} loading="lazy"
                           onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/img/noimg.png' }}
                           className="relative h-20 w-20 rounded-full bg-white object-cover object-top shadow-md ring-4 ring-gold/25 transition-all duration-300 group-hover:ring-gold/60" />
                      {/* little gold seal notch */}
                      <span aria-hidden="true" className="absolute -bottom-1 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-gold text-white shadow"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
                    </div>
                    <h3 className="mt-1 font-heading text-[15px] font-bold leading-tight text-navy transition-colors group-hover:text-gold-cta">{p.Name}</h3>
                    <span className="font-script text-2xl leading-tight text-gold-cta">{p.Year}</span>
                    {/* award flourish divider */}
                    <span className="mt-3 flex items-center gap-2 text-gold" aria-hidden="true">
                      <span className="h-px w-6 bg-gradient-to-r from-transparent to-gold/50 transition-all duration-300 group-hover:w-8"></span>
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                      <span className="h-px w-6 bg-gradient-to-l from-transparent to-gold/50 transition-all duration-300 group-hover:w-8"></span>
                    </span>
                  </article>
                ) : (
                  <article className="spotlight-card group relative flex h-full flex-col items-center overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-cardHover">
                    {/* gold year ribbon */}
                    <span className="absolute right-0 top-4 rounded-l-full bg-gold px-3 py-1 text-[11px] font-bold text-navy shadow-sm">{p.Year}</span>

                    {/* Monogram UNDERNEATH, photograph on top. The photo used to
                        be an <img> with no onError at all, so a 404 (several of
                        these paths do 404 — the files are missing server-side)
                        left an empty white ring with the alt text printed inside
                        it, while a president with NO photo got the designed navy
                        disc. Same disc either way now. alt="" because the name is
                        already the <h3> right below. */}
                    <span className="relative inline-flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-navy to-navy-deep font-heading text-3xl font-bold leading-none text-gold shadow-md ring-4 ring-gold/40">
                      <span aria-hidden="true">{initials(p.Name)}</span>
                      {p.Img && (
                        <img src={p.Img} alt="" loading="lazy"
                             onError={(e) => { e.currentTarget.style.display = 'none' }}
                             className="absolute inset-0 h-full w-full object-cover object-top" />
                      )}
                    </span>

                    <h3 className="mt-4 font-heading text-base font-bold leading-tight text-navy">{p.Name}</h3>
                    <span className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gold-cta">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                      President
                    </span>
                  </article>
                )}
              </div>
            ))}
          </div>

          <p id="ppNoResults" className={noResults ? 'py-16 text-center text-muted' : 'hidden py-16 text-center text-muted'}>
            {noResults ? 'No past president found matching “' + q + '”.' : ''}
          </p>
        </div>
      </section>
    </>
  )
}
