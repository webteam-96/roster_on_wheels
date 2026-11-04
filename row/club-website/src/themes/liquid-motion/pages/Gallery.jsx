'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · GALLERY — the year's photographs, album by album.
//
// Ink hero (the count drifts behind in outline, avenue chips filter THIS page),
// then an ink-2 sheet: one album per project - a sticky head on the left (giant
// outlined gold index, avenue kicker, title, count, "View project") and the
// photos in masonry columns on the right, each a liquid frame that wipes up as
// it arrives (WebGL ripple on desktop once a filter leaves <= 12 photos; the
// cursor bubble swells over them). Every photo is a button into the shared
// PhotoLightbox (Esc, arrows, swipe, captions; focus goes in and comes back).
// A paper band closes with the pager, its page number rolling.
//
// Data + URL contract are Gold's: useGalleryData(page), ?page=<n>,
// GALLERY_PAGE_SIZE per page, plain /gallery?page= links.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import {
  useClub, useCurrentMenuName, usePageTitle, useGalleryData, GALLERY_PAGE_SIZE,
  PhotoLightbox, LightboxStyles, withYear,
} from '../../_shared/data.js'
import {
  PageHero, Band, Media, Chips, ResultCount, EmptyState, Loading, Pill, Odometer, Arrow, useInertBehind, clean, pad2,
} from '../kit.jsx'
import { usePageMotion, scrollToY, prefersReducedMotion } from '../motion.js'
import './Gallery.css'

const plural = (n, one, many) => n.toLocaleString() + ' ' + (n === 1 ? one : many)
// fixed rhythm (no reflow as lazy photos land): portrait, landscape, alternating
const RATIO = ['4 / 5', '4 / 3']

/** Photos -> albums (one per project, first-appearance order), each photo numbered down the whole gallery. */
function albumsOf(photos, first) {
  const map = new Map()
  let n = first
  photos.forEach((p) => {
    const pid = Number(p.projectId) > 0 ? p.projectId : 0
    const title = clean(p.title)
    const k = pid ? 'p' + pid : 't' + title
    if (!map.has(k)) map.set(k, { key: k, pid, title, module: clean(p.module), photos: [] })
    map.get(k).photos.push({ ...p, n: ++n })
  })
  return [...map.values()]
}

function Pager({ page, total }) {
  const nums = Array.from({ length: total }, (_, i) => i + 1)
    .filter((n) => n === 1 || n === total || Math.abs(n - page) <= 1)
  return (
    <Band tone="paper" tight as="nav" aria-label="Gallery pages" className="liq-gal-pg">
      <p className="liq-gal-pg__now liq-rv">
        Page <Odometer value={pad2(page)} /> <span className="liq-gal-pg__of">of {pad2(total)}</span>
      </p>
      <div className="liq-gal-pg__ctl liq-rv">
        {page > 1
          ? <Pill href={'/gallery?page=' + (page - 1)} variant="line" back>Previous<span className="liq-sr"> page</span></Pill>
          : null}
        <ol className="liq-gal-pg__nums">
          {nums.map((n, i) => (
            <li key={n}>
              {i > 0 && n - nums[i - 1] > 1 ? <span className="liq-gal-pg__gap" aria-hidden="true">…</span> : null}
              <a className="liq-chip" href={'/gallery?page=' + n} aria-current={n === page ? 'page' : undefined}>
                <span><span className="liq-sr">Page </span>{n}</span>
              </a>
            </li>
          ))}
        </ol>
        {page < total
          ? <Pill href={'/gallery?page=' + (page + 1)} variant="ink">Next<span className="liq-sr"> page</span></Pill>
          : null}
      </div>
    </Band>
  )
}

export default function Gallery({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Gallery'
  usePageTitle(title)

  const [params] = useSearchParams()
  let page = parseInt(params.get('page'), 10)
  if (Number.isNaN(page) || page < 1) page = 1

  const g = useGalleryData(page, data)
  const [avenue, setAvenue] = useState('')
  const [lb, setLb] = useState(null)
  const ref = useRef(null)
  const sheetRef = useRef(null)
  const openerRef = useRef(null)
  const prevPage = useRef(page)

  // albums of the whole page, then the avenue filter (this page only - the API pages the year, it can't filter it)
  const first = (g.currentPage - 1) * GALLERY_PAGE_SIZE
  const albums = albumsOf(g.photos, first)
  const modules = [...new Set(g.photos.map((p) => clean(p.module)).filter(Boolean))]
  const av = modules.includes(avenue) ? avenue : ''
  const shown = albums
    .map((a) => ({ ...a, photos: av ? a.photos.filter((p) => clean(p.module) === av) : a.photos }))
    .filter((a) => a.photos.length)
  const flat = shown.flatMap((a) => a.photos)
  const urls = flat.map((p) => p.img)
  const captions = flat.map((p) => clean(p.title))
  const sig = [g.loading, g.currentPage, g.totalCount, av, flat.length, urls[0] || ''].join('|')

  usePageMotion(ref, [sig])

  // a new page from the pager is the same route (nothing resets the scroll): bring the sheet's top back
  useEffect(() => {
    if (prevPage.current === page) return
    prevPage.current = page
    const el = sheetRef.current
    const y = el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY) : 0
    if (window.scrollY > y + 4) scrollToY(y, prefersReducedMotion())
  }, [page])

  // the viewer is a modal: the rest inert, smooth scroll paused, focus on Close, then back on the photo
  const open = lb !== null
  useInertBehind(open)
  useEffect(() => {
    if (!open) return undefined
    const close = document.querySelector('[data-pdm-lightbox].open .pdm-lb__close')
    if (close) close.focus()
    return () => {
      const o = openerRef.current
      if (o && o.isConnected) o.focus({ preventScroll: true })
    }
  }, [open])


  return (
    <div className="liq-gal" ref={ref}>
      <LightboxStyles />
      <PhotoLightbox urls={urls} index={lb} onIndex={setLb} captions={captions} />

      <PageHero title={title}>
        {!g.loading && modules.length > 1 ? (
          <div className="liq-gal-filter">
            <Chips
              label="Show photographs on this page by avenue"
              options={[{ value: '', label: 'All', count: g.photos.length },
                ...modules.map((m) => ({ value: m, label: m, count: g.photos.filter((p) => clean(p.module) === m).length }))]}
              value={av}
              onChange={setAvenue}
            />
            <ResultCount count={flat.length} total={g.photos.length} one="photograph on this page" many="photographs on this page" />
          </div>
        ) : null}
      </PageHero>

      {g.loading ? (
        <Band tone="ink2"><Loading label="Loading photographs" /></Band>
      ) : g.totalCount === 0 ? (
        <Band tone="paper">
          <EmptyState
            title="No photographs yet"
            text="Pictures from this club's projects will appear here once they are published for the selected Rotary year."
            action={<Pill href="/projects" variant="ink">See the projects</Pill>}
          />
        </Band>
      ) : (
        <>
          <Band tone="ink2" className="liq-gal-sheet" aria-label="Photographs" ref={sheetRef}>
            {shown.length === 0 ? (
              <EmptyState
                title="Nothing on this page"
                text="This page of the gallery has no photographs. The first page has the latest ones."
                action={<Pill href="/gallery" variant="light">Go to the first page</Pill>}
              />
            ) : shown.map((a, ai) => {
              const name = a.title || 'More photographs'
              return (
                <article className="liq-gal-album" key={a.key}>
                  <header className="liq-gal-head">
                    
                    {a.module ? <p className="liq-kicker liq-gal-head__k liq-rv">{a.module}</p> : null}
                    <h2 className="liq-gal-head__t liq-rv">{name}</h2>
                    <p className="liq-gal-head__m liq-rv">{plural(a.photos.length, 'photograph', 'photographs')}</p>
                    {a.pid ? (
                      <a className="liq-link liq-gal-head__go liq-rv" href={withYear('/project?pid=' + a.pid, club.selectedYearId)}>
                        View project<span className="liq-sr">: {name}</span> <Arrow />
                      </a>
                    ) : null}
                  </header>
                  {/* one or two photos: as many columns as photos, so an album never ends in empty columns */}
                  <ul className={'liq-gal-cols' + (a.photos.length < 3 ? ' liq-gal-cols--' + a.photos.length : '')}>
                    {a.photos.map((p, i) => (
                      <li className="liq-gal-f" key={p.n + '|' + p.img}>
                        {/* no-referrer: the media host 403s some hot-linked gallery requests that send one (as Gold) */}
                        <Media src={p.img} ratio={a.photos.length === 1 ? '4 / 3' : RATIO[i % 2]} label={a.module || 'Rotary'} width="800" height="600"
                               referrerPolicy="no-referrer" className="liq-gal-media">
                          <button type="button" className="liq-gal-f__z"
                            aria-label={'View photograph ' + p.n + (a.title ? ' — ' + a.title : '')}
                            onClick={(e) => { openerRef.current = e.currentTarget; setLb(flat.indexOf(p)) }} />
                        </Media>
                      </li>
                    ))}
                  </ul>
                </article>
              )
            })}
          </Band>
          {g.totalPages > 1 ? <Pager page={g.currentPage} total={g.totalPages} /> : null}
        </>
      )}
    </div>
  )
}
