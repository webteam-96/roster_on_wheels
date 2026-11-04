'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION · ABOUT — "the statement".
// The club's own words are the page. The ink hero carries the menu label; then
// a paper band where the opening of the club's story is set huge in Instrument
// Serif, its words inking in as you scroll while the first year the text
// mentions (usually the charter year) drifts behind it in outline - the home's
// about moment, continued. Under it the club's full HTML beside a sticky
// "at a glance" card (crest, officers, meeting, contact, socials). No "Keep
// exploring" band (client, 2026-10-01).
// Data: useAboutData() only (goldData.useAboutGold) - the same fields Gold shows.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef } from 'react'
import {
  useClub, useAboutData, useCurrentMenuName, usePageTitle, socialLabel, externalUrl, LOGO_PLACEHOLDER,
} from '../../_shared/data.js'
import {
  PageHero, Band, Card, Facts, EmptyState, Loading, Words, ArrowOut,
  splitAbout, clean,
} from '../kit.jsx'
import { usePageMotion } from '../motion.js'
import './About.css'

// Admin HTML sometimes carries its own <h1>; the hero's is the page's only one.
const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2')

// A crest that 404s falls back to the Rotary wheel once, then hides (the flag stops an error loop).
function crestFallback(e) {
  const el = e.currentTarget
  if (el.dataset.fb) { el.style.visibility = 'hidden'; return }
  el.dataset.fb = '1'
  el.src = LOGO_PLACEHOLDER
}

export default function About({ data }) {
  const club = useClub()
  const d = useAboutData(data)
  const menuName = useCurrentMenuName()
  const title = (menuName && menuName.trim()) || 'About Us'
  usePageTitle(title)

  const parts = useMemo(() => splitAbout(d.html), [d.html])
  const html = useMemo(() => demoteH1(d.html), [d.html])

  const ref = useRef(null)
  usePageMotion(ref, [d.loading, d.html])

  const socials = d.socials || []
  const facts = [
    ['President', d.president && clean(d.president.memberName)],
    ['Secretary', d.secretary && clean(d.secretary.memberName)],
    ['Meets', [d.meetingDay, d.meetingTime].filter((v) => v && String(v).trim()).join(' · ')],
    ['Venue', d.meetingVenue ? (
      <>
        <span className="liq-abt-venue">{d.meetingVenue}</span>
        <a className="liq-link" href={d.mapUrl} target="_blank" rel="noopener noreferrer">
          Directions<ArrowOut /><span className="liq-sr"> (opens in new tab)</span>
        </a>
      </>
    ) : ''],
    ['Email', d.email],
    ['Phone', d.phone],
    ['Follow', socials.length ? (
      <ul className="liq-abt-soc">
        {socials.map((s, i) => (
          <li key={i}>
            <a className="liq-chip" href={externalUrl(s.linkUrl)} target="_blank" rel="noopener noreferrer">
              <span>{socialLabel(String(s.platform || '').trim().toLowerCase())}</span><ArrowOut />
              <span className="liq-sr"> (opens in new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    ) : ''],
  ]

  return (
    <div className="liq-abt" ref={ref}>
      <PageHero title={title} />

      <Band tone="paper" className="liq-abt-story" aria-labelledby="liq-abt-h">
        <h2 className="liq-kicker liq-rv" id="liq-abt-h">Our story</h2>
        {d.loading ? <Loading label="Loading the club’s story" /> : (
          <>
            {parts && parts.statement ? (
              /* a pull-quote of the text below: screen readers get it once, in the prose */
              <div className="liq-abt-lead" aria-hidden="true">
                <p className="liq-abt-statement liq-ink"><Words text={parts.statement} em={parts.em} /></p>
              </div>
            ) : null}
            <div className="liq-abt-cols">
              <div className="liq-abt-body">
                {html
                  /* trusted admin rich HTML (already wrappableHtml), rendered verbatim like Gold */
                  ? <div className="liq-prose liq-rv" dangerouslySetInnerHTML={{ __html: html }} />
                  : (
                    <EmptyState as="h3" title="The club hasn’t published its story yet"
                      text="Meanwhile, the projects, events and people pages show what it has been doing." />
                  )}
              </div>
              <Card as="aside" className="liq-abt-card" aria-labelledby="liq-abt-card-h">
                <div className="liq-abt-card__head liq-rv">
                  <span className="liq-abt-crest">
                    <img key={d.logo || 'wheel'} src={d.logo || LOGO_PLACEHOLDER} alt="" width="96" height="96"
                         loading="lazy" decoding="async" onError={crestFallback} />
                  </span>
                  <div className="liq-abt-card__id">
                    <p className="liq-abt-card__cap">At a glance</p>
                    <h3 className="liq-abt-card__name" id="liq-abt-card-h">{club.clubDisplayName}</h3>
                  </div>
                </div>
                <Facts items={facts} />
              </Card>
            </div>
          </>
        )}
      </Band>
    </div>
  )
}
