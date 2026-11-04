'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage · CALENDAR — a planner page.
//
// A spiral-bound planner sheet (the month grid) beside the "day sheet": three
// paper notes (birthdays / anniversaries / events), each row a kraft date stamp
// plus the person or event. Picking a day circles it in pen and turns the notes
// into that day's agenda; the month arrows are real links (a different month is
// different data), exactly as CalendarGold does.
//
// Motion (useScene, so nothing runs under reduced motion): turning the month
// wipes the month name in and swings the new planner page down under its rings;
// the day marks pop on; the notes wipe in top-down and their rows are written in;
// the picked day is circled in pen. Date stamps lean with scroll speed (--col-vel).
//
// Categories differ by SHAPE (dot / heart / ticket), their own note and heading,
// and the day button's label — never by colour alone.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@/site/router.js'
// The /calendar query contract (?month=yyyy-MM, ?date=yyyy-MM-dd). CalendarGold
// imports it from this module; _shared/data.js does not re-export it yet
// (sharedRequest) — imported, never copied, so the parse rule stays single-sourced.
import { resolveContext, addMonths } from '@/themes/shared/pages/AllSpecialDates.jsx'
import { useCalendarData, monthName } from '../../_shared/data.js'
import { PersonPhoto } from '../../_shared/kit.jsx'
import { PageHero, Button, ResultCount, EmptyState, Loading, Tape, Draw, Underline, Chip, cleanText, usePageName } from '../kit.jsx'
import { gsap, useScene, drawNow, CLEAR } from '../motion.js'
import './Calendar.css'
import { MonthJump } from '../../_shared/kit.jsx'

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// `one`/`many` are spelled out: stripping an "s" breaks "Anniversaries".
const CATS = [
  { key: 'birthdays', label: 'Birthdays', one: 'birthday', many: 'birthdays', shape: 'dot', tape: 'gold', r: -0.8 },
  { key: 'anniversaries', label: 'Anniversaries', one: 'anniversary', many: 'anniversaries', shape: 'heart', tape: 'cran', r: 0.6 },
  { key: 'events', label: 'Events', one: 'event', many: 'events', shape: 'ticket', tape: 'azure', r: -0.5 },
]

const SHAPES = {
  dot: <circle cx="8" cy="8" r="6" />,
  heart: <path d="M8 14.2C2.4 10 1 7 2.5 4.6 4 2.4 6.9 2.7 8 5c1.1-2.3 4-2.6 5.5-.4C15 7 13.6 10 8 14.2z" />,
  ticket: <path d="M1.8 4h12.4v2.4a1.6 1.6 0 0 0 0 3.2V12H1.8V9.6a1.6 1.6 0 0 0 0-3.2z" />,
}
/** A category mark: the shape carries the meaning, the colour only helps. */
const Mark = ({ shape, className = '' }) => (
  <svg className={'col-cal-mk is-' + shape + (className ? ' ' + className : '')} viewBox="0 0 16 16" aria-hidden="true" focusable="false">{SHAPES[shape]}</svg>
)
/** The pen loop drawn round the picked day (its own square-ish path, so the stroke never stretches). */
const RING = 'M46 9C36 2 14 3 7 18 1 32 9 49 29 51c18 2 29-11 26-26C53 13 43 5 25 6'
const Chev = ({ next }) => (
  <svg className="col-cal-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={next ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} /></svg>
)
const side = (i) => (i % 2 ? 1 : -1)

export default function Calendar({ data }) {
  const location = useLocation()
  const name = usePageName('Calendar')

  const today = useMemo(() => new Date(), [])
  const ctx = useMemo(() => resolveContext(location.search, today), [location.search, today])
  const { year, month } = ctx
  const d = useCalendarData(year, month, data)

  // ?date= pre-selects a day; 0 = the whole month. Re-armed on every month change (as Gold).
  const [sel, setSel] = useState(ctx.selectedDay || 0)
  useEffect(() => { setSel(ctx.selectedDay || 0) }, [ctx.selectedDay, year, month])

  const ref = useRef(null)
  const dayHeadRef = useRef(null)

  const mName = monthName(month)
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7          // Monday-first
  const trail = (7 - ((lead + daysInMonth) % 7)) % 7
  const isToday = (day) => year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate()
  const weekday = (day) => new Date(year, month - 1, day).toLocaleDateString('en-GB', { weekday: 'long' })
  const dayLong = (day) => weekday(day) + ' ' + day + ' ' + mName + ' ' + year
  const abbr = mName.slice(0, 3)

  const prev = addMonths(year, month, -1), next = addMonths(year, month, 1)
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return monthName(m) + ' ' + y }

  // per-day counts from the hook's own lists (stale while the next month loads -> none)
  const perDay = useMemo(() => {
    const m = {}
    if (d.loading) return m
    CATS.forEach((c) => d[c.key].forEach((it) => {
      const o = m[it.day] || (m[it.day] = { birthdays: 0, anniversaries: 0, events: 0 })
      o[c.key]++
    }))
    return m
  }, [d.loading, d.birthdays, d.anniversaries, d.events]) // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = (it) => sel === 0 || it.day === sel
  const rows = { birthdays: d.birthdays.filter(inScope), anniversaries: d.anniversaries.filter(inScope), events: d.events.filter(inScope) }
  const total = rows.birthdays.length + rows.anniversaries.length + rows.events.length
  const monthTotal = d.birthdays.length + d.anniversaries.length + d.events.length

  const dayAria = (day) => {
    const n = perDay[day]
    const what = n ? CATS.filter((c) => n[c.key]).map((c) => n[c.key] + ' ' + (n[c.key] === 1 ? c.one : c.many)).join(', ') : ''
    return dayLong(day) + (isToday(day) ? ', today' : '') + (what ? ': ' + what : '')
  }

  // ── motion ──────────────────────────────────────────────────────────────────
  // the page turns: month name wipes in, the new planner page swings down under its rings
  useScene(ref, () => {
    const q = (s) => Array.from(ref.current.querySelectorAll(s))
    gsap.fromTo(q('.col-cal-month'), { clipPath: 'inset(-20% 100% -20% -20%)' }, { clipPath: 'inset(-20% -20% -20% -20%)', duration: 0.9, ease: 'power3.inOut', clearProps: 'clipPath' })
    gsap.fromTo(q('.col-cal-sheet-fl'), { rotationX: -84, transformPerspective: 1600, transformOrigin: '50% 0%', opacity: 0.35 },
      { rotationX: 0, opacity: 1, duration: 1.05, ease: 'power3.out', clearProps: CLEAR + ',transformOrigin' })
    drawNow(q('.col-cal-bar-rule'), { delay: 0.15, duration: 0.9 })
  }, [year, month])

  // the day marks pop onto the page once the month's data is in
  useScene(ref, () => {
    if (d.loading) return
    const marks = ref.current.querySelectorAll('.col-cal-days .col-cal-mk')
    if (marks.length) gsap.from(marks, { scale: 0, rotation: -120, transformOrigin: '50% 50%', duration: 0.5, ease: 'back.out(2.2)', stagger: { amount: 0.5 }, delay: 0.3, clearProps: CLEAR })
  }, [d.loading, year, month])

  // the picked day is circled; the notes wipe in top-down and their rows are written in
  useScene(ref, () => {
    if (d.loading) return
    const q = (s, el = ref.current) => Array.from(el.querySelectorAll(s))
    drawNow(q('.col-cal-d.is-sel .col-cal-ring'), { duration: 0.6 })
    drawNow(q('.col-cal-day-t .col-uline'), { delay: 0.2, duration: 0.7 })
    q('.col-cal-note-fl').forEach((note, i) => {
      const lines = q('.col-cal-row, .col-cal-none', note)
      const tl = gsap.timeline({ scrollTrigger: { trigger: note, start: 'top 92%', once: true } })
      tl.fromTo(note, { clipPath: 'inset(-10% -10% 100% -10%)', y: 26, rotation: side(i) * 2 },
        { clipPath: 'inset(-10% -10% -10% -10%)', y: 0, rotation: 0, duration: 0.8, ease: 'power3.out', clearProps: CLEAR + ',clipPath' }, i * 0.12)
      if (lines.length) tl.from(lines, { x: -18, opacity: 0, duration: 0.45, ease: 'power2.out', stagger: { amount: Math.min(0.6, lines.length * 0.06) }, clearProps: CLEAR }, 0.25 + i * 0.12)
    })
  }, [d.loading, sel, year, month])

  // ── pieces ──────────────────────────────────────────────────────────────────
  const row = (c, it, i) => (
    <li key={c.key + i} className="col-cal-row">
      <span className="col-cal-stamp" style={{ '--col-cal-sr': (i % 2 ? 2.5 : -3) + 'deg' }}>
        <b>{it.day}</b><small>{abbr}</small>
      </span>
      {c.key === 'events' ? (
        <span className="col-cal-ph is-ev" aria-hidden="true"><Mark shape="ticket" /></span>
      ) : (
        <span className="col-cal-ph" aria-hidden="true" style={{ '--col-cal-pr': (i % 2 ? -3 : 2.5) + 'deg' }}>
          <PersonPhoto src={it.img} name={it.name} alt="" width={42} height={42} className="col-cal-ph-img" monoClass="col-cal-ph-mono" />
        </span>
      )}
      <span className="col-cal-txt">
        {c.key === 'events' && it.id
          ? <a className="col-cal-name col-cal-go" href={'/event?id=' + it.id}>{cleanText(it.title) || 'Event'}</a>
          : <span className="col-cal-name">{c.key === 'events' ? (cleanText(it.title) || 'Event') : it.name}</span>}
        {c.key === 'events' && it.venue ? <span className="col-cal-meta">{it.venue}</span> : null}
        {isToday(it.day) ? <Chip tone="gold" className="col-cal-chip">Today</Chip> : null}
      </span>
    </li>
  )

  // only the cards with something in them - never a "0" card (client, 2026-10-05)
  const cats = CATS.filter((c) => rows[c.key].length)

  return (
    <div className="col-cal" ref={ref}>
      <PageHero
        title={name}
        kicker={mName + ' ' + year}
        tint="royal"
        lead="The club's birthdays, anniversaries and events, month by month."
      />

      <section className="col-sec col-cal-body" aria-labelledby="col-cal-month">
        <div className="col-wrap">
          {/* ══ month bar ══ */}
          <div className="col-cal-bar">
            <Button href={'/calendar?month=' + prev} variant="ghost" className="col-cal-step" aria-label={'Previous month: ' + monthLabel(prev)}>
              <Chev /><span className="col-cal-step-t">{monthName(+prev.slice(5))}</span>
            </Button>
            <h2 id="col-cal-month" className="col-cal-month" aria-live="polite" style={{ position: 'relative' }}>
              {mName} <span className="col-cal-yr">{year}</span>
              <MonthJump year={year} month={month} label={mName + ' ' + year} />
            </h2>
            <Button href={'/calendar?month=' + next} variant="ghost" className="col-cal-step is-next" aria-label={'Next month: ' + monthLabel(next)}>
              <span className="col-cal-step-t">{monthName(+next.slice(5))}</span><Chev next />
            </Button>
            <Underline className="col-cal-bar-rule" />
          </div>

          <div className="col-cal-spread">
            {/* ══ the planner page ══ */}
            <div className="col-cal-pad">
              <span className="col-cal-rings" aria-hidden="true" />
              <div className="col-cal-sheet-fl">
                <div className="col-cal-sheet">
                  <div className="col-cal-week" aria-hidden="true">
                    {WEEK.map((w) => <span key={w}><span className="col-cal-wk-l">{w}</span><span className="col-cal-wk-s">{w[0]}</span></span>)}
                  </div>
                  <div className="col-cal-days" role="group" aria-label={'Days in ' + mName + ' ' + year}>
                    {Array.from({ length: lead }, (_, i) => <span key={'p' + i} className="col-cal-d is-pad" aria-hidden="true" />)}
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                      const n = perDay[day]
                      const on = sel === day
                      return (
                        <button type="button" key={day}
                          className={'col-cal-d' + (n ? ' has-any' : '') + (isToday(day) ? ' is-today' : '') + (on ? ' is-sel' : '')}
                          aria-pressed={on} aria-current={isToday(day) ? 'date' : undefined} aria-label={dayAria(day)}
                          onClick={() => setSel(on ? 0 : day)}>
                          <span className="col-cal-dn">
                            {day}
                            {on ? <Draw d={RING} viewBox="0 0 60 56" className="col-cal-ring" /> : null}
                          </span>
                          {n ? (
                            <span className="col-cal-mks" aria-hidden="true">
                              {CATS.filter((c) => n[c.key]).map((c) => <Mark key={c.key} shape={c.shape} />)}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                    {Array.from({ length: trail }, (_, i) => <span key={'t' + i} className="col-cal-d is-pad" aria-hidden="true" />)}
                  </div>
                  <ul className="col-cal-key" aria-label="Key">
                    {CATS.map((c) => <li key={c.key}><Mark shape={c.shape} />{c.one.charAt(0).toUpperCase() + c.one.slice(1)}</li>)}
                    <li><span className="col-cal-key-today" aria-hidden="true" />Today</li>
                    <li><span className="col-cal-key-ring" aria-hidden="true"><Draw d={RING} viewBox="0 0 60 56" className="col-cal-ring" /></span>Picked day</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* ══ the day sheet ══ */}
            <div className="col-cal-list">
              <div className="col-cal-dayhead">
                <h2 id="col-cal-day-t" className="col-cal-day-t" ref={dayHeadRef} tabIndex={-1}>
                  {sel === 0 ? 'All of ' + mName : dayLong(sel)}
                  <Underline />
                </h2>
                {!d.loading ? <ResultCount shown={total} noun="entry" plural="entries" /> : null}
                {sel !== 0 ? (
                  <Button variant="ghost" className="col-cal-all" onClick={() => { setSel(0); if (dayHeadRef.current) dayHeadRef.current.focus() }}>
                    Whole month
                  </Button>
                ) : null}
              </div>

              {d.loading ? (
                <Loading label={'Loading ' + mName + ' ' + year} count={3} />
              ) : monthTotal === 0 ? (
                <EmptyState as="h3" title={'Nothing on the calendar in ' + mName}
                  message={'No birthdays, anniversaries or events are recorded for ' + mName + ' ' + year + '.'} />
              ) : total === 0 ? (
                <div className="col-cal-notes">
                  <div className="col-cal-note-fl">
                    <div className="col-cal-note-in" style={{ '--col-r': '-0.6deg' }}>
                      <Tape tone="gold" tilt={-4} />
                      <p className="col-cal-none">Nothing recorded on {dayLong(sel)}.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="col-cal-notes">
                  {cats.map((c) => (
                    <section key={c.key} className={'col-cal-note is-' + c.key} aria-labelledby={'col-cal-' + c.key}>
                      <div className="col-cal-note-fl">
                        <div className="col-cal-note-in" style={{ '--col-r': c.r + 'deg' }}>
                          <Tape tone={c.tape} tilt={c.r > 0 ? 4 : -4} />
                          <h3 id={'col-cal-' + c.key} className="col-cal-note-h">
                            <Mark shape={c.shape} />
                            <span>{c.label}</span>
                            <span className="col-cal-note-n">{rows[c.key].length}</span>
                          </h3>
                          {rows[c.key].length ? (
                            <ul className="col-cal-rows">
                              {rows[c.key].map((it, i) => row(c, it, i))}
                            </ul>
                          ) : (
                            <p className="col-cal-none">No {c.many} in {mName}.</p>
                          )}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
