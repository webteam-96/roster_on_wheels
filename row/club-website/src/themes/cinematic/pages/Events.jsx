'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · EVENTS — "coming attractions".
// The next event is the feature on the marquee: a royal ticket whose poster
// opens like a projector in a lit frame, with a perforated stub carrying the
// date, the countdown and the two actions. After it, the programme: each month
// a giant outlined title-card caption whose letters rise out of their line and
// a gold rule that draws out under it, then the month's events as listing rows
// (slate date | title, time, venue | still | arrow) that rise into place.
// No events: a designed empty card beside a royal panel pointing to the club's
// regular meeting (useAboutData - the same meeting fields About/Home show).
// Data: useEventsData() only (goldData.useEventsGold: this Rotary year, sorted).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, useEventsData, useAboutData, formatTime, plainText } from '../../_shared/data.js'
import { usePageName, PageHero, Button, DateStamp, EmptyState, Loading, Arrow, ArrowOut, Pin, SafeImg, cutText, yearText } from '../kit.jsx'
import { gsap, useScene, afterFonts, riseIn, wipeIn, titleIn, projectorOpen, parallax, EXPO } from '../motion.js'
import './Events.css'

const has = (v) => v && String(v).trim()
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

/** The home's rule (homeData): a record filed at exactly midnight has no time. */
function timeOf(ts, zone) {
  const d = new Date(ts)
  return d.getHours() || d.getMinutes() || d.getSeconds() ? formatTime(d, zone) : ''
}

/** "Today" / "Tomorrow" / "In 17 days" (Gold's countdown). Empty once it has passed. */
function countdown(ts) {
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - today0()) / 86400000)
  if (days < 0) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 31) return 'In ' + days + ' days'
  const weeks = Math.round(days / 7)
  return weeks < 9 ? 'In ' + weeks + ' weeks' : 'In ' + Math.round(days / 30) + ' months'
}

// ── the feature: next up, a royal ticket ─────────────────────────────────────
function NextUp({ ev }) {
  const club = useClub()
  const ref = useRef(null)
  const [broken, setBroken] = useState(false)
  const shot = ev.img && !broken
  useScene(ref, (c) => {
    const root = ref.current
    const tl = gsap.timeline({ delay: 0.25, scrollTrigger: { trigger: root, start: 'top 85%', once: true } })
    const screen = root.querySelector('.cin-ev-next__screen')
    if (screen) tl.add(projectorOpen(screen, { duration: 1.3 }), 0)
    tl.from(root.querySelectorAll('.cin-ev-next__body > *'), {
      y: 36, opacity: 0, duration: 1, ease: EXPO, stagger: 0.08, clearProps: 'transform,opacity',
    }, 0.2)
    // depth: the blurred fill drifts behind a poster that stays put (never crops the poster's own text)
    if (c.wide) parallax(root.querySelector('.cin-ev-next__fill'), { amount: 8, trigger: root })
  }, [ev.id, shot])

  const time = timeOf(ev.ts, club.timeZone)
  const near = countdown(ev.ts)
  const text = cutText(plainText(ev.desc), 240)
  const title = ev.title || 'Club event'
  const href = '/event?id=' + ev.id

  return (
    <section ref={ref} className="cin-ev-next" aria-labelledby="cin-ev-next-h">
      <article className={'cin-ev-ticket' + (shot ? '' : ' is-plain')}>
        {shot ? (
          <div className="cin-ev-next__media">
            <span className="cin-ev-next__glow" aria-hidden="true" />
            {/* the poster repeats the title link below, so it stays out of the tab order */}
            <a className="cin-ev-next__screen" href={href} tabIndex={-1} aria-hidden="true">
              <img className="cin-ev-next__fill" src={ev.img} alt="" />
              <img className="cin-ev-next__im" src={ev.img} alt="" width="800" height="600" decoding="async" onError={() => setBroken(true)} />
            </a>
          </div>
        ) : null}
        <div className="cin-ev-next__body">
          <div className="cin-ev-next__kick">
            <h2 id="cin-ev-next-h" className="cin-ev-next__k">Next up</h2>
            {near ? <p className="cin-ev-next__when">{near}</p> : null}
          </div>
          <DateStamp day={ev.day} mon={ev.mon} year={ev.year} weekday={ev.weekday} className="cin-ev-next__date" />
          <h3 className="cin-ev-next__t">{title}</h3>
          {time || ev.venue ? (
            <p className="cin-ev-next__where">
              {time ? <span className="cin-ev-next__time">{time}</span> : null}
              {ev.venue ? <span className="cin-ev-next__venue"><Pin /><span>{ev.venue}</span></span> : null}
            </p>
          ) : null}
          {text ? <p className="cin-ev-next__x">{text}</p> : null}
          <div className="cin-ev-next__cta">
            <Button href={href}>Event details<span className="cin-sr">: {title}</span> <Arrow /></Button>
            {ev.reg ? <Button href={ev.reg} external variant="line">Register<span className="cin-sr"> for {title}</span> <ArrowOut /></Button> : null}
          </div>
        </div>
      </article>
    </section>
  )
}

// ── one programme row: slate date | title, time, venue | still | arrow ───────
function Row({ ev, past }) {
  const club = useClub()
  const time = timeOf(ev.ts, club.timeZone)
  const title = ev.title || 'Club event'
  return (
    <li className={'cin-ev-row' + (past ? ' is-past' : '')}>
      <DateStamp day={ev.day} mon={ev.mon} year={past ? ev.year : undefined} weekday={ev.weekday} className="cin-ev-row__date" />
      <div className="cin-ev-row__main">
        <h3 className="cin-ev-row__t"><a href={'/event?id=' + ev.id}>{title}</a></h3>
        {time || ev.venue ? (
          <p className="cin-ev-row__where">
            {time ? <span className="cin-ev-row__time">{time}</span> : null}
            {ev.venue ? <span>{ev.venue}</span> : null}
          </p>
        ) : null}
      </div>
      <div className="cin-ev-row__end">
        {ev.img ? <div className="cin-ev-row__still" aria-hidden="true"><SafeImg src={ev.img} width="160" height="120" /></div> : null}
        {ev.reg ? <Button href={ev.reg} external small variant="line" className="cin-ev-row__reg">Register<span className="cin-sr"> for {title}</span></Button> : null}
        <span className="cin-ev-row__go" aria-hidden="true"><Arrow /></span>
      </div>
    </li>
  )
}

// ── the programme: month title cards + rows ──────────────────────────────────
function Programme({ groups, past }) {
  const ref = useRef(null)
  const sig = groups.map((g) => g.label + ':' + g.rows.map((r) => r.id).join(',')).join('|') + '/' + past.map((r) => r.id).join(',')
  useScene(ref, (c, ctx) => {
    const root = ref.current
    root.querySelectorAll('.cin-ev-month').forEach((m) => {
      const rule = m.querySelector('.cin-ev-month__rule')
      if (rule) {
        gsap.fromTo(rule, { scaleX: 0 }, {
          scaleX: 1, duration: 1.6, ease: EXPO, clearProps: 'transform',
          scrollTrigger: { trigger: m, start: 'top 85%', once: true },
        })
      }
      riseIn(m.querySelectorAll('.cin-ev-row'), { trigger: m.querySelector('.cin-ev-rows'), y: 30, stagger: 0.06 })
    })
    return afterFonts(ctx, () => root.querySelectorAll('.cin-ev-month__m').forEach((el) => titleIn(el)))
  }, [sig])

  return (
    <div ref={ref} className="cin-sec cin-ev-prog">
      {groups.map((g) => {
        const id = 'cin-ev-m-' + g.label.replace(/[^A-Za-z0-9]+/g, '-')
        const [mon, ...yr] = g.label.split(' ')
        return (
          <section key={g.label} className="cin-ev-month" aria-labelledby={id}>
            <div className="cin-ev-month__head">
              <h2 className="cin-ev-month__t" id={id}>
                <span className="cin-sr">{g.label}</span>
                <span className="cin-ev-month__vis" aria-hidden="true">
                  <span className="cin-ev-month__m" key={mon}>{mon}</span>
                  {yr.length ? <span className="cin-ev-month__y">{yr.join(' ')}</span> : null}
                </span>
              </h2>
              <p className="cin-ev-month__n">{g.rows.length} {g.rows.length === 1 ? 'event' : 'events'}</p>
            </div>
            <span className="cin-ev-month__rule" aria-hidden="true" />
            <ol className="cin-ev-rows">
              {g.rows.map((e) => <Row key={e.id} ev={e} />)}
            </ol>
          </section>
        )
      })}
      {past.length ? (
        <section className="cin-ev-month cin-ev-month--past" aria-labelledby="cin-ev-past-h">
          <div className="cin-ev-month__head">
            <h2 className="cin-ev-past__t" id="cin-ev-past-h">Earlier this Rotary year</h2>
          </div>
          <span className="cin-ev-month__rule" aria-hidden="true" />
          <ol className="cin-ev-rows">
            {past.map((e) => <Row key={e.id} ev={e} past />)}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

// ── nothing scheduled: the empty card + the regular meeting ──────────────────
function Nothing({ yearLabel }) {
  const ref = useRef(null)
  const info = useAboutData()
  const day = has(info.meetingDay) ? String(info.meetingDay).trim() : ''
  const time = has(info.meetingTime) ? info.meetingTime : ''
  const venue = has(info.meetingVenue) ? info.meetingVenue : ''
  const meet = !info.loading && !!(day || time || venue)
  const lw = Math.max(4, ...day.split(/\s+/).map((w) => w.length))

  // two scenes: the card enters once; the meeting panel builds when the about row lands
  useScene(ref, () => { riseIn(ref.current.querySelectorAll('.cin-ev-none > .cin-empty'), { trigger: false, delay: 0.45 }) }, [])
  useScene(ref, (c, ctx) => {
    const panel = ref.current.querySelector('.cin-ev-meet')
    if (!panel) return undefined
    wipeIn(panel, { start: 'top 92%' })
    return afterFonts(ctx, () => titleIn(panel.querySelector('.cin-ev-meet__dayvis'), { delay: 0.35, start: 'top 95%' }))
  }, [meet, day, time, venue])

  return (
    <div ref={ref} className="cin-sec cin-ev-empty">
      <div className={'cin-ev-none' + (meet ? ' has-meet' : '')}>
        <EmptyState
          title={'No upcoming events ' + (yearLabel ? 'in ' + String(yearLabel).replace(/([\u2013-])/g, '\u2060$1\u2060') : 'this Rotary year')}
          message={'When the club schedules an event it will appear here.' + (meet ? ' Meanwhile, you can find the club at its regular meeting.' : ' The calendar lists birthdays, anniversaries and club dates month by month.')}
          action={<Button href="/calendar" variant="line">Open the calendar <Arrow /></Button>}
        />
        {meet ? (
          <section className="cin-ev-meet" aria-labelledby="cin-ev-meet-h">
            <h2 className="cin-ev-meet__cap" id="cin-ev-meet-h">Our regular meeting</h2>
            {day ? (
              <p className="cin-ev-meet__day" style={{ '--lw': lw }}>
                <span className="cin-sr">{day}</span>
                <span className="cin-ev-meet__dayvis" aria-hidden="true" key={day}>{day}</span>
              </p>
            ) : null}
            {time ? <p className="cin-ev-meet__time">{time}</p> : null}
            {venue ? <address className="cin-ev-meet__venue">{venue}</address> : null}
            {venue && info.mapUrl ? <Button href={info.mapUrl} external>Open in Maps <ArrowOut /></Button> : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Events({ data }) {
  const club = useClub()
  const name = usePageName('Upcoming Events')
  const events = useEventsData(data)                 // null while loading
  const yearLabel = yearText(club.selectedYearLabel)

  // The hook's order (this Rotary year, by date) is kept; anything already
  // behind today is listed after the programme instead of billed as "next".
  const view = useMemo(() => {
    const list = events || []
    const t0 = today0()
    const upcoming = list.filter((e) => e.ts >= t0)
    const past = list.filter((e) => e.ts < t0)
    const groups = []
    for (const e of upcoming.slice(1)) {
      const last = groups[groups.length - 1]
      if (!last || last.label !== e.monthLabel) groups.push({ label: e.monthLabel, rows: [e] })
      else last.rows.push(e)
    }
    return { total: list.length, next: upcoming[0] || null, groups, past }
  }, [events])

  return (
    <div className="cin-ev">
      <PageHero
        title={name}
        meta={view.total ? (
          <p className="cin-ev-tally"><b>{view.total}</b> {view.total === 1 ? 'event' : 'events'} this Rotary year</p>
        ) : null}
      />
      {events === null ? <Loading label="Loading events" />
        : view.total === 0 ? <Nothing yearLabel={yearLabel} />
          : (
            <>
              {view.next ? <NextUp ev={view.next} /> : null}
              {view.groups.length || view.past.length ? <Programme groups={view.groups} past={view.past} /> : null}
            </>
          )}
    </div>
  )
}
