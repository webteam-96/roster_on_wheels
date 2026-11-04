'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · GALLERY — the contact sheet.
//
// The projector opens on the page title with the sheet's first photograph
// blurred behind it. Then each project's photographs are laid out as a strip
// of film: sprocket holes along the edges, a frame number on every picture,
// frames kept at their own aspect ratio in justified rows. The moment: frames
// develop in, row by row, from dark and colourless to full light.
//
// Data and paging are Gold's (useGalleryData(page), ?page=, GALLERY_PAGE_SIZE).
// Every frame opens the shared PhotoLightbox (Esc, arrows, swipe, captions).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import {
  useClub, useGalleryData, GALLERY_PAGE_SIZE, PhotoLightbox, LightboxStyles, withYear,
} from '../../_shared/data.js'
import {
  usePageName, PageHero, ChipGroup, ResultCount, EmptyState, Loading, Button, Pill, Arrow, ArrowBack, hideOnError, useModal,
} from '../kit.jsx'
import {
  useScene, afterFonts, titleIn, riseIn, cleanups, gsap, ScrollTrigger, EXPO,
  useRefreshOnImages, scrollToY, headerH, prefersReducedMotion,
} from '../motion.js'
import './Gallery.css'

const pad3 = (n) => String(n).padStart(3, '0')
const count = (n, noun) => Number(n).toLocaleString() + ' ' + noun + (n === 1 ? '' : 's')

/** Shapes the frame to its photograph once it arrives (clamped against odd uploads). */
function fitFrame(e) {
  const img = e.currentTarget
  const li = img.closest('.cin-gal-f')
  if (!li || !img.naturalWidth || !img.naturalHeight) return
  li.style.setProperty('--ar', String(Math.min(1.9, Math.max(0.62, img.naturalWidth / img.naturalHeight))))
}

/** Photos -> albums (one per project, first-appearance order), numbered down the sheet. */
function albumsOf(photos, first) {
  const map = new Map()
  photos.forEach((p) => {
    const pid = Number(p.projectId) > 0 ? p.projectId : 0
    const k = pid ? 'p' + pid : 't' + p.title
    if (!map.has(k)) map.set(k, { key: k, pid, title: p.title, module: p.module, photos: [] })
    map.get(k).photos.push(p)
  })
  let n = first
  const list = [...map.values()]
  list.forEach((a) => { a.photos = a.photos.map((p) => ({ ...p, n: ++n })) })
  return list
}

function Pager({ page, total }) {
  if (total < 2) return null
  const nums = Array.from({ length: total }, (_, i) => i + 1)
    .filter((n) => n === 1 || n === total || Math.abs(n - page) <= 1)
  return (
    <nav className="cin-gal-pg" aria-label="Gallery pages">
      {page > 1 ? (
        <Button variant="line" small className="cin-gal-pg__prev" href={'/gallery?page=' + (page - 1)}>
          <ArrowBack /> Previous<span className="cin-sr"> page</span>
        </Button>
      ) : null}
      <ol className="cin-gal-pg__nums">
        {nums.map((n, i) => (
          <li key={n}>
            {i > 0 && n - nums[i - 1] > 1 ? <span className="cin-gal-pg__gap" aria-hidden="true">…</span> : null}
            <a className="cin-gal-pg__n" href={'/gallery?page=' + n} aria-current={n === page ? 'page' : undefined}>
              <span className="cin-sr">Page </span>{n}
            </a>
          </li>
        ))}
      </ol>
      {page < total ? (
        <Button variant="line" small className="cin-gal-pg__next" href={'/gallery?page=' + (page + 1)}>
          Next<span className="cin-sr"> page</span> <Arrow />
        </Button>
      ) : null}
    </nav>
  )
}

export default function Gallery({ data }) {
  const club = useClub()
  const name = usePageName('Gallery')
  const [params] = useSearchParams()
  let page = parseInt(params.get('page'), 10)
  if (Number.isNaN(page) || page < 1) page = 1

  const g = useGalleryData(page, data)
  const [avenue, setAvenue] = useState('')
  const [lb, setLb] = useState(null)
  const bodyRef = useRef(null)
  const openerRef = useRef(null)
  const prevPage = useRef(page)

  // Albums of the whole page, then the avenue filter (this page only - the
  // API pages the year's photographs, it cannot filter them).
  const first = (g.currentPage - 1) * GALLERY_PAGE_SIZE
  const albums = albumsOf(g.photos, first)
  const modules = [...new Set(g.photos.map((p) => p.module).filter(Boolean))]
  const av = modules.includes(avenue) ? avenue : ''
  const shown = albums
    .map((a) => ({ ...a, photos: av ? a.photos.filter((p) => p.module === av) : a.photos }))
    .filter((a) => a.photos.length)
  const flat = shown.flatMap((a) => a.photos)
  const urls = flat.map((p) => p.img)
  const captions = flat.map((p) => p.title)
  const sig = [g.loading, g.currentPage, g.totalCount, av, flat.length, urls[0] || ''].join('|')

  // A new page from the pager (same route, so nothing resets the scroll):
  // bring the top of the sheet back under the header.
  useEffect(() => {
    if (prevPage.current === page) return
    prevPage.current = page
    const el = bodyRef.current
    const y = el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerH()) : 0
    if (window.scrollY > y + 4) scrollToY(y, prefersReducedMotion())
  }, [page])

  // The viewer is a modal: the site inert, smooth scroll paused, focus on its
  // close button, and back on the frame that opened it afterwards.
  useModal(lb !== null, openerRef)

  // The moment: album titles rise out of their line, and the frames develop
  // in, batched as they reach the screen (a row arrives together).
  useScene(bodyRef, (c, ctx) => {
    const off = cleanups()
    const root = bodyRef.current
    root.querySelectorAll('.cin-gal-album__head').forEach((h) => {
      riseIn(h.querySelectorAll('.cin-gal-album__edge, .cin-gal-album__meta, .cin-btn'), { trigger: h, y: 24, stagger: 0.08 })
    })
    off(afterFonts(ctx, () => root.querySelectorAll('.cin-gal-album__t').forEach((t) => titleIn(t, { start: 'top 90%' }))))
    // Frames already scrolled above the screen (a filter picked from far down)
    // are left lit: a batch only develops what is still to come into view.
    const frames = gsap.utils.toArray(root.querySelectorAll('.cin-gal-f__z')).filter((f) => f.getBoundingClientRect().bottom > 0)
    if (frames.length) {
      const dark = { opacity: 0, y: 36, filter: 'brightness(.2) saturate(0)' }
      gsap.set(frames, dark)
      ScrollTrigger.batch(frames, {
        start: 'top 94%', once: true, interval: 0.12,
        onEnter: (batch) => ctx.add(() => gsap.fromTo(batch, dark, {
          opacity: 1, y: 0, filter: 'brightness(1) saturate(1)', duration: 1.3, ease: EXPO, stagger: 0.08,
          overwrite: true, clearProps: 'opacity,transform,filter',
        })),
      })
    }
    return off.run
  }, [sig])
  useRefreshOnImages(bodyRef, [sig])


  return (
    <div className="cin-gal">
      <LightboxStyles />
      <PhotoLightbox urls={urls} index={lb} onIndex={setLb} captions={captions} />

      <PageHero title={name} backdrop={g.photos[0] ? g.photos[0].img : undefined} />

      {g.loading ? <Loading label="Loading photographs" /> : g.totalCount === 0 ? (
        <div className="cin-sec">
          <EmptyState
            title="No photographs yet"
            message="Pictures from this club's projects will appear here once they are published for the selected Rotary year."
            action={<Button variant="line" href="/projects">See the projects <Arrow /></Button>}
          />
        </div>
      ) : (
        <div className="cin-sec cin-gal-body" ref={bodyRef}>
          {modules.length > 1 ? (
            <div className="cin-gal-bar">
              <p className="cin-gal-bar__l" aria-hidden="true">On this page</p>
              <ChipGroup
                label="Show photographs on this page by avenue"
                options={[{ value: '', label: 'All', count: g.photos.length },
                  ...modules.map((m) => ({ value: m, label: m, count: g.photos.filter((p) => p.module === m).length }))]}
                value={av}
                onChange={setAvenue}
              />
              <ResultCount count={flat.length} total={g.photos.length} noun="photograph" />
            </div>
          ) : null}

          {shown.length === 0 ? (
            <EmptyState
              title="Nothing on this page"
              message="This page of the gallery has no photographs. The first page has the latest ones."
              action={<Button variant="line" href="/gallery">Go to the first page <Arrow /></Button>}
            />
          ) : (
            <div className="cin-gal-sheet">
              {shown.map((a) => {
                const lo = a.photos[0].n, hi = a.photos[a.photos.length - 1].n
                const title = a.title || 'More photographs'
                return (
                  <div className="cin-gal-album" key={a.key}>
                    <div className="cin-gal-album__head">
                      <p className="cin-gal-album__edge" aria-hidden="true">
                        {lo === hi ? 'Frame ' + pad3(lo) : 'Frames ' + pad3(lo) + '–' + pad3(hi)}
                      </p>
                      <h2 className="cin-gal-album__t" key={title}>{title}</h2>
                      <p className="cin-gal-album__meta">
                        <Pill>{a.module}</Pill>
                        <span>{count(a.photos.length, 'photograph')}</span>
                      </p>
                      {a.pid ? (
                        <Button variant="text" href={withYear('/project?pid=' + a.pid, club.selectedYearId)}>
                          View project<span className="cin-sr">: {title}</span> <Arrow />
                        </Button>
                      ) : null}
                    </div>
                    <div className="cin-gal-film">
                      <ul className="cin-gal-strip">
                        {a.photos.map((p) => {
                          const at = flat.indexOf(p)
                          return (
                            <li className="cin-gal-f" key={p.n + '|' + p.img}>
                              <button type="button" className="cin-gal-f__z"
                                aria-label={'View photograph ' + p.n + (p.title ? ' — ' + p.title : '')}
                                onClick={(e) => { openerRef.current = e.currentTarget; setLb(at) }}>
                                {/* no-referrer: the media host 403s some hot-linked requests (see Gold) */}
                                <img src={p.img} alt="" loading="lazy" decoding="async" width="800" height="600"
                                  referrerPolicy="no-referrer" onLoad={fitFrame} onError={hideOnError} />
                                <span className="cin-gal-f__n" aria-hidden="true">{pad3(p.n)}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <Pager page={g.currentPage} total={g.totalPages} />
        </div>
      )}
    </div>
  )
}
