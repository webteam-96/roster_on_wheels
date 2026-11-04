'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Project detail — one project told as the theme's split. The
// royal hero carries the title (letters rise), avenue, date and venue, and the
// first photograph opening through the iris as the page scrolls. Then the sticky
// panel follows the reader: "The project" counts to the day it happened,
// "Impact" swings the non-zero figures in on stacked cards, "Updates" (the child
// projects, as ProjectDetailGold shows them) is the gold-to-azure timeline whose
// panel date ticks to each update's day, and "Photos" numbers the frames 01, 02…
// as they pass, each opening through the iris or the diagonal wipe. The gold band
// rises at the end with the share row and the way back.
//
// Data + rules: useProjectData (goldData.useProjectGold -> loadProject, incl. the
// child-project recovery) and useProjectShare/shareChannels, used as
// ProjectDetailGold uses them. ?pr=CE sends "back" to /projects?pr=CE;
// ?pid=0/unknown -> the designed NotFound. Update photos keep their own captions.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import {
  useClub, useProjectData, usePageTitle, avenueLabel, groupInt,
  useProjectShare, shareChannels, sharePopup, SHARE_ICONS, PhotoLightbox, LightboxStyles,
} from '../../_shared/data.js'
import {
  PageHero, Split, Chapter, StatStack, Timeline, TimelineItem, GoldBand, Button, BackLink,
  NotFound, Loading, SafeImg, fig, yearText, useLightboxFocus,
} from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, photosIn, lockScroll, motionOn, irisOpen, irisClose } from '../motion.js'
import './ProjectDetail.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const UPD_PAGE = 10

/** "Jul 2026 – Aug 2026", or one month when every update falls in it (ProjectDetailGold's runSpan). */
function runSpan(list) {
  const ds = list.map((c) => (c.date ? new Date(c.date) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b)
  if (ds.length === 0) return ''
  const label = (d) => MON[d.getMonth()] + ' ' + d.getFullYear()
  const from = label(ds[0]), to = label(ds[ds.length - 1])
  return from === to ? from : from + ' – ' + to
}

/** "05 Mar 2026" (fmtDate) -> { day: 5, rest: 'Mar 2026' }, or null. */
function dayOf(text) {
  const m = /^(\d{1,2}) (\S+ \d{4})$/.exec(String(text || '').trim())
  return m ? { day: +m[1], rest: m[2] } : null
}

/** Admin HTML can carry its own <h1>; the page's only h1 is the hero's. */
const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2').trim()

/** Viewport centre of the element that opened a dialog, as "x y" for the iris. */
const centreOf = (el) => {
  if (!el || !el.getBoundingClientRect) return '50% 50%'
  const r = el.getBoundingClientRect()
  return (r.left + r.width / 2) + 'px ' + (r.top + r.height / 2) + 'px'
}

// ── photos: numbered frames, iris / wipe alternately, each a panel state ────
function Photos({ photos, captions, onOpen }) {
  const ref = useRef(null)
  const sig = photos.join('|')
  const n = photos.length
  useScene(ref, () => { photosIn(ref.current.querySelectorAll('.spl-pd-shot-frame')) }, [sig])
  useRefreshOnImages(ref, [sig])
  return (
    <div className="spl-pd-photos" ref={ref}>
      <p className="spl-pd-cap">{n} photographs · select one to view it full size</p>
      <ul className="spl-pd-sheet">
        {photos.map((url, i) => (
          <li key={i} className={'spl-pd-shot' + (i === 0 ? ' is-lead' : '')}
              {...fig({ title: 'Photos', value: i + 1, from: i, fmt: 'pad', caption: captions[i] || 'Photo ' + (i + 1) + ' of ' + n })}>
            <button type="button" className="spl-pd-shot-btn" onClick={(e) => onOpen(i, e)}
                    aria-label={'View photo ' + (i + 1) + ' of ' + n}
                    aria-describedby={captions[i] ? 'spl-pd-shotcap-' + i : undefined}>
              <span className="spl-pd-shot-frame">
                <SafeImg src={url} alt="" width={i === 0 ? '1600' : '800'} height={i === 0 ? '900' : '600'} />
              </span>
              <span className="spl-pd-shot-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            </button>
            {captions[i] ? <p className="spl-pd-shot-cap" id={'spl-pd-shotcap-' + i}>{captions[i]}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── the share row (on the gold band) ─────────────────────────────────────────
function ShareRow({ channels }) {
  return (
    <ul className="spl-pd-share">
      {channels.map((ch) => {
        const glyph = (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"
               fill={ch.fill && !ch.done ? 'currentColor' : 'none'} stroke={ch.fill && !ch.done ? 'none' : 'currentColor'}
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ch.done ? SHARE_ICONS.check : ch.icon}
          </svg>
        )
        const newTab = !!ch.href && ch.key !== 'mail'
        return (
          <li key={ch.key}>
            {ch.href ? (
              <a className="spl-pd-sh" href={ch.href} title={ch.label} aria-label={ch.label + (newTab ? ' (opens in a new tab)' : '')}
                 target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}
                 onClick={ch.popup ? sharePopup : undefined}>{glyph}</a>
            ) : (
              <button type="button" className="spl-pd-sh" title={ch.label} aria-label={ch.label} onClick={ch.onClick}>{glyph}</button>
            )}
            {ch.doneLabel ? <span className={'spl-pd-sh-toast' + (ch.done ? ' is-on' : '')} aria-live="polite">{ch.done ? ch.doneLabel : ''}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

// ── one update in its own dialog (ProjectDetailGold's popup: photos, figures, write-up) ──
function UpdateDialog({ c, currency, at, lbOpen, onClose, onPhoto }) {
  const rootRef = useRef(null)
  const closeRef = useRef(null)
  const closing = useRef(false)
  const titleId = useId()

  useLayoutEffect(() => {
    const r = rootRef.current
    if (closeRef.current) closeRef.current.focus({ preventScroll: true })
    if (!motionOn()) return undefined
    // The theme's iris, grown out of the button that opened it (the menu's motion).
    irisOpen(r, at)
    return () => { gsap.killTweensOf(r); gsap.set(r, { clearProps: 'clipPath' }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c])

  const close = () => {
    if (closing.current) return
    if (!motionOn() || !rootRef.current) { onClose(); return }
    closing.current = true
    irisClose(rootRef.current, at, onClose)
  }

  // Esc belongs to the photo viewer while it is open (it sits above this dialog).
  useEffect(() => {
    if (lbOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const trap = (e) => {
    if (e.key !== 'Tab') return
    const f = [...rootRef.current.querySelectorAll('a[href], button:not([disabled])')]
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const figs = [
    c.costText && ['Project cost', c.costText],
    c.beneficiaries > 0 && ['Beneficiaries', groupInt(c.beneficiaries, currency)],
    c.rotarians > 0 && ['Rotarians', groupInt(c.rotarians, currency)],
    c.manHours > 0 && ['Man hours', groupInt(c.manHours, currency)],
  ].filter(Boolean)
  const html = demoteH1(c.descriptionHtml)
  const meta = [c.dateText, c.location].filter(Boolean)

  return createPortal(
    <div className="spl-pd-dlg" ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trap}>
      <div className="spl-pd-dlg-bg" onClick={close} aria-hidden="true" />
      <div className="spl-pd-dlg-panel" data-lenis-prevent="">
        <div className="spl-pd-dlg-head spl-on-dark">
          <p className="spl-pd-dlg-eyebrow">Project update</p>
          <button type="button" className="spl-pd-dlg-x" ref={closeRef} onClick={close}>
            Close <span aria-hidden="true">&#x2715;</span>
          </button>
          <h2 className="spl-pd-dlg-title" id={titleId}>{c.title}</h2>
          {meta.length ? <p className="spl-pd-dlg-meta">{meta.join(' · ')}</p> : null}
        </div>
        <div className="spl-pd-dlg-body">
          {c.photos.length ? (
            <ul className="spl-pd-dlg-pics">
              {c.photos.map((ph, i) => (
                <li key={i}>
                  <button type="button" className="spl-pd-dlg-pic" onClick={(e) => onPhoto(c.photos, i, c.captions, e)}
                          aria-label={'View photo ' + (i + 1) + ' of ' + c.photos.length}>
                    <SafeImg src={ph} alt="" width="400" height="300" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {figs.length ? (
            <dl className="spl-pd-dlg-figs">
              {figs.map(([l, v]) => <div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}
            </dl>
          ) : null}
          {html ? <div className="spl-prose spl-pd-dlg-prose" dangerouslySetInnerHTML={{ __html: html }} /> : null}
          {!c.photos.length && !figs.length && !html ? <p className="spl-pd-none">No further details were published for this update.</p> : null}
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
  usePageTitle(notFound ? 'Project not found' : (p ? p.title : null))

  const share = useProjectShare({
    projectId: p ? p.id : 0,
    yearId: p ? p.yearId : null,
    fallback: p ? p.shareFallback : null,
  })
  const channels = shareChannels(share).filter((ch) => ch.href || ch.onClick)

  const [lb, setLb] = useState(null)               // { urls, caps, idx }
  const [child, setChild] = useState(null)         // { c, at }
  const [updLimit, setUpdLimit] = useState(UPD_PAGE)
  const lbBack = useRef(null)
  const childBack = useRef(null)
  const updFocus = useRef(-1)
  const pageRef = useRef(null)
  const lbOpen = !!lb
  const childOpen = !!child

  useEffect(() => { setUpdLimit(UPD_PAGE); setChild(null); setLb(null) }, [p])

  // `caps` travel WITH the urls: an update's photos must not borrow the main set's captions.
  const openLb = (urls, start, caps, e) => {
    if (!urls || urls.length === 0) return
    lbBack.current = e ? e.currentTarget : null
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }
  const openUpdate = (c, e) => { childBack.current = e.currentTarget; setChild({ c, at: centreOf(e.currentTarget) }) }

  // While the viewer or an update is open the page behind does not scroll (Lenis too).
  useEffect(() => {
    if (!lbOpen && !childOpen) return undefined
    const root = document.documentElement
    root.classList.add('spl-pd-locked')
    lockScroll(true)
    return () => { root.classList.remove('spl-pd-locked'); lockScroll(false) }
  }, [lbOpen, childOpen])

  // Focus into the viewer (the rest inert), and back to whatever opened it.
  useLightboxFocus(lbOpen, lbBack)

  // ...and back to the update's button when its dialog closes.
  useEffect(() => {
    if (!childOpen) return undefined
    const back = childBack.current
    return () => requestAnimationFrame(() => { if (back && back.isConnected) back.focus({ preventScroll: true }) })
  }, [childOpen])

  // "Show all updates": focus moves to the first newly shown update.
  useEffect(() => {
    if (updFocus.current < 0 || !pageRef.current) return
    const b = pageRef.current.querySelectorAll('.spl-pd-upd-open')[updFocus.current]
    updFocus.current = -1
    if (b) b.focus({ preventScroll: true })
  }, [updLimit])

  useRefreshOnImages(pageRef, [p, updLimit])

  if (notFound) {
    return (
      <NotFound title="Project not found"
                message="We couldn’t find the project you were looking for. It may have been moved, or it is no longer published."
                crumbs={[{ label: listLabel, href: backHref }, { label: 'Project not found' }]}
                backHref={backHref} backLabel={backLabel} />
    )
  }
  // Nothing claims "not found" before the fetch resolves.
  if (!p) {
    return (
      <>
        <PageHero title={fromMeetings ? 'Meeting' : 'Project'} crumbs={[{ label: listLabel, href: backHref }, { label: fromMeetings ? 'Meeting' : 'Project' }]} />
        <Loading label="Loading the project" />
      </>
    )
  }

  const cur = club.currency
  const title = p.title || (fromMeetings ? 'Meeting' : 'Project')
  const avenue = avenueLabel(p.moduleKey) || ''
  const photos = p.photos || []
  const captions = p.photoCaptions || []
  const kids = p.children || []
  const html = demoteH1(p.description)
  const year = yearText(club.selectedYearLabel)
  const when = dayOf(p.dateText)

  const figs = [
    p.cost !== null && p.cost > 0 && { label: 'Total cost', value: p.cost, fmt: 'moneyFull', currency: p.currency },
    p.beneficiaries > 0 && { label: 'Beneficiaries', value: p.beneficiaries, currency: cur },
    p.rotarians > 0 && { label: 'Rotarians involved', value: p.rotarians, currency: cur },
    p.manHours > 0 && { label: 'Man hours', value: p.manHours, currency: cur },
  ].filter(Boolean)

  const facts = [
    avenue && ['Avenue', avenue],
    p.dateText && ['Date', p.dateText],
    year && ['Rotary year', year],
    p.location && ['Venue', p.location],
  ].filter(Boolean)

  const rail = ['The project', figs.length && 'Impact', kids.length && 'Updates', photos.length > 1 && 'Photos'].filter(Boolean)
  const sig = [p.id, figs.length, kids.length, updLimit, photos.length].join('|')
  const span = runSpan(kids)
  const shownKids = kids.slice(0, updLimit)
  const impactSub = p.dateText || year

  return (
    <div className="spl-pd" ref={pageRef}>
      <LightboxStyles />
      <PhotoLightbox urls={lb ? lb.urls : []} index={lb ? lb.idx : null} captions={lb ? lb.caps : null}
                     onIndex={(i) => setLb((l) => (i === null || !l ? null : { ...l, idx: i }))} />

      <PageHero
        title={title}
        eyebrow={avenue || undefined}
        crumbs={[{ label: listLabel, href: backHref }, { label: title }]}
        lead={[p.dateText, p.location].filter(Boolean).join(' · ') || undefined}
        media={photos.length ? { src: photos[0], alt: captions[0] || '' } : undefined}
      >
        <div className="spl-pd-hero-actions">
          <BackLink href={backHref}>{backLabel}</BackLink>
          {photos.length ? (
            <Button variant="light" arrow={false} onClick={(e) => openLb(photos, 0, captions, e)}>
              {photos.length > 1 ? 'View all ' + photos.length + ' photos' : 'View the photo full size'}
            </Button>
          ) : null}
        </div>
      </PageHero>

      <Split rail={rail} deps={[sig]}>
        <Chapter id="spl-pd-about" title="The project"
                 state={when ? { value: when.day, from: 1, fmt: 'pad', caption: when.rest, sub: p.location }
                   : { value: year, caption: year ? 'Rotary year' : '', sub: p.location }}>
          <div className="spl-wrap">
            {facts.length ? (
              <dl className="spl-pd-facts">
                {facts.map(([k, v]) => <div key={k} className={k === 'Venue' ? 'is-long' : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            ) : null}
            {/* Trusted admin rich HTML (already wrappable), rendered verbatim like Gold. */}
            {html ? <div className="spl-prose spl-pd-prose" dangerouslySetInnerHTML={{ __html: html }} />
              : <p className="spl-pd-none">The club has not published a write-up for this {fromMeetings ? 'meeting' : 'project'} yet.</p>}
          </div>
        </Chapter>

        {figs.length ? (
          <Chapter id="spl-pd-impact" title="Impact"
                   state={{ value: figs[0].value, fmt: figs[0].fmt || 'group', currency: cur, caption: figs[0].label, sub: impactSub }}>
            {/* every figure in ONE row (client, 2026-10-05) */}
            <div className="spl-wrap"><StatStack items={figs} grid className="is-row" panel={{ title: 'Impact', sub: impactSub }} /></div>
          </Chapter>
        ) : null}

        {kids.length ? (
          <Chapter id="spl-pd-updates" title="Updates"
                   state={{ value: kids.length, fmt: 'pad', caption: kids.length === 1 ? 'Update' : 'Updates', sub: span }}>
            <div className="spl-wrap">
              {/* The same words the Projects card said ("3 updates"), plus how long it has run. */}
              <p className="spl-pd-cap">{kids.length} update{kids.length === 1 ? '' : 's'}{span ? ' · ' + span : ''}</p>
              <Timeline watch={sig} className="spl-pd-upds">
                {shownKids.map((c, i) => {
                  const d = dayOf(c.dateText)
                  const pos = (i + 1) + ' of ' + kids.length
                  return (
                    <TimelineItem key={c.id} label={c.dateText || 'Undated'} tag={c.location || undefined}
                                  photo={c.photos[0]} title={c.title}
                                  state={d ? { title: 'Updates', value: d.day, from: 1, fmt: 'pad', caption: d.rest, sub: pos }
                                    : { title: 'Updates', value: i + 1, from: i, fmt: 'pad', caption: 'Undated', sub: pos }}>
                      {c.beneficiaries > 0 ? <p className="spl-tl-desc">{groupInt(c.beneficiaries, cur)} beneficiaries</p> : null}
                      <Button variant="ghost" className="spl-pd-upd-open" aria-haspopup="dialog" onClick={(e) => openUpdate(c, e)}>
                        Read this update<span className="spl-sr">: {c.title}</span>
                      </Button>
                    </TimelineItem>
                  )
                })}
              </Timeline>
              {shownKids.length < kids.length ? (
                <div className="spl-pd-more">
                  <Button variant="royal" arrow={false} onClick={() => { updFocus.current = shownKids.length; setUpdLimit(kids.length) }}>
                    Show all {kids.length} updates
                  </Button>
                </div>
              ) : null}
            </div>
          </Chapter>
        ) : null}

        {photos.length > 1 ? (
          <Chapter id="spl-pd-photos" title="Photos"
                   state={{ value: photos.length, fmt: 'pad', caption: 'Photographs' }}>
            <Photos photos={photos} captions={captions} onOpen={(i, e) => openLb(photos, i, captions, e)} />
          </Chapter>
        ) : null}
      </Split>

      {/* only the share icons: no project type behind it, no back button (client, 2026-10-05) */}
      <GoldBand id="spl-pd-share-h" title="Share this project">
        <ShareRow channels={channels} />
      </GoldBand>

      {child ? (
        <UpdateDialog c={child.c} at={child.at} currency={cur} lbOpen={lbOpen}
                      onClose={() => setChild(null)} onPhoto={openLb} />
      ) : null}
    </div>
  )
}
