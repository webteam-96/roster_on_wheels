'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · Dignitary — one leader's profile, told as the theme's split.
// The name rises letter by letter in the royal hero; the portrait opens through
// the iris; the sticky panel holds the office and the Rotary year while the bio
// is read, then ticks 01 → 02 → … through "More leaders" (the other dignitary
// and the club's own president/secretary, each fetched with the SAME hook the
// linked page uses, so a card only appears when its page has someone to show).
//
// URL contract = DignitaryGold: /dignitary?Type=1 RI President (default),
// 2 District Governor, 4 Club President, 5 Club Secretary.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub, useDignitaryData, usePageTitle, withYear, plainText } from '../../_shared/data.js'
import { PageHero, SectionHead, Split, Chapter, fig, Button, PersonCard, EmptyState, Loading, PersonPhoto, excerpt, yearText } from '../kit.jsx'
import { useScene, useRefreshOnImages, gsap, revealBatch, photosIn, irisOnce } from '../motion.js'
import './Dignitary.css'

const TYPES = [1, 2, 4, 5]
// The office named when the API has nobody (the hook fills vm.role when it finds someone).
const OFFICE = { 1: 'RI President', 2: 'District Governor', 4: 'Club President', 5: 'Club Secretary' }
const MORE_T = 'More leaders'

const moreState = (o, i) => ({ title: MORE_T, value: i + 1, from: i, fmt: 'pad', caption: o.role, sub: o.name })

function MoreLeaders({ items, yearId }) {
  return (
    <ul className="spl-grid spl-dig-more">
      {items.map((o, i) => (
        <li key={o.type} {...fig(moreState(o, i))}>
          {/* photo, designation, name and Read more only - no description (client, 2026-10-06) */}
          <PersonCard name={o.name} role={o.role} img={o.img} more="Read more"
                      href={withYear('/dignitary?Type=' + o.type, yearId)} />
        </li>
      ))}
    </ul>
  )
}

export default function Dignitary({ data }) {
  const club = useClub()
  const [params] = useSearchParams()
  let type = parseInt(params.get('Type'), 10)
  if (Number.isNaN(type)) type = 1
  // The hook treats every other number as the RI President; say so here too.
  const t = TYPES.indexOf(type) >= 0 ? type : 1

  // Always the same four hooks (constant order); the page's own profile is one of them.
  const all = { 1: useDignitaryData(1, data), 2: useDignitaryData(2, data), 4: useDignitaryData(4, data), 5: useDignitaryData(5, data) }
  const vm = all[t]
  const more = TYPES.filter((k) => k !== t && all[k].found).map((k) => ({ ...all[k], type: k }))

  usePageTitle(vm.found ? vm.name : 'Dignitaries of Rotary')

  const office = (vm.found && vm.role) || OFFICE[t]
  const yearTxt = yearText(vm.year)
  const ym = /^(\d{4})(.*)$/.exec(yearTxt)
  const profileState = ym
    ? { value: +ym[1], from: +ym[1], fmt: 'plain', suffix: ym[2], caption: 'Rotary year', sub: vm.name || '' }
    : { value: yearTxt, caption: yearTxt ? 'Rotary year' : '', sub: vm.name || '' }
  const rail = [office].concat(more.length ? [MORE_T] : [])
  const key = [t, club.selectedYearId, vm.loading, vm.name, more.map((o) => o.type + ':' + o.name).join(',')].join('|')

  const ref = useRef(null)
  useRefreshOnImages(ref, [key])
  useScene(ref, () => {
    const r = ref.current
    // The portrait opens through the iris (timed, so on wide screens it opens while the name rises).
    irisOnce(r.querySelector('.spl-dig-portrait'))
    // The sky orbit on the royal plate turns with the scroll (the sample's orbit).
    const orbit = r.querySelector('.spl-dig-orbit')
    if (orbit) gsap.fromTo(orbit, { rotation: -60 }, { rotation: 120, ease: 'none', scrollTrigger: { trigger: orbit.parentElement, start: 'top bottom', end: 'bottom top', scrub: 1 } })
    revealBatch(r.querySelectorAll('.spl-dig-bio > *, .spl-dig-actions, .spl-dig-more > li'), { y: 28 })
    photosIn(r.querySelectorAll('.spl-dig-more .spl-person-photo'))
  }, [key])

  const board = <Button href={withYear('/directors', club.selectedYearId)} variant="ghost">Board of directors</Button>

  let body
  if (vm.loading) {
    body = (
      <>
        <PageHero title={office} eyebrow="Rotary leadership" crumbs={[{ label: office }]} />
        <section className="spl-section"><div className="spl-x"><Loading label="Loading the profile" /></div></section>
      </>
    )
  } else if (!vm.found) {
    body = (
      <>
        <PageHero title={office} eyebrow="Rotary leadership" crumbs={[{ label: office }]} />
        <section className="spl-section"><div className="spl-x">
          <EmptyState title="Profile not published yet"
                      message={'The ' + office + ' profile has not been published for the selected Rotary year. Please check back soon.'}
                      action={board} />
        </div></section>
        {more.length ? (
          <section className="spl-section spl-section--mist"><div className="spl-x">
            <SectionHead title={MORE_T} />
            <MoreLeaders items={more} yearId={club.selectedYearId} />
          </div></section>
        ) : null}
      </>
    )
  } else {
    body = (
      <>
        <PageHero title={vm.name} eyebrow={vm.designation || office} crumbs={[{ label: office }]} />
        <Split rail={rail} deps={[key]}>
          <Chapter id="spl-dig-profile" title={office} state={profileState}>
            <figure className="spl-dig-figure">
              <span className="spl-dig-plate" aria-hidden="true"><span className="spl-dig-orbit"><i /></span></span>
              <div className="spl-dig-portrait">
                <PersonPhoto src={vm.img} name={vm.name} alt={vm.name} className="spl-dig-img" monoClass="spl-dig-mono" width="480" height="600" loading="eager" />
              </div>
            </figure>
            {vm.bioHtml
              ? <div className="spl-prose spl-dig-bio" dangerouslySetInnerHTML={{ __html: vm.bioHtml }} />
              : <div className="spl-prose spl-dig-bio"><p>A detailed profile will be available soon.</p></div>}
            <div className="spl-dig-actions">{board}</div>
          </Chapter>
          {more.length ? (
            <Chapter id="spl-dig-more" title={MORE_T} state={moreState(more[0], 0)}>
              <MoreLeaders items={more} yearId={club.selectedYearId} />
            </Chapter>
          ) : null}
        </Split>
      </>
    )
  }

  return <div className="spl-dig" ref={ref}>{body}</div>
}
