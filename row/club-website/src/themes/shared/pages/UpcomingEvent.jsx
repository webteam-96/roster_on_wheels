'use client'
// Port of UpcomingEvent.aspx + UpcomingEvent.aspx.cs.
import { useEffect, useMemo, useState } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, externalUrl, wheelFallback } from '@/themes/shared/rotaryPage.js'
import Breadcrumb, { EmptyState } from '@/themes/shared/Breadcrumb.jsx'
import { formatDate, plainText } from '@/themes/shared/homeData.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

/** Rotary year label "2025-26" -> [2025-07-01, 2026-07-01). Null when no year is
 *  selected (then events aren't year-filtered). */
export function rotaryYearRange(label) {
  if (!label || !String(label).trim()) return null
  const m = String(label).match(/(\d{4})/)
  if (!m) return null
  const start = parseInt(m[1], 10)
  return [new Date(start, 6, 1), new Date(start + 1, 6, 1)]
}

export default function UpcomingEvent({ data }) {
  const club = useClub()
  const { clubId, selectedYearLabel } = club
  const { isWarm } = useTheme()
  const [query, setQuery] = useState('')

  const events = useMemo(() => {
    const range = rotaryYearRange(selectedYearLabel)

    return (data.upcoming || [])
      .filter((ev) => ev.eventDate)
      .map((ev) => ({ ev, d: new Date(ev.eventDate) }))
      .filter(({ d }) => range === null || (d >= range[0] && d < range[1]))
      .sort((a, b) => a.d - b.d)
      .map(({ ev, d }) => {
        const parts = formatDate(d).split(' ')   // "dd MMM yyyy"
        return {
          id: ev.id,
          title: ev.title,
          desc: ev.description,
          day: parts[0],
          mon: parts[1],
          date: formatDate(d),
          img: media(ev.imagePath),
          reg: externalUrl(ev.registrationLink),
        }
      })
  }, [data.upcoming, selectedYearLabel])

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return events
    return events.filter((e) => ((e.title || '') + ' ' + plainText(e.desc || '')).toLowerCase().includes(q))
  }, [events, query])

  const count = matched.length
  useRotaryAnim([isWarm, count])

  return (
    <>
      <Breadcrumb eyebrow="Events" title="Upcoming Events" crumbLabel="Upcoming Events" titleClass="uppercase tracking-wide" />

      {/* ══ Club events grid ══ */}
      <section className="bg-canvas py-12">
        <div className="container-x">
          {/* Same toolbar card as the Club Services list. This page has no search
              box, so the right of the card states the Rotary year the list is
              scoped to — real context (the feed is filtered to it), not filler. */}
          {events.length > 0 && (
            <div className={isWarm ? 'mb-8 flex flex-col gap-4 rounded-2xl border border-navy/10 bg-white p-4 shadow-card lg:flex-row lg:items-center' : 'mb-8 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-card lg:flex-row lg:items-center'}>
              <div className="flex shrink-0 items-center gap-3">
                <span className={isWarm ? 'flex h-11 w-11 items-center justify-center rounded-xl bg-gold/10 text-gold-cta' : 'flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy'}>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                </span>
                <div>
                  <p className="font-heading text-2xl font-extrabold leading-none text-navy">{count}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{count === 1 ? 'Event' : 'Events'}</p>
                </div>
              </div>
              <div className="w-full flex-1">
                <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-3 shadow-sm focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
                  <svg className="h-5 w-5 shrink-0 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" data-event-search aria-label="Search events by name or description"
                         placeholder="Search events by name or description..."
                         value={query}
                         onChange={(e) => setQuery(e.target.value)}
                         onKeyDown={(e) => { if (e.key === 'Enter' || e.keyCode === 13) e.preventDefault() }}
                         className="w-full bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none" autoComplete="off" />
                </label>
              </div>
            </div>
          )}
          {count === 0 ? (
            <EmptyState title="No events found"
                        message={query.trim()
                          ? 'No events match \u201c' + query.trim() + '\u201d. Try a different search.'
                          : 'There are no club events to show for the selected year yet. Please check back soon.'} />
          ) : (
            <div className={isWarm ? 'grid grid-cols-1 gap-5 lg:grid-cols-2' : 'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'}>
              {matched.map((e) => (
                <article key={e.id} className="reveal h-full">
                  {/* WARM: ticket-style card — coral date rail, perforated divider, side thumb. */}
                  {isWarm ? (
                    <div className="group relative flex h-full overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-cardHover">
                      {/* date rail (the ticket stub) */}
                      <div className="flex w-20 shrink-0 flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-gold to-gold-cta text-white">
                        <span className="font-heading text-3xl font-extrabold leading-none">{e.day}</span>
                        <span className="text-[10px] font-bold uppercase tracking-widest">{e.mon}</span>
                        <svg className="mt-1 h-4 w-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      </div>
                      {/* ticket perforation */}
                      <div className="my-4 w-0 border-l-2 border-dashed border-navy/10"></div>
                      {/* body */}
                      <div className="flex min-w-0 flex-1 flex-col p-5">
                        <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                          <svg className="h-3.5 w-3.5 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                          {e.date}
                        </span>
                        <a href={'/event?id=' + e.id} className="line-clamp-2 font-heading text-base font-bold leading-snug text-navy transition-colors hover:text-gold-cta group-hover:text-gold-cta">{e.title}</a>
                        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{e.desc}</p>
                        <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
                          <a href={'/event?id=' + e.id} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-cta transition-all duration-300 hover:gap-2.5">
                            Read More
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                          </a>
                          {e.reg && (
                            <a href={e.reg} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gold-cta hover:shadow-md">Register<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></a>
                          )}
                        </div>
                      </div>
                      {/* side thumb (only when the event has an image) */}
                      {e.img && (
                        <div className="relative hidden w-28 shrink-0 overflow-hidden sm:block"><img src={e.img} alt="" loading="lazy" onError={(ev) => { ev.currentTarget.parentNode.style.display = 'none' }} className="absolute inset-0 h-full w-full bg-white object-contain" /><div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/40 to-transparent"></div></div>
                      )}
                    </div>
                  ) : (
                    <div className="block h-full">
                      <div className="spotlight-card group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-cardHover">

                        {/* image header */}
                        <div className="relative h-52 overflow-hidden bg-navy/5">
                          {/* WHOLE photo, unchanged header height — the same call
                              Home.jsx already made for this exact picture. Event
                              art is usually a PORTRAIT flyer (323x431 is typical)
                              and this header is 427x208, so object-cover threw away
                              63% of its height: a flyer carries its title at the top
                              and its details at the bottom, so the surviving slice
                              was the middle. The WHITE sits on the img, not the
                              wrapper, so the letterbox is white while the wrapper's
                              navy tint still backs the placeholder when a photo is
                              missing. No hover scale: on a contained image it would
                              crop the poster again on hover — the card's own lift is
                              the feedback. */}
                          <img src={e.img} alt={e.title} loading="lazy"
                               className="h-full w-full bg-white object-contain"
                               onError={wheelFallback} />

                          {/* darkening gradient so badges stay legible */}
                          <div className="absolute inset-0 bg-gradient-to-t from-navy/70 via-navy/10 to-transparent"></div>

                          {/* date badge */}
                          <div className="absolute left-4 top-4 flex flex-col items-center rounded-xl bg-white/95 px-3 py-2 text-center shadow-lg backdrop-blur">
                            <span className="font-heading text-lg font-extrabold leading-none text-navy">{e.day}</span>
                            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-gold">{e.mon}</span>
                          </div>

                          {/* avenue tag */}
                          <span className="absolute bottom-3 left-4 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-navy shadow-md">
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                            Upcoming Event
                          </span>
                        </div>

                        {/* body */}
                        <div className="flex flex-1 flex-col p-5">
                          <span className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                            <svg className="h-3.5 w-3.5 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                            {e.date}
                          </span>
                          <a href={'/event?id=' + e.id} className="line-clamp-2 font-heading text-base font-bold leading-snug text-navy transition-colors hover:text-gold-cta group-hover:text-gold-cta">{e.title}</a>
                          <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted">{e.desc}</p>

                          {/* actions: Read More (details) + Register (registration link, new tab) */}
                          <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                            <a href={'/event?id=' + e.id} className="inline-flex items-center gap-1.5 rounded-full border-2 border-navy/10 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-navy transition-all duration-300 hover:border-gold hover:bg-gold/5">
                              Read More
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                            </a>
                            {e.reg && (
                              <a href={e.reg} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-navy shadow-sm transition-all duration-300 hover:bg-gold-light hover:shadow-md">Register<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></a>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
