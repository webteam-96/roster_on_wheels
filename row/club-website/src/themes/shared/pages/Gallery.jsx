'use client'
// Port of Gallery.aspx + Gallery.aspx.cs — the paged project-photo grid.
//
// The viewer is the SHARED PhotoLightbox, not rotary-anim.js's `[data-lightbox]`
// one this page used to use. That one had a Close button and nothing else: no
// next/previous and no counter, so browsing a 24-photo page meant closing and
// re-opening 24 times, while the project-detail page next door had arrows, a
// counter, arrow keys and swipe. (rotary-anim still ships `.rotary-lightbox` for
// the ASP.NET tree; nothing in this SPA binds `data-lightbox` any more.)
import { useEffect, useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media } from '@/themes/shared/rotaryPage.js'
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
import PhotoLightbox, { LightboxStyles } from '@/themes/shared/PhotoLightbox.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

const PAGE_SIZE = 24

export default function Gallery({ data }) {
  const club = useClub()
  const { isWarm } = useTheme()
  const [searchParams] = useSearchParams()
  const g = data.gallery || null
  const [lb, setLb] = useState(null)      // open photo index; null = viewer closed

  let page = parseInt(searchParams.get('page'), 10)
  if (Number.isNaN(page) || page < 1) page = 1

  // SetTitle("Gallery") is left to <Breadcrumb>, which titles the page with the
  // same string and, like the C#, prefers the club's own menu label for it.

  const totalCount = g ? (g.totalCount || 0) : 0
  const totalPages = totalCount > 0 ? Math.floor((totalCount + PAGE_SIZE - 1) / PAGE_SIZE) : 1
  const currentPage = Math.min(Math.max(page, 1), totalPages)

  const photos = (g && g.photos ? g.photos : []).map((p) => ({
    Img: media(p.imagePath),
    Title: p.projectTitle,
    ProjectId: p.projectId,
    Module: p.moduleName,
  }))

  useRotaryAnim([totalCount, currentPage, isWarm])

  return (
    <>
      <Breadcrumb eyebrow="Moments" title="Gallery" crumbLabel="Gallery" titleClass="uppercase tracking-wide" />

      {/* Arrow keys, swipe, Esc and a counter come with it; the project title
          rides along as the per-photo caption. */}
      <LightboxStyles />
      <PhotoLightbox urls={photos.map((p) => p.Img)} index={lb} onIndex={setLb}
                     captions={photos.map((p) => p.Title || '')} />

      {/* ══ Photo grid ══ */}
      <section className="bg-mesh bg-canvas py-12 md:py-16">
        <div className="container-x">

          {totalCount > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {photos.map((p, i) => (
                  <figure key={i} className={isWarm ? 'reveal group relative aspect-[4/5] overflow-hidden arch-mask bg-gradient-to-br from-gold/10 to-canvas shadow-card ring-1 ring-navy/10 transition-all duration-500 ease-out hover:-translate-y-1.5 hover:shadow-cardHover hover:ring-gold/50' : 'reveal group relative aspect-square overflow-hidden rounded-xl bg-navy/5 shadow-card ring-1 ring-navy/10 transition-all duration-500 ease-out hover:-translate-y-1.5 hover:shadow-cardHover hover:ring-navy/20'}>
                    {/* A BUTTON, not a bare <img> with a click handler: the photo
                        was mouse-only before — nothing focusable, so the whole
                        gallery was unreachable by keyboard and announced as a
                        plain image. The caption's "View Project" link is a
                        SIBLING (it sits in the figcaption above), never nested
                        inside this button. */}
                    <button type="button" className="img-zoom block h-full w-full cursor-zoom-in"
                            onClick={() => setLb(i)}
                            aria-label={'View photo ' + (i + 1) + ' of ' + photos.length + (p.Title ? ' — ' + p.Title : '')}>
                      <img src={p.Img}
                           alt={p.Title}
                           referrerPolicy="no-referrer"
                           onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                           className="h-full w-full object-cover" />
                    </button>

                    {/* gradient overlay on hover */}
                    <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-navy-deep/90 via-navy-deep/55 to-transparent p-3 pt-10 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
                      <h3 className="line-clamp-2 font-heading text-sm font-bold leading-snug text-white">{p.Title}</h3>
                      <p className="mt-0.5 line-clamp-1 text-[11px] font-semibold uppercase tracking-wide text-gold-light">{p.Module}</p>
                      <a href={'/project?pid=' + p.ProjectId}
                         className={isWarm ? 'pointer-events-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow transition-colors hover:bg-gold-cta' : 'pointer-events-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-navy shadow transition-colors hover:bg-gold-light'}>View Project
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      </a>
                    </figcaption>
                  </figure>
                ))}
              </div>

              {/* ══ Pagination ══ */}
              {totalPages > 1 && (
              <nav className="mt-12 flex flex-wrap items-center justify-center gap-3" aria-label="Gallery pagination">
                {currentPage > 1 ? (
                <a href={'/gallery?page=' + (currentPage - 1)} className={isWarm ? 'inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-gold/20 transition-all hover:-translate-y-0.5 hover:bg-gold-cta' : 'inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-navy/20 transition-all hover:-translate-y-0.5 hover:bg-gold hover:text-navy'}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Prev
                </a>
                ) : (
                <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-navy/20 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-navy/40">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Prev
                </span>
                )}

                <span className="rounded-full border border-gold bg-gold/15 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-navy">Page {currentPage} of {totalPages}</span>

                {currentPage < totalPages ? (
                <a href={'/gallery?page=' + (currentPage + 1)} className={isWarm ? 'inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-gold/20 transition-all hover:-translate-y-0.5 hover:bg-gold-cta' : 'inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-navy/20 transition-all hover:-translate-y-0.5 hover:bg-gold hover:text-navy'}>Next
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </a>
                ) : (
                <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-navy/20 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-navy/40">Next
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </span>
                )}
              </nav>
              )}
            </>
          ) : (
            /* ══ Empty state ══ */
            <div className="reveal mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-card ring-1 ring-navy/10">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-navy/5 text-navy/40">
                <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              </span>
              <h2 className="mt-5 font-heading text-xl font-bold text-navy">No photos yet</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">There are no gallery photos to show for this year. Please check back soon.</p>
              <a href="/projects" className="btn-gold mt-6">Explore Our Projects
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </a>
            </div>
          )}

        </div>
      </section>
    </>
  )
}
