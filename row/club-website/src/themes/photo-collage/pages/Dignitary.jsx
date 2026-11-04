'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO COLLAGE · DIGNITARY — a feature profile pinned into the scrapbook.
//   PageHero: the name, photo-filled with the person's own portrait (it wipes in)
//   · the spread: a large tilted portrait held by a paper clip — it swings in on
//     the clip and develops from sepia — with a gold Rotary-year sticker slapped
//     on its corner; beside it the bio as a letter on ruled notebook paper
//   (No "Also this year" section of the other leaders - client, 2026-09-29.)
// Data: useDignitaryData(type) only (goldData.useDignitaryGold). URL contract as
// DignitaryGold: /dignitary?Type=1 RI President (default), 2 District Governor,
// 4 club president, 5 club secretary; any other number reads as RI President.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub, useDignitaryData, usePageTitle } from '../../_shared/data.js'
import { isPlaceholderPhoto } from '../../_shared/kit.jsx'
import {
  PageHero, Portrait, Button, NotFound, Loading, Tape, Underline, P, yearDash,
} from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, house, CLEAR, DEV0, DEV1 } from '../motion.js'
import './Dignitary.css'

const OFFICE = { 1: 'RI President', 2: 'District Governor', 4: 'Club President', 5: 'Club Secretary' }
const TINT = { 1: 'royal', 2: 'azure', 4: 'cran', 5: 'violet' }
const photo = (src) => (isPlaceholderPhoto(src) ? '' : src)

export default function Dignitary({ data }) {
  const club = useClub()
  const [params] = useSearchParams()
  let type = parseInt(params.get('Type'), 10)
  if (Number.isNaN(type)) type = 1
  const key = OFFICE[type] ? type : 1       // the hook reads every other number as RI President

  const vm = useDignitaryData(key, data)
  usePageTitle(vm.found ? vm.name : 'Dignitaries of Rotary')

  const yearId = club.selectedYearId
  const office = (vm.found && vm.role) || OFFICE[key]
  const kicker = vm.designation || vm.role
  const Y = yearDash(vm.year || club.selectedYearLabel)
  const img = photo(vm.img)
  const name = vm.name || ''
  // the API's rich HTML keeps its structure, but the page's only h1 is the hero's
  const bio = vm.bioHtml ? String(vm.bioHtml).replace(/<(\/?)h1\b/gi, '<$1h2') : ''

  const sig = [key, yearId, vm.loading, vm.found, name, vm.img, bio.length].join('|')

  const rootRef = useRef(null)
  const spreadRef = useRef(null)
  useRefreshOnImages(rootRef, [sig])

  // the spread: house style + the portrait swinging in on its clip as it develops
  useScene(spreadRef, (c) => {
    const root = spreadRef.current
    const undo = house(root, c)
    const hold = root.querySelector('.col-dig-hold')
    if (hold) {
      const pic = hold.querySelector('img.col-portrait-img')
      const tl = gsap.timeline({ scrollTrigger: { trigger: hold, start: 'top 88%', once: true } })
      tl.fromTo(hold, { y: -90, rotation: 16 }, {
        y: 0, rotation: 0, duration: 2.2, ease: 'elastic.out(1, 0.3)', transformOrigin: '50% 0%', clearProps: CLEAR + ',transformOrigin',
      }, 0.15)
        .fromTo(hold, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power1.out', clearProps: 'opacity' }, 0.15)
      if (pic) tl.fromTo(pic, { filter: DEV0 }, { filter: DEV1, duration: 1.8, ease: 'power2.out', clearProps: 'filter' }, 0.35)
    }
    return undo
  }, [sig])

  let body
  if (vm.loading) {
    body = <section className="col-sec col-dig-state"><Loading label="Loading the profile" count={1} /></section>
  } else if (!vm.found) {
    body = (
      <>
        <PageHero title={office} kicker={Y ? 'Rotary year ' + Y : null} tint={TINT[key]} className="col-dig-hero" />
        <section className="col-sec col-dig-state">
          <NotFound title="Profile not available"
            message={'We couldn’t find the ' + office + '’s profile' + (Y ? ' for Rotary year ' + Y : '') + '. Please check back soon.'}
            backHref="/" backLabel="Back to home" />
        </section>
      </>
    )
  } else {
    body = (
      <>
        <PageHero title={name} kicker={kicker} img={img} tint={TINT[key]} crumbs={[{ label: office }]}
          className={'col-dig-hero' + (name.length > 18 ? ' is-long' : '')} />

        <section ref={spreadRef} className="col-sec col-dig-spread" aria-labelledby="col-dig-bio-t">
          <div className="col-dig-grid">
            <div className="col-dig-side">
              <div className="col-dig-pin">
                <div className="col-dig-hold">
                  <svg className="col-dig-clip" viewBox="0 0 26 62" aria-hidden="true" focusable="false"><path d={P.clip} /></svg>
                  <Portrait src={vm.img} name={name} alt={name} r={-3} k={0.6} tape={null}
                    caption={vm.role && vm.role !== kicker ? vm.role : null} />
                </div>
                {Y ? (
                  <div className="col-stk col-dig-yr"
                    style={{ '--col-c': 'var(--col-gold)', '--col-fg': 'var(--col-ink)', '--col-t': '9deg', '--col-k': -0.8, '--col-len': Y.length }}>
                    <div className="col-stk-move"><div className="col-stk-fl"><div className="col-stk-card">
                      <svg className="col-stk-shape" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><circle className="col-sh" cx="100" cy="100" r="92" /></svg>
                      <p className="col-stk-num">{Y}</p>
                      <p className="col-stk-label">Rotary year</p>
                    </div></div></div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="col-dig-main">
              <div className="col-dig-sheet">
                <div className="col-dig-letter">
                  <Tape tone="gold" left="84%" tilt={6} />
                  <h2 id="col-dig-bio-t" className="col-dig-letter-t">Profile<Underline scroll /></h2>
                  {bio
                    /* buildBioHtml: the API's rich HTML as-is, or plain text split + encoded */
                    ? <div className="col-dig-prose" dangerouslySetInnerHTML={{ __html: bio }} />
                    : <p className="col-dig-soon">A detailed profile will be available soon.</p>}
                </div>
              </div>
              <p className="col-dig-back"><Button href="/" variant="ghost"><span aria-hidden="true">&larr;</span> Back to home</Button></p>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <div className="col-dig" ref={rootRef}>
      {body}
    </div>
  )
}
