'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · Event detail — one stop on the road ahead.
//
// Violet hero with the event as its title and the ticket stub (the listing's
// gold stub, day set large) hanging in the sky beside it; it swings in on
// arrival. Below, on cream: when + where (with a directions link) and the
// registration link when the club gave one, the poster (sticky on wide, opens
// the shared viewer), the club's own description, the way back to all events.
// Not found -> the kit's night NotFound. Data: useEventData(id) only
// (goldData.useEventGold: null loading, false not found; upcoming then past feed).
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useEventData, PhotoLightbox, LightboxStyles } from '../../_shared/data.js'
import { PageHero, Button, Loading, NotFound, useLightboxModal } from '../kit.jsx'
import { useScene, afterFonts, useRefreshOnImages, gsap, titleIn, rise, wipeIn, revealBatch } from '../motion.js'
import './EventDetail.css'

const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const trim = (v) => (v == null ? '' : String(v).trim())

const CAL = <svg className="hj-ed-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
const PIN = <svg className="hj-ed-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>

export default function EventDetail({ data }) {
  const location = useLocation()
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0
  const ev = useEventData(id, data)                        // null = loading, false = not found
  const [lb, setLb] = useState(null)
  const [badImg, setBadImg] = useState('')
  const ref = useRef(null)
  const shotRef = useRef(null)

  const ok = !!ev
  const title = ok ? trim(ev.title) || 'Club event' : ''
  const hasDate = ok && !!ev.year
  // ev.when is "dd MMMM yyyy, h:mm tt"; a midnight time means none was filed (homeData's rule)
  const [dateLong, rawTime] = ok ? String(ev.when || '').split(', ') : []
  const time = rawTime && rawTime !== '12:00 AM' ? rawTime : ''
  const past = hasDate && new Date(+ev.year, MONS.indexOf(ev.mon), +ev.day) < new Date().setHours(0, 0, 0, 0)
  const venue = ok ? trim(ev.venue) : ''
  const mapUrl = venue ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(venue) : ''
  const img = ok && ev.img && ev.img !== badImg ? ev.img : ''
  // trusted admin HTML (buildDescription); its h1s become h2s — the hero owns the page's only h1
  const html = ok && ev.descHtml ? String(ev.descHtml).replace(/<(\/?)h1\b/gi, '<$1h2') : ''

  // the shared viewer as a modal: page inert, focus on its close button, back to the poster after
  useLightboxModal(lb !== null, shotRef)

  const dataKey = ev === null ? 'wait' : ev === false ? 'none' : id + '|' + title + '|' + img + '|' + html.length
  useRefreshOnImages(ref, [dataKey])

  useScene(ref, (c, ctx) => afterFonts(ctx, () => {
    const r = ref.current
    // the ticket stub swings in on its string, like a tag caught by the evening wind
    const stub = r.querySelector('.hj-ed-stub')
    if (stub) gsap.fromTo(stub, { rotation: 16, yPercent: -18, opacity: 0 }, { rotation: 0, yPercent: 0, opacity: 1, duration: 1.8, delay: 0.45, ease: 'elastic.out(1, 0.45)', clearProps: 'transform,opacity' })
    rise(r.querySelectorAll('.hj-ed-fact, .hj-ed-cta'), r.querySelector('.hj-ed-facts'), { from: { x: 60, y: 0 }, stagger: 0.09 })
    wipeIn(r.querySelector('.hj-ed-shot'))
    titleIn(r.querySelector('.hj-ed-h2'))
    const prose = r.querySelector('.hj-ed-prose')
    if (prose) revealBatch(prose.children, { y: 24, stagger: 0.05 })
    rise(r.querySelector('.hj-ed-back'), null, { from: { x: -40, y: 0 } })
  }), [dataKey])

  if (ev === false) {
    return (
      <div className="hj-page hj-ground--cream hj-endpad hj-ed" ref={ref}>
        <NotFound title="Event not found" crumbs={[{ label: 'Upcoming events', href: '/events' }]}
                  message="The club’s upcoming events are listed on the events page."
                  backHref="/events" backLabel="All upcoming events" />
      </div>
    )
  }

  if (ev === null) {
    return (
      <div className="hj-page hj-ground--cream hj-endpad hj-ed" ref={ref}>
        <div className="hj-ed-wait"><Loading label="Loading the event" /></div>
      </div>
    )
  }

  return (
    <div className="hj-page hj-ground--cream hj-endpad hj-ed" ref={ref}>
      <LightboxStyles />
      {img ? <PhotoLightbox urls={[img]} index={lb} onIndex={setLb} /> : null}

      <PageHero tone="violet" title={title} menuTitle={false}
                crumbs={[{ label: 'Upcoming events', href: '/events' }]}
                aside={hasDate ? (
                  <div className="hj-ed-hang" aria-hidden="true">
                    <div className="hj-ed-stub">
                      <span className="hj-ed-stub__day">{ev.day}</span>
                      <span className="hj-ed-stub__mon">{ev.mon} {ev.year}</span>
                      {ev.weekday ? <span className="hj-ed-stub__wd">{ev.weekday}</span> : null}
                      {time ? <span className="hj-ed-stub__time">{time}</span> : null}
                      <span className="hj-ed-stub__art" />
                    </div>
                  </div>
                ) : null} />

      <section className={'hj-wrap hj-sec hj-ed-body' + (img ? ' has-shot' : '')} aria-label="Event details">
        {hasDate || venue || ev.reg ? (
          <div className="hj-ed-facts">
            {hasDate || venue ? (
              <dl className="hj-ed-dl">
                {hasDate ? (
                  <div className="hj-ed-fact">
                    <dt>{CAL}When</dt>
                    <dd>
                      <span className="hj-ed-fact__v">{[ev.weekday, dateLong].filter(Boolean).join(', ')}</span>
                      {time ? <span className="hj-ed-fact__s">{time}</span> : null}
                    </dd>
                  </div>
                ) : null}
                {venue ? (
                  <div className="hj-ed-fact">
                    <dt>{PIN}Where</dt>
                    <dd>
                      <span className="hj-ed-fact__v">{venue}</span>
                      <span className="hj-ed-fact__a"><Button href={mapUrl} variant="ghost" size="sm">Get directions</Button></span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {ev.reg ? (
              <p className="hj-ed-cta"><Button href={ev.reg}>Register<span className="hj-sr"> for {title}</span></Button></p>
            ) : null}
          </div>
        ) : null}

        {img ? (
          <div className="hj-ed-aside">
            <button ref={shotRef} type="button" className="hj-ed-shot" onClick={() => setLb(0)} aria-label="View the event photo full size">
              <img src={img} alt={title} width="800" height="1000" decoding="async" onError={() => setBadImg(img)} />
              <span className="hj-ed-shot__hint" aria-hidden="true">View full size</span>
            </button>
          </div>
        ) : null}

        {html ? (
          <div className="hj-ed-about">
            <h2 className="hj-ed-h2">About this event</h2>
            <div className="hj-prose hj-ed-prose" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        ) : null}

        <p className="hj-ed-back"><Button href="/events" variant="ink" icon="back">All events</Button></p>
      </section>
    </div>
  )
}
