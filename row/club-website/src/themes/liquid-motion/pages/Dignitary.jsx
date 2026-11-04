'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · DIGNITARY — "the arch".
// The ink breadcrumb band carries the designation (client, 2026-09-29: the office,
// not the person's name, and no RI President / District Governor switch there).
// A paper band follows: the portrait in the theme's arch, sticky on desktop,
// rising into an outlined arch while its photo settles from 1.3x (the home
// leadership move), with the name and designation under the photo, beside the bio.
// Data: useDignitaryData(type) only (goldData.useDignitaryGold). URL contract as
// Gold: /dignitary?Type=1 RI President, 2 District Governor (default 1; 4/5 =
// club president / secretary, which the hook also serves).
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub, useDignitaryData, usePageTitle, withYear } from '../../_shared/data.js'
import { PageHero, Band, Portrait, Pill, EmptyState, Loading } from '../kit.jsx'
import { usePageMotion, useScene, gsap } from '../motion.js'
import './Dignitary.css'

const ROLE = { 1: 'RI President', 2: 'District Governor', 4: 'Club President', 5: 'Club Secretary' }

// Admin bios sometimes carry their own <h1>; the hero's is the page's only one.
const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2')

export default function Dignitary({ data }) {
  const club = useClub()
  const [params] = useSearchParams()
  let type = parseInt(params.get('Type'), 10)
  if (Number.isNaN(type)) type = 1
  const key = type === 2 || type === 4 || type === 5 ? type : 1 // the hook reads every other number as RI President

  const vm = useDignitaryData(key, data)
  const role = vm.role || ROLE[key]
  usePageTitle(vm.found ? vm.name + ' – ' + role : role)

  const ref = useRef(null)
  usePageMotion(ref, [key, vm.loading, vm.name])
  // the moment: the arch rises into its outline and the photo settles from 1.3x
  useScene(ref, () => {
    const grid = ref.current.querySelector('.liq-dig-grid')
    if (!grid) return
    const pic = grid.querySelector('.liq-dig-arch .liq-portrait')
    const img = grid.querySelector('.liq-dig-arch .liq-portrait__img')
    const st = (end) => ({ trigger: grid, start: 'top bottom', end, scrub: true })
    if (pic) gsap.fromTo(pic, { yPercent: 18 }, { yPercent: 0, ease: 'none', scrollTrigger: st('top 45%') })
    if (img) gsap.fromTo(img, { scale: 1.3 }, { scale: 1, ease: 'none', scrollTrigger: st('top 40%') })
  }, [key, vm.loading, vm.name, vm.img])

  const bio = demoteH1(vm.bioHtml)

  return (
    <div className="liq-dig" ref={ref}>
      <PageHero key={key} title={role} crumbs={[{ label: role }]} />

      {vm.loading ? (
        <Band tone="paper"><Loading label="Loading profile" /></Band>
      ) : vm.found ? (
        <Band tone="paper" className="liq-dig-profile" aria-labelledby="liq-dig-h">
          <div className="liq-dig-grid">
            <div className="liq-dig-side">
              <div className="liq-dig-arch">
                <Portrait src={vm.img} name={vm.name} />
              </div>
              <div className="liq-dig-who liq-rv">
                <h2 className="liq-dig-name" id="liq-dig-h">{vm.name}</h2>
                <p className="liq-dig-role" style={{ '--n': Array.from(vm.designation || role).length }}>{vm.designation || role}</p>
              </div>
            </div>
            <div className="liq-dig-main">
              {bio
                /* trusted admin HTML, already made wrappable + safe by buildBioHtml (as Gold renders it) */
                ? <div className="liq-prose liq-rv" dangerouslySetInnerHTML={{ __html: bio }} />
                : <EmptyState as="h3" title="A detailed profile will be available soon" text="Please check back later in the Rotary year." />}
            </div>
          </div>
        </Band>
      ) : (
        <Band tone="paper" className="liq-dig-none">
          <EmptyState
            title="Details for this Rotary year haven’t been published yet"
            text={'The ' + ROLE[key] + '’s profile will appear here once it is published. Please check back soon.'}
            action={<Pill href={withYear('/directors', club.selectedYearId)} variant="ink">Meet the club’s board</Pill>} />
        </Band>
      )}
    </div>
  )
}
