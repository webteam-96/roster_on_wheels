'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Event detail — the event as a ticket. The royal hero raises the
// event's name letter by letter under its weekday and date. Below, the split in
// miniature: on the left the gold date plate swings in and counts its day up
// (time, venue with a map link, Register only when the club filed a link), and
// stays beside the reading on tall wide screens; on the right the poster opens
// through the iris — contained over a blurred fill, so a flyer is never cropped —
// and opens full size in the lightbox, then the club's own description.
// Data: useEventData(id) only (upcoming feed, then past — goldData).
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useEventData, usePageTitle, PhotoLightbox, LightboxStyles } from '../../_shared/data.js'
import { PageHero, NotFound, Loading, Button, BackLink, TextLink, Num, useLightboxFocus } from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, riseIn, countUp, irisOnce } from '../motion.js'
import './EventDetail.css'

const EVENTS = { label: 'Upcoming events', href: '/events' }

/** "24 September 2026, 7:30 PM" -> "7:30 PM"; a midnight record has no time filed (the home's rule). */
const timeOf = (when) => {
  const t = String(when || '').split(', ')[1] || ''
  return t === '12:00 AM' ? '' : t
}

function Detail({ ev }) {
  const ref = useRef(null)
  const shotRef = useRef(null)
  const [broken, setBroken] = useState(false)
  const [lb, setLb] = useState(null)
  const title = ev.title || 'Event'
  const shot = !!ev.img && !broken
  const dated = !!ev.day && ev.day !== '--'
  const time = dated ? timeOf(ev.when) : ''
  const mapUrl = ev.venue ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue) : ''
  const plate = dated || time || ev.venue || ev.reg

  useRefreshOnImages(ref, [title, ev.descHtml, shot])
  useScene(ref, (c, ctx) => {
    const r = ref.current
    const p = r.querySelector('.spl-evd-plate')
    if (p) {
      // the plate swings in like the home's stacked cards, then its day counts up
      gsap.from(p, { yPercent: 12, rotation: -3, opacity: 0, duration: 1, delay: 0.35, ease: 'back.out(1.3)', clearProps: 'transform,opacity' })
      countUp(ctx, p.querySelector('.spl-num'), { trigger: p, start: 'top bottom', duration: 1.2, from: 1 })
      riseIn(p.querySelectorAll('.spl-evd-facts > div, .spl-evd-cta'), { delay: 0.75, stagger: 0.08 })
    }
    // the poster opens through the iris once it is on screen (below the plate on phones)
    irisOnce(r.querySelector('.spl-evd-poster'), { delay: 0.3, duration: 1.3 })
  }, [title, shot])

  // The shared lightbox owns Esc and the body lock; focus in, the page inert and focus back to the poster.
  useLightboxFocus(lb !== null, shotRef)

  return (
    <div className="spl-evd" ref={ref}>
      {shot ? (
        <>
          <LightboxStyles />
          <PhotoLightbox urls={[ev.img]} index={lb} onIndex={setLb} captions={[title]} />
        </>
      ) : null}

      <PageHero title={title} crumbs={[EVENTS, { label: title }]}
                eyebrow={dated ? [ev.weekday, ev.day + ' ' + ev.mon + ' ' + ev.year].filter(Boolean).join(' · ') : 'Club event'} />

      <section className="spl-section spl-evd-body" aria-label="Event details">
        <div className={'spl-x spl-evd-grid' + (shot || ev.descHtml ? ' has-main' : '')}>
          <div className="spl-evd-side">
            {plate ? (
              <div className="spl-evd-plate">
                <span className="spl-evd-ring" aria-hidden="true"><i /></span>
                {dated ? (
                  <p className="spl-evd-date">
                    <Num className="spl-evd-day" value={parseInt(ev.day, 10) || ev.day} fmt="pad" />{' '}
                    <span className="spl-evd-my">{ev.mon} {ev.year}</span>{' '}
                    {ev.weekday ? <span className="spl-evd-wd">{ev.weekday}</span> : null}
                  </p>
                ) : null}
                {time || ev.venue ? (
                  <dl className="spl-evd-facts">
                    {time ? <div><dt>Time</dt><dd className="spl-evd-time">{time}</dd></div> : null}
                    {ev.venue ? (
                      <div>
                        <dt>Venue</dt>
                        <dd><address>{ev.venue}</address></dd>
                        <dd><TextLink href={mapUrl} external>Open in maps</TextLink></dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                {ev.reg ? <div className="spl-evd-cta"><Button href={ev.reg} external variant="royal">Register</Button></div> : null}
              </div>
            ) : null}
            <BackLink href="/events">All events</BackLink>
          </div>

          {shot || ev.descHtml ? (
            <div className="spl-evd-main">
              {shot ? (
                <div className="spl-evd-poster">
                  <img className="spl-evd-fill" src={ev.img} alt="" aria-hidden="true" decoding="async" />
                  <button type="button" ref={shotRef} className="spl-evd-shot" onClick={() => setLb(0)}>
                    <img src={ev.img} alt="" width="900" height="1100" decoding="async" onError={() => setBroken(true)} />
                    <span className="spl-evd-zoom" aria-hidden="true">View full size</span>
                    <span className="spl-sr">View the event picture full size</span>
                  </button>
                </div>
              ) : null}
              {ev.descHtml ? (
                <section className="spl-evd-about" aria-labelledby="spl-evd-about-h">
                  <h2 className="spl-evd-cap" id="spl-evd-about-h">About this event</h2>
                  {/* Trusted admin content (buildDescription wraps plain text in <p>), rendered like Gold. */}
                  <div className="spl-prose" dangerouslySetInnerHTML={{ __html: ev.descHtml }} />
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export default function EventDetail({ data }) {
  const location = useLocation()
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0
  const ev = useEventData(id, data)                    // null = loading, false = not found
  usePageTitle(ev === false ? 'Event not found' : ev ? ev.title || 'Event' : null)

  if (ev === null) {
    return (
      <>
        <PageHero title="Event" crumbs={[EVENTS, { label: 'Event' }]} />
        <Loading label="Loading the event" />
      </>
    )
  }
  if (ev === false) {
    return (
      <NotFound title="Event not found" crumbs={[EVENTS, { label: 'Not found' }]}
                message="This event is no longer listed. It may have passed, or it may not be published yet."
                backHref="/events" backLabel="All events" />
    )
  }
  return <Detail key={id} ev={ev} />
}
