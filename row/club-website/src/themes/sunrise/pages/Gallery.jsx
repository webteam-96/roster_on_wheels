'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · GALLERY — travel through the photos, then walk the albums.
//
// Wide screens with motion: the page's first photos come at you as the home's
// tunnel (pinned, sparks streaming past, the camera easing to a stop at each
// picture). Below it, and on every screen, the page's photos are grouped into
// albums by project: an album head (avenue, project title, count, link to the
// project) beside a grid of tiles that lift off a tilted plane (phones: the
// scrubbed tilt-rise). Every photo opens the shared PhotoLightbox (Esc, arrows,
// swipe, captions); the site behind is inert while it is open and focus goes
// back to the photo that opened it.
//
// Data and the ?page= contract are Gold's (useGalleryData(page), GALLERY_PAGE_SIZE
// per page, frame numbers counted through the year). The avenue chips filter
// THIS page only - the API pages the photos, so the chips say so.
// ─────────────────────────────────────────────────────────────────────────────
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import {
  useClub, useGalleryData, GALLERY_PAGE_SIZE, PhotoLightbox, LightboxStyles, withYear,
} from '../../_shared/data.js'
import { PageHero, Button, Chips, ResultCount, EmptyState, Loading, Arrow, ArrowLeft, noEmoji, hideOnError, yearText } from '../kit.jsx'
import { useScene, gsap, photoTunnel, revealBatch, tiltRise, scrollToY, headerHeight, lockScroll } from '../motion.js'
import './Gallery.css'

const TUNNEL_MAX = 8
const clampRatio = (r) => Math.min(2.2, Math.max(0.6, r))

export default function Gallery({ data }) {
  const club = useClub()
  const [params] = useSearchParams()
  let page = parseInt(params.get('page'), 10)
  if (Number.isNaN(page) || page < 1) page = 1

  const g = useGalleryData(page, data)
  const year = yearText(club.selectedYearLabel)
  const yearId = club.selectedYearId
  const multi = g.totalPages > 1
  const cur = g.currentPage

  const [mod, setMod] = useState('')          // '' = every avenue
  const [lb, setLb] = useState(null)          // open photo index; null = viewer closed
  const [ratios, setRatios] = useState({})    // tunnel cards take each photo's own shape
  const opener = useRef(null)
  const jump = useRef(false)                  // a pager click: land on the new page's albums
  const tunnelRef = useRef(null)
  const albumsRef = useRef(null)
  const uid = useId()

  // this page's photos, numbered through the year (Gold's frame number)
  const firstN = (cur - 1) * GALLERY_PAGE_SIZE
  const photos = g.photos.map((p, i) => ({ ...p, title: noEmoji(p.title), n: firstN + i + 1 }))

  const counts = new Map()
  photos.forEach((p) => { if (p.module) counts.set(p.module, (counts.get(p.module) || 0) + 1) })
  const active = counts.has(mod) ? mod : ''
  const chips = counts.size > 1
    ? [{ value: '', label: 'All', count: photos.length }, ...[...counts].map(([m, c]) => ({ value: m, label: m, count: c }))]
    : null

  // albums: one per project, in the order each first appears on the page
  const albums = []
  const byKey = new Map()
  photos.forEach((p) => {
    if (active && p.module !== active) return
    const k = p.projectId > 0 ? 'p' + p.projectId : 't' + p.title
    if (!byKey.has(k)) {
      const a = { key: k, title: p.title, module: p.module, projectId: p.projectId, items: [] }
      byKey.set(k, a)
      albums.push(a)
    }
    byKey.get(k).items.push(p)
  })
  const shown = albums.flatMap((a) => a.items)   // the viewer pages in reading order
  shown.forEach((p, i) => { p.i = i })

  const tunnel = shown.slice(0, TUNNEL_MAX)
  const canTunnel = tunnel.length >= 2
  const tunnelKey = canTunnel ? tunnel.map((p) => p.img).join('|') : ''
  const gridKey = shown.map((p) => p.img).join('|')

  // ── motion ────────────────────────────────────────────────────────────────
  // the tunnel only on a stage tall enough to see a photo (a phone on its side made 155px cards, one word
  // per title line): without it the section stays hidden and the albums below show every photo
  useScene(tunnelRef, (c) => {
    if (!c.wide) return undefined
    const mm = gsap.matchMedia(tunnelRef.current)
    mm.add('(min-height: 540px)', () => photoTunnel(tunnelRef.current, c))
    return () => mm.revert()
  }, [tunnelKey])
  useScene(albumsRef, (c) => {
    const root = albumsRef.current
    revealBatch(root.querySelectorAll('.sun-gal-album__head'), { y: 30, tilt: 0 })
    // each album's small sun rises over its horizon (the album, not the sticky head, is the trigger)
    root.querySelectorAll('.sun-gal-album').forEach((al) => {
      const s = al.querySelector('.sun-gal-album__sun')
      if (s) gsap.fromTo(s, { yPercent: 50 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: al, start: 'top 92%', end: 'top 50%', scrub: true } })
    })
    const tiles = root.querySelectorAll('.sun-gal-tile')
    if (c.wide) revealBatch(tiles, { y: 50, tilt: 14, stagger: 0.06 })
    else tiltRise(tiles, '.sun-gal-tile__img')
  }, [gridKey])

  const toAlbums = (now) => {
    const el = albumsRef.current
    if (!el) return
    scrollToY(Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerHeight() - 16), now)
    el.focus({ preventScroll: true })
  }
  // after a pager click, once the new photos are in (and the tunnel re-pinned), start at the albums
  useEffect(() => {
    if (!jump.current || g.loading) return
    jump.current = false
    toAlbums(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKey])

  // ── the viewer: site behind inert and still, focus in, focus back ─────────
  const open = lb !== null
  const openAt = (i) => (e) => { opener.current = e.currentTarget; setLb(i) }
  useEffect(() => {
    if (!open) return undefined
    const root = document.getElementById('root')
    if (root) root.inert = true
    lockScroll(true)
    const close = document.querySelector('.pdm-lb.open .pdm-lb__close')
    if (close) close.focus()
    return () => {
      if (root) root.inert = false
      lockScroll(false)
      const back = opener.current
      opener.current = null
      if (back && back.isConnected) back.focus({ preventScroll: true })
    }
  }, [open])

  const onRatio = (src) => (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w && h) setRatios((r) => (r[src] ? r : { ...r, [src]: clampRatio(w / h) }))
  }
  const flagJump = (e) => { if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button)) jump.current = true }

  const pages = Array.from({ length: g.totalPages }, (_, k) => k + 1)
    .filter((n) => n === 1 || n === g.totalPages || Math.abs(n - cur) <= 1)
  const pageHref = (n) => '/gallery?page=' + n

  return (
    <div className="sun-page sun-gal">
      <LightboxStyles />
      <PhotoLightbox urls={shown.map((p) => p.img)} index={lb} onIndex={setLb}
                     captions={shown.map((p) => [p.title, p.module].filter(Boolean).join(' · '))} />

      <PageHero title="Gallery">
        {!g.loading && photos.length > 0 ? (
          <div className="sun-tools">
            {/* paged: "24 of 74 photos" (the year's total); an avenue filter counts within this page */}
            <ResultCount count={shown.length} total={active ? photos.length : multi ? g.totalCount : undefined}
                         noun={multi && active ? 'photo on this page' : 'photo'} plural={multi && active ? 'photos on this page' : 'photos'} />
            {chips ? <Chips label="Filter this page by avenue" options={chips} value={active} onChange={setMod} /> : null}
          </div>
        ) : null}
      </PageHero>

      {g.loading ? (
        <div className="sun-wrap sun-block"><Loading label="Loading photos" /></div>
      ) : g.totalCount === 0 ? (
        <div className="sun-wrap sun-block">
          <EmptyState title="No photos yet"
                      message={'Pictures from the club’s projects will appear here once they are published for ' + (year ? 'Rotary year ' + year : 'this Rotary year') + '.'}
                      action={<Button href="/projects" variant="line">See the projects</Button>} />
        </div>
      ) : photos.length === 0 ? (
        <div className="sun-wrap sun-block">
          <EmptyState title="No photos on this page"
                      message={'This year’s gallery runs to ' + g.totalPages + (g.totalPages === 1 ? ' page.' : ' pages.')}
                      action={<Button href={pageHref(page > g.totalPages ? g.totalPages : 1)} variant="line" icon="back">
                        Go to page {page > g.totalPages ? g.totalPages : 1}
                      </Button>} />
        </div>
      ) : (
        <>
          {/* ══ the tunnel (wide + motion; hidden otherwise - the albums hold every photo) ══
              The wrapper is what React adds/removes: the pinned stage itself sits
              inside ScrollTrigger's pin-spacer, so React must never remove it directly. */}
          {canTunnel ? (
            <div className="sun-gal-trail">
              <section className="sun-tunnel sun-gal-tunnel" ref={tunnelRef} aria-labelledby={uid + 'th'}>
                <div className="sun-tunnel__light" aria-hidden="true" />
                <div className="sun-tunnel__sparks" aria-hidden="true" />
                <div className="sun-tunnel__head">
                  <div>
                    <p className="sun-eyebrow">{multi ? 'Page ' + cur + ' of ' + g.totalPages : year ? 'Rotary year ' + year : 'Photographs'}</p>
                    <h2 className="sun-h2" id={uid + 'th'}>The year in pictures</h2>
                  </div>
                </div>
                <ul className="sun-tunnel__cards">
                  {tunnel.map((p) => {
                    const r = ratios[p.img] || 4 / 3
                    const style = { '--sun-tar': String(r), '--sun-w': r > 1 ? 'min(38vw,560px)' : 'min(22vw,320px,(100svh - var(--sun-hh)) * .42)' }
                    return (
                      <li key={p.n} className="sun-tunnel__card" style={style}>
                        <article className="sun-card">
                          <div className="sun-card__img">
                            <img src={p.img} alt="" width="800" height="600" loading="lazy" decoding="async"
                                 referrerPolicy="no-referrer" onLoad={onRatio(p.img)} onError={hideOnError} />
                          </div>
                          <div className="sun-card__body">
                            {p.module ? <p className="sun-card__meta"><span>{p.module}</span></p> : null}
                            <h3 className="sun-card__title">
                              <button type="button" className="sun-card__link sun-gal-tcard" onClick={openAt(p.i)}>
                                {p.title || 'Club photo'}<span className="sun-sr"> (open photo {p.n})</span>
                              </button>
                            </h3>
                          </div>
                        </article>
                      </li>
                    )
                  })}
                </ul>
                <div className="sun-tunnel__end"><div><Button onClick={() => toAlbums(false)}>See all {shown.length} photos</Button></div></div>
                <p className="sun-tunnel__gauge" aria-hidden="true"><b>01</b><span>/ {String(tunnel.length).padStart(2, '0')}</span></p>
              </section>
            </div>
          ) : null}

          {/* ══ the albums ══ */}
          <section className="sun-wrap sun-block sun-gal-albums" ref={albumsRef} tabIndex={-1} aria-label="Photos by project">
            {albums.map((a, ai) => {
              const n = a.items.length
              const shape = (n === 1 ? ' is-one' : '') + (n >= 3 ? ' is-lead' : '') + (n % 2 ? ' is-odd' : '')
              const hid = uid + 'a' + ai
              return (
                <section key={a.key} className="sun-gal-album" aria-labelledby={hid}>
                  <header className="sun-gal-album__head">
                    <span className="sun-gal-album__rise" aria-hidden="true"><span className="sun-gal-album__sun" /></span>
                    {a.module ?<p className="sun-eyebrow">{a.module}</p> : null}
                    <h2 className="sun-gal-album__title" id={hid}>{a.title || 'Club photos'}</h2>
                    <p className="sun-gal-album__n">{n} {n === 1 ? 'photo' : 'photos'}{multi ? ' on this page' : ''}</p>
                    {a.projectId > 0 ? (
                      <a className="sun-link" href={withYear('/project?pid=' + a.projectId, yearId)}>
                        View project<span className="sun-sr">: {a.title}</span> <Arrow />
                      </a>
                    ) : null}
                  </header>
                  <ul className={'sun-gal-tiles' + shape}>
                    {a.items.map((p) => (
                      <li key={p.n} className="sun-gal-tile">
                        <button type="button" className="sun-gal-tile__btn" onClick={openAt(p.i)}
                                aria-label={'Open photo ' + p.n + (p.title ? ': ' + p.title : '')}>
                          <img className="sun-gal-tile__img" src={p.img} alt={p.title} width="800" height="600"
                               loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={hideOnError} />
                          <span className="sun-gal-tile__n" aria-hidden="true">{String(p.n).padStart(2, '0')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </section>

          {/* ══ pages ══ */}
          {multi ? (
            <nav className="sun-wrap sun-gal-pager" aria-label="Gallery pages">
              {cur > 1 ? (
                <a className="sun-gal-pager__step" href={pageHref(cur - 1)} rel="prev" onClick={flagJump}>
                  <ArrowLeft /><span className="sun-gal-pager__word">Previous</span><span className="sun-sr"> page</span>
                </a>
              ) : (
                <span className="sun-gal-pager__step is-off" aria-hidden="true"><ArrowLeft /><span className="sun-gal-pager__word">Previous</span></span>
              )}
              <ol className="sun-gal-pager__nums">
                {pages.map((n, i) => (
                  <Fragment key={n}>
                    {i > 0 && n - pages[i - 1] > 1 ? <li className="sun-gal-pager__gap" aria-hidden="true">…</li> : null}
                    <li>
                      {n === cur
                        ? <span className="sun-gal-pager__n is-on" aria-current="page"><span className="sun-sr">Page </span>{n}</span>
                        : <a className="sun-gal-pager__n" href={pageHref(n)} onClick={flagJump}><span className="sun-sr">Page </span>{n}</a>}
                    </li>
                  </Fragment>
                ))}
              </ol>
              {cur < g.totalPages ? (
                <a className="sun-gal-pager__step sun-gal-pager__step--next" href={pageHref(cur + 1)} rel="next" onClick={flagJump}>
                  <span className="sun-gal-pager__word">Next</span><span className="sun-sr"> page</span><Arrow />
                </a>
              ) : (
                <span className="sun-gal-pager__step sun-gal-pager__step--next is-off" aria-hidden="true"><span className="sun-gal-pager__word">Next</span><Arrow /></span>
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  )
}
