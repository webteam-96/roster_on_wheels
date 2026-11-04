'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO COLLAGE · EVENTS — tickets on a string.
//
// The next event is a big kraft ticket hanging on its own string beside its
// taped photo. Everything after it is grouped under handwritten month headings.
// In each month a drawn string runs across the page, and each event hangs from it
// on a peg as a notched ticket: the day in Shrikhand on the stub, the title in
// Kalam, the venue, and the event's photo as a small clipped print. The tickets
// swing in on their string as each month scrolls up.
//
// The data is useEventsData exactly as Gold uses it (this Rotary year, by date).
// Rows dated before today, if the feed has any, go under "Earlier this year". A
// club with nothing on gets the kraft empty note, with the club's regular meeting
// on a hanging tag beside it.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from 'react'
import { useClub, useEventsData, useAboutData } from '../../_shared/data.js'
import { useScene, useRefreshOnImages, gsap, CLEAR, DEV0, DEV1, titleIn, drawIn, revealBatch, parallax, develop } from '../motion.js'
import {
  usePageName, PageHero, SectionHead, Print, Button, Chip, Tag, Circled, EmptyState, Loading,
  Draw, Underline, P, TAPE_CYCLE, cleanText, excerpt, yearDash,
} from '../kit.jsx'
import './Events.css'

// the string between two pegs: high at the ends, pulled down where the ticket hangs
const SAG = 'M0 3 Q 75 5, 150 14 Q 225 5, 300 3'
const TILT = [-2, 1.5, -1, 2.5]
const SWAY = [0.7, -0.8, 0.9, -0.6]

const Pin = () => (
  <svg className="col-ev-pin" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
)
const Clip = () => (
  <svg className="col-ev-clip" viewBox="0 0 26 62" aria-hidden="true" focusable="false"><path d={P.clip} /></svg>
)

/** "Today" / "Tomorrow" / "In 17 days" (Gold's wording); null once the day has passed. */
function countdown(ts, midnight) {
  if (!ts) return null
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - midnight) / 86400000)
  if (days < 0) return null
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 31) return 'In ' + days + ' days'
  const weeks = Math.round(days / 7)
  return weeks < 9 ? 'In ' + weeks + ' weeks' : 'In ' + Math.round(days / 30) + ' months'
}

/** Month groups straight from the ordered list (no empty month headings). */
function byMonth(rows) {
  const out = []
  for (const e of rows) {
    const last = out[out.length - 1]
    if (!last || last.label !== e.monthLabel) out.push({ label: e.monthLabel, rows: [e] })
    else last.rows.push(e)
  }
  return out
}

/**
 * A ticket (or the meeting tag) drops onto its string and swings to rest as it
 * comes up: its string draws first when it has its own, then the swing. Timed,
 * not scrubbed, so a ticket already on screen never sits frozen mid-swing.
 */
function hangIn(h, i) {
  const hold = h.closest('.col-tag-wrap, .col-ev-next-hold')
  const ink = hold ? hold.querySelectorAll('.col-draw') : []
  const s = i % 2 ? 1 : -1
  const tl = gsap.timeline({ scrollTrigger: { trigger: hold || h.parentElement, start: 'top 90%', once: true } })
  if (ink.length) tl.fromTo(ink, { strokeDashoffset: 1.02 }, { strokeDashoffset: 0, duration: 0.55, stagger: 0.5, ease: 'power2.inOut', clearProps: 'strokeDashoffset' })
  tl.fromTo(h, { rotation: s * 16, y: -36 }, { rotation: 0, y: 0, duration: 1.7, ease: 'elastic.out(1, 0.38)', clearProps: CLEAR }, ink.length ? 0.4 : (i % 3) * 0.12)
}

/**
 * A notched kraft ticket. The title link is stretched over the whole ticket;
 * the action buttons sit above it.
 */
function Ticket({ e, i = 0, H = 'h4', big = false, near }) {
  const title = cleanText(e.title) || 'Club event'
  const href = '/event?id=' + e.id
  return (
    <article className={'col-ev-ticket' + (big ? ' is-big' : '')} style={{ '--col-r': (big ? -2 : TILT[i % 4]) + 'deg', '--col-k': big ? 0.6 : SWAY[i % 4] }}>
      <p className="col-ev-stub">
        <span className="col-ev-day">{e.day}</span>
        <span className="col-ev-mon">{e.mon} {e.year}</span>
        {e.weekday ? <span className="col-ev-wd">{e.weekday}</span> : null}
      </p>
      <div className="col-ev-body">
        {!big && e.img ? (
          <Print className="col-ev-snap" src={e.img} tape="" r={i % 2 ? -5 : 5} k={-0.6} ratio="1 / 1"><Clip /></Print>
        ) : null}
        {big && near ? <p className="col-ev-near"><Chip tone="gold">{near}</Chip></p> : null}
        <H className="col-ev-title"><a href={href}>{title}</a></H>
        {e.venue ? <p className="col-ev-venue"><Pin /><span>{e.venue}</span></p> : null}
        {big && e.desc ? <p className="col-ev-desc">{excerpt(e.desc, 220)}</p> : null}
        {/* every ticket gets its own button (client, 2026-10-05), not only the next event */}
        <p className="col-ev-acts">
          <Button href={href} variant="ink">View details<span className="col-sr">: {title}</span></Button>
          {e.reg ? <Button href={e.reg} external>Register<span className="col-sr">: {title}</span></Button> : null}
        </p>
      </div>
    </article>
  )
}

/** One month: a handwritten heading, then tickets pegged along a drawn string. */
function Month({ g }) {
  return (
    <div className="col-ev-month">
      <h3 className="col-ev-mh"><span>{g.label}</span><Underline scroll /></h3>
      <ul className="col-ev-line">
        {g.rows.map((e, i) => (
          <li key={e.id} className="col-ev-item">
            <Draw d={SAG} viewBox="0 0 300 18" stretch scroll className="col-ev-seg" />
            <span className="col-ev-peg" aria-hidden="true" />
            <div className="col-ev-hang"><Ticket e={e} i={i} /></div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Events({ data }) {
  const club = useClub()
  const name = usePageName('Upcoming events')
  const events = useEventsData(data)                 // null while loading; this Rotary year, by date
  const about = useAboutData(data)                   // the regular meeting, for the empty state
  const ref = useRef(null)

  const midnight = new Date().setHours(0, 0, 0, 0)
  const list = events || []
  const upcoming = list.filter((e) => !(e.ts < midnight))
  const past = list.filter((e) => e.ts < midnight)
  const next = upcoming[0] || null
  const restGroups = byMonth(upcoming.slice(1))
  const pastGroups = byMonth(past)

  const Y = yearDash(club.selectedYearLabel)
  const yearText = Y ? 'Rotary year ' + Y : 'this Rotary year'
  const photos = list.filter((e) => e.img)
  const heroImg = (next && next.img) || (photos[0] && photos[0].img) || ''
  const prints = photos.slice(0, 3).map((e) => ({ src: e.img, caption: excerpt(e.title, 34) }))
  const near = next ? countdown(next.ts, midnight) : null

  // the regular meeting (same fields and '—' guard the home tag uses)
  const day = about.meetingDay && about.meetingDay !== '—' ? about.meetingDay : ''
  const meet = [['Day', day], ['Time', about.meetingTime], ['Venue', about.meetingVenue]].filter(([, v]) => v && v !== '—')
  const mapUrl = about.meetingVenue && about.meetingVenue !== '—' ? about.mapUrl : ''

  useRefreshOnImages(ref, [events])
  useScene(ref, (c) => {
    const root = ref.current
    // house() minus its scrubbed tag swing: a hanging thing near the top of a
    // short page would sit mid-swing until scrolled, so hangIn() plays on entry
    const body = (sel) => Array.from(root.querySelectorAll(sel)).filter((el) => !el.closest('.col-ph'))
    titleIn(body('.col-head-title'))
    drawIn(body('svg.col-scroll-draw').filter((el) => !el.closest('.col-tag-wrap')))
    revealBatch(body('[data-col-deal]'))
    parallax(body('.col-print-move[data-col-speed]'), { wide: c.wide })
    develop(body('.col-ev-snap img'))
    // the next event's photo is often on screen at load: it develops once, timed
    body('.col-ev-next-photo img').forEach((img) => gsap.fromTo(img, { filter: DEV0 }, {
      filter: DEV1, duration: 1.4, delay: 0.3, ease: 'power2.out', clearProps: 'filter',
      scrollTrigger: { trigger: img, start: 'top 92%', once: true },
    }))
    body('.col-ev-hang, .col-tag').forEach(hangIn)
  }, [events, about.loading])

  const lead = upcoming.length ? upcoming.length + (upcoming.length === 1 ? ' event' : ' events') + ' coming up in ' + yearText + '.' : null

  return (
    <div className="col-ev" ref={ref}>
      <PageHero title={name} kicker={Y ? 'Rotary year ' + Y : null} lead={lead} img={heroImg} tint="violet" prints={prints} />

      {events === null ? (
        <section className="col-sec col-ev-state"><Loading label="Loading events" count={3} /></section>
      ) : null}

      {events && !upcoming.length ? (
        <section className="col-sec col-ev-none" aria-label="No upcoming events">
          <div className={'col-ev-none-in' + (meet.length ? ' has-meet' : '')}>
            <EmptyState
              title={past.length ? 'Nothing else coming up' : 'No events scheduled'}
              message={'No events are listed for ' + yearText + '. New ones are pinned up here as the club schedules them.'}
              action={<Button href="/calendar" variant="ink">Open the club calendar</Button>}
            />
            {meet.length ? (
              <Tag className="col-ev-meet">
                <p className="col-ev-meet-k">Meanwhile, the club meets</p>
                <dl className="col-ev-meet-facts">
                  {meet.map(([k, v]) => (
                    <div key={k} className={'is-' + k.toLowerCase() + (k === 'Day' && v.length > 10 ? ' is-long' : '')}>
                      <dt>{k}</dt>
                      <dd>{k === 'Day' ? <Circled>{v}</Circled> : v}</dd>
                    </div>
                  ))}
                </dl>
                {mapUrl ? (
                  <a className="col-ev-map" href={mapUrl} target="_blank" rel="noopener noreferrer">Open in maps<span className="col-sr"> (opens in a new tab)</span></a>
                ) : null}
              </Tag>
            ) : null}
          </div>
        </section>
      ) : null}

      {next ? (
        <section className="col-sec col-ev-next" aria-label="Next event">
          <div className={'col-ev-next-in' + (next.img ? ' has-img' : '')}>
            {next.img ? (
              <div className="col-ev-next-photo">
                <Print src={next.img} tape={TAPE_CYCLE[2]} r={-3} k={0.8} ratio="auto" speed={1.06} deal />
              </div>
            ) : null}
            <div className="col-ev-next-hold">
              <Draw d={P.string} viewBox="0 0 40 112" className="col-ev-next-string" />
              <div className="col-ev-hang is-big"><Ticket e={next} H="h3" big near={near} /></div>
            </div>
          </div>
        </section>
      ) : null}

      {restGroups.length ? (
        <section className="col-sec col-ev-more" aria-labelledby="col-ev-more-t">
          <SectionHead id="col-ev-more-t" title="Still to come" img={photos[1] ? photos[1].img : heroImg} tint="azure" />
          <div className="col-ev-months">{restGroups.map((g) => <Month key={g.label} g={g} />)}</div>
        </section>
      ) : null}

      {pastGroups.length ? (
        <section className="col-sec col-ev-past" aria-labelledby="col-ev-past-t">
          <SectionHead id="col-ev-past-t" title="Earlier this year" img={photos[2] ? photos[2].img : heroImg} tint="royal" />
          <div className="col-ev-months">{pastGroups.map((g) => <Month key={g.label} g={g} />)}</div>
        </section>
      ) : null}
    </div>
  )
}
