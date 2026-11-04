'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · DIGNITARY — the portrait spread.
//
// A leader's page is a portrait and a piece of writing, and nothing else. The
// shared <GPageHead> masthead carries the office and the name, then the page
// splits: a navy panel with the portrait, office and name, and beside it the
// bio on cream at proper reading width. The panel sticks while you read.
//
// Both columns sit INSIDE the page container, so the panel's left edge lines up
// with the masthead logo and the footer's first column. The full-bleed version
// this replaced ran the navy to the viewport edge and left the reading column
// stranded with several hundred pixels of empty cream to its right.
//
// The legacy URL contract is unchanged — /dignitary?Type=N where 1 = RI
// President, 2 = District Governor, 4 = Club President, 5 = Club Secretary.
// ─────────────────────────────────────────────────────────────────────────────
import { useSearchParams } from '@/site/router.js'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useDignitaryGold } from './goldData.js'
import { GPageHead, GEmpty, Arrow, useRevealReplay, portraitFallback, isPlaceholderPhoto } from './kit.jsx'

export default function DignitaryGold({ data }) {
  const [params] = useSearchParams()
  let type = parseInt(params.get('Type'), 10)
  if (Number.isNaN(type)) type = 1

  const vm = useDignitaryGold(type, data)
  // <Breadcrumb> is not used here (the page carries its own name), so the title
  // is set explicitly — the found/not-found split the C# makes.
  usePageTitle(vm.found ? vm.name : 'Dignitaries of Rotary')

  useRotaryAnim([vm.found, vm.name])
  useRevealReplay('gdig-page', [vm.found, vm.name])

  if (vm.loading) return null

  if (!vm.found) {
    return (
      <div className="gdig-page gdig-wrap">
        {/* No profile to name, so the band states the section instead of a person. */}
        <GPageHead crumbs={[{ label: 'Dignitaries' }]} eyebrow="Rotary leadership" title="Dignitaries" />
        <div className="gld-x">
          <GEmpty title="Profile not available"
                  message="We couldn't find this leadership profile right now. Please check back soon."
                  action={<a href="/" className="gld-btn gld-btn--gold">Back to home <Arrow /></a>}
                  icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a7 7 0 0 1 14 0v1" /></svg>} />
        </div>
      </div>
    )
  }

  const missing = isPlaceholderPhoto(vm.img)

  return (
    <div className="gdig-page">

      <GPageHead
        crumbs={[{ label: 'Dignitaries' }, { label: vm.role || vm.name }]}
        eyebrow={vm.designation || vm.role}
        title={vm.name}
      />

      <div className="gdig-wrap"><div className="gld-x">

        <div className="gdig-in">
          {/* ══ The portrait panel ══ */}
          <aside className="gdig-side">
            <div className="gdig-port">
              <img src={missing ? '/images/logo/wheel.png' : vm.img}
                   className={missing ? 'is-ph' : undefined}
                   alt={vm.name} onError={portraitFallback} />
            </div>
            {/* The office and the name are repeated under the portrait so the
                panel still identifies the person once the masthead has scrolled
                away. Office above name, which is the order .gdig-role /
                .gdig-name are spaced for. The Rotary year pill was dropped. */}
            {(vm.designation || vm.role) && <p className="gdig-role">{vm.designation || vm.role}</p>}
            <h2 className="gdig-name">{vm.name}</h2>
          </aside>

          {/* ══ The writing ══ */}
          <section className="gdig-main">
            <h2 className="gdig-main__h">Profile</h2>
            <span className="gdig-main__r" aria-hidden="true" />

            {vm.bioHtml ? (
              /* Already-rich HTML from the API is emitted as-is; plain text was
                 paragraph-split and encoded upstream (buildBioHtml). */
              <div className="gp-prose reveal" dangerouslySetInnerHTML={{ __html: vm.bioHtml }} />
            ) : (
              <p className="gp-prose reveal">A detailed profile will be available soon.</p>
            )}

            {/* One way out only. The board link went (user's call) — the header
                menu already carries Directors on every page. */}
            <div className="reveal" style={{ marginTop: 'var(--g-6)' }}>
              <a href="/" className="gld-btn gld-btn--gold">Back to home <Arrow /></a>
            </div>
          </section>
        </div>

      </div></div>
    </div>
  )
}
