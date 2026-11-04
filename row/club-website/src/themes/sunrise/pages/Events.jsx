'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · EVENTS — the date suns.
//
// The next event is the feature: its date is a sun rising off a horizon inside
// rings, beside the title, when and where, and the poster comes forward out of
// the depth in a window (the whole picture over its own blurred light, never
// cropped). After it the agenda, one month at a time: the month title flies out
// of the distance, a dawn rule draws under it, and each row's date sun rises as
// the row reaches the screen. Events already past (the feed can carry today's
// earlier ones) close the page as "Earlier this Rotary year", their suns set.
// Nothing scheduled: a designed empty state beside the club's weekly meeting
// (useAboutData, the same meeting fields About/Home show), the day's letters
// arriving from depth like the home's "Where we meet".
//
// Data: useEventsData() only (Gold's hook: this Rotary year, date order). Order,
// fields and links are Gold's (/event?id=).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useEventsData, useAboutData, formatTime } from '../../_shared/data.js'
import {
  PageHero, Button, DateSun, DateRise, EmptyState, Loading, Panel, ResultCount, SafeImg,
  excerpt, noEmoji, Arrow, ClockIcon, PinIcon, CalendarIcon, yearText, venueText,
} from '../kit.jsx'
import { useScene, useRefreshOnImages, gsap, ScrollTrigger, flyTitle, flyChars } from '../motion.js'
import './Events.css'

const CLEAR = 'transform,opacity,translate,rotate,scale'
const has = (v) => !!v && !!String(v).trim()
const today0 = () => new Date().setHours(0, 0, 0, 0)

/** The home's rule (homeData): a record filed at exactly midnight has no time. */
function timeOf(ts, zone) {
  const d = new Date(ts)
  return d.getHours() || d.getMinutes() || d.getSeconds() ? formatTime(d, zone) : ''
}

/** Gold's countdown: "Today" / "Tomorrow" / "In 17 days", in whole days from midnight; '' once past. */
function countdown(ts) {
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - today0()) / 86400000)
  if (days < 0) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 31) return 'In ' + days + ' days'
  const weeks = Math.round(days / 7)
  return weeks < 9 ? 'In ' + weeks + ' weeks' : 'In ' + Math.round(days / 30) + ' months'
}

/** Month groups out of the ordered list, so a month with nothing in it never gets a heading. */
const byMonth = (rows) => rows.reduce((out, e) => {
  const last = out[out.length - 1]
  if (last && last.label === e.monthLabel) last.rows.push(e)
  else out.push({ label: e.monthLabel, rows: [e] })
  return out
}, [])

const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-')

// ── the next event ───────────────────────────────────────────────────────────
function Feature({ ev }) {
  const club = useClub()
  const [broken, setBroken] = useState(false)      // a poster that fails drops its window - never an empty frame
  const title = noEmoji(ev.title) || 'Club event'
  const href = '/event?id=' + ev.id
  const near = countdown(ev.ts)
  const time = timeOf(ev.ts, club.timeZone)
  const venue = venueText(ev.venue)
  const shot = has(ev.img) && !broken
  return (
    <section className="sun-wrap sun-block sun-evs-next" aria-labelledby="sun-evs-next-h">
      <article className={'sun-evs-feat' + (shot ? ' has-shot' : '')}>
        <div className="sun-evs-feat__main">
          <DateRise day={ev.day} mon={ev.mon} className="sun-evs-feat__rise" />
          <div className="sun-evs-feat__body">
            <p className="sun-eyebrow sun-evs-feat__kick">
              Next up{near ? <span className="sun-evs-feat__near">{near}</span> : null}
            </p>
            <h2 id="sun-evs-next-h" className="sun-evs-feat__title"><a href={href}>{title}</a></h2>
            <ul className="sun-evs-meta">
              <li><CalendarIcon />{[ev.weekday, ev.date].filter(Boolean).join(', ')}</li>
              {time ? <li><ClockIcon />{time}</li> : null}
              {venue ? <li><PinIcon /><span>{venue}</span></li> : null}
            </ul>
            {has(ev.desc) ? <p className="sun-evs-feat__desc">{excerpt(ev.desc, 240)}</p> : null}
            <div className="sun-evs-feat__cta">
              <Button href={href}>Event details<span className="sun-sr">: {title}</span></Button>
              {ev.reg ? <Button href={ev.reg} external variant="line">Register<span className="sun-sr"> for {title}</span></Button> : null}
            </div>
          </div>
        </div>
        {shot ? (
          <div className="sun-win sun-evs-feat__win">
            <div className="sun-win__slides">
              <div className="sun-win__slide is-on">
                <img className="sun-win__fill" src={ev.img} alt="" aria-hidden="true" decoding="async" />
                <img className="sun-win__img" src={ev.img} alt="" width="800" height="800" decoding="async" onError={() => setBroken(true)} />
              </div>
            </div>
          </div>
        ) : null}
      </article>
    </section>
  )
}

// ── one agenda row: date sun | weekday · time, title, venue, actions | photo ──
function Row({ ev, past }) {
  const club = useClub()
  const title = noEmoji(ev.title) || 'Club event'
  const href = '/event?id=' + ev.id
  const time = timeOf(ev.ts, club.timeZone)
  const venue = venueText(ev.venue)
  return (
    <li className={'sun-evs-row' + (past ? ' is-past' : '')}>
      <div className="sun-evs-row__sun"><DateSun small day={ev.day} mon={ev.mon} /></div>
      <div className="sun-evs-row__main">
        <p className="sun-evs-row__when">{[ev.weekday, past ? ev.year : '', time].filter(Boolean).join(' · ')}</p>
        <h3 className="sun-evs-row__title"><a className="sun-evs-row__link" href={href}>{title}</a></h3>
        {venue ? <p className="sun-evs-row__venue"><PinIcon /><span>{venue}</span></p> : null}
        {/* the whole row is the title's link; the client wants the way in spelled out too */}
        <div className="sun-evs-row__acts">
          <Button href={href} small variant="line">View details<span className="sun-sr">: {title}</span></Button>
          {ev.reg ? <Button href={ev.reg} external small variant="line">Register<span className="sun-sr"> for {title}</span></Button> : null}
        </div>
      </div>
      {has(ev.img) ? <SafeImg className="sun-evs-row__img" src={ev.img} width={160} height={120} /> : null}
    </li>
  )
}

function Month({ id, title, count, children }) {
  return (
    <section className="sun-evs-month" aria-labelledby={id}>
      <div className="sun-evs-month__head">
        <h2 id={id} className="sun-h2 sun-fly">{title}</h2>
        {count ? <p className="sun-evs-month__n">{count} {count === 1 ? 'event' : 'events'}</p> : null}
      </div>
      <span className="sun-evs-month__rule" aria-hidden="true" />
      <ol className="sun-evs-rows">{children}</ol>
    </section>
  )
}

// ── nothing scheduled: the empty state + the club's weekly meeting ───────────
function Nothing({ year }) {
  const ref = useRef(null)
  const info = useAboutData()
  const day = has(info.meetingDay) ? String(info.meetingDay).trim() : ''
  const time = has(info.meetingTime) ? info.meetingTime : ''
  const venue = venueText(info.meetingVenue)
  const meet = !info.loading && !!(day || time || venue)

  // the meeting day's letters arrive from depth (the home's "Where we meet")
  useScene(ref, (c, ctx) => {
    const big = ref.current.querySelector('.sun-evs-meet__big')
    return big ? flyChars(big, ctx, { start: 'top 98%', end: 'top 58%' }) : undefined
  }, [meet, day])

  return (
    <section ref={ref} className="sun-wrap sun-block sun-evs-none" aria-label="No upcoming events">
      <div className={'sun-evs-none__grid' + (meet ? ' is-two' : '')}>
        <EmptyState
          title={'No upcoming events' + (year ? ' in Rotary year ' + year : '')}
          message={'Events appear here once the club publishes them.' + (meet ? ' Until then, the club meets every week.' : '')}
          action={<a className="sun-link" href="/calendar">Open the calendar <Arrow /></a>}
        />
        {meet ? (
          <Panel as="aside" className="sun-evs-meet" aria-labelledby="sun-evs-meet-h">
            <h2 id="sun-evs-meet-h" className="sun-eyebrow">Weekly meeting</h2>
            {day ? (
              <p className="sun-evs-meet__day">
                <span className="sun-sr">{day}</span>
                <span className="sun-evs-meet__big" aria-hidden="true" key={day}>{day}</span>
              </p>
            ) : null}
            {time ? <p className="sun-evs-meet__line"><ClockIcon />{time}</p> : null}
            {venue ? <address className="sun-evs-meet__line"><PinIcon /><span>{venue}</span></address> : null}
            {venue ? <Button href={info.mapUrl} external small className="sun-evs-meet__map">Open in Maps</Button> : null}
          </Panel>
        ) : null}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Events({ data }) {
  const club = useClub()
  const events = useEventsData(data)             // null while loading; this Rotary year, date order
  const ref = useRef(null)
  const year = yearText(club.selectedYearLabel)

  const { next, groups, past } = useMemo(() => {
    const t0 = today0()
    const list = events || []
    const up = list.filter((e) => e.ts >= t0)
    return { next: up[0] || null, groups: byMonth(up.slice(1)), past: list.filter((e) => e.ts < t0) }
  }, [events])
  const total = events ? events.length : 0
  const sig = (events || []).map((e) => e.id).join(',')

  useScene(ref, (c) => {
    const root = ref.current
    flyTitle(root.querySelectorAll('.sun-fly'), c)

    // the next event: the rings grow, its sun rises off the horizon, the poster comes out of the depth
    const feat = root.querySelector('.sun-evs-feat')
    if (feat) {
      const tl = gsap.timeline({ delay: 0.35, scrollTrigger: { trigger: feat, start: 'top 94%', once: true } })
      tl.fromTo(feat.querySelectorAll('.sun-rise__ring'), { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.4, stagger: 0.14, ease: 'power3.out', clearProps: CLEAR }, 0)
        .fromTo(feat.querySelector('.sun-rise .sun-date'), { yPercent: 95, scale: 0.7 }, { yPercent: 0, scale: 1, duration: 1.5, ease: 'power3.out', clearProps: CLEAR }, 0.05)
        .fromTo(feat.querySelectorAll('.sun-evs-feat__body > *'), { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.07, ease: 'power3.out', clearProps: CLEAR }, 0.2)
      const win = feat.querySelector('.sun-evs-feat__win')
      if (win) tl.fromTo(win, { z: -420, rotationX: 9, opacity: 0, transformPerspective: 1200 }, { z: 0, rotationX: 0, opacity: 1, duration: 1.3, ease: 'power3.out', clearProps: CLEAR }, 0.1)
    }

    // each month's dawn rule draws out under its title
    root.querySelectorAll('.sun-evs-month__rule').forEach((r) => {
      gsap.fromTo(r, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: r, start: 'top 94%', end: 'top 64%', scrub: true } })
    })

    // the date suns rise along the agenda, row by row (one batch - a full year can be 60 rows).
    // Rows already scrolled past (a year switch deep in the page) are never hidden.
    const rows = Array.from(root.querySelectorAll('.sun-evs-row')).filter((el) => el.getBoundingClientRect().bottom > 0)
    if (!rows.length) return
    const part = (list, sel) => list.map((r) => r.querySelector(sel)).filter(Boolean)
    gsap.set(part(rows, '.sun-date'), { y: 40, scale: 0.6, opacity: 0 })
    gsap.set(part(rows, '.sun-evs-row__main'), { y: 24, opacity: 0 })
    ScrollTrigger.batch(rows, {
      start: 'top 94%',
      once: true,
      onEnter: (batch) => {
        gsap.to(part(batch, '.sun-date'), { y: 0, scale: 1, opacity: 1, duration: 1.1, stagger: 0.1, ease: 'back.out(1.6)', overwrite: true, clearProps: CLEAR })
        gsap.to(part(batch, '.sun-evs-row__main'), { y: 0, opacity: 1, duration: 0.9, delay: 0.12, stagger: 0.1, ease: 'power3.out', overwrite: true, clearProps: CLEAR })
      },
    })
  }, [sig])
  useRefreshOnImages(ref, [sig])

  return (
    <div className="sun-page sun-evs" ref={ref}>
      <PageHero title="Upcoming events">
        {total > 0 ? <ResultCount count={total} noun="event" /> : null}
      </PageHero>

      {events === null ? <div className="sun-wrap sun-block"><Loading label="Loading events" /></div> : null}
      {events !== null && !next ? <Nothing year={year} /> : null}
      {next ? <Feature key={next.id} ev={next} /> : null}

      {groups.length > 0 ? (
        <div className="sun-wrap sun-block sun-evs-agenda">
          {groups.map((g) => (
            <Month key={g.label} id={'sun-evs-m-' + slug(g.label)} title={g.label} count={g.rows.length}>
              {g.rows.map((e) => <Row key={e.id} ev={e} />)}
            </Month>
          ))}
        </div>
      ) : null}

      {past.length > 0 ? (
        <div className="sun-wrap sun-block sun-evs-agenda sun-evs-past">
          <Month id="sun-evs-past-h" title="Earlier this Rotary year" count={past.length}>
            {past.map((e) => <Row key={e.id} ev={e} past />)}
          </Month>
        </div>
      ) : null}
    </div>
  )
}
