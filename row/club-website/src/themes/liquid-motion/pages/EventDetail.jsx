'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · EVENT DETAIL — "the invitation".
// The ink hero carries the event's name (auto-fits), its weekday in the serif
// and the when line, with the day drifting behind in outline. Then paper: the
// sticky card on the right is the ticket - the date plate whose day rolls like
// an odometer as it arrives, When / Venue (+ Directions), Register only when the
// club filed a link, and the way back - while the left column shows the poster
// WHOLE (it's a flyer: never cropped into a banner strip; it wipes up and opens
// full size) above the club's own description.
// Data: useEventData(id) only (goldData.useEventGold: upcoming feed, then past).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useEventData, usePageTitle, PhotoLightbox, LightboxStyles } from '../../_shared/data.js'
import {
  PageHero, NotFound, Band, Card, Facts, Pill, Odometer, EmptyState, Loading, ArrowOut, SearchIco, useInertBehind,
  clean, clip,
} from '../kit.jsx'
import { usePageMotion, useScene, liquidMedia } from '../motion.js'
import './EventDetail.css'

const CRUMB = { label: 'Events', href: '/events' }

// Admin HTML sometimes carries its own <h1>; the hero's is the page's only one.
const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2')

/** "24 September 2026, 7:30 PM" -> "7:30 PM"; a midnight record has no time filed (the home's rule). */
const timeOf = (when) => {
  const t = String(when || '').split(', ')[1] || ''
  return t === '12:00 AM' ? '' : t
}

function Detail({ ev }) {
  const ref = useRef(null)
  const posterRef = useRef(null)
  const [broken, setBroken] = useState(false)
  const [lb, setLb] = useState(null)

  const title = clean(ev.title) || 'Event'
  const dated = !!ev.mon                    // an undated record comes back as day '--' with no month
  const time = dated ? timeOf(ev.when) : ''
  const when = dated ? (time ? ev.when : String(ev.when).split(', ')[0]) : ''
  const mapUrl = ev.venue ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue) : ''
  const desc = useMemo(() => demoteH1(ev.descHtml), [ev.descHtml])
  const shot = !!ev.img && !broken

  usePageMotion(ref, [ev, shot])
  // the poster wipes up and settles (no WebGL: its cover-zoom would crop a flyer's edges)
  useScene(ref, (c) => {
    const p = ref.current.querySelector('.liq-ed-poster .liq-media')
    if (p) liquidMedia(p, c, { gl: false })
  }, [ev, shot])

  // The shared lightbox owns Esc and the body lock; this adds what a dialog also
  // needs here: the page behind is inert, Lenis stops, focus moves in and
  // returns to the poster on close.
  const open = lb !== null
  useInertBehind(open)
  useEffect(() => {
    if (!open) return undefined
    const raf = requestAnimationFrame(() => {
      const b = document.querySelector('.pdm-lb.open .pdm-lb__close')
      if (b) b.focus()
    })
    const back = posterRef.current
    return () => {
      cancelAnimationFrame(raf)
      if (back) back.focus({ preventScroll: true })
    }
  }, [open])

  const venue = ev.venue ? (
    <>
      <span className="liq-ed-venue">{ev.venue}</span>
      <a className="liq-link" href={mapUrl} target="_blank" rel="noopener noreferrer">
        Directions<ArrowOut /><span className="liq-sr"> (opens in new tab)</span>
      </a>
    </>
  ) : ''

  return (
    <div className="liq-ed" ref={ref}>
      {shot ? (
        <>
          <LightboxStyles />
          <PhotoLightbox urls={[ev.img]} index={lb} onIndex={setLb} captions={[title]} />
        </>
      ) : null}

      <PageHero title={title} crumbs={[CRUMB, { label: clip(title, 48) }]} />

      <Band tone="paper" className="liq-ed-body" aria-label="Event details">
        <div className="liq-ed-cols">
          {/* first in the DOM: on a phone the when / where / register come before the poster */}
          <Card as="aside" className="liq-ed-card" aria-labelledby="liq-ed-card-h">
            <h2 className="liq-sr" id="liq-ed-card-h">When and where</h2>
            {dated ? (
              <p className="liq-ed-plate liq-rv">
                <span className="liq-ed-plate__d"><Odometer value={ev.day} /></span>
                <span className="liq-ed-plate__m">{[ev.mon, ev.year].filter(Boolean).join(' ')}</span>
                {ev.weekday ? <span className="liq-ed-plate__w">{ev.weekday}</span> : null}
              </p>
            ) : null}
            <Facts items={[['When', when], ['Venue', venue]]} />
            <div className="liq-ed-act liq-rv">
              {ev.reg ? <Pill href={ev.reg} variant="ink" external>Register</Pill> : null}
              <Pill href="/events" variant="line" back>All events</Pill>
            </div>
          </Card>

          <div className="liq-ed-main">
            {shot ? (
              <button type="button" className="liq-ed-poster" ref={posterRef} onClick={() => setLb(0)}
                      aria-label="View the event poster full size">
                <span className="liq-media liq-media--still liq-ed-poster__frame">
                  <img src={ev.img} alt="" decoding="async" onError={() => setBroken(true)} />
                  <span className="liq-ed-poster__cue" aria-hidden="true"><SearchIco />Full size</span>
                </span>
              </button>
            ) : null}
            {desc ? (
              <>
                <h2 className="liq-kicker liq-rv">About this event</h2>
                {/* trusted admin content (buildDescription wraps plain text in <p>), rendered like Gold */}
                <div className="liq-prose liq-rv" dangerouslySetInnerHTML={{ __html: desc }} />
              </>
            ) : shot ? null : (
              <EmptyState title="Details to follow" text="The club hasn’t added a description or poster for this event yet." />
            )}
          </div>
        </div>
      </Band>
    </div>
  )
}

export default function EventDetail({ data }) {
  const { search } = useLocation()
  const id = parseInt(new URLSearchParams(search).get('id'), 10) || 0
  const ev = useEventData(id, data)                // null loading · false not found · the event
  usePageTitle(ev === false ? 'Event' : (ev ? ev.title : null))

  if (ev === null) {
    return (
      <div className="liq-ed">
        <div className="liq-ed-wait"><div className="liq-wrap"><Loading label="Loading the event" /></div></div>
      </div>
    )
  }
  if (ev === false) {
    return (
      <div className="liq-ed">
        <NotFound
          title="Event not found"
          text="This event is no longer listed. It may have passed, or it may not be published yet."
          crumbs={[CRUMB, { label: 'Not found' }]}
          backHref="/events"
          backLabel="All events"
        />
      </div>
    )
  }
  // keyed by the event itself: moving to another event replays the entrance on ITS data
  return <Detail ev={ev} key={id + '|' + ev.title} />
}
