'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · UPCOMING EVENTS — the agenda.
//
// The only question this page answers is WHEN, so the date leads every line and
// the whole thing reads as one ruled agenda rather than a grid of cards. The
// very next event is lifted out above it at poster size, because it is the one a
// visitor might actually turn up to.
//
// Second pass (user's call: "improve the design"):
//   · the feature says how far off it is in words — "Today", "Tomorrow",
//     "In 17 days" — which is the one fact a date alone doesn't give you, and
//     it carries the venue now instead of making you open the detail page;
//   · the diary is grouped under month captions rather than running as one
//     undifferentiated column, and each row shows the event's own photograph,
//     its weekday, its venue and both actions.
//
// Which events appear (this Rotary year only, by event date) comes from
// useEventsGold, which reuses UpcomingEvent.jsx's own year-range rule.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useEventsGold } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

const PIN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
)

/** "Today" / "Tomorrow" / "In 17 days" — measured in whole days from midnight,
 *  so an event later today never reads as "In 0 days". Null once it's past. */
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

export default function EventsGold({ data }) {
  const club = useClub()
  const events = useEventsGold(data)
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Upcoming Events')

  const list = events || []
  const next = list.length > 0 ? list[0] : null
  const rest = list.slice(1)

  // Month captions come out of the ordered list, so a month with nothing in it
  // can never leave a heading with no rows under it.
  const groups = useMemo(() => {
    const out = []
    for (const e of rest) {
      const last = out[out.length - 1]
      if (!last || last.label !== e.monthLabel) out.push({ label: e.monthLabel, rows: [e] })
      else last.rows.push(e)
    }
    return out
  }, [rest])

  useRotaryAnim([events])
  useRevealReplay('gev-page', [events])

  const near = next ? countdown(next.ts) : null

  return (
    <div className="gev-page">

      {/* ══ 01 · Masthead — the standard band; the sub line says how much is on ══ */}
      <GPageHead
        crumbs={[{ label: menuName || 'Upcoming Events' }]}
        eyebrow={<>What&rsquo;s on</>}
        title="Upcoming events"
        sub={list.length > 0
          ? list.length + ' event' + (list.length === 1 ? '' : 's') +
            (club.selectedYearLabel ? ' in the ' + club.selectedYearLabel + ' Rotary year' : '')
          : 'Nothing scheduled yet' +
            (club.selectedYearLabel ? ' for ' + club.selectedYearLabel : '') + '.'}
      />

      {/* ══ 02 · The next one, at poster size ══
          Words left, poster right — the SAME split the event page itself uses,
          so clicking through lands you on a page laid out like the thing you
          clicked rather than a different design in the same colours. */}
      {next && (
        <section className="gev-next">
          <div className="gld-x gp-split">
            <div className="gev-next__b reveal">
              <div className="gev-next__hd">
                <p className="gev-next__k"><i aria-hidden="true" /> Next up</p>
                {near && <span className="gev-when">{near}</span>}
              </div>
              <p className="gp-bigdate"><b>{next.day}</b><i>{next.mon} {next.year}</i></p>
              <h2 className="gev-next__t">{next.title}</h2>
              {next.venue && <p className="gev-next__v">{PIN}<span>{next.venue}</span></p>}
              {next.desc && <p className="gev-next__x">{next.desc}</p>}
              <div className="gev-next__cta">
                <a href={'/event?id=' + next.id} className="gld-btn gld-btn--gold">Full details <Arrow /></a>
                {next.reg && (
                  <a href={next.reg} target="_blank" rel="noopener noreferrer" className="gld-btn gld-btn--ghost">
                    Register <Arrow />
                  </a>
                )}
              </div>
            </div>
            {next.img && (
              <a className="gp-shot reveal" href={'/event?id=' + next.id}
                 aria-label={'Open ' + next.title}>
                <img className="gp-shot__bg" src={next.img} alt="" aria-hidden="true" />
                <img className="gp-shot__im" src={next.img} alt="" loading="lazy" onError={hideOnError} />
              </a>
            )}
          </div>
        </section>
      )}

      {/* ══ 03 · The diary ══
          Dropped entirely when the club has exactly one event: the feature above
          already IS that event, and an empty band between it and the footer read
          as a rendering fault. */}
      {(events === null || rest.length > 0 || list.length === 0) && (
      <section className="gev-body">
        <div className="gld-x">
          {events === null ? null : list.length === 0 ? (
            <GEmpty title="No events scheduled"
                    message="Club events for the selected Rotary year will be listed here. The calendar shows past months too."
                    action={<a href="/calendar" className="gld-btn gld-btn--gold">Open the calendar <Arrow /></a>}
                    icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>} />
          ) : (
            <>
              <div className="gld-shead reveal">
                <div className="gld-shead__main">
                  <p className="gld-shead__e">Then</p>
                  <h2 className="gld-shead__t">
                    <span className="gld-w" style={{ '--wi': 0 }}><span>The</span></span>{' '}
                    <span className="gld-w gld-w--em" style={{ '--wi': 1 }}><span>diary</span></span>
                  </h2>
                  <span className="gld-shead__r" aria-hidden="true" />
                </div>
              </div>

              {/* Cards, not ruled rows. A club with a full year on the books ran
                  the old agenda past 6,000px; the same events as a grid fit four
                  to a row and the month captions still break it into spans you
                  can find your way around. */}
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="gev-group">{g.label}<span aria-hidden="true" /></p>
                  <div className="gev-grid gld-stagger">
                    {g.rows.map((e) => (
                      <article className="gev-card reveal" key={e.id}>
                        <a className="gp-shot gp-shot--box gev-card__ph" href={'/event?id=' + e.id}
                           aria-label={'Open ' + e.title}>
                          {e.img ? (
                            <>
                              <img className="gp-shot__bg" src={e.img} alt="" aria-hidden="true" />
                              <img className="gp-shot__im" src={e.img} alt="" loading="lazy" onError={hideOnError} />
                            </>
                          ) : null}
                          <span className="gev-card__d">
                            <b>{e.day}</b><i>{e.mon}</i>
                          </span>
                        </a>
                        <div className="gev-card__b">
                          <p className="gev-card__w">{e.weekday}</p>
                          <h3 className="gev-card__t">
                            <a href={'/event?id=' + e.id}>{e.title}</a>
                          </h3>
                          {e.venue && <p className="gev-card__v">{PIN}<span>{e.venue}</span></p>}
                          {e.desc && <p className="gev-card__x">{e.desc}</p>}
                          <div className="gev-card__a">
                            <a href={'/event?id=' + e.id} className="gld-btn gld-btn--ghost gld-btn--xs">Details</a>
                            {e.reg && (
                              <a href={e.reg} target="_blank" rel="noopener noreferrer" className="gld-btn gld-btn--gold gld-btn--xs">Register</a>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
      )}

    </div>
  )
}
