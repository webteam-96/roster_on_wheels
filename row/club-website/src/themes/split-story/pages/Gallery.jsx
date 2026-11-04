'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Gallery — the year's photos told as the theme's split. Each page
// of the gallery (Gold's ?page= contract, GALLERY_PAGE_SIZE photos) is grouped
// into chapters by avenue and, inside them, albums by project. The sticky royal
// panel names the avenue and counts the album's photos as each album crosses
// the middle of the screen, with the album title and its photo numbers below.
// Photos open through the iris / diagonal wipe alternately (the big ones drift),
// every photo opens the shared PhotoLightbox, and the page closes on the gold
// band that holds the pager.
//
// The avenue chips filter THIS page only: the API pages the year's photos and
// cannot filter them.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import {
  useClub, useGalleryData, GALLERY_PAGE_SIZE, PhotoLightbox, LightboxStyles, withYear, groupInt,
  usePageTitle, useCurrentMenuName,
} from '../../_shared/data.js'
import {
  PageHero, Split, Chapter, fig, Chips, ResultCount, Button, TextLink, GoldBand, EmptyState, Loading, Arrow, yearText,
  useLightboxFocus,
} from '../kit.jsx'
import {
  useScene, useRefreshOnImages, photosIn, parallax, revealBatch, titleOnScroll, scrollToY, prefersReducedMotion,
} from '../motion.js'
import './Gallery.css'

const pad3 = (n) => String(n).padStart(3, '0')
const photosWord = (n) => n + (n === 1 ? ' photo' : ' photos')

/** Page photos -> avenue chapters -> project albums (first-appearance order), numbered down the page. */
function chaptersOf(photos, first) {
  const avs = new Map()
  photos.forEach((p) => {
    const av = String(p.module || '').trim() || 'Photos'
    const pid = Number(p.projectId) > 0 ? Number(p.projectId) : 0
    const title = String(p.title || '').trim()
    const k = pid ? 'p' + pid : 't' + title
    if (!avs.has(av)) avs.set(av, new Map())
    const albums = avs.get(av)
    if (!albums.has(k)) albums.set(k, { key: k, pid, title: title || 'Other photos', photos: [] })
    albums.get(k).photos.push(p)
  })
  let n = first
  return [...avs].map(([title, albums]) => ({
    title,
    albums: [...albums.values()].map((a) => ({ ...a, photos: a.photos.map((p) => ({ ...p, n: ++n })) })),
  }))
}

/**
 * Masonry feel on a 3-column grid, rows always full: groups of six open with a
 * 2x2 photo (on alternate sides), and the last photo stretches over what its
 * row has left (a lone last photo takes the full width, two rows high).
 */
function tileCls(i, n) {
  const g = Math.floor(i / 6), t = Math.min(6, n - g * 6)
  let c = i % 6 === 0 && t >= 3 ? ' is-big' + (g % 2 ? ' is-flip' : '') : ''
  if (i === n - 1) {
    const r = (t >= 3 ? t - 3 : t) % 3
    if (r === 1) c += ' is-w3'
    else if (r === 2) c += ' is-w2'
  }
  return c
}

/** The panel state of one album. */
const stateOf = (chTitle, a, total) => {
  const lo = a.photos[0].n, hi = a.photos[a.photos.length - 1].n
  return {
    title: chTitle, value: a.photos.length, from: 0, fmt: 'pad', caption: a.title,
    sub: (lo === hi ? 'Photo ' + lo : 'Photos ' + lo + '–' + hi) + ' of ' + groupInt(total),
  }
}

function Pager({ page, total, yearId }) {
  const href = (n) => withYear('/gallery?page=' + n, yearId)
  const nums = Array.from({ length: total }, (_, i) => i + 1)
    .filter((n) => n === 1 || n === total || Math.abs(n - page) <= 1)
  return (
    <nav className="spl-gal-pager" aria-label="Gallery pages">
      {page > 1 ? (
        <Button href={href(page - 1)} variant="royal" arrow={false} className="spl-gal-prev">
          <Arrow dir={-1} /> Previous<span className="spl-sr"> page</span>
        </Button>
      ) : null}
      <ol className="spl-gal-nums">
        {nums.map((n, i) => (
          <li key={n}>
            {i > 0 && n - nums[i - 1] > 1 ? <span className="spl-gal-gap" aria-hidden="true">…</span> : null}
            {n === page
              ? <span className="spl-gal-num is-on" aria-current="page"><span className="spl-sr">Page </span>{n}</span>
              : <a className="spl-gal-num" href={href(n)}><span className="spl-sr">Page </span>{n}</a>}
          </li>
        ))}
      </ol>
      {page < total ? (
        <Button href={href(page + 1)} variant="royal" className="spl-gal-next">
          Next<span className="spl-sr"> page</span>
        </Button>
      ) : null}
    </nav>
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
  const [broken, setBroken] = useState(() => new Set())
  const [lb, setLb] = useState(null)
  const ref = useRef(null)
  const bodyRef = useRef(null)
  const openerRef = useRef(null)
  const prevPage = useRef(page)

  // Numbering follows the whole page; broken images drop out, then the avenue filter applies.
  const first = (g.currentPage - 1) * GALLERY_PAGE_SIZE
  const all = chaptersOf(g.photos, first)
    .map((ch) => ({ ...ch, albums: ch.albums.map((a) => ({ ...a, photos: a.photos.filter((p) => !broken.has(p.img)) })).filter((a) => a.photos.length) }))
    .filter((ch) => ch.albums.length)
  const pageCount = all.reduce((s, ch) => s + ch.albums.reduce((t, a) => t + a.photos.length, 0), 0)
  const av = all.some((ch) => ch.title === avenue) ? avenue : ''
  const chapters = av ? all.filter((ch) => ch.title === av) : all
  const flat = chapters.flatMap((ch) => ch.albums.flatMap((a) => a.photos))
  const urls = flat.map((p) => p.img)
  const captions = flat.map((p) => p.title)
  const indexOf = new Map(flat.map((p, i) => [p, i]))
  const sig = [club.selectedYearId, g.loading, g.currentPage, g.totalCount, av, flat.length, urls[0] || ''].join('|')

  const year = yearText(club.selectedYearLabel)
  const showBand = !g.loading && g.totalCount > 0

  // A new page from the pager keeps the route, so nothing resets the scroll: go back to the first album.
  useEffect(() => {
    if (prevPage.current === page) return
    prevPage.current = page
    const el = bodyRef.current
    const y = el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY) : 0
    if (window.scrollY > y + 4) scrollToY(y, prefersReducedMotion())
  }, [page])

  // The viewer is a modal: the page goes inert, focus moves in and comes back to the photo that opened it.
  useLightboxFocus(lb !== null, openerRef)

  useRefreshOnImages(ref, [sig])
  useScene(bodyRef, (c, ctx) => {
    const r = bodyRef.current
    r.querySelectorAll('.spl-gal-title').forEach((el) => titleOnScroll(ctx, el))
    revealBatch(r.querySelectorAll('.spl-gal-meta, .spl-gal-go'), { y: 20 })
    photosIn(r.querySelectorAll('.spl-gal-frame'))
    r.querySelectorAll('.is-big .spl-gal-drift').forEach((d) => parallax(d, { amount: 12, trigger: d.closest('.spl-gal-tile') }))
  }, [sig])

  const openAt = (e, i) => { openerRef.current = e.currentTarget; setLb(i) }
  const markBroken = (src) => setBroken((s) => (s.has(src) ? s : new Set(s).add(src)))

  const avenues = all.map((ch) => ({ value: ch.title, label: ch.title, count: ch.albums.reduce((t, a) => t + a.photos.length, 0) }))

  return (
    <div className="spl-gal" ref={ref}>
      <LightboxStyles />
      <PhotoLightbox urls={urls} index={lb} onIndex={setLb} captions={captions} />

      <PageHero title={title} eyebrow={'Photos' + (year ? ' · ' + year : '')}
                lead={!g.loading && g.totalPages > 1 ? 'Page ' + g.currentPage + ' of ' + g.totalPages + '.' : null}
                stat={!g.loading && g.totalCount > 0 ? { value: g.totalCount, label: g.totalCount === 1 ? 'Photo' : 'Photos' } : null}>
        {avenues.length > 1 ? (
          <div className="spl-gal-filter">
            <Chips label="Filter this page by avenue" value={av} onChange={setAvenue}
                   items={[{ value: '', label: 'All', count: pageCount }, ...avenues]} />
            <ResultCount count={flat.length} total={pageCount} noun={['photo on this page', 'photos on this page']} />
          </div>
        ) : null}
      </PageHero>

      <div className="spl-gal-body" ref={bodyRef}>
        {g.loading ? (
          <section className="spl-section"><div className="spl-x"><Loading label="Loading photos" /></div></section>
        ) : g.totalCount === 0 ? (
          <section className="spl-section"><div className="spl-x">
            <EmptyState title="No photos yet"
                        message="Photos from this club's projects will appear here once they are published for the selected Rotary year."
                        action={<Button href={withYear('/projects', club.selectedYearId)} variant="royal">See the projects</Button>} />
          </div></section>
        ) : flat.length === 0 ? (
          <section className="spl-section"><div className="spl-x">
            <EmptyState title="No photos on this page"
                        message={g.photos.length ? 'The photos on this page could not be loaded.' : 'This page is past the end of the gallery.'}
                        action={<Button href={withYear('/gallery', club.selectedYearId)} variant="royal">Go to the first page</Button>} />
          </div></section>
        ) : (
          <Split rail={chapters.map((ch) => ch.title)} deps={[sig]}>
            {chapters.map((ch, ci) => (
              <Chapter key={ch.title} id={'spl-gal-ch-' + ci} title={ch.title} state={stateOf(ch.title, ch.albums[0], g.totalCount)}>
                {ch.albums.map((a, ai) => {
                  const hid = 'spl-gal-a-' + ci + '-' + ai
                  const n = a.photos.length
                  return (
                    <article className="spl-gal-album" key={a.key} aria-labelledby={hid} {...fig(stateOf(ch.title, a, g.totalCount))}>
                      <header className="spl-gal-head">
                        <p className="spl-gal-meta">{photosWord(n)}</p>
                        <h3 className="spl-gal-title" id={hid} key={a.title}>{a.title}</h3>
                        {a.pid ? (
                          <TextLink className="spl-gal-go" href={withYear('/project?pid=' + a.pid, club.selectedYearId)}>
                            View project<span className="spl-sr">: {a.title}</span>
                          </TextLink>
                        ) : null}
                      </header>
                      <ul className="spl-gal-grid">
                        {a.photos.map((p, k) => (
                          <li className={'spl-gal-tile' + tileCls(k, n)} key={p.n}>
                            <button type="button" className="spl-gal-open" onClick={(e) => openAt(e, indexOf.get(p))}
                                    aria-label={'Open photo ' + (k + 1) + ' of ' + n + ' from ' + a.title}>
                              <span className="spl-gal-frame">
                                <span className="spl-gal-drift">
                                  <img src={p.img} alt="" width="800" height="600" loading="lazy" decoding="async"
                                       referrerPolicy="no-referrer" onError={() => markBroken(p.img)} />
                                </span>
                              </span>
                              <span className="spl-gal-no" aria-hidden="true">{pad3(p.n)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </article>
                  )
                })}
              </Chapter>
            ))}
          </Split>
        )}
      </div>

      {showBand ? (
        g.totalPages > 1 ? (
          <GoldBand id="spl-gal-more" title="More photos" giant={'Page ' + g.currentPage + ' of ' + g.totalPages}>
            <Pager page={g.currentPage} total={g.totalPages} yearId={club.selectedYearId} />
          </GoldBand>
        ) : (
          <GoldBand id="spl-gal-more" title="Behind the photos">
            <Button href={withYear('/projects', club.selectedYearId)} variant="royal">See the projects</Button>
          </GoldBand>
        )
      ) : null}
    </div>
  )
}
