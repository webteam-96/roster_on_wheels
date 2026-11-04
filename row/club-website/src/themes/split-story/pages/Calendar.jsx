'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SPLIT STORY · CALENDAR — the month told day by day.
//
// The royal hero holds the month: the month's name rises letter by letter on
// every change, prev/next are real links (a different month IS different data,
// exactly as CalendarGold), and a night mini-month marks each day's kinds with
// SHAPES (gold dot = birthday, sky ring = anniversary, white square = event) so
// they read without colour. Picking a day filters the story without a reload;
// picking it again (or "Whole month") clears it.
//
// Below, the Split: every day that has entries is a panel state, so on wide
// screens the sticky royal panel keeps the month as its title while its gold
// day number counts forward to each day as it crosses mid-screen (weekday +
// "2 birthdays · 1 event" underneath). Phones get the agenda: the 60px strip
// (month + day number) over a vertical list of days, people as compact rows.
//
// Data: useCalendarData(year, month) only, and the /calendar contract
// (?month=yyyy-MM, ?date=yyyy-MM-dd) parsed by the same resolveContext Gold uses.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// The /calendar query contract. Gold imports it from this module; _shared/data.js
// does not re-export it yet (see sharedRequests) — imported, never copied.
import { resolveContext, addMonths } from '@/themes/shared/pages/AllSpecialDates.jsx'
import {
  useClub, useCalendarData, usePageTitle, useCurrentMenuName, monthName, fullDayLabelOf, withYear,
} from '../../_shared/data.js'
import {
  PageHero, Split, fig, PersonCard, WipeList, WipeRow, Chips, Button, Arrow, EmptyState, Loading, GoldBand,
} from '../kit.jsx'
import { useScene, useRefreshOnImages, riseChars, riseIn, revealBatch, photosIn } from '../motion.js'
import './Calendar.css'
import { MonthJump } from '../../_shared/kit.jsx'

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// `one` is spelled out: stripping an "s" turns "Anniversaries" into "Anniversarie".
const CATS = [
  { key: 'birthdays', label: 'Birthdays', one: 'Birthday', flag: 1 },
  { key: 'anniversaries', label: 'Anniversaries', one: 'Anniversary', flag: 2 },
  { key: 'events', label: 'Events', one: 'Event', flag: 4 },
]

/** { birthdays: 2, events: 1 } -> "2 birthdays · 1 event" */
const summary = (n, sep) => CATS.filter((k) => n[k.key])
  .map((k) => n[k.key] + ' ' + (n[k.key] === 1 ? k.one : k.label).toLowerCase()).join(sep)

const ico = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' }
const Cake = () => (
  <svg {...ico}><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" /><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1" /><path d="M2 21h20M7 8v3M12 8v3M17 8v3" /></svg>
)
const Rings = () => (
  <svg {...ico}><circle cx="9" cy="14" r="5.5" /><circle cx="15" cy="14" r="5.5" /><path d="M10.5 3h3L12 6z" /></svg>
)

export default function Calendar({ data }) {
  const club = useClub()
  const location = useLocation()
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'Calendar'
  usePageTitle(title)

  const today = useMemo(() => new Date(), [])
  const ctx = useMemo(() => resolveContext(location.search, today), [location.search, today])
  const { year, month } = ctx
  const d = useCalendarData(year, month, data)

  // ?date= pre-selects a day; 0 = the whole month. Re-armed on every month change (as Gold).
  const [sel, setSel] = useState(ctx.selectedDay || 0)
  useEffect(() => { setSel(ctx.selectedDay || 0) }, [ctx.selectedDay, year, month])
  const [kind, setKind] = useState('all')

  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7   // Monday-first
  const isToday = (day) => year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate()
  const weekday = (day) => WEEKDAYS[new Date(year, month - 1, day).getDay()]
  const mName = monthName(month)
  const monthTitle = mName + ' ' + year

  // Per-day counts of every kind (day button labels), then the filtered story.
  const perDay = {}
  for (const k of CATS) for (const it of d[k.key]) {
    const n = perDay[it.day] || (perDay[it.day] = {})
    n[k.key] = (n[k.key] || 0) + 1
  }
  const monthTotal = d.birthdays.length + d.anniversaries.length + d.events.length
  const inSel = (it) => sel === 0 || it.day === sel
  const counts = {}
  for (const k of CATS) counts[k.key] = d[k.key].filter(inSel).length
  const allCount = counts.birthdays + counts.anniversaries + counts.events

  const cats = kind === 'all' ? CATS : CATS.filter((k) => k.key === kind)
  const byDay = new Map()
  for (const k of cats) for (const it of d[k.key]) {
    if (!inSel(it)) continue
    let g = byDay.get(it.day)
    if (!g) byDay.set(it.day, (g = { day: it.day, people: [], events: [], n: {} }))
    g.n[k.key] = (g.n[k.key] || 0) + 1
    if (k.key === 'events') g.events.push(it)
    else g.people.push({ ...it, kind: k.key, one: k.one })
  }
  const days = [...byDay.values()].sort((a, b) => a.day - b.day)
  const shown = days.reduce((s, g) => s + g.people.length + g.events.length, 0)
  const listKey = [d.loading, year, month, sel, kind].join('|')

  // ── motion: the month name rises and the days settle on every month change;
  //    the story's headings/people fade up and portraits open iris / wipe.
  const ref = useRef(null)
  useScene(ref, (c, sctx) => {
    const r = ref.current
    riseChars(sctx, r.querySelector('.spl-cal-mname'), { delay: 0.1, duration: 0.8, stagger: 0.035 })
    riseIn(r.querySelectorAll('.spl-cal-d'), { delay: 0.2, y: 14, stagger: 0.012 })
  }, [year, month])
  useScene(ref, (c) => {
    const r = ref.current
    revealBatch(r.querySelectorAll('.spl-cal-dtitle'), { y: 24 })
    revealBatch(r.querySelectorAll('.spl-cal-pli'), { y: 30, stagger: 0.06 })
    if (c.wide) photosIn(r.querySelectorAll('.spl-cal-pli .spl-person-photo'))
  }, [listKey])
  useRefreshOnImages(ref, [listKey])

  const noun = (n) => (n === 1 ? 'entry' : 'entries')
  const countText = d.loading ? 'Loading ' + mName + '…'
    : shown + ' ' + noun(shown) + (sel ? ' on ' + sel + ' ' + mName : ' in ' + mName)

  let body
  if (d.loading) {
    body = <Loading label="Loading the calendar" />
  } else if (days.length === 0) {
    const kindLabel = kind === 'all' ? '' : CATS.find((k) => k.key === kind).label.toLowerCase()
    body = monthTotal === 0 ? (
      <EmptyState headingAs="h3" title={'Nothing on the calendar in ' + mName}
        message="No birthdays, anniversaries or events are recorded for this month. Try another month." />
    ) : sel ? (
      <EmptyState headingAs="h3" title={(kindLabel ? 'No ' + kindLabel : 'Nothing recorded') + ' on ' + sel + ' ' + mName}
        action={<Button variant="royal" arrow={false} onClick={() => setSel(0)}>Show the whole month</Button>} />
    ) : (
      <EmptyState headingAs="h3" title={'No ' + kindLabel + ' in ' + mName}
        action={<Button variant="royal" arrow={false} onClick={() => setKind('all')}>Show everything</Button>} />
    )
  }

  return (
    <div className="spl-cal" ref={ref}>
      <PageHero title={title} lead="The club's birthdays, anniversaries and events, month by month.">
        <div className="spl-cal-ctrl">
          <div className="spl-cal-side">
            <div className="spl-cal-switch">
              <Button href={'/calendar?month=' + addMonths(year, month, -1)} variant="light" arrow={false}
                      className="spl-cal-step spl-cal-step--prev" aria-label="Previous month"><Arrow dir={-1} /></Button>
              <div className="spl-cal-mwrap" aria-live="polite" style={{ position: 'relative' }}>
                <h2 className="spl-cal-mname" key={monthTitle}>{mName} <span>{year}</span></h2>
                {/* beside the title, not in it: the title's letters are re-split by its animation (client, 2026-10-06) */}
                <MonthJump year={year} month={month} label={monthTitle} />
              </div>
              <Button href={'/calendar?month=' + addMonths(year, month, 1)} variant="light" arrow={false}
                      className="spl-cal-step" aria-label="Next month"><Arrow /></Button>
            </div>
            <Chips label="Filter by type" value={kind} onChange={setKind} className="spl-cal-chips"
                   items={[{ value: 'all', label: 'All', count: allCount },
                     ...CATS.map((k) => ({ value: k.key, label: k.label, count: counts[k.key] }))]} />
            <div className="spl-cal-scope">
              <p className="spl-count" aria-live="polite">{countText}</p>
              {sel ? <Button variant="gold" arrow={false} onClick={() => setSel(0)}>Whole month</Button> : null}
            </div>
          </div>

          <div className="spl-cal-month">
            <div className="spl-cal-week" aria-hidden="true">{WEEK.map((w, i) => <span key={i}>{w}</span>)}</div>
            <div className="spl-cal-grid">
              {Array.from({ length: lead }, (_, i) => <span className="spl-cal-pad" key={'pad' + i} aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const f = d.flags[day] || 0
                const n = perDay[day]
                return (
                  <button type="button" key={day}
                          className={'spl-cal-d' + (f ? ' has-dates' : '') + (isToday(day) ? ' is-today' : '')}
                          aria-pressed={sel === day ? 'true' : 'false'}
                          aria-current={isToday(day) ? 'date' : undefined}
                          aria-label={weekday(day) + ', ' + fullDayLabelOf(year, month, day) + (n ? ', ' + summary(n, ', ') : '')}
                          onClick={() => setSel(sel === day ? 0 : day)}>
                    <span>{day}</span>
                    {f ? (
                      <span className="spl-cal-marks" aria-hidden="true">
                        {CATS.filter((k) => (f & k.flag) !== 0).map((k) => <i key={k.key} className={'spl-cal-mark spl-cal-mark--' + k.key} />)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <ul className="spl-cal-key" aria-hidden="true">
              {CATS.map((k) => <li key={k.key}><i className={'spl-cal-mark spl-cal-mark--' + k.key} />{k.one}</li>)}
            </ul>
          </div>
        </div>
      </PageHero>

      {body ? (
        <section className="spl-section"><div className="spl-x">{body}</div></section>
      ) : (
        <Split deps={[listKey]}>
          {days.map((g, i) => {
            const id = 'spl-cal-day-' + g.day
            return (
              <section className="spl-cal-day" key={g.day} aria-labelledby={id}
                       {...fig({ title: monthTitle, value: g.day, from: i ? days[i - 1].day : 1, fmt: 'pad',
                         caption: weekday(g.day) + (isToday(g.day) ? ' · Today' : ''), sub: summary(g.n, ' · ') })}>
                <h3 className="spl-cal-dtitle" id={id}>
                  <span className="spl-cal-dwd">{weekday(g.day)}{isToday(g.day) ? ' · Today' : ''}</span>
                  <span className="spl-cal-ddate">{g.day} {mName}</span>
                </h3>
                {g.people.length ? (
                  <ul className="spl-grid spl-cal-people">
                    {g.people.map((p, j) => (
                      <li className={'spl-cal-pli spl-cal-pli--' + p.kind} key={p.kind + j}>
                        <span className="spl-cal-badge" aria-hidden="true">{p.kind === 'birthdays' ? <Cake /> : <Rings />}</span>
                        <PersonCard name={p.name} role={p.one} img={p.img} nameAs="h4" className="spl-cal-person" />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {g.events.length ? (
                  <WipeList watch={listKey} className="spl-cal-events">
                    {g.events.map((ev, j) => (
                      <WipeRow key={ev.id + '-' + j} href={'/event?id=' + ev.id} title={ev.title || 'Event'}
                               meta={['Event', ev.venue].filter(Boolean).join(' · ')} cta="Event details" />
                    ))}
                  </WipeList>
                ) : null}
              </section>
            )
          })}
        </Split>
      )}

      <GoldBand id="spl-cal-band" title="Upcoming events">
        <div className="spl-cal-band-act">
          <Button href={withYear('/events', club.selectedYearId)} variant="royal">See all events</Button>
        </div>
      </GoldBand>
    </div>
  )
}
