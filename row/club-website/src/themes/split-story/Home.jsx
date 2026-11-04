'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story — home. The sample's page (hero with the iris-open banner, the
// split story with its sticky chapter panel, the gold meeting band) on
// useHomeData, for any club: every chapter is built from live data and simply
// is not rendered when the club has nothing for it. Two chapters the sample
// did not have come from the same hook: the next event, and the club's notices
// (advertisements).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useClub, useHomeData, usePageTitle, withYear, plainText, adAnchorProps } from '../_shared/data.js'
import { useScene, useRefreshOnImages, gsap, riseIn, blurWords, irisIn, lockScroll, motionOn } from './motion.js'
import {
  Split, Chapter, StatStack, Timeline, TimelineItem, WipeList, WipeRow, Slider,
  PersonCard, TextLink, Button, Chevron, SafeImg, imgFallback, excerpt, charterYear, yearText, htmlText,
} from './kit.jsx'
import './home.css'

const AD_PLACEHOLDER = /ClubAdvirtisment\.png$/i
const NOT_AVAILABLE = 'Not available'
/** A designation short enough for ONE line on a leader card (client, 2026-10-06): no trailing Rotary year (the page
 *  is already for that year), and "Rotary International" as RI - "President, Rotary International 2026-27" -> "RI President". */
const shortRole = (role) => {
  const r = String(role || '').replace(/\s*\(?\d{4}\s*[-–]\s*\d{2,4}\)?\s*$/, '').trim()
  if (/^president,?\s*rotary international$/i.test(r)) return 'RI President'
  return r.replace(/rotary international/ig, 'RI')
}

/** The club's own about text, cut for the home: a lead sentence, two short
 *  paragraphs, and the charter year when the text states one. */
function storyOf(html) {
  // Block by block, so a title line ("… – An overview", no full stop) is dropped
  // instead of running into the first sentence.
  const blocks = String(html || '').split(/<\/(?:p|h[1-6]|div|li)>|<br\s*\/?>/i).map(htmlText).filter(Boolean)
  if (blocks.length > 1 && blocks[0].length < 100 && !/[.!?:]$/.test(blocks[0])) blocks.shift()
  const text = blocks.join(' ')
  if (!text) return null
  // "held at Mr. Bhoomreddi's" is one sentence: no break after a title abbreviation.
  const sentences = text.split(/(?<=[.!?])(?<!\b(?:Mr|Mrs|Ms|Dr|Rtn|PP|St|No|Smt|Shri|Pvt)\.)\s+(?=[A-Z0-9"“‘(])/).map((s) => s.trim()).filter(Boolean)
  const lead = excerpt(sentences[0], 240)
  const rest = sentences.slice(1)
  const body = []
  let len = 0
  for (const s of rest) {
    if (body.length && (len + s.length > 720 || body.length >= 6)) break
    body.push(s)
    len += s.length
  }
  const mid = Math.ceil(body.length / 2)
  const paras = [body.slice(0, mid).join(' '), body.slice(mid).join(' ')].filter(Boolean).map((p) => excerpt(p, 520))
  return { lead, paras, charter: charterYear(html) }
}

const AD_MS = 5000

/** The club's advertisements in a popup (client, 2026-10-05, as on photo-collage): opens 2.6s after the home
 *  loads (waits while the menu is open), steps through them every 5s, Esc / backdrop / x closes it. */
function AdPopup({ ads, clubId, onDone }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  const n = ads.length
  // opens straight away (2026-10-06: the 2.6s wait made the whole banner sequence feel slow) - as soon as the
  // first ad's picture has downloaded, so the card is never empty (1.5s cap); still waits while the menu is open
  useEffect(() => {
    if (!n) return undefined
    let t = 0, done = false
    const arm = (ms) => { clearTimeout(t); t = setTimeout(() => (document.documentElement.classList.contains('spl-menu-open') ? arm(400) : setOpen(true)), ms) }
    const go = () => { if (!done) { done = true; arm(0) } }
    const im = new Image()
    im.onload = go; im.onerror = go
    im.src = ads[0].img
    if (im.complete) go()
    const cap = setTimeout(go, 1500)
    return () => { clearTimeout(t); clearTimeout(cap); im.onload = im.onerror = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, clubId])
  useEffect(() => {
    const dlg = ref.current
    if (!open || !dlg) return undefined
    const back = document.activeElement
    if (!dlg.open) dlg.showModal()
    lockScroll(true)
    return () => { lockScroll(false); if (back && back.isConnected && back.focus) back.focus({ preventScroll: true }) }
  }, [open])
  useEffect(() => {
    if (!open || n < 2 || hold || !motionOn()) return undefined
    const t = setInterval(() => setI((k) => (k + 1) % n), AD_MS)
    return () => clearInterval(t)
  }, [open, n, hold])
  if (!n || !open) return null
  const k0 = i % n, ad = ads[k0]
  const name = ad.title || 'Advertisement ' + (k0 + 1)
  const linked = ad.url && ad.url !== '#'
  const img = <img key={ad.img} className="spl-adpop-img" src={ad.img} data-fallbacks={ad.fallbacks || ''} alt={linked ? '' : name} decoding="async" onError={imgFallback} />
  const close = () => { setOpen(false); if (onDone) onDone() }
  return (
    <dialog ref={ref} className="spl-adpop" aria-label="Advertisement" onClose={close} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <button type="button" className="spl-adpop-x" onClick={close}><span aria-hidden="true">&times;</span><span className="spl-sr">Close advertisement</span></button>
      <div className="spl-adpop-in" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
        <div className="spl-adpop-card">
          {linked ? <a className="spl-adpop-link" href={ad.url} {...adAnchorProps(ad.url)}>{img}<span className="spl-sr">{name} (opens in a new tab)</span></a> : img}
        </div>
        {n > 1 ? (
          <div className="spl-adpop-ctrl" role="group" aria-label="Advertisements">
            <button type="button" className="spl-adpop-step" onClick={() => setI((k) => (k - 1 + n) % n)}><Chevron dir="left" /><span className="spl-sr">Previous advertisement</span></button>
            {ads.map((x, k) => (
              <button key={k} type="button" className="spl-adpop-dot" aria-current={k === k0 ? 'true' : 'false'} onClick={() => setI(k)}><i /><span className="spl-sr">Show advertisement {k + 1}</span></button>
            ))}
            <button type="button" className="spl-adpop-step" onClick={() => setI((k) => (k + 1) % n)}><Chevron dir="right" /><span className="spl-sr">Next advertisement</span></button>
          </div>
        ) : null}
      </div>
    </dialog>
  )
}

export default function Home({ data }) {
  const club = useClub()
  const d = useHomeData(data.home, { newsletterTake: 4 })
  const root = useRef(null)
  const name = club.clubDisplayName
  usePageTitle(name)

  const loaded = d.banners.length > 0          // first fetch done (banners always get a fallback)
  const year = yearText(club.selectedYearLabel)
  const yStart = parseInt(String(club.selectedYearLabel || ''), 10) || 0

  const story = useMemo(() => storyOf(d.about && d.about.content), [d.about])
  const n = d.impactNumbers
  const members = d.membershipStats[0] ? d.membershipStats[0].value : 0
  const stats = [   // order (client, 2026-10-27): projects, cost, beneficiaries, man hours, members
    { label: 'Projects', value: n.projects },
    { label: 'Total project cost', value: n.totalCost, fmt: 'moneyFull', currency: n.currency || club.currency }, // full amount, no L / Cr / M (client, 2026-10-06)
    { label: 'Beneficiaries', value: n.beneficiaries },
    { label: 'Man hours', value: n.manHours },
    { label: 'Members', value: members },
  ].filter((s) => s.value > 0)
  const projects = d.featured.slice(0, 6)
  const leaders = d.leaders.filter((l) => l.name && l.name !== NOT_AVAILABLE)
  const ev = d.events[0] || null
  const news = d.newsletters.filter((x) => x.url)
  const ads = d.ads.filter((a) => a.img && !AD_PLACEHOLDER.test(a.img))
  const numbersSub = year ? 'Rotary year ' + year : ''
  const { meetingDay, meetingTime, meetingVenue, mapUrl } = d
  const facts = [['Day', meetingDay], ['Time', meetingTime], ['Venue', meetingVenue]].filter(([, v]) => v && v !== '—')

  const chapters = [
    // the client's order (2026-10-05): impact, leaders, the next event, story, projects, then newsletters + notices
    stats.length && 'Our Impact', leaders.length && 'Our leaders', ev && 'Upcoming events', story && 'Our story', projects.length && 'Our projects',
    news.length && 'Newsletters', facts.length && 'Where we meet',   // notices -> popup; the meeting takes their place (client, 2026-10-05)
  ].filter(Boolean)
  const dataKey = [club.selectedYearId, d.banners.length, story ? story.lead : '', stats.length, projects.length, ev ? ev.id : 0, leaders.length, news.length, ads.length].join('|')


  useRefreshOnImages(root, [dataKey])

  // Hero: its own scene, so the home data landing later never replays the name's entrance.
  useScene(root, (c, ctx) => {
    if (club.loading) return
    const r = root.current
  }, [club.loading, name, club.selectedYearId])

  // ── the banner: a small dot on load; once the ads popup is closed (or ~1s in when the club has no ads) the
  //    dot opens to the WHOLE picture by itself - no scrolling needed (client, 2026-10-05). circle(72%) reaches
  //    every corner of any rectangle; the clip is then cleared, so the banner is plain afterwards.
  const [bannerGo, setBannerGo] = useState(false)
  const opened = useRef(false)
  const nAds = ads.length
  useEffect(() => {
    if (!loaded) return undefined
    // no ads: open shortly after load; with ads, the popup's close opens it (a safety net in case it never shows)
    const t = setTimeout(() => setBannerGo(true), nAds ? 12000 : 400)
    return () => clearTimeout(t)
  }, [loaded, nAds])
  useLayoutEffect(() => {
    const frame = root.current && root.current.querySelector('.spl-home-hero .spl-frame')
    if (!frame || opened.current) return undefined
    if (!motionOn()) { opened.current = true; return undefined }
    if (!bannerGo) { gsap.set(frame, { clipPath: 'circle(1.6% at 50% 50%)' }); return undefined }
    opened.current = true
    // faster and cleaner (2026-10-06): 0.9s, quick out of the dot then settling, and only once the shown banner's
    // picture is ready (opening onto a still-empty frame looked wrong)
    let tw = null, alive = true
    const open = () => { if (alive) tw = gsap.fromTo(frame, { clipPath: 'circle(1.6% at 50% 50%)' }, { clipPath: 'circle(72% at 50% 50%)', duration: 0.9, ease: 'expo.out', clearProps: 'clipPath' }) }
    const img = frame.querySelector('.is-on img, img')
    if (!img || (img.complete && img.naturalWidth)) open()
    else { img.addEventListener('load', open, { once: true }); img.addEventListener('error', open, { once: true }) }
    return () => { alive = false; if (img) { img.removeEventListener('load', open); img.removeEventListener('error', open) } if (tw) tw.kill(); gsap.set(frame, { clearProps: 'clipPath' }) }
  }, [bannerGo, loaded])

  useScene(root, (c, ctx) => {
    const r = root.current
    blurWords(ctx, r.querySelector('.spl-home-story .spl-lead'))
    irisIn(r.querySelector('.spl-home-ev-photo'))
    // the leaders start as one pile in the middle of the row and deal out into it as you scroll (client, 2026-10-05)
    const row = r.querySelector('.spl-home-deal')
    const cards = row ? [...row.querySelectorAll('.spl-home-leader')] : []
    if (cards.length > 1) {
      gsap.matchMedia().add('(min-width: 760px) and (prefers-reduced-motion: no-preference)', () => {
        // towards the middle of the grid, both ways (two cards a row -> two rows)
        const toPile = (el, axis) => {
          const rb = row.getBoundingClientRect(), b = el.getBoundingClientRect()
          return axis === 'x' ? rb.left + rb.width / 2 - (b.left + b.width / 2) : rb.top + rb.height / 2 - (b.top + b.height / 2)
        }
        cards.forEach((el, i) => {
          gsap.fromTo(el, { x: () => toPile(el, 'x'), y: () => toPile(el, 'y') - i * 6, rotation: (i % 2 ? 1 : -1) * (4 + i * 2), zIndex: cards.length - i }, {
            x: 0, y: 0, rotation: 0, ease: 'none',
            scrollTrigger: { trigger: row, start: 'top 88%', end: 'clamp(top 38%)', scrub: 0.6, invalidateOnRefresh: true },
          })
        })
      })
    }
  }, [dataKey])

  return (
    <div className="spl-home" ref={root}>
      <section className="spl-home-hero spl-on-dark" aria-labelledby="spl-home-name">
        {/* the club name stays the page's h1 for screen readers / search, but is not shown; no district (client, 2026-10-05) */}
        <h1 className="spl-sr" id="spl-home-name" key={name}>{name}</h1>
        <Slider key={club.selectedYearId || 0} label="Club banners" itemLabel="banner" pause={false} fit="auto"
                slides={d.banners.map((b, i) => ({ src: b.src, fallbacks: b.fallbacks, url: b.url, alt: b.title || name + ' banner ' + (i + 1) + ' of ' + d.banners.length }))} />
      </section>

      {loaded && chapters.length > 0 ? (
        <Split rail={chapters} deps={[dataKey]}>
          {stats.length ? (
            <Chapter id="spl-ch-numbers" title="Our Impact"
                     state={{ value: stats[0].value, fmt: stats[0].fmt || 'group', currency: stats[0].currency, caption: stats[0].label, sub: numbersSub }}>
              <div className="spl-wrap"><StatStack items={stats} panel={{ title: 'Our Impact', sub: numbersSub }} grid /></div>
            </Chapter>
          ) : null}

          {leaders.length ? (
            <Chapter id="spl-ch-leaders" title="Our leaders" className="spl-home-leaders"
                     state={year ? { value: year, caption: 'Rotary year' } : { value: leaders.length, fmt: 'pad', caption: 'Leaders' }}>
              <div className="spl-wrap">
                {/* no bio and no board link; a Read more on each card (client, 2026-10-05) */}
                <ul className={'spl-home-deal' + (leaders.length === 1 ? ' is-one' : '')} style={{ '--n': leaders.length }}>
                  {leaders.map((l) => (
                    <li className="spl-home-leader" key={l.type} style={{ '--rl': Math.max(12, Array.from(shortRole(l.role)).length) }}>
                      <PersonCard name={l.name} role={shortRole(l.role)} img={l.img} more="Read more"
                                  href={withYear('/dignitary?Type=' + (l.type || 1), club.selectedYearId)} />
                    </li>
                  ))}
                </ul>
              </div>
            </Chapter>
          ) : null}

          {ev ? (
            <Chapter id="spl-ch-next" title="Upcoming events"
                     state={{ value: parseInt(ev.day, 10) || ev.day, from: 1, fmt: 'pad', caption: ev.mon + ' ' + ev.year, sub: ev.time || '' }}>
              <div className="spl-wrap">
                <article className="spl-home-ev spl-on-dark">
                  {ev.img ? <div className="spl-home-ev-photo"><SafeImg src={ev.img} alt="" width="1200" height="675" /></div> : null}
                  <div className="spl-home-ev-body">
                    <p className="spl-home-ev-date"><span className="spl-home-ev-day">{ev.day}</span><span className="spl-home-ev-mon">{ev.mon} {ev.year}</span></p>
                    <h3 className="spl-home-ev-title">{ev.title}</h3>
                    <p className="spl-home-ev-meta">{[ev.time, ev.venue].filter(Boolean).join(' · ')}</p>
                    {ev.desc ? <p className="spl-home-ev-desc">{excerpt(plainText(ev.desc), 240)}</p> : null}
                    <div className="spl-home-ev-actions">
                      <Button href={'/event?id=' + ev.id} variant="gold">Event details</Button>
                      <Button href="/events" variant="light">All events</Button>
                    </div>
                  </div>
                </article>
              </div>
            </Chapter>
          ) : null}

          {story ? (
            <Chapter id="spl-ch-story" title="Our story" className="spl-home-story"
                     state={story.charter ? { value: story.charter, from: story.charter - 25, fmt: 'plain', caption: 'Chartered in ' + story.charter }
                       : { value: yStart || '', fmt: 'plain', caption: year ? 'Rotary year ' + year : '' }}>
              <div className="spl-wrap">
                <p className="spl-lead" key={story.lead}>{story.lead}</p>
                <div className="spl-home-prose">{story.paras.map((p, i) => <p key={i}>{p}</p>)}</div>
                <TextLink href="/about">Read our full story</TextLink>
              </div>
            </Chapter>
          ) : null}

          {projects.length ? (
            <Chapter id="spl-ch-projects" title="Our projects"
                     state={{ value: 1, fmt: 'pad', caption: projects[0].avenueLabel || 'Project', sub: '1 of ' + projects.length }}>
              <div className="spl-wrap">
                <Timeline watch={dataKey}>
                  {projects.map((p, i) => {
                    const title = plainText(p.title)
                    const desc = excerpt(plainText(p.desc), 200)
                    return (
                      <TimelineItem key={p.id} tag={p.avenueLabel} photo={p.img} title={title}
                                    state={{ title: 'Our projects', value: i + 1, from: i, fmt: 'pad', caption: p.avenueLabel || 'Project', sub: (i + 1) + ' of ' + projects.length }}>
                        {desc ? <p className="spl-tl-desc">{desc}</p> : null}
                        <TextLink href={withYear('/project?pid=' + p.id, club.selectedYearId)}>View project<span className="spl-sr">: {title}</span></TextLink>
                      </TimelineItem>
                    )
                  })}
                </Timeline>
                <div className="spl-home-more"><Button href="/projects" variant="ghost">See all projects</Button></div>
              </div>
            </Chapter>
          ) : null}

          {news.length ? (
            <Chapter id="spl-ch-news" title="Newsletters"
                     state={{ value: news.length, fmt: 'pad', caption: news.length === 1 ? 'Latest issue' : 'Latest issues', sub: numbersSub }}>
              <div className="spl-wrap">
                <WipeList watch={dataKey}>
                  {news.map((x, i) => (
                    <WipeRow key={i} href={x.url} external title={x.title} meta={x.date} cta="Read newsletter" srHint=" (opens in a new tab)" />
                  ))}
                </WipeList>
                <div className="spl-home-more"><TextLink href="/newsletters">All newsletters</TextLink></div>
              </div>
            </Chapter>
          ) : null}

          {/* "Where we meet" is titled by the LEFT panel like every chapter (client, 2026-10-06). It is at least a screen
              tall (home.css) so the panel switches to it and stays whole while it is in view - short, it ended the split
              (and so scrolled the panel, title first, off the top) as soon as it arrived. */}
          {facts.length ? (
            <Chapter id="spl-ch-meet" title="Where we meet" className="spl-home-meet"
                     state={{ value: '', caption: '', sub: '' }}>{/* the panel shows only the heading - day / time are in the card (client, 2026-10-06) */}
              <div className="spl-wrap">
                <dl className="spl-facts">
                  {facts.map(([k, v]) => <div key={k} className={k === 'Venue' ? 'is-long' : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
                <div className="spl-home-meet-actions">
                  {meetingVenue && meetingVenue !== '—' && mapUrl ? <Button href={mapUrl} external variant="royal">Open in maps</Button> : null}
                  <Button href="/about" variant="ghost">About the club</Button>
                </div>
              </div>
            </Chapter>
          ) : null}
        </Split>
      ) : null}

      <AdPopup ads={ads} clubId={club.clubId} onDone={() => setBannerGo(true)} />
    </div>
  )
}
