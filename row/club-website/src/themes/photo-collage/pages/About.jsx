'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage · About — the club's own letter, pinned into the scrapbook.
//   PageHero (title filled with a club photo, ONE card: the crest)
//   · the admin's About HTML on ruled notebook paper, clipped to a kraft backing
//     sheet, signed by the club · the club's socials, when it has any.
//   (Client, 2026-09-29: no "Our story" heading, no At a glance / When we meet,
//   no Club leaders or Keep exploring sections, no photo strip in the head.)
// Data: useAboutData() (goldData.useAboutGold) for everything on the page;
// useGalleryData(1) only lends photos to the headings and hero prints.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useClub, useAboutData, useGalleryData, externalUrl, socialLabel, LOGO_PLACEHOLDER } from '../../_shared/data.js'
import {
  PageHero, EmptyState, Loading, Tape, Underline, P,
  SocialIcon, usePageName, excerpt,
} from '../kit.jsx'
import { useScene, useRefreshOnImages, house, revealBatch, gsap } from '../motion.js'
import './About.css'

const BLANK_P = '<p(?:\\s[^>]*)?>(?:\\s|<br\\s*/?>)*</p>'
const LEADING_BLANKS = new RegExp('^(?:\\s*' + BLANK_P + ')+', 'i')
const TRAILING_BLANKS = new RegExp('(?:' + BLANK_P + '\\s*)+$', 'i')
const BLANK_LINE = /<p(\s[^>]*)?>(?:\s|<br\s*\/?>)*<\/p>/gi

/**
 * The admin HTML as a letter. The hero keeps the page's only h1; no blank lines
 * before the first words or after the last; and the editor's empty paragraph
 * (its only way to break one block from the next) stays a blank line, exactly
 * as the shared AboutUs.jsx keepBlankLines() does.
 */
function letterHtml(html) {
  if (!html) return ''
  const out = String(html)
    .replace(/<(\/?)h1\b/gi, '<$1h2')
    .replace(LEADING_BLANKS, '')
    .replace(TRAILING_BLANKS, '')
    .replace(BLANK_LINE, (m, attrs) => '<p' + (attrs || '') + '>&nbsp;</p>')
  // No blank lines at all, and real paragraphs (not one pasted line per <p>,
  // which averages ~80 chars): give each paragraph its blank line, as a letter
  // would, instead of one solid block.
  // ponytail: length heuristic; a per-paragraph rule if a club mixes both styles
  const n = (out.match(/<p[\s>]/gi) || []).length
  const chars = out.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').length
  if (n > 1 && !/>&nbsp;<\/p>/.test(out) && chars / n > 160) return out.replace(/<\/p>(\s*)(?=<p[\s>])/gi, '</p><p>&nbsp;</p>$1')
  return out
}

const SOC_TONES = ['cran', 'azure', 'royal', 'violet']

export default function About({ data }) {
  const club = useClub()
  const name = usePageName('About Us')
  const d = useAboutData(data)
  const g = useGalleryData(1, data)
  const clubName = String(club.clubDisplayName || '').trim()
  const shortName = clubName.replace(/^\s*(the\s+)?(rotary|rotaract)\s+club\s+of\s+/i, '').trim() || clubName

  // The gallery only decorates: never hold the page for it (a failed request stays null).
  const [late, setLate] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLate(true), 1500); return () => clearTimeout(t) }, [])
  const ready = !d.loading && (!g.loading || late)

  const seen = new Set()
  const photos = (g.photos || []).filter((p) => p.img && !seen.has(p.img) && seen.add(p.img))
  const ph = (i) => (photos.length ? photos[i % photos.length].img : '')
  // the one card in the head: the club's crest (client, 2026-09-29: no photo strip)
  const crest = ready && d.logo ? { src: d.logo, caption: excerpt(shortName, 28), ratio: '1 / 1', fallbacks: LOGO_PLACEHOLDER } : null

  const letter = letterHtml(d.html)

  const socials = d.socials || []

  const ref = useRef(null)
  useRefreshOnImages(ref, [ready, letter])
  useScene(ref, (c) => {
    const root = ref.current
    const q = (s) => Array.from(root.querySelectorAll(s))
    const undo = house(root, c)
    // the letter rises off the table and straightens as it arrives (its tilt lives on ::before, never tweened)
    q('.col-about-sheet').forEach((el) => gsap.fromTo(el, { y: 70, rotation: -2, transformOrigin: '50% 0%' }, {
      y: 0, rotation: 0, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'top 50%', scrub: 0.6 },
    }))
    revealBatch(q('.col-about-soc > li'), { y: 40 })
    return undo
  }, [ready, letter, socials.length])

  return (
    <div className={'col-about' + (crest ? ' has-crest' : '')} ref={ref}>
      {!ready ? (
        <div className="col-sec"><Loading label="Loading the club’s story" /></div>
      ) : (
        <>
          <PageHero title={name} img={ph(0)} tint="royal" card={crest} />

          {/* ══ the club's own words (client, 2026-09-29: no heading, no side memo, no leaders / onward sections) ══ */}
          <section className="col-sec col-about-story" aria-labelledby="col-about-story-t">
            <h2 className="col-sr" id="col-about-story-t">About the club</h2>
            <div className="col-about-grid">
              <div className="col-about-main">
                {letter ? (
                  <div className="col-about-sheet">
                    <div className="col-about-letter">
                      <svg className="col-about-clip" viewBox="0 0 26 62" aria-hidden="true" focusable="false"><path d={P.clip} /></svg>
                      <Tape tone="gold" left="86%" tilt={6} />
                      {/* Trusted admin rich HTML (already wrappableHtml), rendered verbatim like Gold. */}
                      <div className="col-about-prose" dangerouslySetInnerHTML={{ __html: letter }} />
                      {clubName ? <p className="col-about-sign">— {clubName}<Underline scroll /></p> : null}
                    </div>
                  </div>
                ) : (
                  <EmptyState title="The club’s story isn’t published yet"
                    message="Meanwhile, the projects, events and people pages show what it has been doing." />
                )}
              </div>

            </div>
          </section>

          {/* ══ the club's socials ══ */}
          {socials.length ? (
          <section className="col-sec col-about-more" aria-label="Follow the club">
            {socials.length ? (
              <div className="col-about-follow">
                <h3 className="col-about-follow-t">Follow the club</h3>
                <ul className="col-about-soc">
                  {socials.map((s, i) => {
                    const k = String(s.platform || '').trim().toLowerCase()
                    return (
                      <li key={i}>
                        <a className="col-about-soc-a" href={externalUrl(s.linkUrl)} target="_blank" rel="noopener noreferrer"
                          style={{ '--col-c': 'var(--col-' + SOC_TONES[i % 4] + ')', '--col-r': (i % 2 ? 3 : -3) + 'deg' }}>
                          <SocialIcon platform={k} />
                          <span>{socialLabel(k)}</span>
                          <span className="col-sr"> (opens in a new tab)</span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </section>
          ) : null}
        </>
      )}
    </div>
  )
}
