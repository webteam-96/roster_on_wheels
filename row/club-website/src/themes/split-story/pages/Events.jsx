'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Events — the selected Rotary year's events, told as the theme's
// split: one chapter per month. As each event crosses the middle of the screen
// the sticky royal panel counts its date up from 01, with the weekday, time and
// venue beneath. Each month is the gold-to-azure timeline (posters open by iris /
// diagonal wipe, never cropped). The next event carries a gold "Next up" tag.
// A club with nothing on the books gets a designed empty state that points to
// its regular meeting on the closing gold band.
// Data: useEventsData() only (sorted, year-scoped by EventsGold's rule).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef } from 'react'
import { useClub, useEventsData, useAboutData, usePageTitle, useCurrentMenuName, plainText, formatTime } from '../../_shared/data.js'
import { PageHero, Split, Chapter, Timeline, TimelineItem, Button, GoldBand, EmptyState, Loading, excerpt, yearText } from '../kit.jsx'
import { useRefreshOnImages } from '../motion.js'
import './Events.css'

const PIN = (
  <svg className="spl-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 10c0 6.5-8 12-8 12s-8-5.5-8-12a8 8 0 0 1 16 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
)

/** "Today" / "Tomorrow" / "In 17 days", in whole days from midnight (EventsGold's wording); null once past. */
function countdown(ts) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - midnight.getTime()) / 86400000)
  if (days < 0) return null
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 31) return 'In ' + days + ' days'
  const weeks = Math.round(days / 7)
  return weeks < 9 ? 'In ' + weeks + ' weeks' : 'In ' + Math.round(days / 30) + ' months'
}

/** A midnight record has no time filed (the home's rule). */
function timeOf(ts, zone) {
  const d = new Date(ts)
  return d.getHours() === 0 && d.getMinutes() === 0 ? '' : formatTime(d, zone)
}

const has = (v) => !!v && String(v).trim() !== '' && String(v).trim() !== '—'

/** Nothing scheduled: the designed empty card, then the club's regular meeting on the gold band. */
function NoEvents({ year }) {
  const a = useAboutData()
  const facts = [['Day', a.meetingDay], ['Time', a.meetingTime], ['Venue', a.meetingVenue]].filter(([, v]) => has(v))
  const meets = !a.loading && facts.length > 0
  return (
    <>
      <section className="spl-section">
        <div className="spl-x">
          <EmptyState
            title={'No upcoming events' + (year ? ' in ' + year : '')}
            message={'When the club schedules an event it will appear here.' +
              (meets ? ' Meanwhile, you can meet the club at its regular meeting.' : ' The calendar lists club dates month by month.')}
            action={<Button href="/calendar" variant="royal">Open the calendar</Button>} />
        </div>
      </section>
      {meets ? (
        <GoldBand id="spl-ev-meet" title="Where we meet"
                  giant={has(a.meetingDay) ? <>{a.meetingDay}{has(a.meetingTime) ? <> <span className="spl-ghost">{a.meetingTime}</span></> : null}</> : null}>
          <dl className="spl-facts">
            {facts.map(([k, v]) => <div key={k} className={k === 'Venue' ? 'is-long' : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="spl-ev-meet-actions">
            {has(a.meetingVenue) ? <Button href={a.mapUrl} external variant="royal">Open in maps</Button> : null}
            <Button href="/about" variant="ghost">About the club</Button>
          </div>
        </GoldBand>
      ) : null}
    </>
  )
}

export default function Events({ data }) {
  const club = useClub()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Upcoming events'
  usePageTitle(title)
  const events = useEventsData(data)                 // null while loading
  const ref = useRef(null)
  const year = yearText(club.selectedYearLabel)

  // Month chapters straight off the hook's date order, so a month can never head an empty list.
  const { months, upcoming, next } = useMemo(() => {
    const out = []
    let upcoming = 0, next = null
    for (const e of events || []) {
      const row = { ...e, when: countdown(e.ts), time: timeOf(e.ts, club.timeZone) }
      if (row.when) { upcoming++; if (!next) next = row }
      const last = out[out.length - 1]
      if (!last || last.label !== e.monthLabel) out.push({ label: e.monthLabel, rows: [row] })
      else last.rows.push(row)
    }
    return { months: out, upcoming, next }
  }, [events])

  const count = events ? events.length : 0
  const key = String(club.selectedYearId) + '|' + (events || []).map((e) => e.id).join(',')
  useRefreshOnImages(ref, [key])

  const stateOf = (e, label) => ({
    title: label, value: parseInt(e.day, 10) || e.day, from: 1, fmt: 'pad',
    caption: [e.weekday, e.time].filter(Boolean).join(' · '), sub: e.venue,
  })
  const rail = months.map((m) => m.label)   // more than 6 months flow into the kit's two-column rail

  return (
    <div className="spl-ev" ref={ref}>
      <PageHero title={title} eyebrow={year ? 'Rotary year ' + year : null}
                lead={next ? 'Next up: ' + next.title + ' · ' + next.when.toLowerCase() : null}
                stat={count ? (upcoming ? { value: upcoming, label: 'Upcoming' } : { value: count, label: count === 1 ? 'Event' : 'Events' }) : null} />

      {events === null ? (
        <section className="spl-section"><div className="spl-x"><Loading label="Loading events" /></div></section>
      ) : count === 0 ? (
        <NoEvents year={year} />
      ) : (
        <Split rail={rail} deps={[key]}>
          {months.map((m, mi) => (
            <Chapter key={m.label} id={'spl-ev-m' + mi} title={m.label} state={stateOf(m.rows[0], m.label)}>
              <div className="spl-wrap">
                <Timeline watch={key}>
                  {m.rows.map((e) => {
                    const desc = excerpt(plainText(e.desc), 220)
                    const isNext = next && e.id === next.id
                    return (
                      <TimelineItem key={e.id} className={isNext ? 'spl-ev-next' : ''}
                                    label={(e.weekday ? e.weekday.slice(0, 3) + ' ' : '') + e.day}
                                    tag={isNext ? 'Next up · ' + e.when : e.when || 'Past event'}
                                    photo={e.img} title={e.title} state={stateOf(e, m.label)}>
                        {e.time || e.venue ? (
                          <p className="spl-ev-meta">
                            {e.time ? <span className="spl-ev-time">{e.time}</span> : null}
                            {e.venue ? <span className="spl-ev-venue">{PIN}<span>{e.venue}</span></span> : null}
                          </p>
                        ) : null}
                        {desc ? <p className="spl-tl-desc">{desc}</p> : null}
                        <div className="spl-ev-actions">
                          <Button href={'/event?id=' + e.id} variant="royal">Event details<span className="spl-sr">: {e.title}</span></Button>
                          {e.reg ? <Button href={e.reg} external variant="gold">Register<span className="spl-sr">: {e.title}</span></Button> : null}
                        </div>
                      </TimelineItem>
                    )
                  })}
                </Timeline>
              </div>
            </Chapter>
          ))}
        </Split>
      )}
    </div>
  )
}
