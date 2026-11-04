'use client'
// Port of EventDetail.aspx + EventDetail.aspx.cs.
//
// There is NO event-detail endpoint: the page pulls the /upcoming-events feed
// (limit 99) and picks the matching id out of it client-side, exactly as the
// code-behind does — including the /past-events fallback below.
import { useEffect, useState } from 'react'
import PhotoLightbox, { LightboxStyles } from '@/themes/shared/PhotoLightbox.jsx'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { useTheme } from '@/site/theme.js'
import { media, externalUrl, wrappableHtml, wheelFallback } from '@/themes/shared/rotaryPage.js'
import Breadcrumb, { EmptyState, enc } from '@/themes/shared/Breadcrumb.jsx'
import { formatTime } from '@/themes/shared/homeData.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { shareUrlFor } from '@/themes/shared/projectShare.jsx'
import { useLocalShare, ShareRow, SHARE_CSS } from '@/themes/shared/ShareRow.jsx'

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** "dd MMMM yyyy, h:mm tt" — invariant, matching the C# formatting. */
export function dateText(d, zone) {
  // No date on the record => C#'s DateTime.MinValue, which formats as this.
  if (!d || Number.isNaN(d.getTime())) return '01 January 0001, 12:00 AM'
  return String(d.getDate()).padStart(2, '0') + ' ' + MONTHS_FULL[d.getMonth()] + ' ' +
    d.getFullYear() + ', ' + formatTime(d, zone)
}

// Plain-text descriptions → encoded paragraphs; already-HTML → emit as-is.
export function buildDescription(desc) {
  if (!desc || !String(desc).trim()) return ''
  // Both branches go through wrappableHtml: the &nbsp; runs admin paste joins
  // words with never wrap, so they get chopped mid-word (or overflow).
  desc = wrappableHtml(desc)
  if (String(desc).indexOf('<') >= 0) return desc   // trusted rich HTML from admin
  return '<p>' + enc(String(desc).trim()).replace(/\n/g, '<br/>') + '</p>'
}

const NOT_FOUND = { found: false }

export default function EventDetail({ data }) {
  const club = useClub()
  const { clubId } = club
  const { isWarm } = useTheme()
  const location = useLocation()
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0
  // The server finds the event among upcoming and past events (themes/shared/loaders.ts).
  const found = data.event
  const ev = !found ? NOT_FOUND : {
    found: true,
    eventTitle: found.title,
    venue: !found.venue || !String(found.venue).trim() ? '' : String(found.venue).trim(),
    dateText: dateText(found.eventDate ? new Date(found.eventDate) : null, club.timeZone),
    imgUrl: media(found.imagePath),
    registrationLink: externalUrl(found.registrationLink),
    descriptionHtml: buildDescription(found.description),
  }

  // null = viewer closed. A single-image page still uses an index so the shared
  // viewer's paging contract is unchanged.
  const [lbIndex, setLbIndex] = useState(null)

  const hasVenue = !!(ev.venue && ev.venue.trim())
  const hasRegistration = !!(ev.registrationLink && ev.registrationLink.trim())
  const hasImage = !!(ev.imgUrl && ev.imgUrl.trim())

  // Share — the same channel row ProjectDetail carries. Events have no /share
  // endpoint (probed: every URL shape 404s while the project one returns 200),
  // so every field is built here. The link is on the club's OWN domain, exactly
  // as project links are.
  const share = useLocalShare({
    url: shareUrlFor(club, '/event?id=' + id),
    title: ev.eventTitle,
    text: [ev.eventTitle, ev.dateText, ev.venue, club.clubDisplayName].filter(Boolean).join('\n'),
    singleLine: [ev.eventTitle, ev.dateText].filter(Boolean).join(' \u00b7 '),
  })

  useRotaryAnim([found, isWarm, ev.eventTitle])

  return (
    <>
      <LightboxStyles />
      {hasImage && <PhotoLightbox urls={[ev.imgUrl]} index={lbIndex} onIndex={setLbIndex} />}

      <Breadcrumb eyebrow="Events" title={found ? ev.eventTitle : 'Event'} crumbLabel={found ? ev.eventTitle : 'Event'}
                  midLabel="Upcoming Events" midHref="/events" />

      {found ? (
        <>
          {/* ══ Two-column detail: sticky image LEFT, details RIGHT — the same
              arrangement ProjectDetail uses on every theme.

              This markup was warm-modern only; every other theme fell through to a
              stacked card with the image on top and the text beneath. Requested
              2026-08-10 against classic-blue ("make it like the project details
              page"), so the layout is now universal and each theme's palette stays
              in the isWarm ternaries below — exactly how ProjectDetail handles it.
              Every utility here is already proven on all themes because
              ProjectDetail renders ungated with the same classes. ══ */}
          <section className="bg-canvas">
            <div className="container-x py-10 lg:py-14">
              <div className="grid gap-8 lg:grid-cols-2">

                {/* ── LEFT: sticky event image ── */}
                <div className="reveal reveal-left h-full min-w-0">
                  <div className="flex flex-col gap-3 lg:sticky lg:top-24">
                    {hasImage ? (
                      /* The "Upcoming Event" pill that used to sit on this image was
                         removed by request (2026-08-10): the right-hand column carries
                         the same pill directly above the title, so the page showed it
                         twice. The one next to the title is the one that stays.

                         The image opens in the SAME viewer ProjectDetail uses (shared
                         as PhotoLightbox) rather than rotary-anim's plain overlay, so
                         the two detail pages behave identically. With a single image
                         the viewer adds its `single` class, which hides the prev/next
                         arrows and the "1 / N" counter. */
                      <button type="button" onClick={() => setLbIndex(0)} aria-label="View image full size"
                              className={isWarm ? 'img-zoom group relative block w-full overflow-hidden rounded-3xl border border-navy/10 bg-white shadow-card' : 'img-zoom group relative block w-full overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-card'}>
                        {/* contain, NOT cover: the box is a fixed 300/460px band while
                            event photos are whatever the club uploaded — a portrait
                            853x1137 was losing 47% off the top and bottom, i.e. the
                            picture this page exists to show. The button behind is
                            already bg-white, so the letterbox is white. */}
                        <img src={ev.imgUrl} alt={ev.eventTitle}
                             onError={wheelFallback}
                             className="h-[300px] w-full cursor-zoom-in object-contain transition-transform duration-700 group-hover:scale-105 md:h-[460px]" />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-navy/0 opacity-0 transition-all duration-300 group-hover:bg-navy/15 group-hover:opacity-100">
                          <span className="rounded-full bg-white/90 px-4 py-1.5 text-xs font-bold text-navy shadow">View Image</span>
                        </span>
                      </button>
                    ) : (
                      <div className={isWarm ? 'flex h-[300px] w-full items-center justify-center rounded-3xl border border-navy/10 bg-gold/5 text-gold-cta/40 md:h-[460px]' : 'flex h-[300px] w-full items-center justify-center rounded-3xl border border-gray-200 bg-navy/5 text-navy/40 md:h-[460px]'}>
                        <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── RIGHT: details ── */}
                <div className="reveal reveal-right h-full min-w-0">
                  <div className="flex h-full flex-col gap-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={isWarm ? 'inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-bold uppercase tracking-wide text-white' : 'inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-bold uppercase tracking-wide text-navy'}>
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        Upcoming Event
                      </span>
                    </div>

                    <h1 className="font-heading text-2xl font-extrabold leading-tight text-navy md:text-[2rem] md:leading-[1.15]">
                      {ev.eventTitle}
                    </h1>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        <span className="font-semibold text-navy">{ev.dateText}</span>
                      </span>
                      {hasVenue && (
                        <span className="inline-flex items-center gap-1.5">
                          <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          <span className="font-semibold text-navy">{ev.venue}</span>
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">About this event</p>
                      <div className="space-y-4 text-[15px] leading-relaxed text-ink/80" dangerouslySetInnerHTML={{ __html: ev.descriptionHtml }} />
                    </div>

                    <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
                      {hasRegistration && (
                        <a href={ev.registrationLink} target="_blank" rel="noopener noreferrer" data-magnetic
                           className={isWarm ? 'inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gold-cta hover:shadow-md' : 'inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-navy shadow-sm transition-all hover:bg-gold-light hover:shadow-md'}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                          Register
                        </a>
                      )}
                      <a href="/events"
                         className={isWarm ? 'inline-flex items-center gap-2 rounded-full border border-navy/15 bg-white px-5 py-3 text-sm font-semibold text-ink/80 transition hover:border-gold/50 hover:text-gold-cta' : 'inline-flex items-center gap-2 rounded-full bg-navy px-5 py-3 text-sm font-semibold text-white transition hover:bg-navy-deep'}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                        All Events
                      </a>
                    </div>

                    {/* Share row — same channels, same order and same chrome as
                        the project detail page. */}
                    <style>{SHARE_CSS}</style>
                    <div className="pt-1">
                      <ShareRow share={share} isWarm={isWarm} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="bg-canvas py-20">
          <div className="container-x">
            <EmptyState title="Event not found" message="This event is no longer available or has expired. Please check the upcoming events." />
            <div className="mt-6 text-center">
              <a href="/events" className="btn-gold inline-flex">Back to Upcoming Events</a>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
