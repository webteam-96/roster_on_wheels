'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · DIGNITARY — a portrait at dusk.
//
// /dignitary?Type=1 RI President (default) · 2 District Governor · 4 Club
// President · 5 Club Secretary — the same contract as DignitaryGold.
//
// The hero sky is royal (azure for the District Governor). The person stands
// in it as a large arch portrait with the day's low sun behind it: on arrival
// the arch opens from the ground while the sun rises behind its shoulders, and
// as the page scrolls on the sun sets behind the portrait. The bio follows on
// paper at reading width beside a sticky heading with a drawn hill line. Night
// falls on the last band: the moon rises over the other leaders of the year,
// each a smaller arch linking to their own profile.
//
// Data: useDignitaryData(type) only. All four profiles are asked for at once —
// the API calls are shared within a page view (bod once for 4 and 5) — so the
// "other leaders" band comes from the same rule, and switching Type swaps
// instantly without showing the previous person under the new URL.
// Personal email/phone are never shown (the shared page shows none either).
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub, useDignitaryData, withYear, currentRotaryYearLabel } from '../../_shared/data.js'
import { PageHero, SectionHead, Band, Button, Portrait, EmptyState, Loading, Ridge, htmlText, cut, yearText } from '../kit.jsx'
import { gsap, useScene, afterFonts, titleIn, rise, revealBatch, archOpen, useRefreshOnImages } from '../motion.js'
import './Dignitary.css'

const TYPES = [1, 2, 4, 5]

export default function Dignitary({ data }) {
  const [params] = useSearchParams()
  let type = parseInt(params.get('Type'), 10)
  if (Number.isNaN(type)) type = 1
  // The hook reads any other number as the RI President; so do we.
  const cur = TYPES.includes(type) ? type : 1

  const club = useClub()
  const ri = useDignitaryData(1, data)
  const dg = useDignitaryData(2, data)
  const pres = useDignitaryData(4, data)
  const sec = useDignitaryData(5, data)
  const byType = { 1: ri, 2: dg, 4: pres, 5: sec }
  const vm = byType[cur]

  const others = TYPES.filter((t) => t !== cur && byType[t].found).map((t) => ({ ...byType[t], type: t }))
  const othersKey = others.map((o) => o.type + ':' + o.name + ':' + (o.img || '')).join('|')
  const yearLabel = club.selectedYearLabel || currentRotaryYearLabel()

  const ref = useRef(null)
  useScene(ref, (c, ctx) => {
    const q = gsap.utils.selector(ref.current)

    // Dusk: the arch opens from the ground while the low sun rises behind it…
    const hero = q('.hj-dig-ph')[0]
    const arch = q('.hj-dig-port .hj-arch')[0]
    if (hero && arch) {
      gsap.fromTo(arch, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'expo.out', delay: 0.3, clearProps: 'clipPath' })
      const img = arch.querySelector('img')
      if (img) gsap.fromTo(img, { scale: 1.35 }, { scale: 1, duration: 1.9, ease: 'expo.out', delay: 0.3, clearProps: 'transform,scale' })
      gsap.fromTo(q('.hj-dig-sun'), { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 2.2, ease: 'power3.out', delay: 0.15, clearProps: 'transform,opacity' })
      // …and sets behind the portrait as the page scrolls on (wrapper, so the two tweens never fight).
      gsap.fromTo(q('.hj-dig-sunw'), { yPercent: 0, opacity: 1 }, {
        yPercent: 80, opacity: 0.45, ease: 'none', immediateRender: false,
        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
      })
    }

    // The profile: kicker rises, the hill line draws itself, paragraphs arrive as you read.
    const body = q('.hj-dig-body')[0]
    if (body) {
      rise(q('.hj-dig-head .hj-kicker'), body)
      const rule = q('.hj-dig-rule')[0]
      if (rule) gsap.fromTo(rule, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'expo.inOut', clearProps: 'clipPath', scrollTrigger: { trigger: body, start: 'top 85%', once: true } })
      const paras = q('.hj-dig-prose > *')
      revealBatch(paras.length ? paras : q('.hj-dig-prose'), { y: 28 })
      rise(q('.hj-dig-back'), q('.hj-dig-back')[0])
    }

    // Night: the moon comes up over the other leaders; their arches open from the ground.
    const more = q('.hj-dig-more')[0]
    if (more) {
      gsap.fromTo(q('.hj-dig-moon'), { yPercent: 90, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: more, start: 'top 85%', end: 'top 25%', scrub: true } })
      q('.hj-dig-ld').forEach((l) => {
        archOpen(l.querySelector('.hj-arch'), { trigger: l })
        rise(l.querySelector('.hj-dig-ld__t'), l, { from: c.wide ? { x: 60, y: 0 } : { y: 26 }, duration: 1.1 })
      })
    }

    // Sticky heading: trigger on its (non-sticky) section so a stuck position is never measured.
    return afterFonts(ctx, () => {
      const h = q('.hj-dig-head .hj-h2')[0]
      if (h) titleIn(h, { trigger: body, start: 'top 90%', end: 'top 55%' })
      const mh = q('.hj-dig-more .hj-h2')[0]
      if (mh) titleIn(mh)
    })
  }, [vm.loading, vm.found, vm.name, othersKey])
  useRefreshOnImages(ref, [vm.name, othersKey])

  const tone = cur === 2 ? 'azure' : 'royal'
  const role = vm.role || ''

  let main
  if (vm.loading) {
    main = <div className="hj-wrap hj-sec"><Loading label="Loading profile" /></div>
  } else if (!vm.found) {
    main = (
      <>
        <PageHero tone="night" title="Dignitaries" docTitle="Dignitaries of Rotary" menuTitle={false} />
        <div className="hj-wrap hj-sec">
          <EmptyState title="Profile not available"
                      message="We couldn’t find this leadership profile right now. Please check back soon."
                      action={<Button href="/" variant="ink" icon="back">Back to home</Button>} />
        </div>
      </>
    )
  } else {
    main = (
      <>
        <PageHero
          className="hj-dig-ph" tone={tone} title={vm.name} docTitle={vm.name} menuTitle={false}
          crumbs={role ? [{ label: 'Dignitaries' }, { label: role }] : [{ label: 'Dignitaries' }]}
          aside={(
            <div className="hj-dig-port">
              <span className="hj-dig-sunw" aria-hidden="true"><span className="hj-dig-sun" /></span>
              <Portrait key={vm.img || vm.name} src={vm.img} name={vm.name} alt={vm.name} />
            </div>
          )}
        />
        <section className="hj-wrap hj-sec hj-dig-body" aria-labelledby="hj-dig-about">
          <div className="hj-dig-head">
            <SectionHead key={vm.name} k="Profile" title={'About ' + vm.name} id="hj-dig-about" />
            <div className="hj-dig-rule" aria-hidden="true"><Ridge preset="far" fill="var(--hj-dig-c)" rim={null} /></div>
          </div>
          {vm.bioHtml ? (
            /* Safe HTML from the hook (buildBioHtml): rich API markup as-is, plain text split + encoded. */
            <div className="hj-prose hj-dig-prose" dangerouslySetInnerHTML={{ __html: vm.bioHtml }} />
          ) : (
            <p className="hj-prose hj-dig-prose hj-dig-prose--none">A detailed profile will be available soon.</p>
          )}
          <p className="hj-dig-back"><Button href="/" variant="ink" icon="back">Back to home</Button></p>
        </section>
      </>
    )
  }

  const moreTitle = vm.found ? 'Other leaders' : 'Rotary leaders'
  return (
    <div ref={ref} className={'hj-page hj-dig hj-dig--' + tone}>
      {main}
      {!vm.loading && others.length > 0 && (
        <Band tone="night" next="var(--hj-night)" className="hj-dig-more hj-endpad" labelledBy="hj-dig-more-h">
          <div className="hj-dig-sky" aria-hidden="true"><span className="hj-stars" /><span className="hj-moon hj-dig-moon" /></div>
          <SectionHead key={moreTitle} k={'Rotary year ' + yearText(yearLabel)} title={moreTitle} id="hj-dig-more-h" />
          <ul className="hj-dig-list">
            {others.map((o) => {
              const bio = cut(htmlText(o.bioHtml), 110)
              return (
                <li key={o.type} className="hj-dig-ld">
                  <Portrait key={o.img || o.name} src={o.img} name={o.name} alt={o.name} />
                  <div className="hj-dig-ld__t">
                    <p className="hj-dig-ld__r">{o.role}</p>
                    <h3 className="hj-dig-ld__n"><a href={withYear('/dignitary?Type=' + o.type, club.selectedYearId)}>{o.name}</a></h3>
                    {bio ? <p className="hj-dig-ld__bio">{bio}</p> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </Band>
      )}
    </div>
  )
}
