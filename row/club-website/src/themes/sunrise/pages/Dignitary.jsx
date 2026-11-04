'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · DIGNITARY — one leader, rising like the sun.
// The name is the page's title. The profile reads in one column while a side
// plate stays beside it (above it on phones): the portrait rising in its arch
// inside the emblem's rings, then the office and Rotary year; paragraphs
// sharpen at the reading line. Below, the other leaders with a published
// profile rise in their arches, each linking to its page.
// Data: useDignitaryData(type) only (goldData.useDignitaryGold). URL contract as
// DignitaryGold: /dignitary?Type=1 RI President (default), 2 District Governor,
// 4 club president, 5 club secretary; any other number reads as RI President.
// ─────────────────────────────────────────────────────────────────────────────
import { useId, useRef } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub, useDignitaryData, withYear } from '../../_shared/data.js'
import { PageHero, SectionHead, Button, Arch, Person, People, EmptyState, Loading, demoteH1, yearText } from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, flyTitle, focusPull } from '../motion.js'
import './Dignitary.css'

const OFFICE = { 1: 'RI President', 2: 'District Governor', 4: 'Club President', 5: 'Club Secretary' }
const ORDER = [1, 2, 4, 5]            // the home's leadership order: RI President, DG, club President, Secretary

/** The side plate's portrait: it rises in its arch, rings and sun grow behind it (once it is on screen). */
function Portrait({ vm }) {
  const ref = useRef(null)
  useScene(ref, () => {
    const r = ref.current
    const q = (s) => r.querySelector(s)
    const clear = 'transform,opacity,translate,rotate,scale'
    // a short screen can hold it below the fold: play when it arrives, not unseen on load
    gsap.timeline({ delay: 0.2, scrollTrigger: { trigger: r, start: 'top 90%', once: true } })
      .fromTo(q('.sun-dig-port__glow'), { yPercent: 30, scale: 0.7, opacity: 0 }, { yPercent: 0, scale: 1, opacity: 1, duration: 1.8, ease: 'power3.out', clearProps: clear }, 0)
      .fromTo(r.querySelectorAll('.sun-dig-port__ring'), { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.6, stagger: 0.14, ease: 'power3.out', clearProps: clear }, 0)
      .fromTo(q('.sun-arch__halo'), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.4, ease: 'power3.out', clearProps: clear }, 0.1)
      .fromTo(q('.sun-arch__win'), { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'power3.out', clearProps: 'clipPath' }, 0.15)
      .fromTo(q('.sun-arch__win > *'), { yPercent: 35, scale: 1.15 }, { yPercent: 0, scale: 1, duration: 1.4, ease: 'power3.out', clearProps: clear }, 0.15)
  }, [vm.name, vm.img])
  return (
    <div ref={ref} className="sun-dig-port">
      <span className="sun-dig-port__glow" aria-hidden="true" />
      <span className="sun-dig-port__ring" aria-hidden="true" />
      <span className="sun-dig-port__ring sun-dig-port__ring--in" aria-hidden="true" />
      <Arch src={vm.img} name={vm.name} decorative eager />
    </div>
  )
}

export default function Dignitary({ data }) {
  const club = useClub()
  const [params] = useSearchParams()
  let type = parseInt(params.get('Type'), 10)
  if (Number.isNaN(type)) type = 1
  const t = OFFICE[type] ? type : 1

  // Always the same four hooks (constant order): switching profiles needs no wait,
  // and "More leaders" shows only people whose own page has a profile.
  const byType = { 1: useDignitaryData(1, data), 2: useDignitaryData(2, data), 4: useDignitaryData(4, data), 5: useDignitaryData(5, data) }
  const vm = byType[t]
  const more = ORDER.filter((k) => k !== t && byType[k].found).map((k) => ({ ...byType[k], type: k }))

  const yearId = club.selectedYearId
  const office = (vm.found && vm.role) || OFFICE[t]
  const yearTxt = yearText(vm.year)
  const name = vm.name || ''
  const key = [t, yearId, vm.loading, vm.found, name, more.map((o) => o.type + ':' + o.name).join(',')].join('|')

  const readId = useId()
  const moreId = useId()
  const ref = useRef(null)
  useRefreshOnImages(ref, [key])
  useScene(ref, (c) => {
    const r = ref.current
    // not the heading in the sticky side plate: it scrolled "past" while the plate held it on screen,
    // and flew off (faded, scaled) beside the bio
    flyTitle(r.querySelectorAll('.sun-fly:not(.sun-dig-side .sun-fly)'), c)
    focusPull(r.querySelectorAll('.sun-dig-prose > *'), c)
  }, [key])

  const switcher = (
    <nav className="sun-dig-switch" aria-label="Rotary dignitaries">
      <ul className="sun-chips">
        {[1, 2].map((k) => (
          <li key={k}>
            <a className="sun-chip" href={withYear('/dignitary?Type=' + k, yearId)} aria-current={k === t ? 'page' : undefined}>{OFFICE[k]}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
  const home = <Button href="/" variant="line" icon="back">Back to home</Button>

  let body
  if (vm.loading) {
    body = (
      <>
        <PageHero title={office} crumbs={[{ label: office }]} menuTitle={false} docTitle="Dignitaries of Rotary">{switcher}</PageHero>
        <div className="sun-wrap sun-block"><Loading label="Loading the profile" /></div>
      </>
    )
  } else if (!vm.found) {
    body = (
      <>
        <PageHero title={office} crumbs={[{ label: office }]} menuTitle={false} docTitle="Dignitaries of Rotary">{switcher}</PageHero>
        <div className="sun-wrap sun-block">
          <EmptyState title="Profile not available"
            message={'No ' + office + ' profile has been published' + (yearTxt ? ' for Rotary year ' + yearTxt : '') + ' yet. Please check back soon.'}
            action={home} />
        </div>
      </>
    )
  } else {
    body = (
      <>
        <PageHero title={name} crumbs={[{ label: office }]} menuTitle={false} size={name.length > 22 ? 'md' : 'lg'}>{switcher}</PageHero>
        <section className="sun-wrap sun-block sun-dig-read" aria-labelledby={readId}>
          <div className="sun-dig-side">
            <Portrait key={name + '|' + vm.img} vm={vm} />
            <SectionHead id={readId} title="Profile" />
            <dl className="sun-dig-facts">
              <div><dt>Office</dt><dd>{office}</dd></div>
              {yearTxt ? <div><dt>Rotary year</dt><dd>{yearTxt}</dd></div> : null}
            </dl>
          </div>
          <div className="sun-dig-main">
            {vm.bioHtml
              /* buildBioHtml: the API's rich HTML as-is, or plain text split + encoded */
              ? <div className="sun-prose sun-dig-prose" dangerouslySetInnerHTML={{ __html: demoteH1(vm.bioHtml) }} />
              : <div className="sun-prose sun-dig-prose"><p>A detailed profile will be available soon.</p></div>}
            <div className="sun-dig-back">{home}</div>
          </div>
        </section>
      </>
    )
  }

  return (
    <div ref={ref} className="sun-page sun-dig">
      {body}
      {!vm.loading && more.length ? (
        <section className="sun-wrap sun-block sun-dig-more" aria-labelledby={moreId}>
          <SectionHead id={moreId} title="More leaders" center />
          <People deps={[more.map((o) => o.type + ':' + o.name).join(',')]}>
            {more.map((o) => (
              /* photo, office and name - no bio, like the home's leader cards */
              <Person key={o.type} src={o.img} name={o.name} role={o.role}
                href={withYear('/dignitary?Type=' + o.type, yearId)} more="View profile" />
            ))}
          </People>
        </section>
      ) : null}
    </div>
  )
}
