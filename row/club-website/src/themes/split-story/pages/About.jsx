'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story · About. The club's own words are told as chapters beside the
// sticky royal panel: Our story (crest, a lead line, the admin HTML), Where we
// meet (a royal ticket with the day's letters rising), Leadership (president and
// secretary portraits opening by iris and wipe), Contact (gold wipe rows). While
// the story is read the panel's gold figure counts up to the charter year from
// 25 years earlier. The page closes on a gold band with onward links.
// Data: useAboutData() only (goldData.useAboutGold), the same fields Gold shows.
// Chapters with no data are not rendered.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import {
  useClub, useAboutData, usePageTitle, useCurrentMenuName, media, withYear, plainText,
  externalUrl, socialLabel,
} from '../../_shared/data.js'
import {
  PageHero, Split, Chapter, fig, PersonCard, WipeList, WipeRow, GoldBand, Button, EmptyState, Loading,
  Arrow, excerpt, charterYear, yearText,
} from '../kit.jsx'
import { useScene, useRefreshOnImages, gsap, blurWords, irisIn, photosIn, titleOnScroll, revealBatch } from '../motion.js'
import './About.css'

const trim = (v) => (v == null ? '' : String(v).trim())
const pad = (n) => String(n).padStart(2, '0')

const ONWARD = [
  { href: '/directors', label: 'Board of directors' },
  { href: '/projects', label: 'Projects' },
  { href: '/past-presidents', label: 'Past presidents' },
]

const INLINE = /^(B|STRONG|EM|I|U|SPAN|FONT|SMALL|MARK|SUP|SUB)$/
/**
 * The admin HTML with its opening paragraph split off as the lead, but only when
 * that is safe: a short <p> of plain or inline-styled text. Otherwise the lead is
 * empty and the prose is the whole HTML. Admin <h1>s become <h2>s (the hero owns
 * the page's only h1). DOMParser builds an inert document: nothing loads or runs.
 */
function splitLead(html) {
  const out = { lead: '', rest: html ? String(html).replace(/<(\/?)h1\b/gi, '<$1h2') : '' }
  if (!out.rest || typeof DOMParser === 'undefined') return out
  const body = new DOMParser().parseFromString(out.rest, 'text/html').body
  const skip = []
  let first = null
  for (const n of body.childNodes) {
    const blank = n.nodeType === 8 || (n.nodeType === 3 && !n.textContent.trim())
      || (n.nodeType === 1 && (n.tagName === 'BR' || (n.tagName === 'P' && !n.textContent.trim() && !n.querySelector('img,iframe,video,table'))))
    if (!blank) { first = n; break }
    skip.push(n)
  }
  if (!first || first.nodeType !== 1 || first.tagName !== 'P') return out
  if ([...first.querySelectorAll('*')].some((e) => !INLINE.test(e.tagName))) return out
  const text = first.textContent.replace(/\s+/g, ' ').trim()
  if (text.length < 12 || text.length > 240) return out
  skip.forEach((n) => n.remove())
  first.remove()
  const empty = !body.textContent.trim() && !body.querySelector('img,iframe,video,table')
  return { lead: text, rest: empty ? '' : body.innerHTML.trim() }
}

/** Club email / phone (as Gold shows them, now as links) and socials, one row each. */
function contactRows(d) {
  const rows = []
  trim(d.email).split(/[,;\s]+/).filter((e) => e.includes('@'))
    .forEach((e) => rows.push({ kind: 'Email', title: e, meta: 'Email', href: 'mailto:' + e, cta: 'Write to us' }))
  trim(d.phone).split(/\s*[,;/|]\s*/).map(trim).forEach((p) => {
    const tel = p.replace(/[^\d+]/g, '')
    if (tel.replace(/\D/g, '').length >= 6) rows.push({ kind: 'Phone', title: p, meta: 'Phone', href: 'tel:' + tel, cta: 'Call' })
  })
  ;(d.socials || []).forEach((s) => {
    const url = externalUrl(s.linkUrl)
    if (!url) return
    const key = trim(s.platform).toLowerCase()
    const label = socialLabel(key)
    const short = excerpt(url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[?#].*$/, '').replace(/\/+$/, ''), 48)
    rows.push({ kind: label, title: label, meta: short, href: url, cta: key === 'web' || key === 'website' ? 'Visit' : 'Follow', external: true })
  })
  return rows
}

/** The club's crest on a white plate inside an orbit; gone entirely if the file fails. */
function Crest({ src, alt }) {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  return (
    <div className="spl-about-crest">
      <span className="spl-about-crest-orbit" aria-hidden="true"><i /></span>
      <div className="spl-about-crest-plate">
        <img src={src} alt={alt} width="240" height="240" decoding="async" onError={() => setOk(false)} />
      </div>
    </div>
  )
}

export default function About({ data }) {
  const club = useClub()
  const d = useAboutData(data)
  const menuName = useCurrentMenuName()
  const title = trim(menuName) || 'About Us'
  usePageTitle(title)
  const ref = useRef(null)

  const name = trim(club.clubDisplayName)
  const year = yearText(club.selectedYearLabel)
  const story = useMemo(() => splitLead(d.html), [d.html])
  const charter = useMemo(() => charterYear(d.html), [d.html])

  const meet = { day: trim(d.meetingDay), time: trim(d.meetingTime), venue: trim(d.meetingVenue) }
  const hasMeet = !!(meet.day || meet.time || meet.venue)
  const people = [[d.president, 4], [d.secretary, 5]]
    .filter(([p], i, a) => p && trim(p.memberName) && a.findIndex(([q]) => q === p) === i)
    .map(([p, type]) => ({
      type, name: trim(p.memberName), role: trim(p.designation) || (type === 4 ? 'President' : 'Secretary'),
      img: media(p.profilePhotoPath), bio: excerpt(plainText(p.memberIntroduction), 200),
    }))
  const contact = d.loading ? [] : contactRows(d)

  // Panel states (see DESIGN.md §5). A chapter opens on its first item's state so the panel does not flicker.
  const storyState = charter
    ? { value: charter, from: charter - 25, fmt: 'plain', caption: 'Chartered in ' + charter, sub: name }
    : { value: year, caption: year ? 'Rotary year' : '', sub: name }
  const meetState = { value: meet.day || meet.time, caption: meet.day ? meet.time : '', sub: excerpt(meet.venue, 90) }
  const peopleStates = people.map((p, i) => (year
    ? { title: 'Leadership', value: year, caption: p.role, sub: p.name }
    : { title: 'Leadership', value: i + 1, from: i, fmt: 'pad', caption: p.role, sub: p.name }))
  const ways = contact.length + (contact.length === 1 ? ' way' : ' ways') + ' to reach the club'
  const contactStates = contact.map((r, i) => ({ title: 'Contact', value: i + 1, from: i, fmt: 'pad', caption: r.kind, sub: ways }))

  // no "Where we meet" chapter and no "Explore the club" band (client, 2026-10-05)
  const rail = ['Our story', people.length > 0 && 'Leadership', contact.length > 0 && 'Contact'].filter(Boolean)
  const dataKey = [
    club.selectedYearId, d.loading, (d.html || '').length, d.logo, meet.day, meet.time, meet.venue,
    people.map((p) => p.name).join(','), contact.map((r) => r.href).join(','),
  ].join('|')

  useRefreshOnImages(ref, [dataKey])
  useScene(ref, (c, ctx) => {
    if (d.loading) return
    const r = ref.current
    const spin = (el, trigger) => {
      if (el) gsap.to(el, { rotation: 360, ease: 'none', scrollTrigger: { trigger: trigger || el, start: 'top bottom', end: 'bottom top', scrub: 1 } })
    }
    blurWords(ctx, r.querySelector('.spl-about-lead'))
    irisIn(r.querySelector('.spl-about-crest-plate'), { start: 'top 98%', end: 'top 55%' })
    spin(r.querySelector('.spl-about-crest-orbit'))
    titleOnScroll(ctx, r.querySelector('.spl-about-day'))
    spin(r.querySelector('.spl-about-ticket-orbit'), r.querySelector('.spl-about-ticket'))
    photosIn(r.querySelectorAll('.spl-about-people .spl-person-photo'))
    // the anchors, not the <li>s: the li carries the panel marker, whose top must not be offset
    revealBatch(r.querySelectorAll('.spl-about-contact .spl-row'), { y: 24 })
  }, [dataKey])

  return (
    <div className="spl-about" ref={ref}>
      <PageHero title={title} eyebrow={name || undefined}
                lead={year ? 'A member club of Rotary International, serving through the ' + year + ' Rotary year.' : undefined} />

      {d.loading ? <Loading label="Loading the club’s story" /> : (
        <>
          <Split rail={rail} deps={[dataKey]}>
            <Chapter id="spl-about-story" title="Our story" className="spl-about-story" state={storyState}>
              <div className="spl-wrap">
                {d.logo ? <Crest key={d.logo} src={d.logo} alt={(name || 'Club') + ' logo'} /> : null}
                {story.lead ? <p className="spl-lead spl-about-lead" key={story.lead}>{story.lead}</p> : null}
                {/* Trusted admin rich HTML (already wrappableHtml), rendered verbatim like Gold. */}
                {story.rest ? <div className="spl-prose spl-about-prose" dangerouslySetInnerHTML={{ __html: story.rest }} /> : null}
                {!story.lead && !story.rest ? (
                  <EmptyState headingAs="h3" title="Our story hasn’t been published yet"
                              message="Meanwhile, the projects, events and people pages show what the club has been doing." />
                ) : null}
              </div>
            </Chapter>

            {people.length ? (
              <Chapter id="spl-about-leaders" title="Leadership" state={peopleStates[0]}>
                <ul className={'spl-about-people' + (people.length === 1 ? ' is-one' : '')}>
                  {people.map((p, i) => (
                    <li key={p.type} {...fig(peopleStates[i])}>
                      <PersonCard name={p.name} role={p.role} img={p.img} bio={p.bio}
                                  href={withYear('/dignitary?Type=' + p.type, club.selectedYearId)} />
                    </li>
                  ))}
                </ul>
              </Chapter>
            ) : null}

            {contact.length ? (
              <Chapter id="spl-about-contact" title="Contact" className="spl-about-contact" state={contactStates[0]}>
                <div className="spl-wrap">
                  <WipeList watch={dataKey}>
                    {contact.map((r, i) => (
                      <WipeRow key={r.href + i} href={r.href} title={r.title} meta={r.meta} cta={r.cta}
                               external={!!r.external} state={contactStates[i]} />
                    ))}
                  </WipeList>
                </div>
              </Chapter>
            ) : null}
          </Split>

        </>
      )}
    </div>
  )
}
