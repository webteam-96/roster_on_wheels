'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · ABOUT — the editorial spread.
//
// This page is TEXT. Whatever the club's admin has written is the whole point of
// it, so the composition is a magazine spread rather than a card layout: the
// club's name set as a poster with its crest, then a sticky fact ledger beside
// one wide, unbroken measure of that copy with a drop cap on it. Nothing else:
// the Four-Way Test band that used to close the page went (user's call), so the
// club's own words are the last thing you read.
// ─────────────────────────────────────────────────────────────────────────────
import { useClub } from '@/site/ClubContext.jsx'
import { usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { useAboutGold } from './goldData.js'
import { GPageHead, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

const SOC = {
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  twitter: '<path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
}
const socPath = (k) => SOC[String(k || '').toLowerCase()]
  || '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'

export default function AboutGold({ data }) {
  const club = useClub()
  const d = useAboutGold(data)

  // The club's own menu label wins, exactly as the C# does — the visitor should
  // see the title of the thing they clicked.
  const menuName = useCurrentMenuName()
  usePageTitle(menuName && menuName.trim() ? menuName : 'About Us')

  useRotaryAnim([d.loading, d.html])
  useRevealReplay('gab-page', [d.loading, d.html])

  const fields = [
    ['Rotary year', club.selectedYearLabel],
    ['President', d.president && d.president.memberName],
    ['Secretary', d.secretary && d.secretary.memberName],
    ['Meets', [d.meetingDay, d.meetingTime].filter(Boolean).join(' · ')],
    ['Venue', d.meetingVenue],
    ['Email', d.email],
    ['Phone', d.phone],
  ].filter(([, v]) => v && String(v).trim())

  return (
    <div className="gab-page">

      {/* ══ 01 · Masthead — the standard band, with the club's name as its title ══ */}
      <GPageHead
        crumbs={[{ label: menuName || 'About Us' }]}
        eyebrow="About the club"
        title={club.clubDisplayName}
        sub={club.selectedYearLabel
          ? 'A member club of Rotary International, serving through the '
            + club.selectedYearLabel + ' Rotary year.'
          : null}
        aside={d.logo ? (
          <div className="gab-crest" aria-hidden="true">
            <span className="gab-crest__in">
              <img src={d.logo} alt="" onError={hideOnError} />
            </span>
          </div>
        ) : null}
      />

      {/* ══ 02 · The club's own words, with the facts alongside ══ */}
      <section className="gab-body">
        <div className="gld-x gab-body__in">

          <aside className="gab-rail reveal">
            <p className="gab-rail__cap">At a glance</p>
            {fields.map(([k, v]) => (
              <span className="gp-f" key={k}><i>{k}</i><b>{v}</b></span>
            ))}
            {d.socials.length > 0 && (
              <div className="gab-rail__soc">
                {d.socials.map((s, i) => {
                  let url = String(s.linkUrl).trim()
                  if (!/^http/i.test(url)) url = 'https://' + url
                  return (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                       aria-label={s.platform || 'Social link'}
                       dangerouslySetInnerHTML={{
                         __html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
                           + socPath(s.platform) + '</svg>',
                       }} />
                  )
                })}
              </div>
            )}
          </aside>

          <div className="gab-copy">
            {/* No pulled-out lede: the club's copy usually OPENS with its own
                one-line summary, so promoting the first sentence printed it
                twice, a paragraph apart. The drop cap carries the opening
                instead. */}
            {d.html ? (
              /* Trusted admin rich HTML, rendered verbatim — encoding it would
                 print the tags. Its first paragraph carries the drop cap. */
              <div className="gp-prose reveal" dangerouslySetInnerHTML={{ __html: d.html }} />
            ) : !d.loading ? (
              <p className="gp-prose reveal">
                This club hasn&rsquo;t published its story yet. Meanwhile, the projects,
                events and people pages show what it has been doing.
              </p>
            ) : null}

            <div className="reveal" style={{ marginTop: 'var(--g-5)', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              <a href="/projects" className="gld-btn gld-btn--gold">Our projects <Arrow /></a>
              <a href="/directory" className="gld-btn gld-btn--ghost">Meet the members <Arrow /></a>
            </div>
          </div>

        </div>
      </section>

    </div>
  )
}
