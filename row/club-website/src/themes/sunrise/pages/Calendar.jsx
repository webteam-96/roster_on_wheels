'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · CALENDAR — "the month sky".
// The row under the page head is the month switcher: changing month turns the
// drum (the old label rolls away over the top, the new one rolls up from
// below). Below, the month as a panel of days where every day with something
// on it holds a small sun; the suns rise as the month's data lands. Beside it
// (under it on phones) the agenda: one card per day with its date sun, lifting
// off a tilted plane, for one kind at a time (a pill per kind that has entries).
// Kinds read by shape and word, not colour: disc = birthday, ring =
// anniversary, diamond = event, and every row names its kind.
// Data: useCalendarData(year, month) only, and the /calendar URL contract
// (?month=yyyy-MM, ?date=yyyy-MM-dd) parsed by the same resolveContext Gold uses.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// The /calendar query contract. Not re-exported by _shared/data.js yet (see
// sharedRequests) - imported, not copied, so the parse rule stays single-sourced.
import { resolveContext, addMonths } from '@/themes/shared/pages/AllSpecialDates.jsx'
import { useCalendarData, monthName } from '../../_shared/data.js'
import { PageHero, Chips, ResultCount, EmptyState, Loading, Button, DateSun, PersonPhoto, Arrow, ArrowLeft, CalendarIcon, venueText } from '../kit.jsx'
import { gsap, useScene, revealBatch } from '../motion.js'
import './Calendar.css'
import { MonthJump } from '../../_shared/kit.jsx'

// `one`/`many` are spelled out: "Anniversaries" minus "s" is not a word.
const CATS = [
  { key: 'birthdays', label: 'Birthdays', one: 'Birthday', many: 'birthdays', flag: 1 },
  { key: 'anniversaries', label: 'Anniversaries', one: 'Anniversary', many: 'anniversaries', flag: 2 },
  { key: 'events', label: 'Events', one: 'Event', many: 'events', flag: 4 },
]
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const CLEAR = 'transform,opacity,translate,rotate,scale'

const pad2 = (n) => String(n).padStart(2, '0')
const weekdayOf = (y, m, day) => WEEKDAYS[new Date(y, m - 1, day).getDay()]
const say = (n, c) => n + ' ' + (n === 1 ? c.one.toLowerCase() : c.many)
const labelOf = (ym) => { const [y, m] = ym.split('-').map(Number); return monthName(m) + ' ' + y }

/** The kind's shape: disc / ring / diamond (the grid, the key and every row use it). */
const Mark = ({ k }) => <i className={'sun-cal-mk sun-cal-mk--' + k} aria-hidden="true" />

const MonthLabel = ({ year, month }) => (
  <>
    <span className="sun-cal-mon__m" style={{ '--sun-len': monthName(month).length }}>{monthName(month)}</span>
    <span className="sun-cal-mon__y">{year}</span>
  </>
)

// ── the switch: prev / month / next, the month turning like a drum ──────────
function MonthSwitch({ year, month }) {
  // Remember the month we came from, so it can roll away while the new one rolls in.
  const r = useRef({ year, month, was: null, dir: 1 })
  if (r.current.year !== year || r.current.month !== month) {
    const dir = year * 12 + month > r.current.year * 12 + r.current.month ? 1 : -1
    r.current = { year, month, was: { year: r.current.year, month: r.current.month }, dir }
  }
  const { was, dir } = r.current
  const prev = addMonths(year, month, -1)
  const next = addMonths(year, month, 1)

  const ref = useRef(null)
  useScene(ref, () => {
    const old = ref.current.querySelector('.sun-cal-mon__was')
    if (!old) return
    const now = ref.current.querySelector('.sun-cal-mon__now')
    const o = { transformPerspective: 700, transformOrigin: '50% 50% -40px' }
    // forward in time: the drum turns up (the same sense as the page's drum lists)
    gsap.fromTo(old, { ...o, rotationX: 0, yPercent: 0, autoAlpha: 1 },
      { rotationX: 90 * dir, yPercent: -55 * dir, autoAlpha: 0, duration: 0.6, ease: 'power2.in' })
    gsap.fromTo(now, { ...o, rotationX: -90 * dir, yPercent: 55 * dir, opacity: 0 },
      { rotationX: 0, yPercent: 0, opacity: 1, duration: 0.9, delay: 0.22, ease: 'power3.out', clearProps: CLEAR })
  }, [year, month])

  return (
    <div className="sun-cal-sw" ref={ref}>
      <a className="sun-cal-sw__btn" href={'/calendar?month=' + prev} aria-label={'Previous month, ' + labelOf(prev)}><ArrowLeft /></a>
      <h2 className="sun-cal-mon" aria-live="polite">
        <span className="sun-cal-mon__now"><MonthLabel year={year} month={month} /></span>
        {was ? <span className="sun-cal-mon__was" aria-hidden="true"><MonthLabel year={was.year} month={was.month} /></span> : null}
        <MonthJump year={year} month={month} label={labelOf(year + '-' + String(month).padStart(2, '0'))} />
      </h2>
      <a className="sun-cal-sw__btn" href={'/calendar?month=' + next} aria-label={'Next month, ' + labelOf(next)}><Arrow /></a>
    </div>
  )
}

// ── one entry in a day card ─────────────────────────────────────────────────
function Entry({ c, it }) {
  const ev = c.key === 'events'
  const venue = ev ? venueText(it.venue) : ''
  return (
    <li className={'sun-cal-e sun-cal-e--' + c.key}>
      <span className="sun-cal-e__pic" aria-hidden="true">
        {ev ? <CalendarIcon />
          : <PersonPhoto src={it.img} name={it.name} alt="" className="sun-cal-e__img" monoClass="sun-cal-e__mono" width="88" height="108" />}
      </span>
      <span className="sun-cal-e__b">
        <span className="sun-cal-e__kind"><Mark k={c.key} />{c.one}</span>
        {ev
          ? <a className="sun-cal-e__n sun-cal-e__link" href={'/event?id=' + it.id}>{it.title || 'Event details'}</a>
          : <span className="sun-cal-e__n">{it.name}</span>}
        {venue ? <span className="sun-cal-e__m">{venue}</span> : null}
      </span>
      {ev ? <Arrow className="sun-cal-e__go" /> : null}
    </li>
  )
}

export default function Calendar({ data }) {
  const location = useLocation()
  const today = useMemo(() => new Date(), [])
  const ctx = useMemo(() => resolveContext(location.search, today), [location.search, today])
  const { year, month } = ctx
  const mk = year + '-' + month
  const d = useCalendarData(year, month, data)
  const hid = useId()

  // For one render after the month changes the hook still holds the previous
  // month's lists (its loading flag is only raised in an effect); its flags
  // object is replaced only when the new month lands.
  const stale = useRef({ mk: '', flags: null })
  if (stale.current.mk !== mk) stale.current = { mk, flags: d.flags }
  const ready = !d.loading && d.flags !== stale.current.flags

  // ?date= pre-selects a day; 0 = the whole month. Re-armed on every month
  // change so paging months always lands on the whole month (as Gold).
  const [sel, setSel] = useState(ctx.selectedDay || 0)
  useEffect(() => { setSel(ctx.selectedDay || 0) }, [ctx.selectedDay, year, month])
  const [kind, setKind] = useState(null)   // the visitor's own pick only (null: none yet)

  const name = monthName(month)
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7   // Monday-first
  const isToday = (day) => year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate()

  // whole-month tally per day (grid labels) and each kind's entries in the scope (selected day or month)
  const tally = {}
  const scoped = {}
  let monthTotal = 0
  CATS.forEach((c, i) => {
    const all = ready ? d[c.key] : []
    all.forEach((it) => { (tally[it.day] = tally[it.day] || [0, 0, 0])[i] += 1 })
    scoped[c.key] = all.filter((it) => sel === 0 || it.day === sel)
    monthTotal += all.length
  })
  // No "All" pill and no empty ones (client, 2026-10-05): a pill per kind with entries in
  // the scope, one kind shown at a time - the visitor's pick while it has entries, else the
  // first that has. Derived, never stored: each month opens on its own first kind, and a
  // pick comes back in any later scope that has it.
  const kinds = CATS.filter((c) => scoped[c.key].length > 0)
  const cat = kinds.find((c) => c.key === kind) || kinds[0] || null
  const rows = cat ? scoped[cat.key] : []
  const byDay = {}
  rows.forEach((it) => { (byDay[it.day] = byDay[it.day] || []).push(it) })
  const dayList = Object.keys(byDay).map(Number).sort((a, b) => a - b)

  const scopeLabel = sel ? weekdayOf(year, month, sel) + ' ' + sel + ' ' + name : 'All of ' + name
  // the list is empty only when the whole scope is (a kind with no entries has no pill)
  const emptyTitle = monthTotal === 0
    ? 'Nothing on the calendar for ' + name
    : 'Nothing' + (sel ? ' on ' + sel + ' ' + name : ' in ' + name)

  // ── motion ────────────────────────────────────────────────────────────────
  const gridRef = useRef(null)
  const listRef = useRef(null)
  // the month's suns rise into their days once its data is in
  useScene(gridRef, () => {
    const suns = ready ? gridRef.current.querySelectorAll('.sun-cal-g__sun') : []
    if (suns.length) gsap.fromTo(suns, { yPercent: 60, scale: 0.3, opacity: 0 },
      { yPercent: 0, scale: 1, opacity: 1, duration: 0.9, ease: 'power3.out', stagger: 0.03, clearProps: CLEAR })
  }, [ready, mk])
  // the day cards lift off a tilted plane; again whenever the scope or the shown kind changes
  useScene(listRef, () => {
    revealBatch(listRef.current.querySelectorAll('.sun-cal-day'), { y: 48, tilt: 14, stagger: 0.07 })
  }, [ready, mk, sel, cat ? cat.key : ''])

  const showAll = () => {
    // the button disappears with the filter; hand focus back to the day it cleared
    const b = gridRef.current && gridRef.current.querySelector('.sun-cal-g.is-sel')
    setSel(0)
    if (b) b.focus()
  }

  return (
    <div className="sun-page sun-cal">
      <PageHero title="Calendar">
        <MonthSwitch year={year} month={month} />
      </PageHero>

      <section className="sun-wrap sun-block sun-cal-body" aria-labelledby={hid}>
        <div className="sun-cal-side">
          <div className="sun-panel sun-cal-month" ref={gridRef}>
            <div className="sun-cal-week" aria-hidden="true">
              {WEEK.map((w, i) => <span key={i}>{w}</span>)}
            </div>
            <div className="sun-cal-grid" role="group" aria-label={'Days of ' + name + ' ' + year}>
              {Array.from({ length: lead }, (_, i) => <span key={'p' + i} aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const f = ready ? (d.flags[day] || 0) : 0
                const t = tally[day]
                const parts = t ? CATS.map((c, i) => (t[i] ? say(t[i], c) : '')).filter(Boolean) : []
                return (
                  <button type="button" key={day}
                          className={'sun-cal-g' + (f ? ' has-any' : '') + (sel === day ? ' is-sel' : '') + (isToday(day) ? ' is-today' : '')}
                          aria-pressed={sel === day}
                          aria-current={isToday(day) ? 'date' : undefined}
                          aria-label={weekdayOf(year, month, day) + ' ' + day + ' ' + name + ' ' + year + (parts.length ? ', ' + parts.join(', ') : '')}
                          /* clicking the selected day clears the filter again */
                          onClick={() => setSel(sel === day ? 0 : day)}>
                    {f ? <span className="sun-cal-g__sun" aria-hidden="true" /> : null}
                    <span className="sun-cal-g__n">{day}</span>
                    {f ? (
                      <span className="sun-cal-g__mks" aria-hidden="true">
                        {CATS.filter((c) => (f & c.flag) !== 0).map((c) => <Mark key={c.key} k={c.key} />)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <ul className="sun-cal-key" aria-label="Key to the day marks">
              {CATS.map((c) => <li key={c.key}><Mark k={c.key} />{c.label}</li>)}
            </ul>
          </div>
        </div>

        <div className="sun-cal-main" ref={listRef}>
          <div className="sun-cal-scope">
            <h2 id={hid} className="sun-cal-scope__t">{scopeLabel}</h2>
            {/* in the shown kind's own words, like its pill: "3 birthdays" */}
            {ready ? <ResultCount count={rows.length} noun={cat ? cat.one.toLowerCase() : 'entry'} plural={cat ? cat.many : 'entries'} /> : null}
            {sel ? <Button variant="line" small icon={false} onClick={showAll}>Show all of {name}</Button> : null}
          </div>

          {cat ? (
            <Chips className="sun-cal-chips" label="Show" value={cat.key} onChange={setKind}
                   options={kinds.map((c) => ({ value: c.key, label: c.label, count: scoped[c.key].length }))} />
          ) : null}

          {!ready ? <Loading label={'Loading ' + name + ' ' + year} />
            : dayList.length === 0 ? (
              <EmptyState title={emptyTitle}
                          message={monthTotal === 0 ? 'No birthdays, anniversaries or events are recorded for ' + name + ' ' + year + '.' : undefined}
                          action={sel ? <Button variant="line" small icon={false} onClick={showAll}>Show all of {name}</Button> : undefined} />
            ) : (
              <ol className="sun-cal-days">
                {dayList.map((day) => {
                  const wk = weekdayOf(year, month, day)
                  return (
                    <li key={day} className={'sun-cal-day' + (isToday(day) ? ' is-today' : '')}>
                      <time className="sun-cal-day__when" dateTime={year + '-' + pad2(month) + '-' + pad2(day)}>
                        <DateSun small day={day} mon={name.slice(0, 3)} />
                        <span className="sun-cal-day__wk"><span aria-hidden="true">{wk.slice(0, 3)}</span><span className="sun-sr">{wk}</span></span>
                        {isToday(day) ? <span className="sun-cal-day__today">Today</span> : null}
                      </time>
                      <ul className="sun-cal-day__list">
                        {byDay[day].map((it, i) => <Entry key={(it.id || it.name) + '|' + i} c={cat} it={it} />)}
                      </ul>
                    </li>
                  )
                })}
              </ol>
            )}
        </div>
      </section>
    </div>
  )
}
