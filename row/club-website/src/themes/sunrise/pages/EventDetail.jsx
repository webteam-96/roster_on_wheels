'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · EVENT DETAIL — the invitation at sunrise.
//
// The page head carries the event's name. Below, the page splits the way the
// listing's "Next up" does: the details panel (the date and time, where + Open
// in Maps, Register only when the club filed a link), the club's own
// description focus-pulling paragraph by paragraph at the reading line, and
// the way back. The poster sits in a window on the right - the whole picture
// over its own blurred light, never cropped - coming out of the depth and
// staying beside you as you read; it opens full size.
//
// Data: useEventData(id) only (Gold's hook: upcoming feed, then past, so
// calendar links into past events resolve). null = loading, false = not found.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useEventData, PhotoLightbox, LightboxStyles } from '../../_shared/data.js'
import { PageHero, Panel, Button, Loading, NotFound, noEmoji, demoteH1, ClockIcon, PinIcon, CalendarIcon, venueText } from '../kit.jsx'
import { useScene, useRefreshOnImages, gsap, flyTitle, focusPull, revealBatch, lockScroll } from '../motion.js'
import './EventDetail.css'

const CLEAR = 'transform,opacity,translate,rotate,scale'
const CRUMB = { label: 'Upcoming events', href: '/events' }
const MAPS = 'https://www.google.com/maps/search/?api=1&query='

function Detail({ ev }) {
  const ref = useRef(null)
  const openRef = useRef(null)
  const [broken, setBroken] = useState(false)
  const [lb, setLb] = useState(null)

  const title = noEmoji(ev.title) || 'Club event'
  const dated = !!ev.mon                               // no date on the record -> the hook's '--' placeholder
  // "24 September 2026, 6:30 PM"; a midnight record has no time filed (the home's rule)
  const [dateLine, t] = String(ev.when || '').split(', ')
  const time = dated && t && t !== '12:00 AM' ? t : ''
  const venue = venueText(ev.venue)
  const mapUrl = venue ? MAPS + encodeURIComponent(venue) : ''
  const shot = !!ev.img && !broken
  const descHtml = demoteH1(ev.descHtml)
  const facts = dated || !!venue || !!ev.reg

  useScene(ref, (c) => {
    const root = ref.current
    // the poster comes forward out of the depth
    const win = root.querySelector('.sun-evd-win')
    if (win) {
      gsap.fromTo(win, { z: -420, rotationX: 9, opacity: 0, transformPerspective: 1200 }, {
        z: 0, rotationX: 0, opacity: 1, duration: 1.3, delay: 0.3, ease: 'power3.out', clearProps: CLEAR,
        scrollTrigger: { trigger: win, start: 'top 96%', once: true },
      })
    }
    revealBatch(root.querySelectorAll('.sun-evd-facts, .sun-evd-back'), { y: 40, tilt: 10 })
    flyTitle(root.querySelectorAll('.sun-fly'), c)
    // the description sharpens as it reaches the reading line
    focusPull(root.querySelectorAll('.sun-evd-prose > *'), c)
  }, [ev.title, ev.descHtml, shot])
  useRefreshOnImages(ref, [ev.title, ev.descHtml])

  // The shared lightbox owns Esc and its own body lock; this adds what a dialog
  // also needs here: focus moves in, the page behind is inert and Lenis stops,
  // and focus returns to the poster on close.
  const open = lb !== null
  useEffect(() => {
    if (!open) return undefined
    const behind = [document.getElementById('main'), document.querySelector('.sun-hdr'), document.querySelector('.sun-foot')].filter(Boolean)
    behind.forEach((el) => { el.inert = true })
    lockScroll(true)
    const raf = requestAnimationFrame(() => {
      const b = document.querySelector('.pdm-lb.open .pdm-lb__close')
      if (b) b.focus()
    })
    const back = openRef.current
    return () => {
      cancelAnimationFrame(raf)
      behind.forEach((el) => { el.inert = false })
      lockScroll(false)
      if (back) back.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <div ref={ref} className="sun-page sun-evd">
      {shot ? (
        <>
          <LightboxStyles />
          <PhotoLightbox urls={[ev.img]} index={lb} onIndex={setLb} captions={[title]} />
        </>
      ) : null}

      <PageHero size="md" menuTitle={false} title={title} crumbs={[CRUMB, { label: title }]} />

      <div className={'sun-wrap sun-block sun-evd-body' + (shot ? ' has-shot' : '')}>
        {facts ? (
          <Panel as="section" className="sun-evd-facts" aria-labelledby="sun-evd-facts-h">
            <h2 id="sun-evd-facts-h" className="sun-eyebrow">Event details</h2>
            {dated || venue ? (
              <dl className="sun-evd-list">
                {dated ? (
                  <div className="sun-evd-fact">
                    <dt className="sun-evd-fact__k"><CalendarIcon />When</dt>
                    <dd className="sun-evd-fact__v">{[ev.weekday, dateLine].filter(Boolean).join(', ')}</dd>
                  </div>
                ) : null}
                {time ? (
                  <div className="sun-evd-fact">
                    <dt className="sun-evd-fact__k"><ClockIcon />Time</dt>
                    <dd className="sun-evd-fact__v">{time}</dd>
                  </div>
                ) : null}
                {venue ? (
                  <div className="sun-evd-fact">
                    <dt className="sun-evd-fact__k"><PinIcon />Where</dt>
                    <dd className="sun-evd-fact__v"><address className="sun-evd-addr">{venue}</address></dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {ev.reg || mapUrl ? (
              <div className="sun-evd-cta">
                {ev.reg ? <Button href={ev.reg} external>Register<span className="sun-sr"> for {title}</span></Button> : null}
                {mapUrl ? <Button href={mapUrl} external variant="line" small>Open in Maps</Button> : null}
              </div>
            ) : null}
          </Panel>
        ) : null}

        {shot ? (
          <div className="sun-evd-side">
            <div className="sun-win sun-evd-win">
              <div className="sun-win__slides">
                <div className="sun-win__slide is-on">
                  <img className="sun-win__fill" src={ev.img} alt="" aria-hidden="true" decoding="async" />
                  <img className="sun-win__img" src={ev.img} alt={title} width="800" height="1000" decoding="async" onError={() => setBroken(true)} />
                </div>
              </div>
              <button type="button" ref={openRef} className="sun-evd-win__open" onClick={() => setLb(0)}>
                <span className="sun-evd-win__hint" aria-hidden="true">Full size</span>
                <span className="sun-sr">View the event picture full size</span>
              </button>
            </div>
          </div>
        ) : null}

        {descHtml ? (
          <section className="sun-evd-about" aria-labelledby="sun-evd-about-h">
            <h2 id="sun-evd-about-h" className="sun-h2 sun-fly">About this event</h2>
            {/* Trusted admin content (buildDescription wraps plain text in <p>), rendered like Gold. */}
            <div className="sun-prose sun-evd-prose" dangerouslySetInnerHTML={{ __html: descHtml }} />
          </section>
        ) : null}

        <div className="sun-evd-back">
          <Button href="/events" variant="line" icon="back">All events</Button>
        </div>
      </div>
    </div>
  )
}

export default function EventDetail({ data }) {
  const location = useLocation()
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0
  const ev = useEventData(id, data)                    // null = loading, false = not found

  if (ev === null) {
    return <div className="sun-page sun-evd"><div className="sun-wrap sun-block"><Loading label="Loading event" /></div></div>
  }
  if (ev === false) {
    return (
      <NotFound
        title="Event not found"
        message="This event is no longer listed. It may have passed, or it may not be published yet."
        crumbs={[CRUMB, { label: 'Event not found' }]}
        backHref="/events"
        backLabel="All events"
      />
    )
  }
  return <Detail key={id} ev={ev} />
}
