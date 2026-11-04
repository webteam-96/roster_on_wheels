'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · ABOUT — the club's own words at first light.
// The club's About HTML is the centrepiece: one readable column whose paragraphs
// come into focus as they reach the reading line, opened by the club's name and
// closed by its contact and socials, beside the club crest in rising rings (the
// home emblem), sticky on wide screens. Nothing else (client, 2026-10-05: no
// weekly meeting, leadership or "Explore the club" here).
// Data: useAboutData() only (goldData.useAboutGold) - the fields Gold shows.
// ─────────────────────────────────────────────────────────────────────────────
import { useId, useMemo, useRef } from 'react'
import { useClub, useAboutData, LOGO_PLACEHOLDER } from '../../_shared/data.js'
import { PageHero, EmptyState, Loading, Emblem, SocialLinks, demoteH1 } from '../kit.jsx'
import { useScene, useRefreshOnImages, focusPull, ringsRise } from '../motion.js'
import './About.css'

const has = (v) => !!v && !!String(v).trim()

/** The club's logo, else the Rotary wheel, else the white plate alone (never a loop). */
function crestFallback(e) {
  const img = e.currentTarget
  if (img.dataset.fb) { img.style.visibility = 'hidden'; return }
  img.dataset.fb = '1'
  img.src = LOGO_PLACEHOLDER
}

export default function About({ data }) {
  const club = useClub()
  const d = useAboutData(data)
  const clubName = String(club.clubDisplayName || '').trim()
  // "Rotary Club of" in the serif; the rest of the name as the accent
  const short = clubName.replace(/^\s*(the\s+)?rotary\s+club\s+of\s+/i, '').trim()
  const isRotary = !!short && short !== clubName

  // Admin HTML can carry its own <h1>; the page's only h1 is the hero's.
  const html = useMemo(() => demoteH1(d.html), [d.html])
  const email = has(d.email) ? String(d.email).trim() : ''
  const phone = has(d.phone) ? String(d.phone).trim() : ''
  const socials = d.socials || []   // already filtered to rows with a link (useAboutGold)
  const logo = d.logo || LOGO_PLACEHOLDER

  const storyId = useId()
  const ref = useRef(null)
  useRefreshOnImages(ref, [d.loading, html, logo])

  useScene(ref, (c) => {
    const root = ref.current
    const crest = root.querySelector('.sun-ab-crest')
    if (!crest) return                                  // still loading
    ringsRise(crest.querySelectorAll('.sun-emblem__glow, .sun-emblem__ring'), crest)
    const prose = root.querySelector('.sun-ab-prose')
    if (prose) {
      // one wrapper <div> around the whole text: pull its paragraphs instead
      let blocks = prose.children
      if (blocks.length === 1 && blocks[0].children.length > 1) blocks = blocks[0].children
      // ponytail: blur is dropped past 60 blocks (line-by-line pasted text); fine-grained budget if it ever matters
      focusPull(blocks, blocks.length > 60 ? { wide: false } : c)
    }
  }, [d.loading, html])

  // the page head is crumbs + title only; the club's name opens the story instead
  const intro = !clubName ? null : isRotary
    ? <>Rotary Club of <em>{short}</em>, a member club of Rotary International.</>
    : <em>{clubName}</em>

  return (
    <div className="sun-page sun-ab" ref={ref}>
      <PageHero title="About Us" />

      {d.loading ? <div className="sun-wrap"><Loading label="Loading the club’s story" /></div> : (
        <div className="sun-wrap sun-block sun-ab-story">
          <Emblem className="sun-ab-crest" src={logo} alt={(clubName || 'Club') + ' logo'} onError={crestFallback} />

          <section className="sun-ab-main" aria-labelledby={storyId}>
            <h2 className="sun-sr" id={storyId}>The club’s story</h2>
            {intro ? <p className="sun-lead sun-ab-intro">{intro}</p> : null}
            {html ? (
              /* Trusted admin rich HTML (already wrappableHtml), rendered verbatim like Gold. */
              <div className="sun-prose sun-ab-prose" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <EmptyState title="The club’s story isn’t published yet"
                message="Meanwhile, the projects, events and people pages show what it has been doing." />
            )}

            {email || phone || socials.length ? (
              <div className="sun-ab-reach">
                {email || phone ? (
                  <div>
                    <h3 className="sun-eyebrow">Contact</h3>
                    <dl className="sun-ab-contact">
                      {/* plain text, exactly as Gold's About shows them (personal contact data) */}
                      {email ? <div><dt>Email</dt><dd>{email}</dd></div> : null}
                      {phone ? <div><dt>Phone</dt><dd>{phone}</dd></div> : null}
                    </dl>
                  </div>
                ) : null}
                {socials.length ? (
                  <div>
                    <h3 className="sun-eyebrow">Follow the club</h3>
                    <SocialLinks socials={socials} className="sun-ab-soc" label="The club on social media" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  )
}
