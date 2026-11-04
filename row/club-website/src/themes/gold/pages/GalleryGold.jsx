'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · GALLERY — the contact sheet.
//
// This page has exactly one kind of content, and it is the most visual thing on
// the whole site. So everything else gets out of the way: navy ground, a 6px
// gutter, true masonry columns that keep every photograph at its OWN aspect
// ratio (the shared page crops them all to squares), a frame number and the
// project caption appearing only on hover. Click anything to open the shared
// viewer and page through the sheet.
//
// The ?page= contract is unchanged, so a link to a particular page of the
// gallery keeps working.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import PhotoLightbox, { LightboxStyles } from '@/themes/shared/PhotoLightbox.jsx'
import { useGalleryGold, GALLERY_PAGE_SIZE } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

export default function GalleryGold({ data }) {
  const club = useClub()
  const [params] = useSearchParams()
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Gallery')

  let page = parseInt(params.get('page'), 10)
  if (Number.isNaN(page) || page < 1) page = 1

  const g = useGalleryGold(page, data)
  const [lbIndex, setLbIndex] = useState(null)
  const urls = g.photos.map((p) => p.img)

  useRotaryAnim([g.totalCount, g.currentPage])
  // The photographs animate themselves; the masthead and the empty state are the
  // only .reveal nodes here, and they replay on re-entry like every other page.
  useRevealReplay('ggal-page', [g.loading, g.totalCount, g.currentPage])

  const first = (g.currentPage - 1) * GALLERY_PAGE_SIZE

  return (
    <div className="ggal-page">
      <LightboxStyles />
      <PhotoLightbox urls={urls} index={lbIndex} onIndex={setLbIndex} />

      {/* ══ 01 · Masthead — the standard band, cream ══ */}
      {/* Cream is deliberate: the way IN is the same as every other page, and the
          navy starts at the sheet, which is the part that has to be dark. The
          count only reads once the fetch has landed, so it stays guarded. */}
      <GPageHead
        crumbs={[{ label: menuName || 'Gallery' }]}
        eyebrow="Photographs"
        title="Gallery"
        sub={g.totalCount > 0
          ? g.totalCount + ' photograph' + (g.totalCount === 1 ? '' : 's')
            + (club.selectedYearLabel ? ' from the ' + club.selectedYearLabel + ' Rotary year' : '')
            + (g.totalPages > 1 ? ', sheet ' + g.currentPage + ' of ' + g.totalPages : '')
            + '.'
          : null}
      />

      {/* ══ 02 · The sheet ══ */}
      {g.loading ? null : g.totalCount === 0 ? (
        <section className="ggal-empty">
          <div className="gld-x">
            <GEmpty title="No photographs yet"
                    message="Pictures from this club's projects will appear here once they are published for the selected Rotary year."
                    action={<a href="/projects" className="gld-btn gld-btn--gold">See the projects <Arrow /></a>}
                    icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>} />
          </div>
        </section>
      ) : (
        <>
          <section className="ggal-sheet">
            <div className="ggal-cols">
              {g.photos.map((p, i) => (
                <figure className="ggal-f" key={i}>
                  <button type="button" className="ggal-f__z" onClick={() => setLbIndex(i)}
                          aria-label={'View photograph ' + (first + i + 1) + (p.title ? ' — ' + p.title : '')}>
                    {/* referrerPolicy: the media host 403s some hot-linked
                        requests when a referrer is sent, which showed as random
                        blanks in the sheet. */}
                    <img src={p.img} alt={p.title} loading="lazy"
                         referrerPolicy="no-referrer" onError={hideOnError} />
                  </button>
                  <span className="ggal-f__n" aria-hidden="true">{String(first + i + 1).padStart(3, '0')}</span>
                  {(p.title || p.module || p.projectId) && (
                    <figcaption className="ggal-f__cap">
                      {p.title && <span className="ggal-f__t">{p.title}</span>}
                      {p.module && <span className="ggal-f__m">{p.module}</span>}
                      {p.projectId ? (
                        <a className="ggal-f__go" href={'/project?pid=' + p.projectId}>
                          View project <Arrow />
                        </a>
                      ) : null}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </section>

          {g.totalPages > 1 && (
            <section className="ggal-foot">
              <div className="gld-x">
                <div className="gp-pager">
                  {g.currentPage > 1
                    ? <a href={'/gallery?page=' + (g.currentPage - 1)} aria-label="Previous sheet">&lsaquo;</a>
                    : <button type="button" disabled aria-label="Previous sheet">&lsaquo;</button>}
                  {Array.from({ length: g.totalPages }, (_, n) => n + 1)
                    .filter((n) => n === 1 || n === g.totalPages || Math.abs(n - g.currentPage) <= 1)
                    .map((n, i, arr) => (
                      <span key={n} style={{ display: 'contents' }}>
                        {i > 0 && n - arr[i - 1] > 1 && <span>…</span>}
                        {n === g.currentPage
                          ? <button type="button" className="is-on" aria-current="page">{n}</button>
                          : <a href={'/gallery?page=' + n}>{n}</a>}
                      </span>
                    ))}
                  {g.currentPage < g.totalPages
                    ? <a href={'/gallery?page=' + (g.currentPage + 1)} aria-label="Next sheet">&rsaquo;</a>
                    : <button type="button" disabled aria-label="Next sheet">&rsaquo;</button>}
                </div>
              </div>
            </section>
          )}
        </>
      )}

    </div>
  )
}
