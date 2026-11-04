'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · EVENT DETAIL — the invitation.
//
// The standard masthead carries the event's name, then the page splits: what you
// need to know on the left — the day set large, when and where, the two actions,
// the club's own description — and the poster itself on the right, where it stays
// with you as you read (user's call). It is deliberately the same composition the
// listing's "Next up" feature uses, so clicking through continues that layout
// instead of starting a new one.
//
// There is no event-detail endpoint: the page finds its event in the upcoming
// feed and falls back to the past feed — the same two-step the shared page does,
// without which every Calendar link into a past event 404s.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useLocation } from '@/site/router.js'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import PhotoLightbox, { LightboxStyles } from '@/themes/shared/PhotoLightbox.jsx'
import { useEventGold } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

const I = {
  pin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  cal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
  wheel: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M17.7 6.3l-2.1 2.1M8.4 15.6l-2.1 2.1" /></svg>,
}

export default function EventDetailGold({ data }) {
  const location = useLocation()
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0
  const ev = useEventGold(id, data)

  const [lbIndex, setLbIndex] = useState(null)

  usePageTitle(ev === false ? 'Event' : (ev ? ev.title : null))
  useRotaryAnim([ev])
  useRevealReplay('ged-page', [ev])

  if (ev === null) return null      // still resolving — never flash "not found"

  if (ev === false) {
    return (
      <div className="ged-page">
        <GPageHead
          crumbs={[{ label: 'Upcoming Events', href: '/events' }, { label: 'Event' }]}
          eyebrow="Club event"
          title="Event"
        />
        <div className="ged-wrap">
          <div className="gld-x">
            <GEmpty title="Event not found"
                    message="This event is no longer listed. It may have passed, or it may not be published yet."
                    action={<a href="/events" className="gld-btn gld-btn--gold">All upcoming events <Arrow /></a>}
                    icon={I.cal} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ged-page">
      <LightboxStyles />
      {ev.img && <PhotoLightbox urls={[ev.img]} index={lbIndex} onIndex={setLbIndex} />}

      {/* ══ 01 · Masthead — the standard band, the event as its title ══ */}
      <GPageHead
        crumbs={[{ label: 'Upcoming Events', href: '/events' }, { label: ev.title }]}
        eyebrow={<>You&rsquo;re invited</>}
        title={ev.title}
        sub={[ev.weekday, ev.when].filter(Boolean).join(' · ')}
      />

      {/* ══ 02 · Words left, poster right — the same split the listing's
              feature uses, so the page reads as a continuation of it ══ */}
      <div className="ged-wrap">
        <div className="gld-x gp-split">
          <div className="ged-main reveal">
            <p className="gp-bigdate"><b>{ev.day}</b><i>{ev.mon} {ev.year}</i></p>

            {/* WHEN is already on the band as the sub line and again as the big
                date, so this row carries only where. */}
            {ev.venue && (
              <div className="ged-meta">
                <span>{I.pin}{ev.venue}</span>
              </div>
            )}

            {/* Register is the reason to be on this page, so it stays above the
                fold; "All events" is a way OUT and belongs after you have read
                what this one is (user's call). */}
            {ev.reg && (
              <div className="ged-cta">
                <a href={ev.reg} target="_blank" rel="noopener noreferrer" className="gld-btn gld-btn--gold">
                  Register <Arrow />
                </a>
              </div>
            )}

            {ev.descHtml && (
              <>
                <p className="ged-rule" aria-hidden="true"><span />{I.wheel}<span /></p>
                {/* Trusted admin content — plain text is wrapped in <p> upstream. */}
                <div className="ged-copy gp-prose" dangerouslySetInnerHTML={{ __html: ev.descHtml }} />
              </>
            )}

            <div className="ged-cta">
              <a href="/events" className="gld-btn gld-btn--ghost">All events <Arrow /></a>
            </div>
          </div>

          {ev.img && (
            <button type="button" className="gp-shot reveal ged-shot" onClick={() => setLbIndex(0)}
                    aria-label="View the event photograph full size">
              <img className="gp-shot__bg" src={ev.img} alt="" aria-hidden="true" />
              <img className="gp-shot__im" src={ev.img} alt={ev.title} onError={hideOnError} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
