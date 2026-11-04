'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · EVENT DETAIL — the ticket, torn off.
// The hero projects a blurred copy of the poster behind the title; below it the
// page splits like the listing's "Next up" ticket, so clicking through continues
// that layout: the stub on the left (slate date, time, venue, Register when the
// club filed a link, Open in Maps), the club's own description under it, and on
// the right the poster in a lit screen frame that opens like a projector and
// stays beside you as you read (opens full size in the lightbox).
// Data: useEventData(id) only (goldData.useEventGold: upcoming feed, then past).
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useEventData, usePageTitle, PhotoLightbox, LightboxStyles } from '../../_shared/data.js'
import { PageHero, Button, DateStamp, NotFound, Loading, ArrowBack, ArrowOut, demoteH1, useModal } from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, riseIn, projectorOpen, parallax } from '../motion.js'
import './EventDetail.css'

const CRUMB = { label: 'Upcoming Events', href: '/events' }

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
  const shot = ev.img && !broken
  const title = ev.title || 'Event'
  const dated = !!ev.day && ev.day !== '--'
  const time = dated ? timeOf(ev.when) : ''
  const mapUrl = ev.venue ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue) : ''

  useScene(ref, (c) => {
    const root = ref.current
    riseIn(root.querySelectorAll('.cin-evd-stub > *'), { trigger: false, delay: 0.45, stagger: 0.08 })
    riseIn(root.querySelectorAll('.cin-evd-copy, .cin-evd-back'), { stagger: 0.1 })
    const screen = root.querySelector('.cin-evd-screen')
    if (screen) {
      // on phones the poster sits below the stub, so the projector waits until it is on screen
      gsap.timeline({ delay: 0.4, scrollTrigger: { trigger: screen, start: 'top 92%', once: true } })
        .add(projectorOpen(screen, { duration: 1.4 }))
      if (c.wide) parallax(root.querySelector('.cin-evd-screen__fill'), { amount: 8, trigger: screen })
    }
  }, [ev.title, shot])
  useRefreshOnImages(ref, [ev.title, ev.descHtml])

  // The shared lightbox owns Esc; useModal makes it a dialog (site inert, Lenis
  // stopped, focus in, and back on the poster when it closes).
  useModal(lb !== null, shotRef)

  return (
    <div ref={ref} className="cin-evd">
      {shot ? (
        <>
          <LightboxStyles />
          <PhotoLightbox urls={[ev.img]} index={lb} onIndex={setLb} captions={[title]} />
        </>
      ) : null}

      <PageHero
        title={title}
        eyebrow={ev.weekday || 'Club event'}
        crumbs={[CRUMB, { label: title }]}
        backdrop={shot ? ev.img : undefined}
      />

      <div className={'cin-sec cin-evd-body' + (shot ? ' has-shot' : '')}>
        <div className="cin-evd-stub">
          {dated ? <DateStamp day={ev.day} mon={ev.mon} year={ev.year} className="cin-evd-date" /> : null}
          {time || ev.venue ? (
            <dl className="cin-evd-facts">
              {time ? <div><dt>Time</dt><dd className="cin-evd-time">{time}</dd></div> : null}
              {ev.venue ? <div><dt>Venue</dt><dd><address>{ev.venue}</address></dd></div> : null}
            </dl>
          ) : null}
          {ev.reg || mapUrl ? (
            <div className="cin-evd-cta">
              {ev.reg ? <Button href={ev.reg} external>Register <ArrowOut /></Button> : null}
              {mapUrl ? <Button href={mapUrl} external variant="line">Open in Maps <ArrowOut /></Button> : null}
            </div>
          ) : null}
        </div>

        {shot ? (
          <div className="cin-evd-aside">
            <div className="cin-evd-screen">
              <img className="cin-evd-screen__fill" src={ev.img} alt="" />
              <button type="button" ref={shotRef} className="cin-evd-shot" onClick={() => setLb(0)}>
                <img className="cin-evd-shot__im" src={ev.img} alt="" width="800" height="1000" decoding="async" onError={() => setBroken(true)} />
                <span className="cin-sr">View the event picture full size</span>
              </button>
            </div>
          </div>
        ) : null}

        {ev.descHtml ? (
          <section className="cin-evd-copy" aria-labelledby="cin-evd-about-h">
            <h2 className="cin-evd-cap" id="cin-evd-about-h">About this event</h2>
            {/* Trusted admin content (buildDescription wraps plain text in <p>), rendered like Gold. */}
            <div className="cin-prose" dangerouslySetInnerHTML={{ __html: demoteH1(ev.descHtml) }} />
          </section>
        ) : null}

        <div className="cin-evd-back">
          <Button href="/events" variant="line"><ArrowBack /> All events</Button>
        </div>
      </div>
    </div>
  )
}

export default function EventDetail({ data }) {
  const location = useLocation()
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0
  const ev = useEventData(id, data)                    // null = loading, false = not found
  usePageTitle(ev === false ? 'Event not found' : ev ? ev.title || 'Event' : null)

  if (ev === null) return <Loading label="Loading event" />
  if (ev === false) {
    return (
      <NotFound
        title="Event not found"
        message="This event is no longer listed. It may have passed, or it may not be published yet."
        backHref="/events"
        backLabel="All events"
        crumbs={[CRUMB, { label: 'Event not found' }]}
      />
    )
  }
  return <Detail key={id} ev={ev} />
}
