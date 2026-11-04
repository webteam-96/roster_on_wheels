'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · About — the walk's starting point.
//
// Dawn hero with the club's crest rising like a second sun. Then the walk:
//   01 Our story      the club's own About HTML on cream, a sticky "at a glance"
//                     rail beside it, closing on ridges in the next chapter colour
//   02 Our leaders    turquoise band: president + secretary arches -> /dignitary
//   03 Where we meet  royal night band: moon, stars, the day in huge gold type
//   04 Explore        onward trail cards (directors, projects, past presidents)
// A chapter the club has no data for is not rendered; numbering and the ridge
// colours follow what is left. Data: useAboutData() only (goldData.useAboutGold).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef } from 'react'
import { useClub, useAboutData, media, withYear, externalUrl, socialLabel } from '../../_shared/data.js'
import { PageHero, SectionHead, Band, Button, Portrait, Ridge, EmptyState, Loading, IconArrow, yearText } from '../kit.jsx'
import { useScene, afterFonts, useRefreshOnImages, gsap, titleIn, rise, revealBatch, archOpen, parallax, split } from '../motion.js'
import './About.css'

const trim = (v) => (v == null ? '' : String(v).trim())
const pad = (n) => String(n).padStart(2, '0')
const okName = (p) => !!p && !!trim(p.memberName) && trim(p.memberName).toLowerCase() !== 'not available'

const ONWARD = [
  { href: '/directors', label: 'Board of directors', c: 'var(--hj-royal)', sun: 'var(--hj-gold)' },
  { href: '/projects', label: 'Projects', c: 'var(--hj-azure)', sun: 'var(--hj-gold)' },
  { href: '/past-presidents', label: 'Past presidents', c: 'var(--hj-night)', sun: '#E6EBFA' },
]

export default function About({ data }) {
  const club = useClub()
  const d = useAboutData(data)
  const ref = useRef(null)

  const name = trim(club.clubDisplayName)
  const yr = yearText(club.selectedYearLabel)
  // Trusted admin HTML (already wrappableHtml); its <h1>s become <h2>s — the hero owns the page's only h1.
  const html = useMemo(() => (d.html ? String(d.html).replace(/<(\/?)h1\b/gi, '<$1h2') : ''), [d.html])

  const day = trim(d.meetingDay)
  const time = trim(d.meetingTime).replace(/\s+-\s+/, ' – ')
  const venue = trim(d.meetingVenue)
  const hasMeet = !d.loading && !!(day || time || venue)

  const leaders = d.loading ? [] : [[d.president, 4, 'President'], [d.secretary, 5, 'Secretary']]
    .filter(([p], i, a) => okName(p) && a.findIndex(([q]) => q === p) === i)
    .map(([p, type, role]) => ({ type, role: trim(p.designation) || role, name: trim(p.memberName), img: media(p.profilePhotoPath) }))

  // "At a glance": the same facts Gold's ledger shows (venue lives in the night band).
  const email = trim(d.email)
  const phone = trim(d.phone)
  const tel = phone.replace(/[^\d+]/g, '')
  const rows = d.loading ? [] : [
    { k: 'Rotary year', v: yr },
    { k: 'President', v: okName(d.president) ? trim(d.president.memberName) : '' },
    { k: 'Secretary', v: okName(d.secretary) ? trim(d.secretary.memberName) : '' },
    { k: 'Meets', v: [day, time].filter(Boolean).join(' · ') },
    { k: 'Email', v: email, href: /^[^\s@,;]+@[^\s@,;]+$/.test(email) ? 'mailto:' + email : '' },
    { k: 'Phone', v: phone, href: /^[+\d\s().-]+$/.test(phone) && tel.replace(/\D/g, '').length >= 6 ? 'tel:' + tel : '' },
  ].filter((r) => r.v)
  const socials = d.loading ? [] : (d.socials || []).map((s) => ({ url: externalUrl(s.linkUrl), label: socialLabel(trim(s.platform).toLowerCase()) })).filter((s) => s.url)
  const hasRail = rows.length > 0 || socials.length > 0

  const chapters = ['story', leaders.length > 0 && 'leaders', hasMeet && 'meet', 'more'].filter(Boolean)
  const num = (k) => pad(chapters.indexOf(k) + 1)
  const storyNext = leaders.length ? 'var(--hj-turq)' : hasMeet ? 'var(--hj-royal)' : ''

  const dataKey = [club.selectedYearId, d.loading, html.length, d.logo, leaders.map((l) => l.name).join(','), day, time, venue, rows.length, socials.length].join('|')
  useRefreshOnImages(ref, [dataKey])

  useScene(ref, (c, ctx) => afterFonts(ctx, () => {
    const r = ref.current
    // chapter heads: the title rises out of the skew, kicker + sub follow
    r.querySelectorAll('.hj-about-ch .hj-sh').forEach((sh) => {
      titleIn(sh.querySelector('.hj-h2'))
      rise(sh.querySelectorAll('.hj-kicker, .hj-sh__sub'), sh, { from: { y: 28 }, stagger: 0.06 })
    })
    // far ridges settle as each chapter's bottom edge arrives; band numerals drift
    r.querySelectorAll('.hj-about-ch').forEach((p) => {
      const far = p.querySelector(':scope > .hj-band__ridge > .hj-rg:first-child, :scope > .hj-about-ridge > .hj-rg:first-child')
      if (far) gsap.fromTo(far, { yPercent: 35 }, { yPercent: -8, ease: 'none', scrollTrigger: { trigger: p, start: 'bottom bottom', end: 'bottom 30%', scrub: true } })
      parallax(p.querySelector(':scope > .hj-band__num'), { trigger: p })
    })
    const prose = r.querySelector('.hj-about-prose')
    if (prose) revealBatch(prose.children, { y: 28, stagger: 0.05 })
    rise(r.querySelector('.hj-about-rail'), null, { from: { x: 40, y: 0 } })
    r.querySelectorAll('.hj-about-ld').forEach((l) => {
      archOpen(l.querySelector('.hj-arch'), { trigger: l })
      rise(l.querySelector('.hj-about-ld__t'), l, { from: { y: 26 } })
    })
    const meet = r.querySelector('.hj-about-meet')
    if (meet) {
      gsap.fromTo(meet.querySelector('.hj-about-moon'), { yPercent: 90, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: meet, start: 'top 85%', end: 'top 25%', scrub: true } })
      // the aria-hidden visual copy is split; the dd keeps a plain sr-only day
      const dd = meet.querySelector('.hj-about-meet__dayt')
      if (dd) {
        const s = split(dd, 'none')
        gsap.fromTo(s ? s.chars : dd, { yPercent: 70, rotation: -12, opacity: 0 }, { yPercent: 0, rotation: 0, opacity: 1, duration: 1, stagger: 0.05, ease: 'back.out(1.6)', scrollTrigger: { trigger: dd, start: 'top 90%', once: true } })
      }
      rise(meet.querySelectorAll('.hj-about-meet__time, .hj-about-meet__venue, .hj-about-meet__go'), meet.querySelector('.hj-about-meet__dl'), { from: { x: 60, y: 0 }, stagger: 0.08 })
    }
    rise(r.querySelectorAll('.hj-about-more__list > li'), r.querySelector('.hj-about-more__list'), { from: { x: 70, y: 0 }, stagger: 0.08 })
  }), [dataKey])

  return (
    <div className="hj-page hj-ground--cream hj-about" ref={ref}>
      <PageHero tone="dawn" title="About Us" />

      {/* ══ Our story: the club's own words, the facts alongside - left out when there is neither ══ */}
      {d.loading || html || hasRail ? (
      <section className={'hj-about-ch hj-about-story' + (storyNext ? ' has-ridge' : '')} aria-labelledby={html || d.loading ? 'hj-about-story-t' : 'hj-about-rail-t'}
               style={storyNext ? { '--hj-next': storyNext } : undefined}>
        <div className={'hj-wrap hj-about-story__in' + (hasRail ? ' has-rail' : '')}>
          {/* no story -> no heading and no "not published" card (client, 2026-10-05: hide what has no data) */}
          {d.loading || html ? (
            <div className="hj-about-copy">
              <SectionHead k={num('story')} title="Our story" id="hj-about-story-t" />
              {d.loading ? <Loading label="Loading the club’s story" />
                : <div className="hj-prose hj-about-prose" dangerouslySetInnerHTML={{ __html: html }} />}
            </div>
          ) : null}
          {hasRail ? (
            <aside className="hj-about-rail" aria-labelledby="hj-about-rail-t">
              <h3 className="hj-about-rail__t" id="hj-about-rail-t">At a glance</h3>
              {rows.length > 0 && (
                <dl className="hj-about-rail__dl">
                  {rows.map((r) => (
                    <div key={r.k}><dt>{r.k}</dt><dd>{r.href ? <a href={r.href}>{r.v}</a> : r.v}</dd></div>
                  ))}
                </dl>
              )}
              {socials.length > 0 && (
                <ul className="hj-about-rail__soc" aria-label="Social media">
                  {socials.map((s, i) => <li key={i}><Button href={s.url} variant="ghost" size="sm">{s.label}</Button></li>)}
                </ul>
              )}
            </aside>
          ) : null}
        </div>
        {storyNext ? (
          <div className="hj-about-ridge" aria-hidden="true">
            <Ridge preset="pnFar" fill="color-mix(in srgb, var(--hj-next) 38%, transparent)" />
            <Ridge preset="pnFront" className="hj-rg--front" />
          </div>
        ) : null}
      </section>
      ) : null}

      {/* ══ Our leaders: this year's president and secretary ══ */}
      {leaders.length > 0 && (
        <Band tone="turq" next={hasMeet ? 'var(--hj-royal)' : 'var(--hj-ground)'} num={num('leaders')}
              labelledBy="hj-about-lead-t" className="hj-about-ch hj-about-lead">
          <SectionHead k={num('leaders')} title="Our leaders" id="hj-about-lead-t" sub={yr ? 'Rotary year ' + yr : null} />
          <ul className={'hj-about-lead__list' + (leaders.length === 1 ? ' is-one' : '')}>
            {leaders.map((l) => (
              <li className="hj-about-ld" key={l.type}>
                <Portrait src={l.img} name={l.name} alt={l.name} />
                <div className="hj-about-ld__t">
                  <p className="hj-about-ld__r">{l.role}</p>
                  <h3 className="hj-about-ld__n"><a href={withYear('/dignitary?Type=' + l.type, club.selectedYearId)}>{l.name}</a></h3>
                </div>
              </li>
            ))}
          </ul>
        </Band>
      )}

      {/* ══ Where we meet: night falls ══ */}
      {hasMeet && (
        <Band tone="royal" labelledBy="hj-about-meet-t" className="hj-about-ch hj-about-meet">
          <span className="hj-about-moon hj-moon" aria-hidden="true" />
          <SectionHead k={num('meet')} title="Where we meet" id="hj-about-meet-t" />
          <dl className="hj-about-meet__dl">
            {day ? (
              <div className="hj-about-meet__day">
                <dt>Day</dt>
                <dd style={{ '--hj-len': Math.max(6, day.length) }}>
                  <span key={day} className={'hj-about-meet__dayt' + (day.length > 12 ? ' is-long' : '')} aria-hidden="true">{day}</span>
                  <span className="hj-sr">{day}</span>
                </dd>
              </div>
            ) : null}
            {time ? <div className="hj-about-meet__time"><dt>Time</dt><dd>{time}</dd></div> : null}
            {venue ? <div className="hj-about-meet__venue"><dt>Venue</dt><dd>{venue}</dd></div> : null}
          </dl>
          {venue && d.mapUrl ? <Button className="hj-about-meet__go" href={d.mapUrl}>Get directions</Button> : null}
        </Band>
      )}

      {/* ══ Onward: the next stops on the walk ══ */}
      <section className="hj-about-ch hj-about-more hj-wrap hj-sec hj-endpad" aria-labelledby="hj-about-more-t">
        <SectionHead k={num('more')} title="Explore the club" id="hj-about-more-t" />
        <ul className="hj-about-more__list">
          {ONWARD.map((o) => (
            <li key={o.href}>
              <a className="hj-about-go" href={o.href} style={{ '--hj-c': o.c, '--hj-sunc': o.sun }}>
                <span className="hj-about-go__t">{o.label}<IconArrow /></span>
                <span className="hj-about-go__art" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
