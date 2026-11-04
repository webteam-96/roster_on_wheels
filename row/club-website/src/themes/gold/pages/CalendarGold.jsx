'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · CALENDAR — the almanac.
//
// The MONTH is the subject of this page, so the month grid is large, its name is
// set enormous behind it as a watermark, and everything for that month lands on
// a single "day sheet" beside it. Picking a day filters the sheet without
// reloading; the month arrows are real links, because that IS a different
// month's data.
//
// The shared page builds its grid as an HTML string and then binds a hand-
// written script to it — a straight port of the Web Forms original. Here the
// grid is ordinary JSX driven by state, which is how it can afford to be twice
// the size and still stay legible.
//
// The three feeds (birthdays / anniversaries / events) and the dot flags come
// from the same cached month payload the shared page uses.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from '@/site/router.js'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { resolveContext, addMonths } from '@/themes/shared/pages/AllSpecialDates.jsx'
import { useCalendarGold, monthName, fullDayLabelOf, initials } from './goldData.js'
import { GPageHead, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// `one` is spelled out, not derived: stripping a trailing "s" turns
// "Anniversaries" into "Anniversarie".
const CATS = [
  { key: 'birthdays', label: 'Birthdays', one: 'Birthday', dot: 'gcal-dot--b', flag: 1 },
  { key: 'anniversaries', label: 'Anniversaries', one: 'Anniversary', dot: 'gcal-dot--a', flag: 2 },
  { key: 'events', label: 'Events', one: 'Event', dot: 'gcal-dot--e', flag: 4 },
]

export default function CalendarGold({ data }) {
  const location = useLocation()
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Calendar')

  const today = useMemo(() => new Date(), [])
  const ctx = useMemo(() => resolveContext(location.search, today), [location.search, today])
  const { year, month } = ctx

  const d = useCalendarGold(year, month, data)

  // The ?date= deep link pre-selects a day; 0 means the whole month. Re-armed on
  // every month change so navigating months always lands on the whole month.
  const [sel, setSel] = useState(ctx.selectedDay || 0)
  useEffect(() => { setSel(ctx.selectedDay || 0) }, [ctx.selectedDay, year, month])

  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7   // Monday-first

  const isToday = (day) =>
    year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate()

  const inScope = (item) => sel === 0 || item.day === sel
  const rows = {
    birthdays: d.birthdays.filter(inScope),
    anniversaries: d.anniversaries.filter(inScope),
    events: d.events.filter(inScope),
  }
  const total = rows.birthdays.length + rows.anniversaries.length + rows.events.length

  useRotaryAnim([d.loading, year, month, sel])
  useRevealReplay('gcal-page', [d.loading, year, month])

  return (
    <div className="gcal-page">

      {/* ══ 01 · Masthead — the standard band ══ */}
      <GPageHead
        crumbs={[{ label: menuName || 'Calendar' }]}
        eyebrow="Club calendar"
        title={menuName && menuName.trim() ? menuName : 'Calendar'}
        sub="The club's birthdays, anniversaries and events, month by month."
      />

      <div className="gcal-wrap">
      <div className="gld-x">

        {/* ══ Month rail ══ */}
        <div className="gcal-bar">
          <div className="gcal-nav">
            <a href={'/calendar?month=' + addMonths(year, month, -1)} aria-label="Previous month">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </a>
            <h2 className="gcal-m">{monthName(month)} <span>{year}</span></h2>
            <a href={'/calendar?month=' + addMonths(year, month, 1)} aria-label="Next month">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </a>
          </div>
          <p className="gcal-legend">
            {CATS.map((c) => (
              <span key={c.key}><i className={c.dot} />{c.label}</span>
            ))}
          </p>
        </div>

        <div className="gcal-grid2">

          {/* ══ The grid ══ */}
          <section className="gcal-cal reveal" data-month={monthName(month)}>
            <div className="gcal-week" aria-hidden="true">
              {WEEK.map((w, i) => <div key={i}>{w}</div>)}
            </div>
            <div className="gcal-days">
              {Array.from({ length: lead }, (_, i) => (
                <span className="gcal-d gcal-d--pad" key={'pad' + i} aria-hidden="true" />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const f = d.flags[day] || 0
                return (
                  <button type="button" key={day}
                          className={'gcal-d' + (isToday(day) ? ' is-today' : '') + (sel === day ? ' is-sel' : '')}
                          aria-pressed={sel === day}
                          aria-label={fullDayLabelOf(year, month, day)}
                          /* clicking the selected day clears the filter again */
                          onClick={() => setSel(sel === day ? 0 : day)}>
                    <span>{day}</span>
                    {f !== 0 && (
                      <span className="gcal-d__dots" aria-hidden="true">
                        {CATS.filter((c) => (f & c.flag) !== 0).map((c) => (
                          <i className={c.dot} key={c.key} />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ══ The day sheet ══ */}
          <section className="gcal-sheet reveal">
            <div className="gcal-sheet__h">
              <h2 className="gcal-sheet__t">
                {sel === 0 ? 'All of ' + monthName(month) : fullDayLabelOf(year, month, sel)}
              </h2>
              {sel === 0
                ? <span className="gp-idx">{total} entr{total === 1 ? 'y' : 'ies'}</span>
                : <button type="button" className="gcal-sheet__all" onClick={() => setSel(0)}>Whole month</button>}
            </div>

            {/* The one scrolling thing on the page from 1000px up — see the
                .gcal-sheet__body rule. */}
            <div className="gcal-sheet__body">
            {d.loading ? null : total === 0 ? (
              <p className="gcal-none">
                Nothing recorded {sel === 0 ? 'this month' : 'on this day'}.
              </p>
            ) : CATS.map((c) => (
              rows[c.key].length === 0 ? null : (
                <div className="gcal-cat" key={c.key}>
                  <p className="gcal-cat__h"><i className={c.dot} />{c.label}<b>{rows[c.key].length}</b></p>
                  {rows[c.key].map((it, i) => (
                    <div className={'gcal-e' + (c.key === 'events' ? ' gcal-e--go' : '')} key={c.key + i}>
                      {c.key === 'events' ? (
                        <span aria-hidden="true">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                        </span>
                      ) : it.img ? (
                        <img src={it.img} alt="" loading="lazy" onError={hideOnError} />
                      ) : (
                        <span aria-hidden="true">{initials(it.name)}</span>
                      )}
                      <span className="gcal-e__b">
                        {/* The title is the link a visitor reaches for; its ::after
                            stretches over the row, so the whole row is the target.
                            Birthdays and anniversaries have nowhere to go. */}
                        {c.key === 'events'
                          ? <a className="gcal-e__n" href={'/event?id=' + it.id}>{it.title}</a>
                          : <span className="gcal-e__n">{it.name}</span>}
                        <span className="gcal-e__m">
                          {c.key === 'events'
                            ? [it.venue, it.dayLabel].filter(Boolean).join(' · ')
                            : c.one + ' · ' + it.dayLabel}
                        </span>
                      </span>
                      {c.key === 'events' && (
                        <span className="gcal-e__go" aria-hidden="true"><Arrow /></span>
                      )}
                    </div>
                  ))}
                </div>
              )
            ))}
            </div>
          </section>

        </div>
      </div>
      </div>
    </div>
  )
}
