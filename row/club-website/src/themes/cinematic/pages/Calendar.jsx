'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · CALENDAR — "the call sheet".
// The hero carries the month switcher; the month's name rises out of its line
// every time the reel changes. Below, the call sheet: a lit mini-month (opens
// like a projector, days with anything get shaped marks — circle, diamond,
// frame — so the kinds read without colour) beside the scope's counts, which
// count up. Then the moment: the month as a strip of three clapperboard slates
// (Birthdays / Anniversaries / Events) that wipe open from the bottom; picking a
// day filters them. Phones stack the slates behind a tab row.
// Data: useCalendarData(year, month) only (goldData.useCalendarGold) and the
// /calendar URL contract (?month=yyyy-MM, ?date=yyyy-MM-dd) exactly as Gold.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// The /calendar query contract. Gold imports it from the same module; it is not
// re-exported by _shared/data.js yet (see sharedRequests), so it is imported
// here rather than copied — the parse rule stays single-sourced.
import { resolveContext, addMonths } from '@/themes/shared/pages/AllSpecialDates.jsx'
import { useCalendarData, monthName } from '../../_shared/data.js'
import {
  usePageName, PageHero, Button, ChipGroup, ResultCount, StatRow, DateStamp, EmptyState, Loading,
  PersonPhoto, Arrow, ArrowBack,
} from '../kit.jsx'
import {
  gsap, useScene, afterFonts, cleanups, splitChars, titleIn, riseIn, wipeIn, projectorOpen, EXPO,
} from '../motion.js'
import './Calendar.css'
import { MonthJump } from '../../_shared/kit.jsx'

const ico = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' }
const Cake = () => (
  <svg {...ico}><path d="M4 20h16" /><path d="M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" /><path d="M5 16c1.3 0 1.9-1 3.5-1s2.2 1 3.5 1 1.9-1 3.5-1 2.2 1 3.5 1" /><path d="M12 12V8.5" /><path d="M12 3.5c.9 1 1.3 1.9 0 3.1-1.3-1.2-.9-2.1 0-3.1z" /></svg>
)
const Rings = () => (
  <svg {...ico}><circle cx="9" cy="14.5" r="5.5" /><circle cx="15" cy="14.5" r="5.5" /><path d="M12 3.2 13.6 5 12 6.8 10.4 5z" /></svg>
)
const Ticket = () => (
  <svg {...ico}><path d="M3.5 7h17v3a2 2 0 0 0 0 4v3h-17v-3a2 2 0 0 0 0-4z" /><path d="M14.5 7.5v9" strokeDasharray="1.5 2" /></svg>
)

// `one`/`many` are spelled out: "Anniversaries" minus "s" is not a word.
const CATS = [
  { key: 'birthdays', label: 'Birthdays', one: 'birthday', many: 'birthdays', flag: 1, Icon: Cake },
  { key: 'anniversaries', label: 'Anniversaries', one: 'anniversary', many: 'anniversaries', flag: 2, Icon: Rings },
  { key: 'events', label: 'Events', one: 'event', many: 'events', flag: 4, Icon: Ticket },
]
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NONE = { birthdays: [], anniversaries: [], events: [] }

const pad2 = (n) => String(n).padStart(2, '0')
const weekdayOf = (y, m, day) => WEEKDAYS[new Date(y, m - 1, day).getDay()]
const longDay = (y, m, day) => weekdayOf(y, m, day) + ' ' + day + ' ' + monthName(m) + ' ' + y
const say = (n, c) => n + ' ' + (n === 1 ? c.one : c.many)

// ── hero meta: the month switcher ────────────────────────────────────────────
function MonthSwitch({ year, month, isThisMonth }) {
  const ref = useRef(null)
  const name = monthName(month)
  const prev = monthName(new Date(year, month - 2, 1).getMonth() + 1)
  const next = monthName(new Date(year, month, 1).getMonth() + 1)
  useScene(ref, (c, ctx) => {
    const off = cleanups()
    off(afterFonts(ctx, () => {
      const s = splitChars(ref.current.querySelector('.cin-cal-mon__m'), 'none')
      if (s) gsap.from(s.chars, { yPercent: 115, duration: 0.9, ease: EXPO, stagger: 0.035, onComplete: () => s.revert() })
      riseIn(ref.current.querySelector('.cin-cal-mon__y'), { trigger: false, y: 24, delay: 0.25, duration: 0.8 })
    }))
    return off.run
  }, [year, month])

  return (
    <div ref={ref} className="cin-cal-switch">
      <h2 className="cin-cal-mon" style={{ position: 'relative' }}>
        <MonthJump year={year} month={month} label={name + ' ' + year} />
        <span className="cin-sr">{name} {year}</span>
        <span className="cin-cal-mon__vis" aria-hidden="true">
          <span className="cin-cal-mon__m" key={name}>{name}</span>{' '}
          <span className="cin-cal-mon__y" key={year}>{year}</span>
        </span>
      </h2>
      <nav className="cin-cal-switch__nav" aria-label="Change month">
        <Button href={'/calendar?month=' + addMonths(year, month, -1)} variant="line" small>
          <ArrowBack /><span className="cin-sr">Previous month: </span>{prev}
        </Button>
        <Button href={'/calendar?month=' + addMonths(year, month, 1)} variant="line" small>
          <span className="cin-sr">Next month: </span>{next}<Arrow />
        </Button>
        {isThisMonth ? null : <Button href="/calendar" variant="text" small>This month</Button>}
      </nav>
    </div>
  )
}

// ── one slate: a kind of date, its rows or a designed empty card ─────────────
function Slate({ cat, items, sel, year, month, off }) {
  const hid = 'cin-cal-col-' + cat.key
  const mon = monthName(month).slice(0, 3)
  const isEvent = cat.key === 'events'
  return (
    <section className={'cin-cal-col cin-cal-col--' + cat.key + (off ? ' is-off' : '')} aria-labelledby={hid}>
      <div className="cin-cal-col__h">
        <span className="cin-cal-col__ico"><cat.Icon /></span>
        <h3 id={hid} className="cin-cal-col__t">
          <span>{cat.label}</span><span className="cin-sr">: </span><span className="cin-cal-col__n">{items.length}</span>
        </h3>
      </div>
      {items.length ? (
        <ul className="cin-cal-list">
          {items.map((it, i) => (
            <li key={it.day + '|' + (isEvent ? it.id : it.name) + '|' + i} className={'cin-cal-row' + (isEvent ? ' cin-cal-row--go' : '')}>
              <time className="cin-cal-row__date" dateTime={year + '-' + pad2(month) + '-' + pad2(it.day)}>
                <DateStamp day={it.day} mon={mon} weekday={weekdayOf(year, month, it.day).slice(0, 3)} />
              </time>
              {isEvent ? (
                <span className="cin-cal-row__ico" aria-hidden="true"><Ticket /></span>
              ) : (
                <span className="cin-cal-row__ph" aria-hidden="true">
                  <PersonPhoto src={it.img} name={it.name} alt="" className="cin-cal-row__img" monoClass="cin-cal-row__mono" width="88" height="88" />
                </span>
              )}
              <span className="cin-cal-row__b">
                {isEvent
                  ? <a className="cin-cal-row__t" href={'/event?id=' + it.id}>{it.title}</a>
                  : <span className="cin-cal-row__t">{it.name}</span>}
                {isEvent && it.venue ? <span className="cin-cal-row__m">{it.venue}</span> : null}
              </span>
              {isEvent ? <span className="cin-cal-row__go" aria-hidden="true"><Arrow /></span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState as="p" className="cin-cal-none" title={'No ' + cat.many + (sel ? ' on this day' : ' this month')} />
      )}
    </section>
  )
}

export default function Calendar({ data }) {
  const name = usePageName('Calendar')
  const location = useLocation()
  const today = useMemo(() => new Date(), [])
  const ctx = useMemo(() => resolveContext(location.search, today), [location.search, today])
  const { year, month } = ctx
  const mk = year + '-' + month
  const d = useCalendarData(year, month, data)

  // For one render after the month changes the hook still holds the previous
  // month's lists; its flags object is only replaced when the new month lands.
  // (Checking d.loading alone misses a cached month that resolves in one batch.)
  const stale = useRef({ mk: '', flags: null })
  if (stale.current.mk !== mk) stale.current = { mk, flags: d.flags }
  const ready = !d.loading && d.flags !== stale.current.flags

  // ?date= pre-selects a day; 0 = the whole month. Re-armed on every month
  // change so paging months always lands on the whole month (as Gold).
  const [sel, setSel] = useState(ctx.selectedDay || 0)
  useEffect(() => { setSel(ctx.selectedDay || 0) }, [ctx.selectedDay, year, month])
  const [tab, setTab] = useState('all')

  const tally = useMemo(() => {
    const t = {}
    CATS.forEach((c, i) => d[c.key].forEach((it) => { (t[it.day] = t[it.day] || [0, 0, 0])[i] += 1 }))
    return t
  }, [d.birthdays, d.anniversaries, d.events]) // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = (it) => sel === 0 || it.day === sel
  const rows = ready
    ? { birthdays: d.birthdays.filter(inScope), anniversaries: d.anniversaries.filter(inScope), events: d.events.filter(inScope) }
    : NONE
  const total = rows.birthdays.length + rows.anniversaries.length + rows.events.length
  // Only the kinds that have something are shown: an empty kind has no slate and no tab (client, 2026-09-28).
  const present = CATS.filter((c) => rows[c.key].length > 0)
  const shownTab = present.some((c) => c.key === tab) ? tab : 'all'
  const scopeLabel = sel === 0 ? 'All of ' + monthName(month) : longDay(year, month, sel)

  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7   // Monday-first
  const isThisMonth = year === today.getFullYear() && month === today.getMonth() + 1
  const isToday = (day) => isThisMonth && day === today.getDate()

  // ── motion ────────────────────────────────────────────────────────────────
  const ref = useRef(null)
  const seen = useRef('')
  // each month opens like a projector: a slit of light widens to the frame
  useScene(ref, () => { projectorOpen(ref.current.querySelector('.cin-cal-month'), { duration: 1 }) }, [mk])
  // the day marks develop in once the month's data is in
  useScene(ref, () => {
    const marks = ready ? ref.current.querySelectorAll('.cin-cal-days .cin-cal-mk') : []
    if (marks.length) {
      gsap.from(marks, { scale: 0, opacity: 0, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.012, clearProps: 'transform,opacity' })
    }
  }, [ready, mk])
  // the scope's title card: letters rise whenever the scope changes
  useScene(ref, (c, ctx2) => afterFonts(ctx2, () => titleIn(ref.current.querySelector('.cin-cal-scope__t'))), [scopeLabel])
  // the slates wipe open once per month; a day/tab change re-deals the rows
  useScene(ref, () => {
    if (!ready) return
    const shown = (list) => [...list].filter((el) => el.offsetParent !== null)
    if (seen.current !== mk) {
      seen.current = mk
      shown(ref.current.querySelectorAll('.cin-cal-col')).forEach((col) => wipeIn(col, { radius: 24 }))
    } else {
      riseIn(shown(ref.current.querySelectorAll('.cin-cal-row, .cin-cal-none')).slice(0, 24),
        { trigger: false, y: 18, stagger: 0.03, duration: 0.7 })
    }
  }, [ready, mk, sel, tab])

  const showAll = () => {
    // the button disappears with the filter; hand focus back to the day it cleared
    const b = ref.current && ref.current.querySelector('.cin-cal-day.is-sel')
    setSel(0)
    if (b) b.focus()
  }

  return (
    <div className="cin-cal">
      <PageHero
        title={name}
        meta={<MonthSwitch year={year} month={month} isThisMonth={isThisMonth} />}
      />

      <section ref={ref} className="cin-sec cin-cal-sheet" aria-labelledby="cin-cal-scope-h">
        <div className="cin-cal-top">
          {/* the mini-month */}
          <div className="cin-cal-month">
            <div className="cin-cal-week" aria-hidden="true">
              {WEEK.map((w, i) => <span key={i}>{w}</span>)}
            </div>
            <div className="cin-cal-days" role="group" aria-label={'Days of ' + monthName(month) + ' ' + year} key={mk}>
              {Array.from({ length: lead }, (_, i) => <span key={'p' + i} className="cin-cal-day cin-cal-day--pad" aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const f = ready ? (d.flags[day] || 0) : 0
                const t = ready ? tally[day] : null
                const parts = t ? CATS.map((c, i) => (t[i] ? say(t[i], c) : '')).filter(Boolean) : []
                return (
                  <button type="button" key={day}
                    className={'cin-cal-day' + (f ? ' has-any' : '') + (sel === day ? ' is-sel' : '')}
                    aria-pressed={sel === day}
                    aria-current={isToday(day) ? 'date' : undefined}
                    aria-label={longDay(year, month, day) + (parts.length ? ', ' + parts.join(', ') : '')}
                    /* clicking the selected day clears the filter again */
                    onClick={() => setSel(sel === day ? 0 : day)}>
                    <span className="cin-cal-day__n">{day}</span>
                    <span className="cin-cal-day__mks" aria-hidden="true">
                      {CATS.filter((c) => (f & c.flag) !== 0).map((c) => <i key={c.key} className={'cin-cal-mk cin-cal-mk--' + c.key} />)}
                    </span>
                  </button>
                )
              })}
            </div>
            <ul className="cin-cal-legend" aria-label="Key to the day marks">
              {CATS.map((c) => (
                <li key={c.key}><i className={'cin-cal-mk cin-cal-mk--' + c.key} aria-hidden="true" />{c.label}</li>
              ))}
            </ul>
          </div>

          {/* what is showing, and how much of it */}
          <div className="cin-cal-scope">
            <h2 id="cin-cal-scope-h" className="cin-cal-scope__t" key={scopeLabel}>{scopeLabel}</h2>
            <StatRow items={CATS.map((c) => (ready ? { label: c.label, value: rows[c.key].length } : { label: c.label, text: '—' }))} />
            <div className="cin-cal-scope__foot">
              {ready ? <ResultCount count={total} noun="entry" plural="entries" /> : null}
              {sel ? <Button variant="line" small onClick={showAll}>Show all of {monthName(month)}</Button> : null}
            </div>
          </div>
        </div>

        {/* the moment: the month as a strip of slates */}
        {ready ? (
          present.length ? (
            <>
              {present.length > 1 ? (
                <ChipGroup className="cin-cal-tabs" label="Show" value={shownTab} onChange={setTab}
                  options={[{ value: 'all', label: 'All', count: total }].concat(present.map((c) => ({ value: c.key, label: c.label, count: rows[c.key].length })))} />
              ) : null}
              <div className={'cin-cal-cols' + (present.length === 1 ? ' is-one' : '')} key={mk} style={{ '--n': present.length }}>
                {present.map((c) => (
                  <Slate key={c.key} cat={c} items={rows[c.key]} sel={sel} year={year} month={month}
                    off={shownTab !== 'all' && shownTab !== c.key} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState as="p" className="cin-cal-none cin-cal-nothing"
              title={'Nothing on the calendar ' + (sel ? 'on ' + longDay(year, month, sel) : 'in ' + monthName(month))} />
          )
        ) : <Loading label={'Loading ' + monthName(month) + ' ' + year} />}
      </section>
    </div>
  )
}
