'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · DIGNITARY — "the feature presentation".
// One person, presented like the feature: the DESIGNATION is the title card
// (PageHero, with a blurred projection of the portrait behind it), then the
// portrait opens like a projector in a lit screen frame (viewfinder corners,
// gold glow; the photo does not react to the mouse) beside the name and the profile.
// No dignitary switcher and no leadership cards below (client, 2026-09-28): the
// home's Leadership cards link here, one person per page.
// Data: useDignitaryData(type) only (goldData.useDignitaryGold). URL contract as
// DignitaryGold: /dignitary?Type=1 RI President (default), 2 District Governor,
// 4 club president, 5 club secretary; any other number reads as RI President.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useDignitaryData, usePageTitle } from '../../_shared/data.js'
import { isPlaceholderPhoto } from '../../_shared/kit.jsx'
import { PageHero, SectionHead, Button, PersonPhoto, EmptyState, Loading, Arrow, demoteH1 } from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, cleanups, riseIn, projectorOpen, EXPO } from '../motion.js'
import './Dignitary.css'

const ROLE = { 1: 'RI President', 2: 'District Governor', 4: 'Club President', 5: 'Club Secretary' }
const WHOSE = { 1: 'The RI President’s', 2: 'The District Governor’s', 4: 'The club president’s', 5: 'The club secretary’s' }

// ── the feature: portrait in a lit screen frame + the profile ────────────────
function Feature({ vm }) {
  const ref = useRef(null)
  useScene(ref, (c) => {
    const root = ref.current
    const off = cleanups()
    const tl = gsap.timeline({ delay: 0.3, scrollTrigger: { trigger: root, start: 'top 85%', once: true } })
    tl.add(projectorOpen(root.querySelector('.cin-dig-frame'), { duration: 1.3 }), 0)
      .fromTo(root.querySelector('.cin-dig-glow'), { opacity: 0, scale: 0.7 },
        { opacity: 1, scale: 1, duration: 1.8, ease: 'power2.out', clearProps: 'opacity,transform' }, 0.2)
      .fromTo(root.querySelector('.cin-dig-gate'), { opacity: 0, scale: 1.12 },
        { opacity: 1, scale: 1, duration: 1, ease: EXPO, clearProps: 'opacity,transform' }, 0.8)
      .from(root.querySelectorAll('.cin-dig-plate > *'),
        { y: 22, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, clearProps: 'transform,opacity' }, 0.6)
    // each block of the profile rises as it reaches the screen (bios run long)
    root.querySelectorAll('.cin-dig-read > .cin-prose > *, .cin-dig-soon, .cin-dig-back').forEach((el) => riseIn(el, { y: 28 }))
    return off.run
  }, [vm.name, vm.img, vm.bioHtml])

  const credit = vm.designation || vm.role
  return (
    <section ref={ref} className="cin-dig-stage" aria-labelledby="cin-dig-h">
      <div className="cin-dig-side">
        <div className="cin-dig-ph">
          <span className="cin-dig-glow" aria-hidden="true" />
          <div className="cin-dig-frame">
            <PersonPhoto key={vm.img || vm.name} src={vm.img} name={vm.name} alt={vm.name} className="cin-dig-img" monoClass="cin-dig-mono"
              width="480" height="600" loading="eager" />
            <span className="cin-dig-gate" aria-hidden="true" />
          </div>
        </div>
        <div className="cin-dig-plate">
          {credit ? <p className="cin-dig-role">{credit}</p> : null}
          <p className="cin-dig-name">{vm.name}</p>
        </div>
      </div>

      <div className="cin-dig-read">
        <SectionHead id="cin-dig-h" title="Profile" />
        {vm.bioHtml ? (
          /* buildBioHtml output: the API's rich HTML as-is, or plain text split + encoded */
          <div className="cin-prose" dangerouslySetInnerHTML={{ __html: demoteH1(vm.bioHtml) }} />
        ) : (
          <p className="cin-dig-soon">A detailed profile will be available soon.</p>
        )}
        <div className="cin-dig-back"><Button href="/" variant="line">Back to home <Arrow /></Button></div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Dignitary({ data }) {
  const [params] = useSearchParams()
  let type = parseInt(params.get('Type'), 10)
  if (Number.isNaN(type)) type = 1
  const key = type === 2 || type === 4 || type === 5 ? type : 1   // the hook reads every other number as RI President

  // Only this person's profile loads (the switcher and the leader cards that needed all four are gone).
  const vm = useDignitaryData(key, data)

  usePageTitle(vm.found ? vm.name : 'Dignitaries of Rotary')
  const pageRef = useRef(null)
  useRefreshOnImages(pageRef, [key, vm.loading, vm.bioHtml])

  const backdrop = vm.found && !isPlaceholderPhoto(vm.img) ? vm.img : undefined

  return (
    <div ref={pageRef} className="cin-dig">
      {vm.loading ? (
        <Loading label="Loading profile" />
      ) : vm.found ? (
        <>
          {/* the designation is the title (client, 2026-09-28); the name is on the portrait's plate below */}
          <PageHero title={vm.role || ROLE[key]} backdrop={backdrop}
            crumbs={[{ label: 'Dignitaries' }, { label: vm.role || ROLE[key] }]} />
          <Feature key={key} vm={vm} />
        </>
      ) : (
        <>
          <PageHero title={ROLE[key]}
            crumbs={[{ label: 'Dignitaries' }, { label: ROLE[key] }]} />
          <div className="cin-sec">
            <EmptyState title="Profile not available"
              message={WHOSE[key] + ' profile hasn’t been published for this Rotary year.'}
              action={<Button href="/">Back to home <Arrow /></Button>} />
          </div>
        </>
      )}
    </div>
  )
}
