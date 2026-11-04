'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · YOUTH PARTNERS — the two panels.
//
// Rotaract and Interact are two separate programmes, and the page should say so
// before you read a word: two panels, one navy and one cream, each with its own
// mark and its own numbered list. The shared page draws them as two identical
// four-column card grids, which makes them look like one thing split in half.
//
// Both lists are imported from the shared page — static content, one source.
// ─────────────────────────────────────────────────────────────────────────────
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { ROTARACT, INTERACT } from '@/themes/shared/pages/YouthPartners.jsx'
import { GPageHead, useRevealReplay, hideOnError } from './kit.jsx'

function Panel({ navy, logo, alt, blurb, items }) {
  return (
    <section className={'gyp-panel reveal' + (navy ? ' gyp-panel--navy' : '')}>
      <img src={logo} alt={alt} onError={hideOnError} />
      <p className="gyp-panel__x">{blurb}</p>
      <div className="gyp-list">
        {items.map((name, i) => (
          <div className="gyp-item" key={name}>
            <span className="gp-idx">{String(i + 1).padStart(2, '0')}</span>
            <span>{name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function YouthPartnersGold({ data }) {
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Youth Partners')

  useRotaryAnim([])
  useRevealReplay('gyp-page', [])

  return (
    <div className="gyp-page">

      {/* ══ 01 · Masthead — the club's own menu label wins, as the C# does ══ */}
      <GPageHead
        crumbs={[{ label: menuName || 'Youth Partners' }]}
        eyebrow="New generations service"
        title={menuName && menuName.trim() ? menuName : 'Youth partners'}
        sub="The Rotaract clubs and college partners, and the Interact clubs in schools, that this club sponsors."
      />

      {/* ══ 02 · The two panels ══ */}
      {/* gyp-wrap only pads the panels — the band brings its own gutters, so it
          has to sit outside this rather than inherit them twice. */}
      <div className="gyp-wrap">
        <div className="gld-x">
          <div className="gyp-panels gld-stagger">
            <Panel logo="images/logo/rotaract-logo.png" alt="Rotaract"
                   blurb="Our sponsored Rotaract clubs & college partners"
                   items={ROTARACT} />
            <Panel navy logo="images/logo/interact-logo.png" alt="Interact"
                   blurb="Our sponsored Interact clubs in schools"
                   items={INTERACT} />
          </div>
        </div>
      </div>

    </div>
  )
}
