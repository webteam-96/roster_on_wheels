'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · EVENTS — "what's on".
// The ink hero carries the menu label and the count, drifting behind in outline.
// Then the very next event floods in on gold from a small circle as it scrolls
// up (the home meeting's move, not pinned): poster left, a date plate whose day
// rolls like an odometer, the title, venue and the two actions. The rest of the
// year follows on paper as "the diary": liquid-fill rows grouped by month, and
// anything already past (the feed can carry today's) under its own heading.
// No events -> a designed empty state and, when the club has filed one, its
// weekly meeting flooding in on gold instead.
// Data: useEventsData() exactly as Gold uses it (this Rotary year, date order);
// useAboutData() only for the meeting in the empty state.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef } from 'react'
import { useClub, useCurrentMenuName, usePageTitle, useEventsData, useAboutData, plainText } from '../../_shared/data.js'
import {
  PageHero, Band, SectionHead, Pill, RowLink, Media, Odometer, EmptyState, Loading, Chars,
  clean, clip, longestWord, yearText,
} from '../kit.jsx'
import { usePageMotion, useScene, gsap, onRevert, liquidMedia } from '../motion.js'
import './Events.css'

/** Gold's countdown: "Today" / "Tomorrow" / "In 17 days", in whole days from midnight; null once past. */
function countdown(ts) {
  if (!ts) return null
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - midnight.getTime()) / 86400000)
  if (days < 0) return null
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 31) return 'In ' + days + ' days'
  const weeks = Math.round(days / 7)
  return weeks < 9 ? 'In ' + weeks + ' weeks' : 'In ' + Math.round(days / 30) + ' months'
}

/** Consecutive events of the same month under one caption (the list is already in date order). */
function byMonth(rows) {
  const out = []
  for (const e of rows) {
    const last = out[out.length - 1]
    if (!last || last.label !== e.monthLabel) out.push({ label: e.monthLabel, rows: [e] })
    else last.rows.push(e)
  }
  return out
}

/** One diary line: date plate, title + weekday/venue, the action. The whole row is the link. */
function Row({ e, past }) {
  const sub = [e.weekday, e.venue].filter(Boolean).join(' · ')
  return (
    <li className="liq-rv">
      <RowLink
        href={'/event?id=' + e.id}
        className={'liq-evt-row' + (past ? ' liq-evt-row--past' : '')}
        action={e.reg ? 'Details & register' : 'Details'}
        title={(
          <>
            <span className="liq-evt-row__date"><b>{e.day}</b><span>{e.mon}{past && e.year ? ' ' + e.year : ''}</span></span>
            <span className="liq-evt-row__txt">
              <span className="liq-evt-row__t">{clean(e.title) || 'Club event'}</span>
              {sub ? <span className="liq-evt-row__sub">{sub}</span> : null}
            </span>
          </>
        )}
      />
    </li>
  )
}

function MonthHead({ label, count, id }) {
  const s = String(label || '')
  const at = s.lastIndexOf(' ')
  return (
    <h3 className="liq-evt-month__h liq-rv" id={id}>
      <span className="liq-evt-month__name">{at > 0 ? s.slice(0, at) : s}</span>
      {at > 0 ? <> <span className="liq-evt-month__yr">{s.slice(at + 1)}</span></> : null}
      <span className="liq-evt-month__n">{count + (count === 1 ? ' event' : ' events')}</span>
    </h3>
  )
}

export default function Events({ data }) {
  const club = useClub()
  const year = yearText(club.selectedYearLabel)
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Upcoming Events'
  usePageTitle(title)
  const events = useEventsData(data)        // null while loading
  const ab = useAboutData(data)             // the weekly meeting, for the empty state

  const list = events || []
  const { next, groups, past } = useMemo(() => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0)
    const up = list.filter((e) => !e.ts || e.ts >= t0.getTime())
    return { next: up[0] || null, groups: byMonth(up.slice(1)), past: list.filter((e) => e.ts && e.ts < t0.getTime()) }
  }, [events]) // eslint-disable-line react-hooks/exhaustive-deps

  const day = clean(ab.meetingDay), time = clean(ab.meetingTime), venue = clean(ab.meetingVenue)
  const hasMeet = !!(day || time || venue)

  const ref = useRef(null)
  usePageMotion(ref, [events, hasMeet])
  // the moment: each gold band floods in from a small circle as it scrolls up (scrubbed, not pinned)
  useScene(ref, (c) => {
    ref.current.querySelectorAll('.liq-evt-flood').forEach((band) => {
      const tw = gsap.fromTo(band, { clipPath: 'circle(8% at 50% 40%)' }, {
        clipPath: 'circle(110% at 50% 40%)', ease: 'none',
        scrollTrigger: { trigger: band, start: 'top 94%', end: 'top 12%', scrub: true },
      })
      // keyboard users never tab into a half-drawn band: focus opens it at once
      const open = () => { if (tw.scrollTrigger) tw.scrollTrigger.kill(); tw.kill(); gsap.set(band, { clearProps: 'clipPath' }) }
      band.addEventListener('focusin', open)
      onRevert(() => band.removeEventListener('focusin', open))
    })
    // the poster wipes up inside the flood; no WebGL here - a canvas plane would paint outside the gold circle
    const poster = ref.current.querySelectorAll('.liq-evt-next__poster .liq-media')
    if (poster.length) liquidMedia(poster, c, { gl: false })
  }, [events, hasMeet])

  const nextHref = next ? '/event?id=' + next.id : ''
  const near = next ? countdown(next.ts) : null
  const hasDiary = groups.length > 0 || past.length > 0

  return (
    <div className="liq-evt" ref={ref}>
      <PageHero title={title} />

      {events === null ? (
        <Band tone="paper" aria-label="Events">
          <Loading label="Loading events" />
        </Band>
      ) : null}

      {/* ── the next event, big, on gold ── */}
      {next ? (
        <Band tone="gold" className="liq-evt-flood liq-evt-next" aria-labelledby="liq-evt-next-h">
          <div className={'liq-evt-next__grid' + (next.img ? '' : ' liq-evt-next__grid--solo')}>
            {next.img ? (
              /* a mouse shortcut to the same page as the title link: out of the tab order and the a11y tree */
              <a className="liq-evt-next__poster" href={nextHref} tabIndex={-1} aria-hidden="true">
                <Media src={next.img} alt="" ratio="4 / 5" className="liq-media--still" label={next.mon} />
              </a>
            ) : null}
            <div className="liq-evt-next__body">
              <div className="liq-evt-next__top liq-rv">
                {near ? <span className="liq-evt-when">{near}</span> : null}
              </div>
              <p className="liq-evt-plate liq-rv">
                <span className="liq-evt-plate__d"><Odometer value={next.day} /></span>
                <span className="liq-evt-plate__m">{[next.mon, next.year].filter(Boolean).join(' ')}</span>
                {next.weekday ? <span className="liq-evt-plate__w">{next.weekday}</span> : null}
              </p>
              <h2 className="liq-evt-next__t liq-rv" id="liq-evt-next-h"><a href={nextHref}>{clean(next.title) || 'Club event'}</a></h2>
              {next.venue ? <p className="liq-evt-next__v liq-rv">{next.venue}</p> : null}
              {next.desc && plainText(next.desc) ? <p className="liq-evt-next__x liq-rv">{clip(plainText(next.desc), 240)}</p> : null}
              <div className="liq-evt-next__cta liq-rv">
                <Pill href={nextHref} variant="ink">Full details</Pill>
                {next.reg ? <Pill href={next.reg} variant="ghost" external>Register</Pill> : null}
              </div>
            </div>
          </div>
        </Band>
      ) : null}

      {/* ── the rest of the year, as the diary ── */}
      {hasDiary ? (
        <Band tone="paper" className="liq-evt-diary" aria-labelledby="liq-evt-diary-h">
          <SectionHead big={['The', 'diary']} id="liq-evt-diary-h" />
          {groups.map((g, i) => (
            <section className="liq-evt-month" key={g.label} aria-labelledby={'liq-evt-m' + i}>
              <MonthHead label={g.label} count={g.rows.length} id={'liq-evt-m' + i} />
              <ul className="liq-rows liq-evt-rows">
                {g.rows.map((e) => <Row e={e} key={e.id} />)}
              </ul>
            </section>
          ))}
          {past.length ? (
            <section className="liq-evt-month liq-evt-month--past" aria-labelledby="liq-evt-past-h">
              <h3 className="liq-evt-month__h liq-rv" id="liq-evt-past-h">
                <span className="liq-evt-month__name">Earlier this Rotary year</span>
                <span className="liq-evt-month__n">{past.length + (past.length === 1 ? ' event' : ' events')}</span>
              </h3>
              <ul className="liq-rows liq-evt-rows">
                {past.map((e) => <Row e={e} key={e.id} past />)}
              </ul>
            </section>
          ) : null}
        </Band>
      ) : null}

      {/* ── nothing listed: say so, then point to the weekly meeting ── */}
      {events !== null && list.length === 0 ? (
        <>
          <Band tone="paper" className="liq-evt-none" aria-labelledby="liq-evt-none-h">
            <EmptyState
              title={<span id="liq-evt-none-h">No upcoming events are listed for this Rotary year</span>}
              text={'Events the club adds' + (year ? ' for ' + year : '') + ' will be listed here. The calendar also shows past months, birthdays and anniversaries.'}
              action={<Pill href="/calendar" variant="ink">Open the calendar</Pill>}
            />
          </Band>
          {hasMeet ? (
            <Band tone="gold" className="liq-evt-flood liq-evt-meet" aria-labelledby="liq-evt-meet-h">
              <h2 className="liq-kicker" id="liq-evt-meet-h">Meanwhile, the club meeting</h2>
              {day ? (
                <p className="liq-evt-meet__day liq-rise" style={{ '--liq-lw': longestWord(day) }}><Chars text={day} mask /></p>
              ) : null}
              <div className="liq-evt-meet__info">
                {time ? <p className="liq-evt-meet__time">{time}</p> : null}
                {venue ? <p className="liq-evt-meet__venue">{venue}</p> : null}
                {venue ? <Pill href={ab.mapUrl} variant="ink" external>Directions</Pill> : null}
              </div>
            </Band>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
