'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · Events — the road ahead.
//
// Violet hero, then the walk forward through the Rotary year:
//   Next up         the very next event as a big ticket: gold stub with the day,
//                   a low sun rising behind its hills, the photo pinned beside it
//   The road ahead  the rest, month by month along a dashed trail; each month is
//                   a chapter with its own sky colour, its tickets fan in
//   Earlier         anything the hook returns that is already behind us (rare:
//                   the feed is upcoming-only), same tickets under a pale moon
//   Nothing ahead   a designed empty state, then "Where we meet" at dusk (moon,
//                   stars, the meeting day in huge gold) from the About payload
// Data: useEventsData() (goldData.useEventsGold — this Rotary year, date order)
// and, only when nothing is ahead, useAboutData() for the weekly meeting.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from 'react'
import { useClub, useEventsData, useAboutData, formatTime } from '../../_shared/data.js'
import { PageHero, SectionHead, Band, Button, EmptyState, Loading, htmlText, cut, yearText } from '../kit.jsx'
import { useScene, afterFonts, useRefreshOnImages, gsap, titleIn, rise, fanIn, wipeIn, split } from '../motion.js'
import './Events.css'

const trim = (v) => (v == null ? '' : String(v).trim())
// A month is a chapter: its sky colour comes from the Rotary palette by calendar month.
const TONES = ['cran', 'gold', 'azure', 'turq', 'violet', 'royal']

const PIN = <svg className="hj-ev-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
const CLOCK = <svg className="hj-ev-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>

/** homeData's rule: a time of exactly midnight means none was filed. */
function timeOf(ts, zone) {
  const d = new Date(ts)
  return d.getHours() || d.getMinutes() || d.getSeconds() ? formatTime(d, zone) : ''
}

/** Gold's countdown: "Today" / "Tomorrow" / "In 17 days", in whole days from midnight. */
function countdown(ts, today) {
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - today) / 86400000)
  if (days < 0) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 31) return 'In ' + days + ' days'
  const weeks = Math.round(days / 7)
  return weeks < 9 ? 'In ' + weeks + ' weeks' : 'In ' + Math.round(days / 30) + ' months'
}

/** Consecutive rows under one "October 2026" caption (the hook's monthLabel). */
function byMonth(rows) {
  const out = []
  for (const e of rows) {
    const last = out[out.length - 1]
    if (last && last.label === e.monthLabel) last.rows.push(e)
    else out.push({ label: e.monthLabel, rows: [e] })
  }
  return out
}

/** One ticket on the trail: coloured stub (day + month), white body, one stretched link. */
function Ticket({ e, past }) {
  const club = useClub()
  const when = [e.weekday, timeOf(e.ts, club.timeZone)].filter(Boolean).join(' · ')
  const title = trim(e.title) || 'Club event'
  return (
    <li className="hj-ev-item">
      <article className="hj-ev-tk">
        <p className="hj-ev-tk__stub">
          <span className="hj-ev-tk__day">{e.day}</span> <span className="hj-ev-tk__mon">{e.mon}</span>
        </p>
        <div className="hj-ev-tk__body">
          <h4 className="hj-ev-tk__t"><a href={'/event?id=' + e.id}>{title}</a></h4>
          {when ? <p className="hj-ev-tk__when">{when}</p> : null}
          {e.venue ? <p className="hj-ev-tk__v">{PIN}<span>{e.venue}</span></p> : null}
          {e.reg && !past ? (
            <p className="hj-ev-tk__act">
              <Button href={e.reg} size="sm">Register<span className="hj-sr"> for {title}</span></Button>
            </p>
          ) : null}
        </div>
      </article>
    </li>
  )
}

/** A month on the road: a small sun (a pale moon once past) on the trail, its name, its tickets. */
function Month({ g, past }) {
  const [name, ...yr] = g.label.split(' ')
  const tone = TONES[new Date(g.rows[0].ts).getMonth() % TONES.length]
  const id = 'hj-ev-m-' + (past ? 'p-' : '') + g.label.replace(/\W+/g, '-')
  return (
    <section className={'hj-ev-month hj-tone--' + tone + (past ? ' is-past' : '')} aria-labelledby={id}>
      <span className="hj-ev-month__sun" aria-hidden="true" />
      <div className="hj-ev-month__hd">
        <h3 className="hj-ev-month__t" id={id}>{name} <span className="hj-ev-month__y">{yr.join(' ')}</span></h3>
        <p className="hj-ev-month__n">{g.rows.length} event{g.rows.length === 1 ? '' : 's'}</p>
      </div>
      <ul className="hj-ev-list">
        {g.rows.map((e) => <Ticket key={e.id} e={e} past={past} />)}
      </ul>
    </section>
  )
}

/** The next event, at poster size: stub with a sun rising over hills, photo alongside. */
function NextUp({ e, today }) {
  const club = useClub()
  const near = countdown(e.ts, today)
  const time = timeOf(e.ts, club.timeZone)
  const desc = cut(htmlText(e.desc), 220)
  const title = trim(e.title) || 'Club event'
  const [photo, setPhoto] = useState(!!e.img)          // a broken photo drops out; the ticket takes the row
  return (
    <section className="hj-wrap hj-sec hj-ev-next" aria-labelledby="hj-ev-next-t">
      <p className="hj-kicker hj-ev-next__k">Next up</p>
      <article className={'hj-ev-big' + (photo ? ' has-ph' : '')}>
        {photo ? (
          <div className="hj-ev-big__ph">
            <img src={e.img} alt="" width="800" height="600" decoding="async" onError={() => setPhoto(false)} />
          </div>
        ) : null}
        <div className="hj-ev-big__tk">
          <p className="hj-ev-big__stub">
            <span className="hj-ev-big__day">{e.day}</span> <span className="hj-ev-big__mon">{e.mon} {e.year}</span>
            <span className="hj-ev-big__scene" aria-hidden="true"><span className="hj-ev-big__sun" /></span>
          </p>
          <div className="hj-ev-big__body">
            {near ? <p className="hj-ev-big__near">{near}</p> : null}
            <h2 className="hj-ev-big__t" id="hj-ev-next-t">{title}</h2>
            <ul className="hj-ev-big__facts">
              <li>{CLOCK}<span>{[e.weekday, time].filter(Boolean).join(' · ')}</span></li>
              {e.venue ? <li>{PIN}<span>{e.venue}</span></li> : null}
            </ul>
            {desc ? <p className="hj-ev-big__d">{desc}</p> : null}
            <p className="hj-ev-big__cta">
              <Button href={'/event?id=' + e.id} variant="ink" icon="arrow">Event details</Button>
              {e.reg ? <Button href={e.reg}>Register<span className="hj-sr"> for {title}</span></Button> : null}
            </p>
          </div>
        </div>
      </article>
    </section>
  )
}

/** Nothing ahead: where the club can be found meanwhile (dusk, moon, the day in gold). */
function WeeklyMeet() {
  const d = useAboutData()
  const day = trim(d.meetingDay)
  const time = trim(d.meetingTime).replace(/\s+-\s+/, ' – ')
  const venue = trim(d.meetingVenue)
  const show = !d.loading && !!(day || time || venue)
  const ref = useRef(null)
  // its own scene: the About payload lands after the page's scene has run
  useScene(ref, (c, ctx) => afterFonts(ctx, () => {
    const meet = ref.current
    const title = meet.querySelector('.hj-h2')
    titleIn(title)
    gsap.fromTo(meet.querySelector('.hj-ev-meet__moon'), { yPercent: 90, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: meet, start: 'top 85%', end: 'top 25%', scrub: true } })
    const dd = meet.querySelector('.hj-ev-meet__dayt')
    if (dd) {
      const s = split(dd, 'none')
      gsap.fromTo(s ? s.chars : dd, { yPercent: 70, rotation: -12, opacity: 0 }, { yPercent: 0, rotation: 0, opacity: 1, duration: 1, stagger: 0.05, ease: 'back.out(1.6)', scrollTrigger: { trigger: dd, start: 'top 90%', once: true } })
    }
    rise(meet.querySelectorAll('.hj-ev-meet__time, .hj-ev-meet__venue, .hj-ev-meet__go'), meet.querySelector('.hj-ev-meet__dl'), { from: { x: 60, y: 0 }, stagger: 0.08 })
  }), [show, day, time, venue])
  if (!show) return null
  return (
    <div ref={ref} className="hj-ev-meetwrap">
      <Band tone="royal" next="var(--hj-night)" labelledBy="hj-ev-meet-t" className="hj-ev-meet hj-endpad">
        <span className="hj-ev-meet__moon hj-moon" aria-hidden="true" />
        <SectionHead k="Meanwhile" title="Where we meet" id="hj-ev-meet-t" />
        <dl className="hj-ev-meet__dl">
          {day ? (
            <div className="hj-ev-meet__day">
              <dt>Day</dt>
              <dd style={{ '--hj-len': Math.max(6, day.length) }}>
                <span key={day} className={'hj-ev-meet__dayt' + (day.length > 12 ? ' is-long' : '')} aria-hidden="true">{day}</span>
                <span className="hj-sr">{day}</span>
              </dd>
            </div>
          ) : null}
          {time ? <div className="hj-ev-meet__time"><dt>Time</dt><dd>{time}</dd></div> : null}
          {venue ? <div className="hj-ev-meet__venue"><dt>Venue</dt><dd>{venue}</dd></div> : null}
        </dl>
        {venue && d.mapUrl ? <Button className="hj-ev-meet__go" href={d.mapUrl}>Get directions</Button> : null}
      </Band>
    </div>
  )
}

export default function Events({ data }) {
  const club = useClub()
  const events = useEventsData(data)                     // null while loading
  const ref = useRef(null)

  const list = events || []
  const today = new Date().setHours(0, 0, 0, 0)
  const ahead = list.filter((e) => e.ts >= today)
  const past = list.filter((e) => e.ts < today)
  const next = ahead[0] || null
  const road = byMonth(ahead.slice(1))
  const behind = byMonth(past)
  const yr = yearText(club.selectedYearLabel)

  const dataKey = events === null ? 'wait' : club.selectedYearId + '|' + list.map((e) => e.id).join(',')
  useRefreshOnImages(ref, [dataKey])

  useScene(ref, (c, ctx) => afterFonts(ctx, () => {
    const r = ref.current
    r.querySelectorAll('.hj-ev-road .hj-h2, .hj-ev-past .hj-h2').forEach((h) => titleIn(h))

    // next up: the ticket rolls in along the road, the photo wipes open, the sun rises behind the stub's hills
    const big = r.querySelector('.hj-ev-big')
    if (big) {
      rise(r.querySelector('.hj-ev-next__k'), big, { from: { x: -40, y: 0 } })
      rise(big.querySelector('.hj-ev-big__tk'), big, { from: c.wide ? { x: 90, y: 0 } : { y: 40 } })
      wipeIn(big.querySelector('.hj-ev-big__ph'), { trigger: big })
      gsap.fromTo(big.querySelector('.hj-ev-big__sun'), { yPercent: 120 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: big, start: 'top 92%', end: 'center 45%', scrub: true } })
    }

    // the trail draws itself down the road; each month's sun pops up on it and its name arrives sideways
    r.querySelectorAll('.hj-ev-trail').forEach((t) => {
      gsap.fromTo(t, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: t.parentNode, start: 'top 78%', end: 'bottom 72%', scrub: true } })
    })
    r.querySelectorAll('.hj-ev-month').forEach((m) => {
      rise(m.querySelector('.hj-ev-month__sun'), m, { from: { scale: 0.2, y: 0 }, ease: 'back.out(2.2)', duration: 0.9 })
      rise(m.querySelector('.hj-ev-month__hd'), m, { from: { x: 70, y: 0 } })
      fanIn(m.querySelectorAll('.hj-ev-item'))
    })

    rise(r.querySelector('.hj-ev-empty .hj-empty'), null, { from: { y: 40 } })
  }), [dataKey])

  return (
    <div className="hj-page hj-ground--cream hj-endpad hj-ev" ref={ref}>
      <PageHero tone="violet" title="Upcoming events" />

      {events === null ? (
        <div className="hj-wrap hj-sec"><Loading label="Loading events" /></div>
      ) : (
        <>
          {next ? <NextUp key={next.id + '|' + next.img} e={next} today={today} /> : null}

          {road.length > 0 ? (
            <section className="hj-wrap hj-sec hj-ev-road" aria-labelledby="hj-ev-road-t">
              <SectionHead k="Then" title="The road ahead" id="hj-ev-road-t" />
              <div className="hj-ev-trailwrap">
                <span className="hj-ev-trail" aria-hidden="true" />
                {road.map((g) => <Month key={g.label} g={g} />)}
              </div>
            </section>
          ) : null}

          {/* only when the page would otherwise be empty (client, 2026-10-05: hide sections with no data) */}
          {ahead.length === 0 && behind.length === 0 ? (
            <div className="hj-wrap hj-sec hj-ev-empty">
              <EmptyState title={'No upcoming events' + (yr ? ' for ' + yr : '') + ' yet'}
                          message="When the club publishes an event for this Rotary year it appears here. Until then, you can find the club at its regular meeting."
                          action={<Button href="/calendar" variant="ink" icon="arrow">Open the calendar</Button>} />
            </div>
          ) : null}

          {behind.length > 0 ? (
            <section className="hj-wrap hj-sec hj-ev-past" aria-labelledby="hj-ev-past-t">
              <SectionHead k="Behind us" title="Earlier this year" id="hj-ev-past-t" />
              <div className="hj-ev-trailwrap">
                <span className="hj-ev-trail" aria-hidden="true" />
                {behind.map((g) => <Month key={g.label} g={g} past />)}
              </div>
            </section>
          ) : null}

          {ahead.length === 0 ? <WeeklyMeet /> : null}
        </>
      )}
    </div>
  )
}
