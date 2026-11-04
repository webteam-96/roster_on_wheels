'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · ABOUT — "the screening notes".
// The club's own words are the centrepiece: one readable column with a gold
// projector beam drawing down beside it as you read, the club's logo on a white
// plate and its contact/socials in a rail. (Client, 2026-09-25: no meeting slate,
// leadership or "explore" links here - the home page carries those.)
// Data: useAboutData() only (goldData.useAboutGold) - same fields Gold shows.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef } from 'react'
import { useClub, useAboutData } from '../../_shared/data.js'
import {
  usePageName, PageHero, SocialLinks, Logo, EmptyState, Loading, clubNames, demoteH1,
} from '../kit.jsx'
import {
  gsap, useScene, useRefreshOnImages, riseIn,
} from '../motion.js'
import './About.css'

const has = (v) => v && String(v).trim()

// ── the club's own words + the details rail ──────────────────────────────────
function Notes({ html, logo, logoAlt, email, phone, socials }) {
  const ref = useRef(null)
  useScene(ref, (c) => {
    const root = ref.current
    riseIn(root.querySelectorAll('.cin-about-story > .cin-about-cap, .cin-about-prose, .cin-about-story .cin-empty'), { stagger: 0.08 })
    riseIn(root.querySelectorAll('.cin-about-aside > *'), { trigger: root.querySelector('.cin-about-aside'), stagger: 0.1 })
    const beam = root.querySelector('.cin-about-beam'), prose = root.querySelector('.cin-about-prose')
    if (c.wide && beam && prose) {
      gsap.fromTo(beam, { scaleY: 0 }, {
        scaleY: 1, ease: 'none', scrollTrigger: { trigger: prose, start: 'top 75%', end: 'bottom 75%', scrub: true },
      })
    }
  }, [html, logo])

  const contact = [['Email', email], ['Phone', phone]].filter(([, v]) => has(v))
  const hasSocials = (socials || []).length > 0

  return (
    <div ref={ref} className="cin-about-notes">
      <section className="cin-about-story" aria-labelledby="cin-about-story-h">
        <h2 className="cin-about-cap" id="cin-about-story-h">Our story</h2>
        {html ? (
          <>
            <span className="cin-about-beam" aria-hidden="true" />
            {/* Trusted admin rich HTML (already wrappableHtml), rendered verbatim like Gold. */}
            <div className="cin-prose cin-about-prose" dangerouslySetInnerHTML={{ __html: html }} />
          </>
        ) : (
          <EmptyState as="h3" title="The club’s story hasn’t been published yet"
            message="Meanwhile, the projects, events and people pages show what it has been doing." />
        )}
      </section>

      {logo || contact.length || hasSocials ? <aside className="cin-about-aside" aria-label="Club details">
        {logo ? (
          <div className="cin-about-plate">
            <Logo sources={[logo]} alt={logoAlt} width="280" height="280" loading="lazy" />
          </div>
        ) : null}
        {contact.length ? (
          <div className="cin-about-box">
            <h2 className="cin-about-cap">Contact</h2>
            <dl className="cin-about-contact">
              {contact.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </div>
        ) : null}
        {hasSocials ? (
          <div className="cin-about-box">
            <h2 className="cin-about-cap">Follow the club</h2>
            <SocialLinks socials={socials} />
          </div>
        ) : null}
      </aside> : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function About({ data }) {
  const club = useClub()
  const d = useAboutData(data)
  const name = usePageName('About Us')
  const pageRef = useRef(null)
  useRefreshOnImages(pageRef, [d.loading, d.html, d.logo])

  const names = clubNames(club.clubDisplayName)
  const html = useMemo(() => (d.html ? demoteH1(d.html) : ''), [d.html])

  return (
    <div className="cin-about-page" ref={pageRef}>
      <PageHero
        title={club.clubDisplayName || name}
        crumbs={[{ label: name }]}
      />
      {d.loading ? <Loading label="Loading the club’s story" /> : (
        <>
          <Notes html={html} logo={d.logo} logoAlt={names.full + ' logo'}
            email={d.email} phone={d.phone} socials={d.socials} />
        </>
      )}
    </div>
  )
}
