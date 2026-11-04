'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO COLLAGE · EVENT DETAIL (/event?id=) — the invitation.
//
// The event's name is the page title, filled with its own photo. Below it the
// poster is a big taped print (it opens full size), and beside it a kraft ticket
// hangs on a drawn string: the stub carries the day, the body the date, time and
// venue with a map link. Register (only when the club filed a link), then the
// club's description on ruled notebook paper, then the way back.
//
// useEventData(id) is Gold's hook: null while it looks (upcoming feed, then the
// past feed), false when the event isn't listed -> PageHero + NotFound.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from 'react'
import { useLocation } from '@/site/router.js'
import { useEventData, usePageTitle, PhotoLightbox, LightboxStyles } from '../../_shared/data.js'
import { useScene, useRefreshOnImages, gsap, CLEAR, DEV0, DEV1, revealBatch, parallax } from '../motion.js'
import { PageHero, Print, Button, NotFound, Loading, Draw, Tape, P, cleanText, useLightbox } from '../kit.jsx'
import './EventDetail.css'

const CRUMB = { label: 'Upcoming events', href: '/events' }

function Missing() {
  return (
    <div className="col-evd">
      <PageHero title="Event not found" crumbs={[CRUMB, { label: 'Event not found' }]} tint="violet" />
      <section className="col-sec col-evd-state">
        <NotFound
          title="This event isn’t listed"
          message="It may have passed, or it may not be published yet."
          backHref="/events"
          backLabel="All upcoming events"
        />
      </section>
    </div>
  )
}

function Detail({ ev }) {
  const ref = useRef(null)
  const lb = useLightbox()                       // modal viewer: focus in and back, page inert

  const title = cleanText(ev.title) || 'Club event'
  const dated = !!ev.year                        // no date on the record -> no stub, no date row
  const cut = ev.when ? ev.when.lastIndexOf(', ') : -1   // "26 September 2026, 1:42 PM"
  const date = dated ? [ev.weekday, cut > 0 ? ev.when.slice(0, cut) : ev.day + ' ' + ev.mon + ' ' + ev.year].filter(Boolean).join(', ') : ''
  const time = dated && cut > 0 ? ev.when.slice(cut + 2) : ''
  const mapUrl = ev.venue ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue) : ''
  const hasTicket = dated || !!ev.venue
  // the hook also finds PAST events (Calendar links to them): those are not an invitation
  const mi = dated ? 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(String(ev.mon).slice(0, 3)) / 3 : -1
  const past = mi >= 0 && new Date(+ev.year, mi, +ev.day + 1) <= new Date()

  useRefreshOnImages(ref, [ev])
  useScene(ref, (c) => {
    const root = ref.current
    const q = (s) => Array.from(root.querySelectorAll(s)).filter((el) => !el.closest('.col-ph'))
    revealBatch(q('[data-col-deal]'))
    parallax(q('.col-print-move[data-col-speed]'), { wide: c.wide })
    // everything here is near the top of the page, so each piece plays once, timed
    q('.col-evd-poster img').forEach((img) => gsap.fromTo(img, { filter: DEV0 }, {
      filter: DEV1, duration: 1.5, delay: 0.35, ease: 'power2.out', clearProps: 'filter',
      scrollTrigger: { trigger: img, start: 'top 92%', once: true },
    }))
    const hold = root.querySelector('.col-evd-hold')
    if (hold) {
      gsap.timeline({ delay: 0.3, scrollTrigger: { trigger: hold, start: 'top 92%', once: true } })
        .fromTo(hold.querySelectorAll('.col-evd-string .col-draw'), { strokeDashoffset: 1.02 }, { strokeDashoffset: 0, duration: 0.55, ease: 'power2.inOut', clearProps: 'strokeDashoffset' })
        .fromTo(hold.querySelector('.col-evd-hang'), { rotation: 16, y: -40 }, { rotation: 0, y: 0, duration: 1.9, ease: 'elastic.out(1, 0.36)', clearProps: CLEAR }, 0.4)
    }
    q('.col-evd-rise').forEach((el) => gsap.from(el, {
      y: 50, rotation: 2, opacity: 0, duration: 0.9, ease: 'power3.out', clearProps: CLEAR,
      scrollTrigger: { trigger: el, start: 'top 94%', once: true },
    }))
  }, [ev])

  return (
    <div className="col-evd" ref={ref}>
      {ev.img ? <><LightboxStyles /><PhotoLightbox urls={[ev.img]} index={lb.index} onIndex={lb.setIndex} /></> : null}

      <PageHero
        className={title.length > 30 ? 'col-evd-long' : ''}
        title={title}
        crumbs={[CRUMB, { label: title }]}
        kicker={past ? 'From the club’s diary' : 'You’re invited'}
        img={ev.img}
        tint="violet"
      />

      <section className="col-sec col-evd-body" aria-label="Event details">
        <div className={'col-evd-in' + (ev.img ? ' has-img' : '')}>
          {hasTicket ? (
            <div className="col-evd-hold">
              <Draw d={P.string} viewBox="0 0 40 112" className="col-evd-string" />
              <div className="col-evd-hang">
                <div className={'col-evd-ticket' + (dated ? '' : ' is-undated')}>
                  {dated ? (
                    <p className="col-evd-stub">
                      <span className="col-evd-day">{ev.day}</span>
                      <span className="col-evd-mon">{ev.mon} {ev.year}</span>
                    </p>
                  ) : null}
                  <div className="col-evd-tbody">
                    <dl className="col-evd-facts">
                      {date ? <div><dt>Date</dt><dd>{date}</dd></div> : null}
                      {time ? <div className="is-time"><dt>Time</dt><dd>{time}</dd></div> : null}
                      {ev.venue ? <div><dt>Venue</dt><dd>{ev.venue}</dd></div> : null}
                    </dl>
                    {mapUrl ? (
                      <a className="col-evd-map" href={mapUrl} target="_blank" rel="noopener noreferrer">Open in maps<span className="col-sr"> (opens in a new tab)</span></a>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {ev.reg ? (
            <p className="col-evd-cta"><Button href={ev.reg} external>Register for this event</Button></p>
          ) : null}

          {ev.img ? (
            <div className="col-evd-poster">
              <Print src={ev.img} alt={title} tape="gold" r={-2.5} k={0.8} ratio="auto" speed={1.05} deal>
                <button type="button" className="col-evd-zoom" aria-haspopup="dialog" onClick={(e) => lb.open(0, e)}>
                  <span className="col-evd-zoom-t">View full size<span className="col-sr">: event photo</span></span>
                </button>
              </Print>
            </div>
          ) : null}

          {ev.descHtml ? (
            <div className="col-evd-note col-evd-rise">
              <Tape tone="azure" tilt={-3} />
              <h2 className="col-evd-h">About this event</h2>
              {/* trusted admin content; plain text is wrapped in <p> upstream (buildDescription) */}
              {/* the admin's own <h1> becomes <h2>: the page's only h1 is the hero's */}
              <div className="col-evd-prose" dangerouslySetInnerHTML={{ __html: String(ev.descHtml).replace(/<(\/?)h1\b/gi, '<$1h2') }} />
            </div>
          ) : null}

          <p className="col-evd-back">
            <Button href="/events" variant="ghost"><span aria-hidden="true">←</span> All upcoming events</Button>
          </p>
        </div>
      </section>
    </div>
  )
}

export default function EventDetail({ data }) {
  const location = useLocation()
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0
  const ev = useEventData(id, data)                    // null = looking, false = not listed
  usePageTitle(ev === false ? 'Event not found' : ev ? cleanText(ev.title) || 'Event' : null)

  if (ev === null) {
    return (
      <div className="col-evd">
        <section className="col-sec col-evd-state"><Loading label="Loading the event" count={1} /></section>
      </div>
    )
  }
  if (ev === false) return <Missing />
  return <Detail key={id} ev={ev} />
}
