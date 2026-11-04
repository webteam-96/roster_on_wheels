'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · Calendar — a month is a day's walk.
//
// Gold hero with the month as a chapter title in its right column (prev / next
// links, "this month"). Below, on cream:
//   the month card   a strip of sky that runs dawn -> noon -> night across the
//                    month, with a low sun standing over the chosen day (day 1
//                    rises from the hills, the last day sets into them), a key,
//                    and the day grid (Monday first, marks by SHAPE and colour:
//                    birthday = disc, anniversary = heart, event = diamond)
//   the day sheet    birthdays / anniversaries / events for the whole month or
//                    the chosen day: people as "day chips" (the day in a small
//                    gold sun), events as tickets linking to /event?id=.
// Phones: the card stacks over the sheet; the sheet is an agenda list.
// Motion: the month title slides in sideways from the side you walked to and
// the days follow; the sun glides along its arc to the chosen day; sheet rows
// rise. Reduced motion: everything is static and complete.
//
// Data + URL contract exactly as CalendarGold: useCalendarData(year, month),
// ?month=yyyy-MM / ?date=yyyy-MM-dd via resolveContext, month links are real
// links, the day filter is local state re-armed on every month/date change.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { useCalendarData, monthName, fullDayLabelOf } from '../../_shared/data.js'
// ponytail: Gold's URL rule (?month=/?date=) is not re-exported by _shared/data.js yet (sharedRequest) — imported, never re-implemented.
import { resolveContext, addMonths } from '@/themes/shared/pages/AllSpecialDates.jsx'
import { PageHero, Button, EmptyState, Loading, Ridge, PersonPhoto, IconArrow, IconBack } from '../kit.jsx'
import { useScene, afterFonts, gsap, split, rise } from '../motion.js'
import './Calendar.css'
import { MonthJump } from '../../_shared/kit.jsx'

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// `one`/`many` are spelled out: stripping an "s" turns "Anniversaries" into "Anniversarie".
const CATS = [
  { key: 'birthdays', label: 'Birthdays', one: 'Birthday', many: 'birthdays', mk: 'b', flag: 1 },
  { key: 'anniversaries', label: 'Anniversaries', one: 'Anniversary', many: 'anniversaries', mk: 'a', flag: 2 },
  { key: 'events', label: 'Events', one: 'Event', many: 'events', mk: 'e', flag: 4 },
]

// Marks differ by shape, not only colour: disc, heart, diamond.
const MK_PATH = {
  b: <circle cx="5" cy="5" r="4.3" />,
  a: <path d="M5 9.2 1.2 5.3A2.45 2.45 0 0 1 5 2.1 2.45 2.45 0 0 1 8.8 5.3Z" />,
  e: <path d="M5 .5 9.5 5 5 9.5 .5 5Z" />,
}
const Mk = ({ k }) => (
  <svg className={'hj-cal-mk hj-cal-mk--' + k} viewBox="0 0 10 10" aria-hidden="true" focusable="false">{MK_PATH[k]}</svg>
)

const weekday = (y, m, d) => WEEK[(new Date(y, m - 1, d).getDay() + 6) % 7]

/** The hero's right column: the month as a chapter title + the month links. */
function MonthNav({ year, month, isNow }) {
  const link = (n) => {
    const v = addMonths(year, month, n)
    const [y, m] = v.split('-').map(Number)
    return { href: '/calendar?month=' + v, name: monthName(m), y }
  }
  const prev = link(-1)
  const next = link(1)
  return (
    <div className="hj-cal-mnav">
      <div className="hj-cal-m" aria-live="polite">
        {/* keyed: a new month mounts a new heading, so SplitText never reverts stale text */}
        <h2 key={year + '-' + month} className="hj-cal-m__t" style={{ position: 'relative' }}>
          <span className="hj-cal-m__mo">{monthName(month)}</span> <span className="hj-cal-m__yr">{year}</span>
          <MonthJump year={year} month={month} label={monthName(month) + ' ' + year} />
        </h2>
      </div>
      <nav className="hj-cal-mbtns" aria-label="Change month">
        <a className="hj-cal-mbtn" href={prev.href} aria-label={'Previous month, ' + prev.name + ' ' + prev.y}>
          <IconBack /><span className="hj-cal-mbtn__l">{prev.name}</span><span className="hj-cal-mbtn__s">{prev.name.slice(0, 3)}</span>
        </a>
        {isNow ? null : <a className="hj-cal-mbtn hj-cal-mbtn--now" href="/calendar">This month</a>}
        <a className="hj-cal-mbtn" href={next.href} aria-label={'Next month, ' + next.name + ' ' + next.y}>
          <span className="hj-cal-mbtn__l">{next.name}</span><span className="hj-cal-mbtn__s">{next.name.slice(0, 3)}</span><IconArrow />
        </a>
      </nav>
    </div>
  )
}

export default function Calendar({ data }) {
  const location = useLocation()
  const today = useMemo(() => new Date(), [])
  const ctx = useMemo(() => resolveContext(location.search, today), [location.search, today])
  const { year, month } = ctx
  const d = useCalendarData(year, month, data)

  // The ?date= deep link pre-selects a day; 0 = the whole month. Re-armed on every
  // month/date change (Gold's rule) — derived, so no render ever pairs a new month
  // with the old month's day.
  const arm = year + '-' + month + '-' + (ctx.selectedDay || 0)
  const [pick, setPick] = useState({ arm, day: ctx.selectedDay || 0 })
  const sel = pick.arm === arm ? pick.day : (ctx.selectedDay || 0)
  const setSel = (day) => setPick({ arm, day })

  // Which way did we walk? (the title and days slide in from that side)
  const mk = year * 12 + month
  const prevMk = useRef(mk)
  const dir = mk < prevMk.current ? -1 : 1
  useEffect(() => { prevMk.current = mk }, [mk])

  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7 // Monday-first
  const isNow = year === today.getFullYear() && month === today.getMonth() + 1
  const isToday = (day) => isNow && day === today.getDate()
  const mname = monthName(month)

  // While a month loads the hook still holds the previous month's payload: show nothing from it.
  const loaded = !d.loading
  const flags = loaded ? d.flags : {}
  const rows = {}
  const counts = {}
  let total = 0
  for (const c of CATS) {
    const all = loaded ? d[c.key] : []
    rows[c.key] = all.filter((it) => sel === 0 || it.day === sel)
    total += rows[c.key].length
    for (const it of all) {
      const o = counts[it.day] || (counts[it.day] = {})
      o[c.key] = (o[c.key] || 0) + 1
    }
  }
  const dayName = (day) => {
    const o = counts[day] || {}
    const parts = CATS.filter((c) => o[c.key]).map((c) => o[c.key] + ' ' + (o[c.key] === 1 ? c.one.toLowerCase() : c.many))
    return fullDayLabelOf(year, month, day) + (isToday(day) ? ', today' : '') + (parts.length ? ': ' + parts.join(', ') : '')
  }
  const countText = total + (total === 1 ? ' entry ' : ' entries ') +
    (sel ? 'on ' + sel + ' ' + mname : 'in ' + mname + ' ' + year)

  // The sun stands over the chosen day (or today), at noon for a whole month elsewhere.
  const focus = sel || (isNow ? today.getDate() : 0)
  const st = focus ? (daysInMonth > 1 ? (focus - 1) / (daysInMonth - 1) : 0.5) : 0.5
  const arc = (v) => ({ '--x': v.toFixed(4), '--y': Math.sin(Math.PI * v).toFixed(4) })

  // ── motion ────────────────────────────────────────────────────────────────
  const ref = useRef(null)
  const skyRef = useRef(null)
  const sheetRef = useRef(null)
  const sunFrom = useRef(null)

  // The month title slides in like a chapter on the track; the days follow it.
  useScene(ref, (c, gctx) => afterFonts(gctx, () => {
    const root = ref.current
    const t = root.querySelector('.hj-cal-m__t')
    if (t) {
      const s = split(t)
      gsap.fromTo(s ? s.chars : t, { x: 120 * dir, skewX: -12 * dir, opacity: 0 },
        { x: 0, skewX: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.025, clearProps: 'transform,opacity' })
    }
    const grid = root.querySelector('.hj-cal-days')
    if (grid) {
      gsap.fromTo(grid.children, { x: 36 * dir, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.012, clearProps: 'transform,opacity',
          scrollTrigger: { trigger: grid, start: 'top 92%', once: true } })
    }
  }), [mk])

  // The sun walks its arc to the chosen day (first arrival: it rises from day 1).
  useScene(skyRef, () => {
    const from = sunFrom.current == null ? 0 : sunFrom.current
    sunFrom.current = st
    if (Math.abs(from - st) < 0.001) return undefined
    const sky = skyRef.current
    const put = (v) => { const a = arc(v); sky.style.setProperty('--x', a['--x']); sky.style.setProperty('--y', a['--y']) }
    const o = { v: from }
    put(from)
    gsap.to(o, { v: st, duration: 0.7 + Math.abs(st - from) * 1.1, ease: 'power2.inOut', onUpdate: () => put(o.v) })
    return () => put(st)
  }, [st])

  // The sheet's rows rise whenever what it lists changes.
  useScene(sheetRef, () => {
    const items = sheetRef.current.querySelectorAll('.hj-cal-it')
    if (items.length) rise(items, sheetRef.current, { stagger: Math.min(0.06, 0.8 / items.length), start: 'top 88%', duration: 0.8 })
  }, [loaded, mk, sel])

  return (
    <div className="hj-page hj-ground--cream hj-cal" ref={ref}>
      <PageHero tone="gold" title="Calendar"
                aside={<MonthNav year={year} month={month} isNow={isNow} />} />

      <div className="hj-wrap hj-sec hj-endpad hj-cal-body">

        {/* ══ The month card ══ */}
        <div className="hj-cal-card">
          <div className="hj-cal-sky" ref={skyRef} style={arc(st)} aria-hidden="true">
            <span className="hj-stars" />
            <span className="hj-cal-sky__sun">{focus || ''}</span>
            <div className="hj-cal-sky__hills">
              <Ridge preset="far" seed={0.6} />
              <Ridge preset="ground" fill="#fff" className="hj-rg--ground" />
            </div>
          </div>

          <ul className="hj-cal-key" aria-label="Key">
            {CATS.map((c) => <li key={c.key}><Mk k={c.mk} />{c.one}</li>)}
            {isNow ? <li><span className="hj-cal-key__today" aria-hidden="true" />Today</li> : null}
            <li><span className="hj-cal-key__sel" aria-hidden="true" />Chosen day</li>
          </ul>

          <div className="hj-cal-grid" role="group" aria-label={'Days of ' + mname + ' ' + year}>
            <div className="hj-cal-week" aria-hidden="true">
              {WEEK.map((w) => <span key={w}>{w}</span>)}
            </div>
            <div className="hj-cal-days">
              {Array.from({ length: lead }, (_, i) => <span className="hj-cal-pad" key={'pad' + i} aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const f = flags[day] || 0
                return (
                  <button type="button" key={day}
                          className={'hj-cal-d' + (f ? ' hj-cal-d--has' : '')}
                          aria-pressed={sel === day}
                          aria-current={isToday(day) ? 'date' : undefined}
                          aria-label={dayName(day)}
                          /* choosing the chosen day again goes back to the whole month */
                          onClick={() => setSel(sel === day ? 0 : day)}>
                    <span className="hj-cal-d__n">{day}</span>
                    <span className="hj-cal-d__mk" aria-hidden="true">
                      {CATS.filter((c) => (f & c.flag) !== 0).map((c) => <Mk key={c.key} k={c.mk} />)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ══ The day sheet ══ */}
        <section className="hj-cal-sheet" ref={sheetRef} aria-labelledby="hj-cal-sheet-t">
          <div className="hj-cal-sheet__h">
            <div className="hj-cal-sheet__main">
              <p className="hj-kicker">{sel ? 'Chosen day' : 'Whole month'}</p>
              <h2 id="hj-cal-sheet-t" className="hj-cal-sheet__t">
                {sel === 0 ? 'All of ' + mname : fullDayLabelOf(year, month, sel)}
              </h2>
              <p className="hj-count hj-cal-sheet__c" aria-live="polite">{loaded ? countText : ''}</p>
            </div>
            {sel !== 0 ? <Button variant="ghost" size="sm" icon="back" onClick={() => setSel(0)}>Whole month</Button> : null}
          </div>

          {!loaded ? (
            <Loading label={'Loading ' + mname} />
          ) : total === 0 ? (
            <EmptyState as="h3" title={'Nothing recorded ' + (sel ? 'on this day' : 'in ' + mname)}
                        message="Birthdays, anniversaries and events show here once the club records them." />
          ) : CATS.filter((c) => rows[c.key].length > 0).map((c) => (   /* empty kinds hidden (client, 2026-09-29) */
            <div className="hj-cal-grp" key={c.key}>
              <h3 className="hj-cal-grp__h">
                <Mk k={c.mk} />{c.label}<span className="hj-cal-grp__n">{rows[c.key].length}</span>
              </h3>
              {rows[c.key].length === 0 ? (
                <p className="hj-cal-none">No {c.many} {sel ? 'on this day' : 'this month'}.</p>
              ) : (
                <ul className={'hj-cal-list hj-cal-list--' + c.mk}>
                  {rows[c.key].map((it, i) => (c.key === 'events' ? (
                    <li className="hj-cal-it hj-cal-ev" key={'e' + it.id + '-' + it.day + '-' + i}>
                      <span className="hj-cal-ev__stub" aria-hidden="true">
                        <span className="hj-cal-ev__d">{it.day}</span>
                        <span className="hj-cal-ev__w">{weekday(year, month, it.day)}</span>
                      </span>
                      <span className="hj-cal-ev__b">
                        <a className="hj-cal-ev__t" href={'/event?id=' + it.id}>{it.title || 'Event'}</a>
                        <span className="hj-cal-meta"><Mk k="e" />{[it.venue, it.dayLabel].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="hj-cal-ev__go" aria-hidden="true"><IconArrow /></span>
                    </li>
                  ) : (
                    <li className="hj-cal-it hj-cal-p" key={c.mk + it.day + '-' + i}>
                      <span className="hj-cal-sunc" aria-hidden="true">{it.day}</span>
                      <span className="hj-cal-ph" aria-hidden="true">
                        <PersonPhoto src={it.img} name={it.name} alt="" className="hj-cal-ph__i" monoClass="hj-cal-ph__mono" width="80" height="80" />
                      </span>
                      <span className="hj-cal-p__b">
                        <span className="hj-cal-p__n">{it.name}</span>
                        <span className="hj-cal-meta"><Mk k={c.mk} />{c.one} · {it.dayLabel}</span>
                      </span>
                    </li>
                  )))}
                </ul>
              )}
            </div>
          ))}
        </section>

      </div>
    </div>
  )
}
