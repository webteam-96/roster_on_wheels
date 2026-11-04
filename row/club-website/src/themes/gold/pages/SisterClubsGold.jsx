'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · SISTER CLUBS — the world index.
//
// Six partner clubs, each a name and a district. That is a LIST, not a grid of
// six identical icon tiles, so the page reads as an index: the standard masthead
// band, then ruled rows with the club name set large and its district tracked
// out on the right.
//
// The list itself is imported from the shared page — it is static content with
// no API behind it, and it must not be copied into a second place where it can
// go stale.
// ─────────────────────────────────────────────────────────────────────────────
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { CLUBS } from '@/themes/shared/pages/SisterClubs.jsx'
import { GPageHead, useRevealReplay } from './kit.jsx'

export default function SisterClubsGold({ data }) {
  const menuName = useCurrentMenuName()
  usePageTitle((menuName && menuName.trim()) || 'Sister Clubs')

  useRotaryAnim([])
  useRevealReplay('gsc-page', [])

  return (
    <div className="gsc-page">

      {/* ══ 01 · Masthead — the standard band; the club's own menu label wins ══ */}
      <GPageHead
        crumbs={[{ label: menuName || 'Sister Clubs' }]}
        eyebrow="Around the world"
        title={menuName && menuName.trim() ? menuName : 'Sister clubs'}
        sub={<>
          We are proud to partner with Rotary clubs across the world &mdash; building
          international friendship, goodwill and service beyond borders.
        </>}
      />

      <section className="gsc-body">
        <div className="gld-x">
          <div className="gsc-list">
            {CLUBS.map((c, i) => (
              <div className="gsc-row" key={c.Name + c.Rid}>
                <span className="gp-idx">{String(i + 1).padStart(2, '0')}</span>
                <h2 className="gsc-row__n">{c.Name}</h2>
                <span className="gsc-row__r">{c.Rid}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
