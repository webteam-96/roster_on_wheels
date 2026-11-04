'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · PROJECT DETAIL — "the story, then the pictures".
// The ink hero carries the avenue, the title and the lead photograph, which wipes
// up through the liquid edge. A paper band sets the club's write-up beside a
// sticky record card (facts, the non-zero figures rolling in as the card arrives,
// the share row). Then an ink wall of liquid photographs (WebGL ripple on desktop
// for 12 or fewer) that open the shared viewer with their captions, and - when
// the project runs on - a gold band of its updates as liquid-fill rows, each
// opening a panel that floods in from where it was pressed.
// Data: useProjectData(pid) only (goldData.useProjectGold -> loadProject, with the
// child-project recovery) - the same view-model, rules and states as Gold.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import {
  useClub, useProjectData, usePageTitle, avenueLabel, groupInt,
  useProjectShare, shareChannels, sharePopup, SHARE_ICONS, PhotoLightbox, LightboxStyles,
} from '../../_shared/data.js'
import {
  PageHero, NotFound, Band, SectionHead, Card, Facts, StatRow, Media, Pill, EmptyState, Loading, Arrow, CloseIco,
  useInertBehind, clip, yearText,
} from '../kit.jsx'
import { usePageMotion } from '../motion.js'
import './ProjectDetail.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jul 2026 – Aug 2026", or one month when every update falls in it (as Gold). */
function runSpan(list) {
  const ds = list.map((c) => (c.date ? new Date(c.date) : null))
    .filter((x) => x && !Number.isNaN(x.getTime()))
    .sort((a, b) => a - b)
  if (!ds.length) return ''
  const label = (x) => MON[x.getMonth()] + ' ' + x.getFullYear()
  const from = label(ds[0]), to = label(ds[ds.length - 1])
  return from === to ? from : from + ' – ' + to
}

// Admin HTML sometimes carries its own <h1>; the hero's is the page's only one.
const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2')
/** Admin HTML, or plain text whose line breaks must survive (no tags at all). */
function Prose({ html, className = '' }) {
  const plain = !/<[a-z!\/]/i.test(html)
  return <div className={'liq-prose liq-pd-prose' + (plain ? ' liq-pd-prose--plain' : '') + (className ? ' ' + className : '')}
              dangerouslySetInnerHTML={{ __html: demoteH1(html) }} />
}

/** The row's liquid flood starts where the pointer entered (as the kit's RowLink). */
function flood(e) {
  const el = e.currentTarget, r = el.getBoundingClientRect()
  el.style.setProperty('--liq-mx', (e.clientX - r.left) + 'px')
  el.style.setProperty('--liq-my', (e.clientY - r.top) + 'px')
}

/** Figures that are actually filed (zero = not shown, as Gold). */
function figures(x, currency, costLabel) {
  return [
    x.costText && { label: costLabel, value: x.costText },
    x.beneficiaries > 0 && { label: 'Beneficiaries', value: groupInt(x.beneficiaries, currency) },
    x.rotarians > 0 && { label: 'Rotarians involved', value: groupInt(x.rotarians, currency) },
    x.manHours > 0 && { label: 'Man-hours', value: groupInt(x.manHours, currency) },
  ].filter(Boolean)
}

/** One update's panel body: its own photos (with its own captions), figures and write-up. */
function UpdateBody({ c, titleId, currency, onPhoto }) {
  const figs = figures(c, currency, 'Project cost')
  return (
    <>
      <p className="liq-kicker">Project update</p>
      <h2 className="liq-pd-panel__t" id={titleId}>{c.title}</h2>
      {c.dateText || c.location ? (
        <p className="liq-pd-meta">{c.dateText ? <span>{c.dateText}</span> : null}{c.location ? <span>{c.location}</span> : null}</p>
      ) : null}
      {c.photos.length ? (
        <ul className="liq-pd-thumbs">
          {c.photos.map((u, i) => (
            <li key={i}>
              <button type="button" className="liq-pd-hit" onClick={(e) => onPhoto(c.photos, i, c.captions, e)}
                      aria-label={'View photo ' + (i + 1) + ' of ' + c.photos.length + (c.captions[i] ? ': ' + c.captions[i] : '')}>
                <Media src={u} ratio="1 / 1" label="Photo" className="liq-media--still" whole />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {figs.length ? <StatRow items={figs} className="liq-pd-figs" /> : null}
      {c.descriptionHtml ? <Prose html={c.descriptionHtml} /> : null}
    </>
  )
}

export default function ProjectDetail({ data }) {
  const club = useClub()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const pid = parseInt(params.get('pid'), 10) || 0
  const fromMeetings = params.get('pr') === 'CE'
  const backHref = fromMeetings ? '/projects?pr=CE' : '/projects'
  const listLabel = fromMeetings ? 'Club Services' : 'Projects'
  const backLabel = fromMeetings ? 'Back to Club Services' : 'All projects'

  // ponytail: no local ?demoChild=1 preview - data.js exports no isLocalRequest (sharedRequest).
  const { p, notFound } = useProjectData(pid, false, data)
  usePageTitle(notFound ? 'Project Not Found' : (p ? p.title : null))

  // The API's share payload (canonical club-domain URL, ready-made text, card); p.shareFallback keeps the row working without it.
  const share = useProjectShare({ projectId: p ? p.id : 0, yearId: p ? p.yearId : null, fallback: p ? p.shareFallback : null })
  const channels = shareChannels(share)

  const [lb, setLb] = useState(null)             // { urls, caps, idx } - the shared viewer
  const [openChild, setOpenChild] = useState(null)
  const [at, setAt] = useState(null)             // where the update panel floods from
  const lbFrom = useRef(null)
  const childFrom = useRef(null)
  const panelX = useRef(null)
  const panelId = useId()

  // `caps` travel WITH the urls: an update's photo 2 must not show the gallery's caption 2 (as Gold).
  const openLb = (urls, start, caps, e) => {
    if (!urls || !urls.length) return
    lbFrom.current = e ? e.currentTarget : null
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }
  const openUpdate = (c, e) => {
    const r = e.currentTarget.getBoundingClientRect()
    childFrom.current = e.currentTarget
    setAt(e.clientX || e.clientY ? [e.clientX, e.clientY] : [r.left + r.width / 2, r.top + r.height / 2])
    setOpenChild(c)
  }

  // While either overlay is open the page behind is inert (Tab stays in the overlays) and smooth scroll pauses.
  const anyOpen = !!(lb || openChild)
  useInertBehind(anyOpen, '[data-pdm-lightbox], .liq-pd-modal')

  // The panel owns Esc (and the page's scroll lock) only while the viewer is closed - the viewer sits above it (as Gold).
  useEffect(() => {
    if (!openChild || lb) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpenChild(null) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [openChild, lb])

  // Focus moves into an overlay when it opens and back to what opened it when it closes.
  const lbOpen = !!lb
  useEffect(() => {
    if (lbOpen) {
      const b = document.querySelector('.pdm-lb.open .pdm-lb__close')
      if (b) b.focus()
    } else if (lbFrom.current) {
      lbFrom.current.focus({ preventScroll: true })
      lbFrom.current = null
    }
  }, [lbOpen])
  const childOpen = !!openChild
  useEffect(() => {
    if (childOpen) { if (panelX.current) panelX.current.focus() } else if (childFrom.current) {
      childFrom.current.focus({ preventScroll: true })
      childFrom.current = null
    }
  }, [childOpen])

  const ref = useRef(null)
  usePageMotion(ref, [notFound, p])

  if (notFound) {
    return (
      <NotFound title="Project not found"
                text="We couldn’t find that project. It may have been moved, or it is no longer published."
                crumbs={[{ label: listLabel, href: backHref }, { label: 'Not found' }]}
                backHref={backHref} backLabel={backLabel} />
    )
  }
  // Nothing claims "not found" before the fetch resolves (as Gold) - a quiet ink stage meanwhile.
  if (!p) {
    return (
      <div className="liq-pd liq-pd--wait" ref={ref}>
        <div className="liq-wrap"><Loading label="Loading project" /></div>
      </div>
    )
  }

  const photos = p.photos || []
  const captions = p.photoCaptions || []
  const kids = p.children || []
  const av = avenueLabel(p.moduleKey)
  const figs = figures({ ...p, costText: p.cost !== null && p.cost > 0 ? p.costText : '' }, club.currency, 'Total cost')
  const span = runSpan(kids)
  const last = kids.length ? 'gold' : photos.length > 1 ? 'ink' : 'paper'
  const end = (
    <div className="liq-pd-end liq-rv">
      <Pill back href={backHref} variant={last === 'ink' ? 'light' : 'ink'}>{backLabel}</Pill>
    </div>
  )

  return (
    <div className="liq-pd" ref={ref}>
      <PageHero title={p.title} crumbs={[{ label: listLabel, href: backHref }, { label: clip(p.title, 40) }]} />

      <Band tone="paper" className="liq-pd-body" aria-labelledby="liq-pd-story-h">
        <div className="liq-pd-cols">
          <div className="liq-pd-main">
            {photos.length ? (
              /* the whole photo (client, 2026-09-29: never cropped); it opens full size */
              <button type="button" className="liq-pd-cover liq-rv" onClick={(e) => openLb(photos, 0, captions, e)}
                      aria-label={'View the photo full size' + (photos.length > 1 ? ', 1 of ' + photos.length : '')}>
                <Media src={photos[0]} ratio="16 / 10" label="Photo" className="liq-media--nohover" whole eager />
              </button>
            ) : null}
            <h2 className="liq-kicker liq-rv" id="liq-pd-story-h">About this project</h2>
            {p.description
              /* trusted admin rich HTML (already wrappableHtml), rendered verbatim like Gold */
              ? <Prose html={p.description} className="liq-rv" />
              : <EmptyState as="h3" title="No write-up yet" text="The club hasn’t added a description for this project." />}
          </div>
          <Card as="aside" className="liq-pd-card" aria-labelledby="liq-pd-card-h">
            <h2 className="liq-pd-cap liq-rv" id="liq-pd-card-h">Project record</h2>
            <Facts items={[
              ['Avenue', av],
              ['Date', p.dateText],
              ['Venue', p.location],
              ['Rotary year', yearText(club.selectedYearLabel)],
            ]} />
            {figs.length ? <StatRow items={figs} className="liq-pd-figs" /> : null}
            <div className="liq-pd-share liq-rv">
              <p className="liq-pd-cap">Share this project</p>
              <ul className="liq-pd-share__row">
                {channels.map((ch) => {
                  const glyph = (
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill={ch.fill ? 'currentColor' : 'none'}
                         stroke={ch.fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {ch.done ? SHARE_ICONS.check : ch.icon}
                    </svg>
                  )
                  const ext = ch.href && ch.key !== 'mail'
                  return (
                    <li key={ch.key}>
                      {ch.href ? (
                        <a className="liq-pd-share__b" href={ch.href} title={ch.label} onClick={ch.popup ? sharePopup : undefined}
                           {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                          {glyph}<span className="liq-sr">{ch.label}{ext ? ' (opens in new tab)' : ''}</span>
                        </a>
                      ) : (
                        <button type="button" className="liq-pd-share__b" title={ch.label} onClick={ch.onClick}>
                          {glyph}<span className="liq-sr">{ch.label}</span>
                        </button>
                      )}
                      {ch.doneLabel ? <span className="liq-pd-toast" aria-live="polite">{ch.done ? ch.doneLabel : ''}</span> : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          </Card>
        </div>
        {last === 'paper' ? end : null}
      </Band>

      {photos.length > 1 ? (
        <Band tone="ink" className="liq-pd-photos" aria-labelledby="liq-pd-ph-h">
          <SectionHead kicker={photos.length + ' photographs'} big={['In', 'pictures']} id="liq-pd-ph-h" />
          <ul className="liq-pd-wall">
            {photos.map((u, i) => (
              <li key={i}>
                <figure className="liq-pd-fig">
                  <button type="button" className="liq-pd-hit" onClick={(e) => openLb(photos, i, captions, e)}
                          aria-label={'View photo ' + (i + 1) + ' of ' + photos.length}>
                    <Media src={u} ratio="4 / 3" label="Photo" className="liq-media--nohover" whole />
                  </button>
                  {captions[i] ? <figcaption className="liq-pd-figcap">{captions[i]}</figcaption> : null}
                </figure>
              </li>
            ))}
          </ul>
          {last === 'ink' ? end : null}
        </Band>
      ) : null}

      {kids.length ? (
        <Band tone="gold" className="liq-pd-upd" aria-labelledby="liq-pd-upd-h">
          {/* the listing card's word ("3 updates") plus how long the project has run (as Gold) */}
          <SectionHead kicker="Project updates" title={kids.length + (kids.length === 1 ? ' update' : ' updates')}
                       id="liq-pd-upd-h" lede={span || null} />
          <ul className="liq-rows">
            {kids.map((c) => (
              <li className="liq-rv" key={c.id}>
                <button type="button" className="liq-row liq-pd-run" aria-haspopup="dialog"
                        onPointerEnter={flood} onClick={(e) => openUpdate(c, e)}>
                  <span className="liq-row__t">{c.title}</span>
                  <span className="liq-row__m liq-pd-m">
                    <span>{c.dateText || 'Undated'}</span>
                    {c.location ? <span>{c.location}</span> : null}
                    {c.beneficiaries > 0 ? <span>{groupInt(c.beneficiaries, club.currency)} beneficiaries</span> : null}
                  </span>
                  <span className="liq-row__go">View<Arrow /></span>
                </button>
              </li>
            ))}
          </ul>
          {end}
        </Band>
      ) : null}

      <LightboxStyles />
      <PhotoLightbox urls={lb ? lb.urls : []} index={lb ? lb.idx : null} captions={lb ? lb.caps : null}
                     onIndex={(i) => setLb((l) => (i === null || !l ? null : { ...l, idx: i }))} />
      {/* Portalled to <body> so position:fixed means the viewport (as Gold). */}
      {openChild ? createPortal(
        <div className="liq-pd-modal" role="dialog" aria-modal="true" aria-labelledby={panelId}
             style={at ? { '--liq-pd-x': at[0] + 'px', '--liq-pd-y': at[1] + 'px' } : undefined}>
          <div className="liq-pd-modal__bg" onClick={() => setOpenChild(null)} />
          <div className="liq-pd-panel" data-lenis-prevent="">
            <button type="button" className="liq-pd-panel__x" ref={panelX} onClick={() => setOpenChild(null)}>
              <CloseIco /><span className="liq-sr">Close update</span>
            </button>
            <UpdateBody c={openChild} titleId={panelId} currency={club.currency} onPhoto={openLb} />
          </div>
        </div>, document.body) : null}
    </div>
  )
}
