'use client'
// Port of AboutUs.aspx + AboutUs.aspx.cs.
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, usePageTitle, wrappableHtml } from '@/themes/shared/rotaryPage.js'
import Breadcrumb, { useCurrentMenuName } from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

/** Club logo fallback — the generic Rotary wheel that ships in /images. */
const LOGO_PLACEHOLDER = '/images/logo/wheel.png'

/**
 * The editor's block separator is an EMPTY paragraph — <p>&nbsp;</p> — because
 * it renders <p> with no margin, so a blank line is the only way to break one
 * block from the next. wrappableHtml() rewrites that &nbsp; to a plain space,
 * which then collapses and leaves a zero-height paragraph, losing the break.
 * Put a hard space back so the blank line the author typed survives.
 * Local to this page: the other rich-HTML consumers still stack their
 * paragraphs with space-y-4 and do not want a second source of blank lines.
 */
function keepBlankLines(html) {
  return String(html).replace(/<p([^>]*)>(?:\s|<br\s*\/?>)*<\/p>/gi, '<p$1>&nbsp;</p>')
}

// Neutral placeholder when the API has no about content (a placeholder, not
// hardcoded club content).
const ABOUT_PLACEHOLDER = '<p class="text-muted">About information will be available soon.</p>'

export default function AboutUs() {
  const club = useClub()
  const { isWarm } = useTheme()

  // Rich about-text HTML for the left column. Sourced from the admin API
  // (trusted, already-sanitised rich HTML) and rendered verbatim.
  // The shell's about (lib/pageShell) is already for the picked year and in the visitor's language.
  const a = club.about
  const logo = media(a ? a.clubLogoPath : null)
  const about = {
    aboutHtml: a && a.content && String(a.content).trim() ? keepBlankLines(wrappableHtml(a.content)) : ABOUT_PLACEHOLDER,
    logoUrl: logo ? logo : LOGO_PLACEHOLDER,
  }

  const menuName = useCurrentMenuName()
  usePageTitle(menuName && menuName.trim() ? menuName : 'About Us')

  useRotaryAnim([about.aboutHtml, isWarm])

  return (
    <>
      <Breadcrumb eyebrow="About Us" title={club.clubDisplayName} crumbLabel="About Us" />

      {/* ══ About ══ */}
      <div className={isWarm ? 'bg-canvas' : 'bg-white'}>
        <div className="container-x py-14 md:py-16">

          {/* ABOUT ROTARY CLUB
              The logo card FLOATS instead of owning a second grid track: in a
              two-column grid the about-text stops dead at the card's left edge,
              so anything longer than the card left a tall empty block under the
              logo. Floated, the text runs beside the card and then continues
              full-width underneath it.
              display:flow-root contains the float, so the section still grows to
              the card's height when the text is SHORTER than the logo, and
              min-w-0 keeps admin text pasted with unbreakable &nbsp; runs from
              blowing the column out into a page-wide horizontal scroll.
              The rule is inline because this port ships PRECOMPILED Tailwind (no
              build step here) and lg:float-right / clear-both were never emitted
              into any theme's CSS. Below lg the card is a normal full-width block. */}
          <style>{`@media (min-width:1024px){.about-aside{float:right;width:360px;margin-left:2.5rem;margin-bottom:1rem}}`}</style>
          <div className="min-w-0" style={{ display: 'flow-root' }}>

            {/* Rotary logo card (TiltedCard) */}
            <div className={'about-aside mb-6 ' + (isWarm ? 'tilted-card tilted-glare flex items-center justify-center rounded-xl border border-navy/10 bg-white p-10 shadow-card' : 'tilted-card tilted-glare flex items-center justify-center rounded-xl bg-[#FBF6EC] p-10')}>
              <img src={about.logoUrl} alt={club.clubName}
                   onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = LOGO_PLACEHOLDER }}
                   className="w-full max-w-[260px]" />
            </div>

            <div className="mb-5">
              <h2 className="font-heading text-xl font-extrabold uppercase tracking-wide text-navy md:text-2xl" data-split>About {club.clubDisplayName}</h2>
              <div className="reveal mt-2 h-1 w-14 rounded-full bg-gold"></div>
            </div>
            {/* NO space-y here, deliberately. The admin editor renders <p> with
                zero margin, so in its "rendered exactly as it appears on the
                public site" preview consecutive <p> tags read as consecutive
                LINES, and a block break is an explicit empty <p>. Most club
                About text is pasted with hard line breaks, so it arrives as
                dozens of one-line paragraphs — a gap between every one of them
                turned a solid block into a widely spaced ladder that matched
                nothing the author saw. Zero margin + the empty paragraphs the
                author actually typed reproduces the editor exactly. */}
            <div className="reveal break-words text-[15px] leading-relaxed text-muted"
                 dangerouslySetInnerHTML={{ __html: about.aboutHtml }} />
          </div>

        </div>
      </div>
    </>
  )
}
