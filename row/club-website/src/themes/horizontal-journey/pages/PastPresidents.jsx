'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · PAST PRESIDENTS — the walk back through the years.
//
// The one genuinely timeline-like page, so it gets the sample's journey run in
// reverse: the page starts at night (the hero's moon, this year's president in
// the aside) and walks back decade by decade through the day's skies — night,
// royal, violet, azure, turquoise, gold, cranberry — to the club's dawn, where
// the sun sits low and orange over the first president on record.
//
// Wide + motion + tall (>= 900 x 620): one pinned horizontal track. Every
// president is an arch portrait STANDING on a long night hill (each arch's foot
// is read off the drawn ridge line), with the start year above in the home's
// milestone style (outline, gold fill wiping in). Portraits lean with scroll
// speed, feet planted. No decade bar (client, 2026-10-01).
// Everything else (phones, short windows, reduced motion, short rolls): the same
// decades stacked as chapter bands closing on ridges, cards in a 2-up grid.
//
// Data and rules are Gold's: usePastPresidentsData (strictly before the selected
// year, newest first, undated last) and Gold's search (name + year). This
// year's president comes from useDignitaryData(4) — the same record
// /dignitary?Type=4 shows. The oldest dated year is marked "First on record"
// (the API has no charter year, so "charter" is never claimed).
// Motion: one ScrollTrigger per card on the track, one batch for the grid, no
// per-card SplitText; nothing is hidden in CSS.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { useClub, usePastPresidentsData } from '../../_shared/data.js'
import { PageHero, Band, SearchField, ResultCount, Portrait, EmptyState, Loading, Button, yearText } from '../kit.jsx'
import {
  gsap, ScrollTrigger, useScene, afterFonts, split, titleIn, parallax, useMedia, headerH,
  onRevert, drawRidge, ridgeY, RIDGE,
} from '../motion.js'
import './PastPresidents.css'

// The day in reverse: tonight's decade first, the club's dawn last.
const TONES = ['night', 'royal', 'violet', 'azure', 'turq', 'gold', 'cran']
// The hill the presidents stand on (night ground), y 16–44 of its box.
const STAND = { base: 30, amp: 14, seed: 3.9, fill: 'var(--hj-ground)', rim: 'rgba(255,255,255,.22)' }
const SINK = 10   // px of each arch buried in the hill

/** Newest-first roll -> contiguous decade groups (the hook sorts by start year, undated last). */
function byDecade(rows) {
  const out = []
  rows.forEach((p) => {
    const d = p.y == null ? null : Math.floor(p.y / 10) * 10
    let g = out[out.length - 1]
    if (!g || g.d !== d) {
      g = { d, key: d == null ? 'undated' : String(d), label: d == null ? 'Year not recorded' : d + 's', items: [] }
      out.push(g)
    }
    g.items.push(p)
  })
  const n = out.length
  out.forEach((g, i) => { g.tone = TONES[n < 2 ? 0 : Math.round((i * (TONES.length - 1)) / (n - 1))] })
  return out
}

function President({ p, first }) {
  const yr = yearText(p.year)
  return (
    <li className="hj-pp-p">
      {p.y != null ? (
        <p className="hj-pp-p__yr" aria-hidden="true">
          <span className="hj-pp-p__o">{p.y}</span><span className="hj-pp-p__f">{p.y}</span>
        </p>
      ) : null}
      {yr ? <p className="hj-pp-p__y">{yr}</p> : null}
      <h3 className="hj-pp-p__n">{p.name || 'Name not recorded'}</h3>
      {first ? <p className="hj-pp-p__mark">First on record</p> : null}
      {/* the name is right above: the portrait is decoration */}
      <div className="hj-pp-p__a" aria-hidden="true"><Portrait src={p.img} name={p.name} alt="" /></div>
    </li>
  )
}

export default function PastPresidents({ data }) {
  const club = useClub()
  const list = usePastPresidentsData(data)      // null while loading; newest first
  const [query, setQuery] = useState('')
  const tall = useMedia('(min-height: 620px)')
  const rootRef = useRef(null)

  const all = list || []
  const q = query.trim().toLowerCase()
  // Gold's filter: name + year label, case-insensitive substring.
  const shown = useMemo(() => (q ? all.filter((p) => (p.name + ' ' + p.year).toLowerCase().indexOf(q) !== -1) : all),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, q])
  const groups = useMemo(() => byDecade(shown), [shown])
  // The oldest dated year on the roll — only a mark worth making when the roll spans more than one year.
  const firstY = useMemo(() => {
    const ys = all.map((p) => p.y).filter((y) => y != null)
    if (!ys.length) return null
    const lo = Math.min(...ys)
    return lo < Math.max(...ys) ? lo : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])
  const shownKey = shown.map((p) => p._i).join(',')

  // ── motion ─────────────────────────────────────────────────────────────────
  useScene(rootRef, (c, ctx) => afterFonts(ctx, () => {
    const jr = rootRef.current && rootRef.current.querySelector('.hj-pp-jr')
    if (!jr) return
    const S = c.fine ? true : 0.8   // Lenis smooths the wheel; touch gets a short catch-up
    if (!(c.wide && tall && horizontal(jr, S))) vertical(jr, ctx, !!q)
  }), [shownKey, tall])

  // DESKTOP: the pinned track. Returns false (and leaves the page vertical) when the roll is too short to travel.
  function horizontal(jr, S) {
    const track = jr.querySelector('.hj-pp-track')
    jr.classList.add('hj-pp-jr--h')
    if (track.offsetWidth < jr.clientWidth * 1.25) { jr.classList.remove('hj-pp-jr--h'); return false }

    const panels = gsap.utils.toArray(track.querySelectorAll('.hj-pp-dec'))
    const cards = gsap.utils.toArray(track.querySelectorAll('.hj-pp-p'))
    const n = panels.length
    const sky = track.querySelector('.hj-pp-sky'), sun = track.querySelector('.hj-pp-sun'), glow = sun.querySelector('b')
    const ground = track.querySelector('.hj-pp-ground')
    const L = [
      { el: track.querySelector('.hj-pp-hl--far'), f: 0.5, o: RIDGE.far },
      { el: track.querySelector('.hj-pp-hl--mid'), f: 0.28, o: RIDGE.mid },
    ]
    let vw = 0, H = 0, tw = 0, dist = 1, starts = [], widths = [], sunS = 0

    onRevert(() => {
      jr.classList.remove('hj-pp-jr--h')
      sky.style.removeProperty('--hj-pp-sky')
      L.map((l) => l.el).concat(ground).forEach((el) => { el.innerHTML = ''; el.style.width = '' })
      cards.forEach((li) => li.style.removeProperty('--hj-pp-stand'))
    })

    // measure; paint the sky (one colour per decade, blended across each border); draw the hills; stand everyone on the ground
    function layout() {
      vw = jr.clientWidth; H = jr.clientHeight; tw = track.offsetWidth; dist = Math.max(1, tw - vw)
      starts = panels.map((p) => p.offsetLeft)
      widths = panels.map((p) => p.offsetWidth)
      const b = Math.round(vw * 0.1), stops = []
      panels.forEach((p, i) => {
        const col = getComputedStyle(p).getPropertyValue('--hj-c').trim()
        stops.push(col + ' ' + (i ? starts[i] + b : 0) + 'px', col + ' ' + (i < n - 1 ? starts[i] + widths[i] - b : tw) + 'px')
      })
      sky.style.setProperty('--hj-pp-sky', 'linear-gradient(90deg,' + stops.join(',') + ')')
      L.forEach((l) => drawRidge(l.el, Math.ceil((1 - l.f) * dist + vw + 60), l.o, true))
      drawRidge(ground, tw, STAND, true)
      const gh = ground.getBoundingClientRect().height, x0 = track.getBoundingClientRect().left
      cards.forEach((li) => {
        const a = li.querySelector('.hj-pp-p__a').getBoundingClientRect()
        li.style.setProperty('--hj-pp-stand', Math.round(gh * (1 - ridgeY(a.left - x0 + a.width / 2, STAND) / 100) - SINK) + 'px')
      })
      sunS = sun.offsetWidth
    }
    layout()

    // velocity: everyone leans into the travel with their feet planted
    const leanTo = gsap.quickTo(cards, 'skewX', { duration: 0.6, ease: 'power3' })
    const settle = gsap.delayedCall(0.14, () => leanTo(0)).pause()
    const react = (self) => {
      leanTo(gsap.utils.clamp(-6, 6, self.getVelocity() / 420))
      settle.restart(true)
    }

    const tl = gsap.timeline({
      defaults: { ease: 'none', duration: 1 },
      scrollTrigger: {
        trigger: jr, pin: true, scrub: S, anticipatePin: 1, invalidateOnRefresh: true,
        start: () => 'top ' + headerH(),
        end: () => { layout(); return '+=' + dist },
        onUpdate: react,
      },
    })
    tl.to(track, { x: () => -dist }, 0)
    // two depths of hills behind the ground: the far one drifts slowest
    L.forEach((l) => tl.to(l.el, { x: () => l.f * dist }, 0))
    // walking back towards the club's dawn the sun comes UP: hidden under tonight's hill, climbs low over
    // the middle decades, and ends low and orange over the first years
    tl.fromTo(sun, { x: () => vw * 0.3 - sunS / 2 }, { x: () => dist + vw * 0.82 - sunS / 2 }, 0)
      .fromTo(sun, { y: () => H * 1.02 }, { y: () => H * 0.6 - sunS / 2, duration: 0.5, ease: 'sine.out' }, 0)
      .fromTo(sun, { y: () => H * 0.6 - sunS / 2 }, { y: () => H * 0.7 - sunS / 2, duration: 0.5, ease: 'sine.in', immediateRender: false }, 0.5)
      .fromTo(glow, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.7)

    const ca = (trigger, start, end) => ({ trigger, containerAnimation: tl, start, end, scrub: S, invalidateOnRefresh: true })
    // what is already on screen when the pin starts arrives with the climb instead of the travel
    const approach = () => ({ trigger: jr, start: 'top 88%', end: () => 'top ' + (headerH() + 30), scrub: S })

    // images inside the clipped track never reach lazy-load range until they slide in
    track.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = 'eager' })

    // decades: titles skew in against the travel; the giant outlined decade drifts behind the hills
    panels.forEach((p, i) => {
      const num = p.querySelector('.hj-band__num')
      if (num) gsap.fromTo(num, { x: () => vw * 0.22 }, { x: () => -vw * 0.22, scrollTrigger: ca(p, 'left right', 'right left') })
      const h = p.querySelector('.hj-pp-dec__t'), s = split(h), cnt = p.querySelector('.hj-pp-dec__c')
      if (i === 0) {
        gsap.fromTo(s ? s.chars : h, { yPercent: 110, skewY: 10, opacity: 0 }, { yPercent: 0, skewY: 0, opacity: 1, stagger: 0.05, ease: 'power3.out', scrollTrigger: approach() })
        gsap.fromTo(cnt, { y: 30, opacity: 0 }, { y: 0, opacity: 1, ease: 'power2.out', scrollTrigger: approach() })
        const moon = p.querySelector('.hj-pp-moon')
        if (moon) gsap.fromTo(moon, { yPercent: 140, scale: 0.7 }, { yPercent: 0, scale: 1, ease: 'power2.out', scrollTrigger: approach() })
        return
      }
      gsap.fromTo(s ? s.chars : h, { xPercent: 150, skewX: -30, scale: 1.3, opacity: 0 }, { xPercent: 0, skewX: 0, scale: 1, opacity: 1, ease: 'power3.out', stagger: 0.04, scrollTrigger: ca(h, 'left 100%', 'left 45%') })
      gsap.fromTo(cnt, { x: 120, opacity: 0 }, { x: 0, opacity: 1, ease: 'power2.out', scrollTrigger: ca(h, 'left 100%', 'left 55%') })
    })

    // presidents: ONE scrubbed timeline each — the arch rises open out of the hill, the photo settles,
    // the year slides in and fills with gold, the name follows. The last cards never travel to 38%
    // (the track stops first), so they finish just before the travel ends (16px early) - else the oldest years stayed half-filled
    const x0 = track.getBoundingClientRect().left
    cards.forEach((li) => {
      const a = li.querySelector('.hj-arch'), img = a && a.querySelector('img')
      const yr = li.querySelector('.hj-pp-p__yr'), f = li.querySelector('.hj-pp-p__f')
      const txt = li.querySelectorAll('.hj-pp-p__y, .hj-pp-p__n, .hj-pp-p__mark')
      const onScreen = li.getBoundingClientRect().left - x0 < vw * 0.95
      const t = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: onScreen ? approach() : ca(li, 'left 100%', () => 'left ' + Math.max(38, (li.getBoundingClientRect().left - track.getBoundingClientRect().left - dist + 16) / vw * 100).toFixed(2) + '%') })
      if (a) t.fromTo(a, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.6, ease: 'power2.out' }, 0)
      if (img) t.fromTo(img, { scale: 1.4 }, { scale: 1, duration: 1 }, 0)
      if (yr) t.fromTo(yr, { x: 120 }, { x: 0, duration: 1, ease: 'power2.out' }, 0)
      if (f) t.fromTo(f, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7 }, 0.3)
      if (txt.length) t.fromTo(txt, { x: 70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, stagger: 0.08, ease: 'power2.out' }, 0.15)
    })
    return true
  }

  // PHONES, SHORT WINDOWS, SHORT ROLLS: decades as stacked chapter bands, lighter effects
  function vertical(jr, ctx, filtering) {
    jr.querySelectorAll('.hj-pp-dec').forEach((p) => {
      titleIn(p.querySelector('.hj-pp-dec__t'))
      parallax(p.querySelector('.hj-band__num'), { trigger: p })
    })
    const moon = jr.querySelector('.hj-pp-moon')
    if (moon) gsap.fromTo(moon, { yPercent: 90, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: moon.closest('.hj-pp-dec'), start: 'top 85%', end: 'top 25%', scrub: true } })

    // one batch for every card. While searching only cards below the fold animate, so what you are
    // looking at re-flows instantly; on a fresh roll everything from the screen down does.
    const fold = window.innerHeight * 0.92
    const cards = gsap.utils.toArray(jr.querySelectorAll('.hj-pp-p')).filter((el) => {
      const r = el.getBoundingClientRect()
      return filtering ? r.top > fold : r.bottom > 0
    })
    if (!cards.length) return
    const archOf = (el) => el.querySelector('.hj-arch')
    const fillOf = (el) => el.querySelector('.hj-pp-p__f')
    gsap.set(cards, { y: 40, opacity: 0 })
    gsap.set(cards.map(archOf), { clipPath: 'inset(100% 0% 0% 0%)' })
    const fills = cards.map(fillOf).filter(Boolean)
    if (fills.length) gsap.set(fills, { clipPath: 'inset(0% 100% 0% 0%)' })
    ScrollTrigger.batch(cards, {
      start: 'top 92%',
      once: true,
      // ctx.add: tweens made later still belong to this scene and revert with it
      onEnter: (batch) => ctx.add(() => {
        const o = { stagger: 0.07, overwrite: true }
        gsap.to(batch, { ...o, y: 0, opacity: 1, duration: 0.9, ease: 'expo.out', clearProps: 'transform,opacity' })
        gsap.to(batch.map(archOf), { ...o, clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2, delay: 0.08, ease: 'expo.out', clearProps: 'clipPath' })
        const f = batch.map(fillOf).filter(Boolean)
        if (f.length) gsap.to(f, { ...o, clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1, delay: 0.35, ease: 'power2.inOut', clearProps: 'clipPath' })
        const imgs = batch.map((el) => el.querySelector('.hj-arch img')).filter(Boolean)
        if (imgs.length) gsap.fromTo(imgs, { scale: 1.35 }, { scale: 1, duration: 1.6, ease: 'expo.out', stagger: 0.07, clearProps: 'transform,scale' })
      }),
    })
  }

  const clear = () => {
    setQuery('')
    const input = rootRef.current && rootRef.current.querySelector('.hj-search input')
    if (input) input.focus()
  }


  return (
    <div className="hj-page hj-pp" ref={rootRef}>
      <PageHero tone="night" title="Past presidents">
        {all.length > 4 ? (
          <div className="hj-pp-find">
            <SearchField value={query} onChange={setQuery} label="Search past presidents by name or year" placeholder="Search by name or year" />
            <ResultCount count={shown.length} total={all.length} noun="president" />
          </div>
        ) : null}
      </PageHero>

      {list === null ? (
        <div className="hj-wrap hj-sec"><Loading label="Loading past presidents" /></div>
      ) : shown.length === 0 ? (
        <div className="hj-wrap hj-sec">
          <EmptyState
            night
            title={all.length ? 'No match' : 'No roll of honour yet'}
            message={all.length ? 'Nobody on the roll of honour matches “' + query.trim() + '”.' : 'Past presidents for the years before this one will appear here once the club files them.'}
            action={all.length ? <Button variant="ink" onClick={clear}>Clear search</Button> : null}
          />
        </div>
      ) : (
        <div className="hj-pp-jr">
          <div className="hj-pp-track">
            <div className="hj-pp-sky" aria-hidden="true" />
            <div className="hj-pp-sun" aria-hidden="true"><b /></div>
            <svg className="hj-pp-hl hj-pp-hl--far" aria-hidden="true" focusable="false" />
            <svg className="hj-pp-hl hj-pp-hl--mid" aria-hidden="true" focusable="false" />
            {groups.map((g, i) => (
              <Band key={g.key} tone={g.tone} className="hj-pp-dec" labelledBy={'hj-pp-d-' + g.key}
                    next={groups[i + 1] ? 'var(--hj-' + groups[i + 1].tone + ')' : 'var(--hj-ground)'}
                    num={g.d == null ? null : g.label}>
                {i === 0 && g.tone === 'night' ? (
                  <>
                    <span className="hj-stars hj-pp-stars" aria-hidden="true" />
                    <span className="hj-moon hj-pp-moon" aria-hidden="true" />
                  </>
                ) : null}
                <div className="hj-pp-dec__hd">
                  <h2 className="hj-h2 hj-pp-dec__t" id={'hj-pp-d-' + g.key}>{g.label}</h2>
                  <p className="hj-pp-dec__c">{g.items.length} {g.items.length === 1 ? 'president' : 'presidents'}</p>
                </div>
                <ol className="hj-pp-list">
                  {g.items.map((p) => <President key={p._i} p={p} first={firstY != null && p.y === firstY} />)}
                </ol>
              </Band>
            ))}
            <svg className="hj-pp-ground" aria-hidden="true" focusable="false" />
          </div>
        </div>
      )}

      {/* night runs on into the footer's night: no white spacer */}
      <div className="hj-endpad hj-pp-end" aria-hidden="true" />
    </div>
  )
}
