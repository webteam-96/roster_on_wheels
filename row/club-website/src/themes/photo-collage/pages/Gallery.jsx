'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage · Gallery — the year's photos as scrapbook contact sheets.
//
// A page of photos is sorted into albums (one per project, in the API's order).
// Each album hangs a kraft tag (avenue, title, link to the project) beside a
// masonry of taped prints kept at their own shape. Prints are dealt and develop
// from sepia as they scroll in, paper cut-outs race past, and a print opens the
// shared PhotoLightbox (Esc, arrows, swipe, captions); focus returns to it.
// Contract = GalleryGold: ?page=<n>, GALLERY_PAGE_SIZE per page, pager links.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub, useGalleryData, GALLERY_PAGE_SIZE, withYear, groupInt, PhotoLightbox, LightboxStyles } from '../../_shared/data.js'
import { hideOnError } from '../../_shared/kit.jsx'
import { gsap, useScene, useRefreshOnImages, scrollToY, prefersReducedMotion, house, captionIn } from '../motion.js'
import {
  PageHero, Tag, Chip, TextLink, Button, Tape, TAPE_CYCLE, Underline, Cutouts, FilterGroup, ResultCount,
  EmptyState, Loading, usePageName, yearDash, cleanText, excerpt, useLightbox,
} from '../kit.jsx'
import './Gallery.css'

// tilt (deg), sway with scroll speed, parallax depth — cycled across the page
const LOOK = [
  { r: -2.5, k: 0.7, s: 1.04 }, { r: 2, k: -0.8, s: 0.97 }, { r: -1.5, k: 0.9, s: 1.02 },
  { r: 3, k: -0.6, s: 0.96 }, { r: -3, k: 1, s: 1.03 }, { r: 1.5, k: -0.9, s: 0.98 },
]

/** Photos -> albums (one per project), in first-seen order. */
function groupAlbums(photos) {
  const map = new Map()
  photos.forEach((p) => {
    const key = p.projectId ? 'p' + p.projectId : 't' + (p.title || p.module)
    if (!map.has(key)) map.set(key, { key, title: p.title, module: p.module, projectId: p.projectId, photos: [] })
    map.get(key).photos.push(p)
  })
  return [...map.values()]
}

/** 1 … cur-1 cur cur+1 … total (0 = a gap). */
function pageList(cur, total) {
  const out = []
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - cur) <= 1) out.push(n)
    else if (out[out.length - 1] !== 0) out.push(0)
  }
  return out
}

export default function Gallery({ data }) {
  const club = useClub()
  const name = usePageName('Gallery')
  const [params] = useSearchParams()
  let page = parseInt(params.get('page'), 10)
  if (Number.isNaN(page) || page < 1) page = 1
  const g = useGalleryData(page, data)
  const Y = yearDash(club.selectedYearLabel)
  const yearId = club.selectedYearId

  const [pick, setPick] = useState('')      // avenue filter, this page only
  const lb = useLightbox()                  // the viewer: modal, focus in and back, photos develop
  const ref = useRef(null)
  const headRef = useRef(null)
  const lastPage = useRef(page)

  // every photo keeps its frame number on the whole gallery
  const first = (g.currentPage - 1) * GALLERY_PAGE_SIZE
  const all = g.photos.map((p, i) => ({ ...p, no: first + i + 1, title: cleanText(p.title), module: cleanText(p.module) }))
  const mods = [...new Set(all.map((p) => p.module).filter(Boolean))]
  const sel = mods.includes(pick) ? pick : ''
  const albums = groupAlbums(sel ? all.filter((p) => p.module === sel) : all)
  const flat = albums.flatMap((a) => a.photos)   // lightbox order = reading order
  const urls = flat.map((p) => p.img)
  const caps = flat.map((p) => [p.title, p.module].filter(Boolean).join(' · '))

  const covers = groupAlbums(all).slice(0, 3).map((a) => ({ src: a.photos[0].img, caption: excerpt(a.title, 26) }))
  const empty = !g.loading && g.totalCount === 0
  const offEnd = !g.loading && g.totalCount > 0 && all.length === 0
  const pageHref = (n) => withYear('/gallery?page=' + n, yearId)
  const lead = g.totalCount > 0
    ? groupInt(g.totalCount) + ' photograph' + (g.totalCount === 1 ? '' : 's') + ' from the club’s projects.' + (all.length ? ' Select a print to see it larger.' : '')
    : undefined

  // a new ?page= starts at the top of the albums (the router only resets on a new path)
  useEffect(() => {
    if (lastPage.current === page) return
    lastPage.current = page
    const h = headRef.current
    scrollToY(h ? Math.max(0, h.getBoundingClientRect().top + window.scrollY - 24) : 0, prefersReducedMotion())
    if (h) h.focus({ preventScroll: true })
  }, [page])

  // house style: tags swing, prints deal + develop, numbers write in; cut-outs race past
  const sig = [g.loading, g.currentPage, sel, urls.length, urls[0], urls[urls.length - 1]].join('|')
  useScene(ref, (c) => {
    const root = ref.current
    const undo = house(root, c)
    captionIn(root.querySelectorAll('.col-gal-head'))
    const body = root.querySelector('.col-gal-body')
    if (body) {
      body.querySelectorAll('.col-gal-cuts .col-cut').forEach((cu, i) => gsap.fromTo(cu, { y: () => body.offsetHeight * 0.1 }, {
        y: () => -body.offsetHeight * 0.3, rotation: (i % 2 ? 1 : -1) * 150, ease: 'none',
        scrollTrigger: { trigger: body, start: 'top bottom', end: 'bottom top', scrub: 0.4, invalidateOnRefresh: true },
      }))
    }
    return undo
  }, [sig])
  useRefreshOnImages(ref, [sig])

  return (
    <div className="col-gal" ref={ref}>
      <LightboxStyles />
      <PhotoLightbox urls={urls} index={lb.index} onIndex={lb.setIndex} captions={caps} />

      <PageHero title={name} kicker={Y ? 'Rotary year ' + Y : undefined} tint="cran" lead={lead}
        img={all.length ? all[all.length - 1].img : undefined} prints={covers}>
        {mods.length > 1 ? (
          <>
            <div>
              <p className="col-gal-show" aria-hidden="true">Show on this page</p>
              <FilterGroup label="Show on this page" value={sel} onChange={setPick}
                options={[{ value: '', label: 'All', count: all.length }, ...mods.map((m) => ({ value: m, label: m, count: all.filter((p) => p.module === m).length }))]} />
            </div>
            <ResultCount shown={flat.length} total={all.length} noun="photo on this page" plural="photos on this page" />
          </>
        ) : null}
      </PageHero>

      <div className="col-sec col-gal-body">
        {g.loading ? (
          <Loading label="Loading photos" count={3} />
        ) : empty ? (
          <EmptyState title="No photographs yet"
            message={'Photos from the club’s projects will appear here once they are published' + (Y ? ' for Rotary year ' + Y : '') + '.'}
            action={<Button href="/projects">See the projects</Button>} />
        ) : offEnd ? (
          <EmptyState title="Nothing on this page"
            message={'The gallery has ' + g.totalPages + ' page' + (g.totalPages === 1 ? '' : 's') + ' of photos.'}
            action={<Button href={pageHref(1)}>Go to page 1</Button>} />
        ) : (
          <>
            <Cutouts className="col-gal-cuts" />
            <div className="col-gal-wrap">
              <h2 className="col-gal-head" id="col-gal-t" ref={headRef} tabIndex={-1}>
                Albums{g.totalPages > 1 ? <span className="col-gal-of"> · page {g.currentPage} of {g.totalPages}</span> : null}
                <Underline scroll />
              </h2>

              <ul className="col-gal-albums">
                {albums.map((a) => (
                  <li key={a.key + a.photos[0].no} className="col-gal-album">
                    <div className="col-gal-tagcol">
                      <Tag>
                        {a.module ? <p className="col-gal-mod"><Chip>{a.module}</Chip></p> : null}
                        <h3 className="col-gal-title">{a.title || a.module || 'Photos'}</h3>
                        {a.projectId
                          ? <TextLink href={withYear('/project?pid=' + a.projectId, yearId)} sr={a.title || undefined}>View project</TextLink>
                          : null}
                      </Tag>
                    </div>
                    <ul className="col-gal-sheet" style={{ '--col-gal-n': Math.min(a.photos.length, 3), '--col-gal-m': Math.min(a.photos.length, 2) }}>
                      {a.photos.map((p) => {
                        const at = flat.indexOf(p)
                        const L = LOOK[at % LOOK.length]
                        return (
                          <li key={p.img + p.no} className="col-gal-item" style={{ '--col-gal-r': L.r }}>
                            <div className="col-print-move" data-col-speed={L.s} style={{ '--col-k': L.k }}>
                              <div className="col-print-fl" data-col-deal="">
                                <button type="button" className="col-print col-gal-print" aria-haspopup="dialog"
                                  aria-label={'View photo ' + p.no + (p.title ? ': ' + p.title : '')}
                                  onClick={(e) => lb.open(at, e)}>
                                  <Tape tone={TAPE_CYCLE[at % 4]} tilt={L.r > 0 ? 5 : -5} />
                                  <span className="col-print-photo is-natural">
                                    {/* no-referrer: the media host 403s some hot-linked requests (as GalleryGold) */}
                                    <img src={p.img} alt={p.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={hideOnError} />
                                  </span>
                                  <span className="col-print-cap col-gal-no" aria-hidden="true">No. {p.no}</span>
                                </button>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>

              {g.totalPages > 1 ? (
                <nav className="col-gal-pager" aria-label="Gallery pages">
                  <ul>
                    {g.currentPage > 1 ? (
                      <li><a className="col-gal-pg is-step" href={pageHref(g.currentPage - 1)}><span aria-hidden="true">&lsaquo;</span> Previous<span className="col-sr"> page</span></a></li>
                    ) : null}
                    {pageList(g.currentPage, g.totalPages).map((n, i) => (n === 0
                      ? <li key={'gap' + i} className="col-gal-gap" aria-hidden="true">…</li>
                      : (
                        <li key={n}>
                          <a className={'col-gal-pg' + (n === g.currentPage ? ' is-on' : '')} href={pageHref(n)} aria-current={n === g.currentPage ? 'page' : undefined}>
                            <span className="col-sr">Page </span>{n}
                          </a>
                        </li>
                      )))}
                    {g.currentPage < g.totalPages ? (
                      <li><a className="col-gal-pg is-step" href={pageHref(g.currentPage + 1)}>Next<span className="col-sr"> page</span> <span aria-hidden="true">&rsaquo;</span></a></li>
                    ) : null}
                  </ul>
                </nav>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
