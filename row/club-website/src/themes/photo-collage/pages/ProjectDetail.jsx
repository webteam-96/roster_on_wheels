'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage · PROJECT DETAIL — a scrapbook spread.
//
// PageHero (crumbs back to the list, the title filled with the project's own
// photo, the avenue as the handwritten kicker). Then: the main photo as a big
// taped print beside a kraft "On record" memo · the figures as stickers · the
// club's write-up on ruled notebook paper · every photo as a contact sheet of
// small prints that develop as they scroll in (PhotoLightbox, captions travel
// with the set, the open photo develops too) · the updates as a dated timeline
// of stapled notes, each opening its own panel exactly as Gold's popup does ·
// the share row as sticker buttons · the way back.
//
// Data + rules: useProjectData (goldData.useProjectGold -> loadProject) and
// useProjectShare/shareChannels, used as ProjectDetailGold uses them.
// ?pr=CE sends "back" to /projects?pr=CE; ?pid=0/unknown -> the designed not-found.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import {
  useClub, useProjectData, usePageTitle, avenueLabel, groupInt,
  useProjectShare, shareChannels, sharePopup, SHARE_ICONS, PhotoLightbox, LightboxStyles,
} from '../../_shared/data.js'
import { hideOnError } from '../../_shared/kit.jsx'
import {
  PageHero, SectionHead, StatRow, Memo, Print, Button, NotFound, Loading, Tape, TAPE_CYCLE,
  cleanText, htmlText, yearDash,
} from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, lockScroll, prefersReducedMotion, house, CLEAR, DEV0, DEV1 } from '../motion.js'
import './ProjectDetail.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SHARE_TONE = ['cran', 'azure', 'gold', 'turq', 'violet', 'royal', 'cran', 'azure']
const side = (i) => (i % 2 ? 1 : -1)

/** Day / month / year for a stamp, or null when the update carries no date (Gold's splitDate). */
function splitDate(raw) {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return { day: String(d.getDate()).padStart(2, '0'), mon: MON[d.getMonth()], year: d.getFullYear() }
}

/** "Jul 2026 – Aug 2026", or one month when every update falls in it (Gold's runSpan). */
function runSpan(list) {
  const ds = list.map((c) => (c.date ? new Date(c.date) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b)
  if (ds.length === 0) return ''
  const label = (d) => MON[d.getMonth()] + ' ' + d.getFullYear()
  const from = label(ds[0]), to = label(ds[ds.length - 1])
  return from === to ? from : from + ' – ' + to
}

/** Admin HTML can carry its own <h1>; the page's only h1 is the hero's. */
const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2')
/** Admin HTML that says nothing ("<p><br></p>") is no write-up. */
const hasBody = (html) => !!html && (htmlText(html) !== '' || /<img\b/i.test(html))

const Ico = ({ children }) => (
  <svg className="col-pjd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
)
const ZoomIco = () => <Ico><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21M11 8v6M8 11h6" /></Ico>
const CloseIco = () => <Ico><path d="M18 6 6 18M6 6l12 12" /></Ico>

// ── one update, in its own panel (Gold's popup: photos, figures, write-up) ───
function UpdatePanel({ c, currency, onClose, onPhoto }) {
  const sheetRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = 'col-pjd-upd-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  useLayoutEffect(() => {
    if (closeRef.current) closeRef.current.focus({ preventScroll: true })
    if (prefersReducedMotion() || !sheetRef.current) return undefined
    const t = gsap.fromTo(sheetRef.current, { y: 70, rotation: -4, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.6, ease: 'back.out(1.3)', clearProps: CLEAR })
    return () => t.kill()
  }, [c])
  const figs = [
    c.costText && ['Project cost', c.costText],
    c.beneficiaries > 0 && ['Beneficiaries', groupInt(c.beneficiaries, currency)],
    c.rotarians > 0 && ['Rotarians', groupInt(c.rotarians, currency)],
    c.manHours > 0 && ['Man hours', groupInt(c.manHours, currency)],
  ].filter(Boolean)
  const html = demoteH1(c.descriptionHtml).trim()

  return createPortal(
    <div className="col-pjd-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="col-pjd-modal-bg" onClick={onClose} aria-hidden="true" />
      <div className="col-pjd-modal-sheet" ref={sheetRef}>
        <button type="button" className="col-pjd-modal-x" ref={closeRef} onClick={onClose}>
          <span className="col-sr">Close update</span><CloseIco />
        </button>
        <div className="col-pjd-modal-paper" data-lenis-prevent="">
          <Tape tone="gold" tilt={-3} left="22%" />
          <p className="col-pjd-modal-kick">Project update</p>
          <h2 className="col-pjd-modal-t" id={titleId}>{cleanText(c.title) || 'Update'}</h2>
          {c.dateText || c.location ? (
            <p className="col-pjd-modal-meta">
              {c.dateText ? <span>{c.dateText}</span> : null}
              {c.location ? <span>{c.location}</span> : null}
            </p>
          ) : null}
          {c.photos.length ? (
            <ul className="col-pjd-modal-pics">
              {c.photos.map((ph, i) => (
                <li key={i} style={{ '--col-r': (side(i) * (1 + (i % 3))) + 'deg' }}>
                  <button type="button" onClick={(e) => onPhoto(c.photos, i, c.captions, e)}
                    aria-label={'View photo ' + (i + 1) + ' of ' + c.photos.length}>
                    <img src={ph} alt="" loading="lazy" decoding="async" width="400" height="300" onError={hideOnError} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {figs.length ? (
            <dl className="col-pjd-modal-figs">
              {figs.map(([l, n]) => <div key={l}><dt>{l}</dt><dd>{n}</dd></div>)}
            </dl>
          ) : null}
          {hasBody(html) ? <div className="col-pjd-prose" dangerouslySetInnerHTML={{ __html: html }} /> : null}
        </div>
      </div>
    </div>, document.body)
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectDetail({ data }) {
  const club = useClub()
  const loc = useLocation()
  const params = new URLSearchParams(loc.search)
  const pid = parseInt(params.get('pid'), 10) || 0
  const fromMeetings = params.get('pr') === 'CE'
  const listLabel = fromMeetings ? 'Club Services' : 'Projects'
  const backHref = fromMeetings ? '/projects?pr=CE' : '/projects'
  const backLabel = fromMeetings ? 'Back to Club Services' : 'Back to all projects'

  // demoChild (the local ?demoChild=1 preview) needs isLocalRequest, which data.js does not export.
  const { p, notFound } = useProjectData(pid, false, data)
  usePageTitle(notFound ? 'Project Not Found' : (p ? p.title : null))

  const share = useProjectShare({
    projectId: p ? p.id : 0,
    yearId: p ? p.yearId : null,
    fallback: p ? p.shareFallback : null,
  })
  const channels = shareChannels(share).filter((ch) => ch.href || ch.onClick)

  const [lb, setLb] = useState(null)             // { urls, caps, idx }
  const [openChild, setOpenChild] = useState(null)
  const lbBack = useRef(null)
  const childBack = useRef(null)
  const ref = useRef(null)
  const lbOpen = !!lb
  const childOpen = !!openChild

  // `caps` travel WITH the urls: an update's photos must not borrow the main set's captions.
  const openLb = (urls, start, caps, e) => {
    if (!urls || urls.length === 0) return
    lbBack.current = e ? e.currentTarget : null
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }
  const openUpdate = (c, e) => { childBack.current = e.currentTarget; setOpenChild(c) }

  // While the viewer or an update is open, the page behind is inert and does not scroll (Lenis too).
  // The lock is a class on <html>, not body.style: the shared viewer and the base
  // rotary-anim.js (on ANY Escape) both reset body.style.overflow, which let the
  // page behind an open update scroll again once its photo viewer was closed.
  useEffect(() => {
    if (!lbOpen && !childOpen) return undefined
    const app = document.getElementById('root')
    const html = document.documentElement
    if (app) app.inert = true
    html.classList.add('col-locked')
    lockScroll(true)
    return () => {
      if (app) app.inert = false
      html.classList.remove('col-locked')
      lockScroll(false)
    }
  }, [lbOpen, childOpen])

  // Focus into the viewer and back to whatever opened it.
  useEffect(() => {
    if (!lbOpen) return undefined
    const back = lbBack.current
    const raf = requestAnimationFrame(() => {
      const b = document.querySelector('.pdm-lb.open .pdm-lb__close')
      if (b) b.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      requestAnimationFrame(() => { if (back && back.isConnected) back.focus({ preventScroll: true }) })
    }
  }, [lbOpen])

  // The open photo develops from sepia each time it changes.
  useEffect(() => {
    if (!lb || prefersReducedMotion()) return undefined
    const img = document.querySelector('.pdm-lb.open .pdm-lb__img')
    if (!img) return undefined
    let t = null
    const run = () => { t = gsap.fromTo(img, { filter: DEV0 }, { filter: DEV1, duration: 1.2, ease: 'power2.out', clearProps: 'filter' }) }
    if (img.complete) run(); else img.addEventListener('load', run, { once: true })
    return () => { img.removeEventListener('load', run); if (t) t.kill(); gsap.set(img, { clearProps: 'filter' }) }
  }, [lb])

  // The update panel returns focus on close, and owns Esc only while the viewer (above it) is closed.
  useEffect(() => {
    if (!childOpen) return undefined
    const back = childBack.current
    return () => requestAnimationFrame(() => { if (back && back.isConnected) back.focus({ preventScroll: true }) })
  }, [childOpen])
  useEffect(() => {
    if (!childOpen || lbOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpenChild(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [childOpen, lbOpen])

  // The house style (prints deal + develop, captions write, memo settles, stickers
  // count up, section titles wipe) plus the updates' timeline drawing down.
  useScene(ref, (c) => {
    const root = ref.current
    const undo = house(root, c)
    const line = root.querySelector('.col-pjd-runs-line')
    if (line) {
      gsap.fromTo(line, { scaleY: 0 }, {
        scaleY: 1, ease: 'none', transformOrigin: '50% 0',
        scrollTrigger: { trigger: line.parentElement, start: 'top 80%', end: 'bottom 60%', scrub: 0.5 },
      })
    }
    return undo
  }, [p, notFound])
  useRefreshOnImages(ref, [p])

  // ── not found / loading ────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="col-pjd" ref={ref}>
        <PageHero title="Project not found" tint="cran" crumbs={[{ label: listLabel, href: backHref }, { label: 'Project not found' }]} />
        <section className="col-sec col-pjd-nf">
          <NotFound title="We couldn’t find that project"
            message="It may have been moved, or it is no longer published."
            backHref={backHref} backLabel={backLabel} />
        </section>
      </div>
    )
  }
  if (!p) {
    return (
      <div className="col-pjd" ref={ref}>
        <section className="col-sec col-pjd-wait"><Loading label="Loading the project" count={3} /></section>
      </div>
    )
  }

  const cur = club.currency
  const title = cleanText(p.title) || 'Project'
  const photos = p.photos || []
  const captions = p.photoCaptions || []
  const kids = p.children || []
  const html = demoteH1(p.description).trim()
  const av = avenueLabel(p.moduleKey)
  const Y = yearDash(club.selectedYearLabel)
  const figs = [
    p.cost !== null && p.cost > 0 && { value: p.cost, label: 'Total cost', money: true },
    p.beneficiaries > 0 && { value: p.beneficiaries, label: 'Beneficiaries' },
    p.rotarians > 0 && { value: p.rotarians, label: 'Rotarians involved' },
    p.manHours > 0 && { value: p.manHours, label: 'Man hours' },
  ].filter(Boolean)
  const record = [
    p.dateText && <><b>Date</b> {p.dateText}</>,
    p.location && <><b>Venue</b> {p.location}</>,
    Y && <><b>Rotary year</b> {Y}</>,
    photos.length > 1 && <><b>Photos</b> {photos.length}</>,
    kids.length > 0 && <><b>Updates</b> {kids.length}</>,
  ].filter(Boolean)
  const span = runSpan(kids)

  return (
    <div className="col-pjd" ref={ref}>
      <LightboxStyles />
      <PhotoLightbox urls={lb ? lb.urls : []} index={lb ? lb.idx : null} captions={lb ? lb.caps : null}
        onIndex={(i) => setLb((l) => (i === null || !l ? null : { ...l, idx: i }))} />

      <PageHero title={title} kicker={av || undefined} img={photos[0]} tint="cran"
        crumbs={[{ label: listLabel, href: backHref }, { label: title }]} />

      {/* ══ the spread: the main print + the record ══ */}
      {photos.length || record.length ? (
        <section className={'col-sec col-pjd-spread' + (photos.length ? ' has-photo' : '')} aria-label="Project details">
          {photos.length ? (
            <div className="col-pjd-main">
              <Print src={photos[0]} alt="" tape="gold" r={-2} k={0.7} speed={0.94}
                caption={captions[0] ? <span id="col-pjd-cap-main">{captions[0]}</span> : undefined}>
                <button type="button" className="col-btn is-ghost col-pjd-open" onClick={(e) => openLb(photos, 0, captions, e)}
                  aria-describedby={captions[0] ? 'col-pjd-cap-main' : undefined}>
                  <ZoomIco />{photos.length > 1 ? 'View all ' + photos.length + ' photos' : 'View full size'}
                </button>
              </Print>
            </div>
          ) : null}
          {record.length ? <Memo className="col-pjd-memo" title="On record" items={record} tape="azure" /> : null}
        </section>
      ) : null}

      {/* ══ the figures ══ */}
      {figs.length ? (
        <section className="col-sec col-pjd-nums" aria-labelledby="col-pjd-nums-h">
          <h2 className="col-pjd-cap" id="col-pjd-nums-h">By the numbers</h2>
          <StatRow items={figs} currency={p.currency} />
        </section>
      ) : null}

      {/* ══ the write-up, on ruled paper ══ */}
      {hasBody(html) ? (
        <section className="col-sec col-pjd-story" aria-labelledby="col-pjd-story-h">
          <SectionHead id="col-pjd-story-h" title="The story" img={photos[1] || photos[0]} tint="royal" />
          <div className="col-pjd-letter">
            <Tape tone="turq" tilt={-4} left="18%" />
            {/* Trusted admin rich HTML (wrappableHtml), rendered verbatim like Gold. */}
            <div className="col-pjd-prose" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </section>
      ) : null}

      {/* ══ the contact sheet ══ */}
      {photos.length > 1 ? (
        <section className="col-sec col-pjd-photos" aria-labelledby="col-pjd-photos-h">
          <SectionHead id="col-pjd-photos-h" title="Photographs" img={photos[2] || photos[0]} tint="azure"
            kicker={photos.length + ' photos. Select one to see it full size.'} />
          <ul className="col-pjd-sheet">
            {photos.map((url, i) => (
              <li key={i} className="col-pjd-shot">
                <Print src={url} alt="" tape={TAPE_CYCLE[i % 4]} r={[-3, 2, -1.5, 3, -2, 1][i % 6]} k={i % 2 ? -0.8 : 0.8} deal
                  caption={captions[i] ? <span id={'col-pjd-cap-' + i}>{captions[i]}</span> : undefined}>
                  <button type="button" className="col-pjd-shot-btn" onClick={(e) => openLb(photos, i, captions, e)}
                    aria-label={'View photo ' + (i + 1) + ' of ' + photos.length}
                    aria-describedby={captions[i] ? 'col-pjd-cap-' + i : undefined}>
                    <span className="col-pjd-shot-z" aria-hidden="true"><ZoomIco /></span>
                  </button>
                </Print>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ══ the updates: stapled notes on a pen line ══ */}
      {kids.length ? (
        <section className="col-sec col-pjd-updates" aria-labelledby="col-pjd-upd-h">
          <SectionHead id="col-pjd-upd-h" title="Project updates" tint="violet"
            kicker={kids.length + ' update' + (kids.length === 1 ? '' : 's') + (span ? ' · ' + span : '')} />
          <div className="col-pjd-runs-wrap">
            <span className="col-pjd-runs-line" aria-hidden="true" />
            <ol className="col-pjd-runs">
              {kids.map((c, i) => {
                const d = splitDate(c.date)
                return (
                  <li key={c.id} className="col-pjd-run" data-col-deal="" style={{ '--col-r': (side(i) * 3) + 'deg' }}>
                    <span className="col-pjd-stamp" aria-hidden={d ? 'true' : undefined}>
                      {d ? <><b>{d.day}</b><span>{d.mon} {d.year}</span></> : <span>Undated</span>}
                    </span>
                    <button type="button" className="col-pjd-note" aria-haspopup="dialog" onClick={(e) => openUpdate(c, e)}>
                      <span className="col-pjd-staple" aria-hidden="true" />
                      <span className="col-pjd-note-t">{cleanText(c.title) || 'Update'}</span>
                      {c.dateText || c.location || c.beneficiaries > 0 ? (
                        <span className="col-pjd-note-m">
                          {c.dateText ? <span className="col-sr">{c.dateText}. </span> : null}
                          {c.location ? <span>{c.location}</span> : null}
                          {c.beneficiaries > 0 ? <span>{groupInt(c.beneficiaries, cur)} beneficiaries</span> : null}
                        </span>
                      ) : null}
                      <span className="col-pjd-note-go">Read the update{c.photos.length ? ' · ' + c.photos.length + ' photo' + (c.photos.length === 1 ? '' : 's') : ''}</span>
                      {c.photos.length ? (
                        <span className="col-pjd-note-pic" aria-hidden="true">
                          <img src={c.photos[0]} alt="" loading="lazy" decoding="async" width="160" height="120" onError={hideOnError} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>
      ) : null}

      {/* ══ share + the way back ══ */}
      <section className="col-sec col-pjd-end" aria-labelledby={channels.length ? 'col-pjd-share-h' : undefined} aria-label={channels.length ? undefined : 'Back'}>
        {channels.length ? (
          <div className="col-pjd-share-wrap">
            <h2 className="col-pjd-cap" id="col-pjd-share-h">Share this project</h2>
            <ul className="col-pjd-share">
              {channels.map((ch, i) => {
                const tone = SHARE_TONE[i % SHARE_TONE.length]
                const style = { '--col-c': 'var(--col-' + tone + ')', '--col-fg': tone === 'gold' || tone === 'turq' ? 'var(--col-ink)' : '#fff', '--col-t': (side(i) * (3 + (i % 3) * 2)) + 'deg' }
                if (ch.brand) style['--col-pjd-brand'] = ch.brand
                const glyph = (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"
                    fill={ch.fill && !ch.done ? 'currentColor' : 'none'} stroke={ch.fill && !ch.done ? 'none' : 'currentColor'}
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {ch.done ? SHARE_ICONS.check : ch.icon}
                  </svg>
                )
                const newTab = ch.href && ch.key !== 'mail'
                return (
                  <li key={ch.key} style={style} className={ch.brand ? 'is-brand' : undefined}>
                    {ch.href ? (
                      <a href={ch.href} className="col-pjd-stk" aria-label={ch.label + (newTab ? ' (opens in a new tab)' : '')}
                        title={ch.label} target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}
                        onClick={ch.popup ? sharePopup : undefined}>{glyph}</a>
                    ) : (
                      <button type="button" className="col-pjd-stk" aria-label={ch.label} title={ch.label} onClick={ch.onClick}>{glyph}</button>
                    )}
                    {ch.doneLabel ? <span className={'col-pjd-toast' + (ch.done ? ' is-on' : '')} aria-live="polite">{ch.done ? ch.doneLabel : ''}</span> : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        <Button href={backHref} variant="ghost" className="col-pjd-back"><span aria-hidden="true">&larr;</span> {backLabel}</Button>
      </section>

      {openChild ? <UpdatePanel c={openChild} currency={cur} onClose={() => setOpenChild(null)} onPhoto={openLb} /> : null}
    </div>
  )
}
