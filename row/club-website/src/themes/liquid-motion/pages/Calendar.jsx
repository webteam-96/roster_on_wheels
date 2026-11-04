'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · CALENDAR — the month grid, then the month as three lists.
// Ink breadcrumb band: the menu label and the month switcher (real links -
// another month IS different data, exactly as Gold). Paper band: a 7-column grid
// of day buttons, each marked with lettered tags (B birthdays · A anniversaries ·
// E events - text, not colour alone), and a day sheet beside it: the month's
// tally, or the picked day's people and events. Then (client, 2026-09-29: no
// "All" tab, no filter tabs) Birthdays, Anniversaries and Events as SEPARATE
// lists, each row led by its date in solid type.
// Data: useCalendarData(year, month) only; URL contract ?month=yyyy-MM /
// ?date=yyyy-MM-dd parsed by the same resolveContext Gold uses.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// The /calendar query contract. Gold imports it from this module; _shared/data.js
// does not re-export it yet (see sharedRequests), so it is imported, not copied.
import { resolveContext, addMonths } from '@/themes/shared/pages/AllSpecialDates.jsx'
import { useCalendarData, useCurrentMenuName, usePageTitle, monthName, fullDayLabelOf } from '../../_shared/data.js'
import {
  PageHero, Band, Card, Kicker, Loading, Pill, Portrait, Odometer, Chars, Arrow, ArrowLeft, clean,
} from '../kit.jsx'
import { usePageMotion, useScene, gsap, titleIn } from '../motion.js'
import './Calendar.css'
import { MonthJump } from '../../_shared/kit.jsx'

const CATS = [
  { key: 'birthdays', label: 'Birthdays', one: 'Birthday', code: 'b', letter: 'B', none: 'No birthdays' },
  { key: 'anniversaries', label: 'Anniversaries', one: 'Anniversary', code: 'a', letter: 'A', none: 'No anniversaries' },
  { key: 'events', label: 'Events', one: 'Event', code: 'e', letter: 'E', none: 'No events' },
]
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekdayOf = (y, m, day) => WEEKDAYS[new Date(y, m - 1, day).getDay()]
/** "2026-08" -> "August 2026" */
const labelOf = (p) => monthName(Number(p.slice(5))) + ' ' + p.slice(0, 4)

/** The lettered tag: the letter carries the meaning, the colour only repeats it. */
function Tag({ cat, n }) {
  return (
    <span className={'liq-cal-g liq-cal-g--' + cat.code} aria-hidden="true">
      {cat.letter}{n > 1 ? <b>{n}</b> : null}
    </span>
  )
}

/** One birthday / anniversary / event line (sheet and agenda). */
function Entry({ cat, it }) {
  const ev = cat.key === 'events'
  return (
    <li className={'liq-cal-e' + (ev ? ' liq-cal-e--ev' : '')}>
      {ev
        ? <span className="liq-cal-e__ev" aria-hidden="true"><Arrow /></span>
        : <Portrait src={it.img} name={it.name} className="liq-cal-e__pic" />}
      <span className="liq-cal-e__b">
        {ev
          ? <a className="liq-cal-e__n" href={'/event?id=' + it.id}>{clean(it.title)}</a>
          : <span className="liq-cal-e__n">{clean(it.name)}</span>}
        <span className="liq-cal-e__m">
          <Tag cat={cat} />
          <span>{cat.one}</span>
          {ev && it.venue ? <span className="liq-cal-e__v">{clean(it.venue)}</span> : null}
        </span>
      </span>
    </li>
  )
}

export default function Calendar({ data }) {
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
  const [cur, setCur] = useState(0) // the grid's roving tab stop (arrow keys move it)
  useEffect(() => { setSel(ctx.selectedDay || 0); setCur(0) }, [ctx.selectedDay, year, month])

  const ref = useRef(null)
  usePageMotion(ref, [d.loading, year, month])

  // The moment: a month change re-draws the grid as a ripple running from the
  // arrow that was pressed (previous = from the first cell, next = from the
  // last), the month name re-rises and the ghost month fades in. First visit:
  // the same ripple, from the top, when the grid scrolls into view.
  const last = useRef(0)
  useScene(ref, () => {
    const key = year * 12 + month
    const dir = last.current ? Math.sign(key - last.current) : 0
    last.current = key
    const root = ref.current
    const grid = root.querySelector('.liq-cal-grid')
    if (grid && grid.offsetWidth) {
      const cells = grid.querySelectorAll('.liq-cal-cell')
      const to = {
        opacity: 1, scale: 1, duration: 0.8, ease: 'expo.out', clearProps: 'opacity,transform',
        stagger: { grid: [Math.ceil(cells.length / 7), 7], from: dir < 0 ? 'start' : dir > 0 ? 'end' : 'start', amount: 0.55 },
      }
      if (!dir) to.scrollTrigger = { trigger: grid, start: 'top 88%', once: true }
      gsap.fromTo(cells, { opacity: 0, scale: 0.55 }, to)
    }
    if (dir) {
      titleIn(root.querySelector('.liq-cal-mon__m'))
    }
  }, [year, month])

  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7 // Monday-first
  const isThisMonth = year === today.getFullYear() && month === today.getMonth() + 1
  const isToday = (day) => isThisMonth && day === today.getDate()
  const prev = addMonths(year, month, -1)
  const next = addMonths(year, month, 1)
  const mLabel = monthName(month) + ' ' + year

  // per-day counts for the grid tags (none while a month loads: the hook still holds the last one)
  const per = {}
  if (!d.loading) {
    for (const c of CATS) {
      for (const it of d[c.key]) {
        const p = per[it.day] || (per[it.day] = {})
        p[c.key] = (p[c.key] || 0) + 1
      }
    }
  }
  const total = d.birthdays.length + d.anniversaries.length + d.events.length

  const selList = sel ? CATS.flatMap((c) => d[c.key].filter((it) => it.day === sel).map((it) => [c, it])) : []

  const dayLabel = (day) => {
    const p = per[day] || {}
    const bits = CATS.filter((c) => p[c.key]).map((c) => p[c.key] + ' ' + (p[c.key] === 1 ? c.one : c.label).toLowerCase())
    return weekdayOf(year, month, day) + ' ' + fullDayLabelOf(year, month, day) +
      (isToday(day) ? ', today' : '') + (bits.length ? ', ' + bits.join(', ') : '')
  }
  const stop = cur && cur <= daysInMonth ? cur : sel || (isThisMonth ? today.getDate() : 1)
  const onGridKey = (e) => {
    const day = Number(e.target.getAttribute('data-liq-day'))
    if (!day) return
    const wd = (lead + day - 1) % 7
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -wd, End: 6 - wd }[e.key]
    if (typeof delta !== 'number') return
    e.preventDefault()
    const n = Math.min(daysInMonth, Math.max(1, day + delta))
    setCur(n)
    const b = e.currentTarget.querySelector('[data-liq-day="' + n + '"]')
    if (b) b.focus()
  }

  return (
    <div className="liq-cal" ref={ref}>
      <PageHero title={title}>
        <div className="liq-cal-sw">
          <p className="liq-cal-mon" aria-live="polite" style={{ position: 'relative' }}>
            <span className="liq-cal-mon__m"><Chars text={monthName(month)} /></span>{' '}
            <span className="liq-cal-mon__y">{year}</span>
            <MonthJump year={year} month={month} label={monthName(month) + ' ' + year} />
          </p>
          <nav className="liq-cal-sw__nav" aria-label="Change month">
            <a className="liq-cal-sw__btn" href={'/calendar?month=' + prev} aria-label={'Previous month, ' + labelOf(prev)}><ArrowLeft /></a>
            <a className="liq-cal-sw__btn" href={'/calendar?month=' + next} aria-label={'Next month, ' + labelOf(next)}><Arrow /></a>
          </nav>
          {!isThisMonth ? <a className="liq-link liq-cal-sw__now" href="/calendar">Back to this month</a> : null}
        </div>
      </PageHero>

      {/* the month grid + day sheet: pick a day to see who is celebrating and what is on */}
      <Band tone="paper" className="liq-cal-top" aria-label={mLabel + ' at a glance'}>
        <div className="liq-cal-cols">
          <div className="liq-cal-cal">
            <div className="liq-cal-wk" aria-hidden="true">{WEEK.map((w) => <span key={w}>{w}</span>)}</div>
            <div className="liq-cal-grid" role="group" aria-label={'Days of ' + mLabel} onKeyDown={onGridKey}>
              {Array.from({ length: lead }, (_, i) => <span className="liq-cal-cell liq-cal-pad" key={'p' + i} aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const p = per[day]
                return (
                  <button type="button" key={day} data-liq-day={day}
                          className={'liq-cal-cell liq-cal-d' + (p ? ' liq-cal-d--has' : '') + (isToday(day) ? ' liq-cal-d--today' : '')}
                          aria-pressed={sel === day} aria-label={dayLabel(day)} tabIndex={day === stop ? 0 : -1}
                          onFocus={() => setCur(day)}
                          /* the selected day again = back to the whole month */
                          onClick={() => setSel(sel === day ? 0 : day)}>
                    <span className="liq-cal-d__top">
                      <span className="liq-cal-d__n">{day}</span>
                      {isToday(day) ? <span className="liq-cal-d__t">Today</span> : null}
                    </span>
                    {p ? <span className="liq-cal-d__gs">{CATS.filter((c) => p[c.key]).map((c) => <Tag cat={c} n={p[c.key]} key={c.key} />)}</span> : null}
                  </button>
                )
              })}
            </div>
            <ul className="liq-cal-key" aria-label="Key">
              {CATS.map((c) => <li key={c.key}><Tag cat={c} />{c.label}</li>)}
            </ul>
          </div>

          <Card as="section" className="liq-cal-sheet liq-rv" aria-labelledby="liq-cal-sheet-h">
            <div className="liq-cal-sheet__h">
              <Kicker>{sel ? 'Selected day' : 'This month'}</Kicker>
              <h2 className="liq-h3" id="liq-cal-sheet-h">
                {sel ? weekdayOf(year, month, sel) + ' ' + fullDayLabelOf(year, month, sel) : 'All of ' + mLabel}
              </h2>
            </div>
            {sel ? (
              <>
                {d.loading ? <Loading label="Loading this day" />
                  : selList.length
                    ? <ul className="liq-cal-list">{selList.map(([c, it], i) => <Entry cat={c} it={it} key={c.key + i} />)}</ul>
                    : <p className="liq-cal-none">Nothing recorded on this day.</p>}
                <Pill variant="line" back onClick={() => setSel(0)}>Whole month</Pill>
              </>
            ) : (
              <>
                <dl className="liq-cal-tally" aria-busy={d.loading}>
                  {CATS.map((c) => (
                    <div key={c.key}>
                      <dt><Tag cat={c} />{c.label}</dt>
                      <dd><Odometer value={d.loading ? '0' : String(d[c.key].length)} live /></dd>
                    </div>
                  ))}
                </dl>
                <p className="liq-cal-none">
                  {!d.loading && total === 0 ? 'Nothing recorded this month.' : 'Choose a day to see who is celebrating and what is on.'}
                </p>
              </>
            )}
          </Card>
        </div>
      </Band>

      <Band tone="gold" className="liq-cal-lists" aria-label={mLabel}>
        {d.loading ? <Loading label={'Loading ' + mLabel} /> : (
          CATS.every((c) => !d[c.key].length) ? (
            <p className="liq-cal-none">No birthdays, anniversaries or events are recorded for {mLabel}.</p>
          ) : (
          /* only the lists that have something this month (client, 2026-10-01) */
          <div className="liq-cal-3" style={{ '--n': CATS.filter((c) => d[c.key].length).length }}>
            {CATS.filter((c) => d[c.key].length).map((c) => {
              const list = [...d[c.key]].sort((a, b) => a.day - b.day)
              const hid = 'liq-cal-' + c.key
              return (
                <section className="liq-cal-col" key={c.key} aria-labelledby={hid}>
                  <h2 className="liq-cal-col__h liq-rv" id={hid}>
                    {c.label}<span className="liq-cal-col__n">{list.length}</span>
                  </h2>
                  {list.length ? (
                    <ol className="liq-cal-rows">
                      {list.map((it, i) => {
                        const now = isThisMonth && it.day === today.getDate()
                        const ev = c.key === 'events'
                        return (
                          <li className={'liq-cal-row liq-rv' + (now ? ' liq-is-today' : '') + (ev ? ' liq-cal-row--ev' : '')} key={c.key + i}>
                            <p className="liq-cal-row__d">
                              <b aria-hidden="true">{it.day}</b>
                              <span aria-hidden="true">{now ? 'Today' : weekdayOf(year, month, it.day).slice(0, 3)}</span>
                              <span className="liq-sr">{weekdayOf(year, month, it.day) + ' ' + fullDayLabelOf(year, month, it.day)}</span>
                            </p>
                            {ev
                              ? <span className="liq-cal-row__ev" aria-hidden="true"><Arrow /></span>
                              : <Portrait src={it.img} name={it.name} className="liq-cal-row__pic" />}
                            <span className="liq-cal-row__b">
                              {ev
                                ? <a className="liq-cal-row__n" href={'/event?id=' + it.id}>{clean(it.title)}</a>
                                : <span className="liq-cal-row__n">{clean(it.name)}</span>}
                              {ev && it.venue ? <span className="liq-cal-row__m">{clean(it.venue)}</span> : null}
                            </span>
                          </li>
                        )
                      })}
                    </ol>
                  ) : (
                    <p className="liq-cal-none liq-rv">{c.none} in {mLabel}.</p>
                  )}
                </section>
              )
            })}
          </div>
          )
        )}
        <nav className="liq-cal-more" aria-label="Other months">
          <Pill href={'/calendar?month=' + prev} back>{labelOf(prev)}</Pill>
          <Pill href={'/calendar?month=' + next}>{labelOf(next)}</Pill>
        </nav>
      </Band>
    </div>
  )
}
