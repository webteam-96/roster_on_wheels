'use client'
// Port of diginitary.aspx + diginitary.aspx.cs.
//
// "Dignitaries of Rotary" profile page. Mirrors the React DignitaryProfile
// page (two-column photo + bio layout) and preserves the legacy URL contract
// diginitary.aspx?Type=N where 1 = International / RI President,
// 2 = District Governor, 4 = Club President, 5 = Club Secretary.
//
// RI President & District Governor come only from the public API. When the
// API has no row (currently 204), the page shows its "Profile not available"
// empty state — there is no bundled/hardcoded snapshot.
import { useEffect, useState } from 'react'
import { useSearchParams } from '@/site/router.js'
import { useClub, currentRotaryYearLabel } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, usePageTitle, wrappableHtml } from '@/themes/shared/rotaryPage.js'
import Breadcrumb from '@/themes/shared/Breadcrumb.jsx'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

/** HttpUtility.HtmlEncode — only needed inside the bio HTML string. */
function enc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Turn a (possibly plain-text, possibly multi-paragraph) bio into safe
 * HTML paragraphs. Splits on blank lines, HTML-encodes each block, and
 * converts single newlines to <br/>. Returns "" when empty.
 */
export function buildBioHtml(bio) {
  if (!bio || !String(bio).trim()) return ''

  // Some API bios (notably the RI President's, pasted from a PDF) join EVERY word
  // with a non-breaking space (&nbsp; / U+00A0). Non-breaking spaces never wrap, so
  // each paragraph becomes one unbreakable line that forces a horizontal page scroll
  // on every theme/device. Convert them to normal spaces so the text wraps.
  bio = wrappableHtml(bio)

  // The bio may already be rich HTML (the API returns <p>…</p> markup, e.g. the
  // RI President bio). Render that as-is — encoding it would show the tags as
  // literal text. Only a plain-text bio (no tags) is paragraph-split + encoded.
  if (/<[a-zA-Z/][^>]*>/.test(bio)) return bio

  const normalized = bio.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split('\n\n').filter((b) => b.length > 0)

  let sb = ''
  for (const block of blocks) {
    const trimmed = block.trim()
    if (trimmed.length === 0) continue
    const encoded = enc(trimmed).replace(/\n/g, '<br/>')
    sb += '<p>' + encoded + '</p>'
  }
  return sb
}

const EMPTY_VM = {
  name: null, role: null, designation: null, year: null,
  imgUrl: null, bio: null, email: null, phone: null,
}

export default function Diginitary({ data }) {
  const club = useClub()
  const { isWarm } = useTheme()
  const [searchParams] = useSearchParams()

  let type = parseInt(searchParams.get('Type'), 10)
  if (Number.isNaN(type)) type = 1

  // Normally the ClubContext-resolved label. Only when the API returned no
  // year list (SelectedYearLabel null) do we fall back — to the CURRENT
  // Rotary year computed from the date, not a hardcoded year that goes
  // stale at the 1 July rollover.
  const yearLabel = !club.selectedYearLabel ? currentRotaryYearLabel() : club.selectedYearLabel

  const vm = (() => {
      const next = { ...EMPTY_VM }

      switch (type) {
        case 2: { // District Governor
          const dg = data.dg
          if (dg && dg.memberName) {
            next.year = !dg.yearLabel ? yearLabel : dg.yearLabel
            next.name = dg.memberName
            next.role = 'District Governor'
            next.designation = 'District Governor ' + next.year
            next.imgUrl = media(dg.profilePhoto)
            next.bio = dg.description
          }
          break
        }

        case 4: // Club President
          bindBod('President', next)
          break

        case 5: // Club Secretary
          bindBod('Secretary', next)
          break

        default: { // 1 -> International / RI President
          const ip = data.ip
          if (ip && ip.name) {
            next.year = !ip.yearLabel ? yearLabel : ip.yearLabel
            next.name = ip.name
            next.role = 'RI President'
            next.designation = !ip.designation ? 'RI President' : ip.designation
            next.imgUrl = media(ip.profilePhotoPath)
            next.bio = ip.description
          }
          break
        }
      }

      return next

    /** Bind a club President/Secretary from the BOD endpoint, enriching contact from the directory. */
    function bindBod(designationKeyword, next) {
      next.year = yearLabel
      const bod = (data.bod || [])
      const kw = designationKeyword.toLowerCase()
      const m = bod.find((b) => String(b.designation || '').toLowerCase().indexOf(kw) >= 0)
      if (!m) return

      next.name = m.memberName
      next.role = m.designation
      next.designation = m.designation
      next.imgUrl = media(m.profilePhotoPath)
      next.bio = m.memberIntroduction

      // Personal email/phone are deliberately NOT shown for the club President
      // and Secretary (user request 2026-07-06) — the card renders without the
      // contact block when these stay null.
    }

  })()

  const found = !!vm.name
  const name = found ? vm.name : 'Our Leadership'
  const role = vm.role || ''
  const designation = !vm.designation ? role : vm.designation
  const imgUrl = !vm.imgUrl ? '/img/profile_pic.png' : vm.imgUrl
  const email = vm.email
  const phone = vm.phone
  const bioHtml = buildBioHtml(vm.bio)
  const hasBio = !!bioHtml
  const phoneTel = !phone ? '' : String(phone).replace(/\s/g, '')

  // SetTitle(Found ? Name : "Dignitaries of Rotary") — when a profile is found,
  // <Breadcrumb> already titles the page with Name (and prefers the club's own
  // menu label, as the C# does), so only the not-found branch needs its own.
  usePageTitle(found ? null : 'Dignitaries of Rotary')

  useRotaryAnim([found, name, hasBio])

  return (
    <>
      {/* ══ Breadcrumb ══ */}
      <Breadcrumb eyebrow="Dignitaries of Rotary" title={name} crumbLabel={role}
        midLabel="Dignitaries" midHref="/" titleClass="uppercase tracking-wide" />

      {found ? (
        /* ══ Profile (mirrors React DignitaryProfile: sticky photo card + bio card) ══ */
        <div className="bg-canvas">
          <div className="container-x py-12">
            <div className="grid gap-8 lg:grid-cols-[360px_1fr]">

              {/* Left: photo card */}
              <div className="reveal lg:sticky lg:top-28 lg:self-start">
                <div className={isWarm ? 'rounded-2xl border border-navy/10 bg-white p-6 text-center shadow-card' : 'rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-card'}>
                  <img src={imgUrl} alt={name}
                       onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/img/profile_pic.png' }}
                       className={isWarm ? 'mx-auto h-44 w-44 rounded-full object-cover object-top shadow-md ring-4 ring-gold/20' : 'mx-auto h-44 w-44 rounded-full object-cover object-top shadow-md ring-4 ring-gold/40'} />
                  <h2 className="mt-5 font-heading text-xl font-bold text-navy">{name}</h2>
                  {/* One line, always. A designation that carries its year
                      ("President, Rotary International 2026-27") used to wrap,
                      which left the badge icon stranded beside the first line.
                      The card is 360px for the same reason; truncate is only the
                      backstop for a pathologically long title, and the full text
                      stays available on hover. */}
                  <p className="mt-1.5 flex items-center justify-center gap-1.5 text-sm font-semibold text-gold-cta" title={designation}>
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                    <span className="min-w-0 truncate">{designation}</span>
                  </p>

                  {(email || phone) && (
                  <div className={isWarm ? 'mt-5 space-y-2 border-t border-navy/10 pt-5 text-sm' : 'mt-5 space-y-2 border-t border-gray-100 pt-5 text-sm'}>
                    {email && (
                    <a href={'mailto:' + email} className="flex items-center justify-center gap-2 text-muted transition-colors hover:text-navy">
                      <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                      {email}
                    </a>
                    )}
                    {phone && (
                    <a href={'tel:' + phoneTel} className="flex items-center justify-center gap-2 text-muted transition-colors hover:text-navy">
                      <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                      {phone}
                    </a>
                    )}
                  </div>
                  )}
                </div>
              </div>

              {/* Right: bio */}
              <div className="reveal">
                <div className={isWarm ? 'rounded-2xl border border-navy/10 bg-white p-7 shadow-card md:p-9' : 'rounded-2xl border border-gray-100 bg-white p-7 shadow-card md:p-9'}>
                  <h3 className="font-heading text-2xl font-extrabold text-navy">About {name}</h3>
                  <div className="mt-3 h-1 w-16 rounded-full bg-gold"></div>

                  {hasBio ? (
                  <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-ink dignitary-bio" dangerouslySetInnerHTML={{ __html: bioHtml }}></div>
                  ) : (
                  <p className="mt-6 text-[15px] leading-relaxed text-muted">A detailed profile will be available soon.</p>
                  )}

                  <a href="/" className={isWarm ? 'mt-8 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-white transition hover:bg-gold-cta' : 'mt-8 inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-deep'}>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                    Back to Home
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ══ Empty state (only if a club President/Secretary row is genuinely missing) ══ */
        <section className="bg-canvas py-24">
          <div className="container-x">
            <div className="reveal mx-auto max-w-xl rounded-2xl border border-navy/10 bg-white p-10 text-center shadow-card">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-navy/5 text-navy">
                <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>
              </div>
              <h2 className="font-heading text-xl font-bold text-navy">Profile not available</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">We couldn&rsquo;t find this leadership profile right now. Please check back soon.</p>
              <a href="/" className="btn-gold mt-7 inline-flex">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                Back to Home
              </a>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
