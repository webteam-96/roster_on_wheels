'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD · PROJECT DETAIL — the dossier.
//
// A project has a photograph, a story, four numbers and (sometimes) a run of
// repeat instances. So the page is built like a case file: the photograph goes
// full-bleed with the title sitting on its bottom edge, the facts and the share
// row become a sticky rail, the numbers are a RULED LEDGER rather than four
// coloured tiles, and the remaining photographs bleed off the right edge as a
// filmstrip — because there being more is the point.
//
// Deliberately the opposite of the event page next door, which is centred and
// symmetrical. Two detail pages that looked alike would make the site feel
// templated, which is exactly what this pass exists to fix.
//
// The lightbox is the SHARED viewer (PhotoLightbox), so the two detail pages
// cannot drift apart, and the update popup is portalled to <body> for the same
// reason the shared page portals its own: <main class="route-enter"> keeps a
// filled transform, which makes it the containing block for position:fixed.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import { useClub } from '@/site/ClubContext.jsx'
import { isLocalRequest } from '@/site/config.js'
import { avenueLabel, usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import PhotoLightbox, { LightboxStyles } from '@/themes/shared/PhotoLightbox.jsx'
import { useProjectShare, shareChannels, sharePopup, SHARE_ICONS } from '@/themes/shared/projectShare.jsx'
import { useOpenGraph, inr } from '@/themes/shared/pages/ProjectDetail.jsx'
import { useProjectGold } from './goldData.js'
import { GCrumbs, GEmpty, Arrow, useRevealReplay, hideOnError } from './kit.jsx'

const I = {
  cal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
  pin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  coin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="m16.71 13.88.7.71-2.82 2.82" /></svg>,
  heart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  zoom: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>,
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Day / month / year for the stamp, or null when the update carries no date. */
function splitDate(raw) {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return { day: String(d.getDate()).padStart(2, '0'), mon: MON[d.getMonth()], year: d.getFullYear() }
}

/**
 * "Jul 2026 - Aug 2026", or one month when every update falls in it. Reads the
 * whole set rather than assuming the API's newest-first order holds.
 */
function runSpan(list) {
  const ds = list.map((c) => (c.date ? new Date(c.date) : null))
              .filter((d) => d && !Number.isNaN(d.getTime()))
              .sort((a, b) => a - b)
  if (ds.length === 0) return ''
  const label = (d) => MON[d.getMonth()] + ' ' + d.getFullYear()
  const from = label(ds[0]), to = label(ds[ds.length - 1])
  return from === to ? from : from + ' – ' + to
}

/** The update panel's body — one component for the popup, so there is no
 *  innerHTML cloning and the photo clicks can be ordinary handlers. */
function UpdateBody({ c, onPhoto }) {
  const figs = [
    c.costText && ['Project cost', c.costText, I.coin],
    c.beneficiaries > 0 && ['Beneficiaries', inr(c.beneficiaries), I.heart],
    c.rotarians > 0 && ['Rotarians', inr(c.rotarians), I.users],
    c.manHours > 0 && ['Man hours', inr(c.manHours), I.clock],
  ].filter(Boolean)

  return (
    <>
      <p className="gpd-sec__cap">Project update</p>
      <h3>{c.title}</h3>
      <div className="gpd-hero__meta" style={{ color: 'var(--g-ink-3)' }}>
        {c.dateText && <span>{I.cal}{c.dateText}</span>}
        {c.location && <span>{I.pin}{c.location}</span>}
      </div>
      {c.photos.length > 0 && (
        <div className="gpd-panel__grid">
          {c.photos.map((ph, i) => (
            <button key={i} type="button" onClick={() => onPhoto(c.photos, i, c.captions)}
                    aria-label={'View photo ' + (i + 1) + ' of ' + c.photos.length}>
              <img src={ph} alt="" loading="lazy" onError={hideOnError} />
            </button>
          ))}
        </div>
      )}
      {figs.length > 0 && (
        <div className="gpd-figs" style={{ marginTop: 'var(--g-4)' }}>
          {figs.map(([l, n, ic]) => (
            <div className="gpd-fig" key={l}>
              <span className="gpd-fig__ic">{ic}</span>
              <span className="gpd-fig__l">{l}</span>
              <span className="gpd-fig__n">{n}</span>
            </div>
          ))}
        </div>
      )}
      {c.descriptionHtml && (
        <div style={{ marginTop: 'var(--g-4)' }}>
          <p className="gpd-sec__cap">Overview</p>
          <div className="gp-prose" dangerouslySetInnerHTML={{ __html: c.descriptionHtml }} />
        </div>
      )}
    </>
  )
}

export default function ProjectDetailGold({ data }) {
  const club = useClub()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const pid = parseInt(params.get('pid'), 10) || 0
  const demoChild = isLocalRequest() && params.get('demoChild') === '1'
  const fromMeetings = params.get('pr') === 'CE'
  const backHref = fromMeetings ? '/projects?pr=CE' : '/projects'
  const backLabel = fromMeetings ? 'Back to Club Services' : 'Back to all projects'

  const { p, notFound } = useProjectGold(pid, demoChild, data)

  usePageTitle(notFound ? 'Project Not Found' : (p ? p.title : null))

  // The API's own share payload (canonical club-domain URL, ready-made text, a
  // 1200x630 card). p.shareFallback keeps the row working without it.
  const share = useProjectShare({
    projectId: p ? p.id : 0,
    yearId: p ? p.yearId : null,
    fallback: p ? p.shareFallback : null,
  })
  const channels = shareChannels(share)

  useOpenGraph(notFound ? null : p, club.clubName, share)

  const [lb, setLb] = useState(null)         // { urls, caps, idx }
  const [openChild, setOpenChild] = useState(null)

  // `caps` travels WITH the urls: the viewer is shared with the update popup,
  // whose photos have no captions, so reading them off the project would show a
  // child's photo 2 with the main gallery's photo-2 caption.
  const openLb = (urls, start, caps) => {
    if (!urls || urls.length === 0) return
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }

  // The popup owns Esc only while the viewer is closed — the viewer sits above
  // it and handles its own keys.
  useEffect(() => {
    if (!openChild || lb) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpenChild(null) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      if (!lb) document.body.style.overflow = ''
    }
  }, [openChild, lb])

  const photos = p ? p.photos : []
  const captions = p ? (p.photoCaptions || []) : []
  const children = p ? p.children : []

  useRotaryAnim([notFound, p, photos.length, children.length])
  useRevealReplay('gpd-page', [p, photos.length, children.length])

  if (notFound) {
    return (
      <div className="gpd-page" style={{ background: 'var(--g-bg)', paddingBlock: 'var(--g-8)' }}>
        <div className="gld-x">
          <GEmpty title="Project not found"
                  message="We couldn't find the project you were looking for. It may have been moved, or it is no longer published."
                  action={<a href={backHref} className="gld-btn gld-btn--gold">{backLabel} <Arrow /></a>} />
        </div>
      </div>
    )
  }
  // Nothing is drawn until the fetch resolves — flashing "not found" first would
  // be a lie, and the Web Forms original is never in this state at all.
  if (!p) return null

  const figs = [
    p.cost !== null && p.cost > 0 && ['Total cost', p.costText, I.coin],
    p.beneficiaries > 0 && ['Beneficiaries', inr(p.beneficiaries), I.heart],
    p.rotarians > 0 && ['Rotarians involved', inr(p.rotarians), I.users],
    p.manHours > 0 && ['Man hours', inr(p.manHours), I.clock],
  ].filter(Boolean)

  return (
    <div className="gpd-page">
      <LightboxStyles />
      <PhotoLightbox urls={lb ? lb.urls : []} index={lb ? lb.idx : null} captions={lb ? lb.caps : null}
                     onIndex={(i) => setLb((l) => (i === null || !l ? null : { ...l, idx: i }))} />

      {/* ══ 01 · The photograph, with the title on its edge ══ */}
      <header className="gpd-hero">
        {photos.length > 0 && (
          <div className="gpd-hero__bg" aria-hidden="true">
            <img src={photos[0]} alt="" onError={hideOnError} />
          </div>
        )}
        <div className="gld-x gpd-hero__in">
          <GCrumbs items={[
            { label: fromMeetings ? 'Club Services' : 'Projects', href: backHref },
            { label: p.title },
          ]} />
          <span className="gp-tag">{avenueLabel(p.moduleKey)}</span>
          <h1 className="gpd-hero__t">{p.title}</h1>
          <div className="gpd-hero__meta">
            {p.dateText && <span>{I.cal}{p.dateText}</span>}
            {p.location && <span>{I.pin}{p.location}</span>}
            {photos.length > 1 && <span>{I.zoom}{photos.length} photographs</span>}
          </div>
        </div>
        {photos.length > 0 && (
          <button type="button" className="gpd-hero__zoom" onClick={() => openLb(photos, 0, captions)}>
            {I.zoom} View full size
          </button>
        )}
      </header>

      {/* ══ 02 · Facts rail + the narrative ══ */}
      <section className="gpd-body">
        <div className="gld-x gpd-body__in">

          {/* The rail's three parts are separate blocks so the phone layout can
              interleave them with the narrative — see the `display: contents`
              re-order in gold-pages.css. On desktop they stack as before. */}
          <aside className="gpd-rail reveal">
            <div className="gpd-rec">
              <p className="gpd-rail__cap">Record</p>
              <span className="gp-f"><i>Avenue</i><b>{avenueLabel(p.moduleKey)}</b></span>
              {p.dateText && <span className="gp-f"><i>Date</i><b>{p.dateText}</b></span>}
              {p.location && <span className="gp-f"><i>Venue</i><b>{p.location}</b></span>}
              {club.selectedYearLabel && <span className="gp-f"><i>Rotary year</i><b>{club.selectedYearLabel}</b></span>}
            </div>

            {/* One mapped row over the shared channel list, so gold gains any
                channel added in shared/projectShare.jsx without a second copy of
                the icons. --gpd-brand tints the hover per network. */}
            <div className="gpd-shr">
            <p className="gpd-rail__cap" style={{ marginTop: 'var(--g-4)' }}>Share</p>
            <div className="gpd-share">
              {channels.map((ch) => {
                const style = ch.brand ? { '--gpd-brand': ch.brand } : undefined
                const glyph = (
                  <svg viewBox="0 0 24 24" aria-hidden="true"
                       fill={ch.fill ? 'currentColor' : 'none'}
                       stroke={ch.fill ? 'none' : 'currentColor'}
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {ch.done ? SHARE_ICONS.check : ch.icon}
                  </svg>
                )
                return ch.href ? (
                  <a key={ch.key} href={ch.href} aria-label={ch.label} title={ch.label}
                     className={ch.brand ? 'is-brand' : undefined} style={style}
                     target={ch.key === 'mail' ? undefined : '_blank'}
                     rel={ch.key === 'mail' ? undefined : 'noopener noreferrer'}
                     onClick={ch.popup ? sharePopup : undefined}>
                    {glyph}
                  </a>
                ) : (
                  <button key={ch.key} type="button" aria-label={ch.label} title={ch.label}
                          className={ch.brand ? 'is-brand' : undefined}
                          style={style} onClick={ch.onClick}>
                    {glyph}
                    {ch.doneLabel && (
                      <span className={'gpd-share__toast' + (ch.done ? ' is-on' : '')}>{ch.doneLabel}</span>
                    )}
                  </button>
                )
              })}
            </div>
            </div>

            <a href={backHref} className="gld-btn gld-btn--ghost gpd-back" style={{ marginTop: 'var(--g-5)' }}>
              {I.back} {backLabel}
            </a>
          </aside>

          <div className="gpd-main">
            {p.description && (
              <div className="gpd-sec gpd-ov reveal">
                <p className="gpd-sec__cap">Overview</p>
                {/* Trusted admin rich HTML — rendered verbatim. */}
                <div className="gp-prose" dangerouslySetInnerHTML={{ __html: p.description }} />
              </div>
            )}

            {/* The first photo's caption used to print here as loose body copy,
                which read as part of the club's write-up. It belongs to the
                PICTURE — PhotoLightbox already shows the caption of whichever
                frame is open, so it appears there and only there (user's call). */}

            {figs.length > 0 && (
              <div className="gpd-sec gpd-nums reveal">
                <h2 className="gpd-sec__h">By the numbers</h2>
                <div className="gpd-figs">
                  {figs.map(([l, n, ic]) => (
                    <div className="gpd-fig" key={l}>
                      <span className="gpd-fig__ic">{ic}</span>
                      <span className="gpd-fig__l">{l}</span>
                      <span className="gpd-fig__n">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {photos.length > 1 && (
              /* A contact sheet, not a scroll strip: the first frame leads at
                 poster size and the rest tile around it, each numbered like a
                 negative and carrying its own caption. The strip showed every
                 photograph at the same small size and hid most of them off the
                 right edge. */
              <div className="gpd-sec reveal">
                <h2 className="gpd-sec__h">Photographs</h2>
                <p className="gpd-sheet__k">
                  {photos.length} frames &middot; tap any to view full size
                </p>
                <div className="gpd-sheet gld-stagger">
                  {photos.map((url, i) => (
                    <button key={i} type="button"
                            className={'gpd-frame' + (i === 0 ? ' gpd-frame--lead' : '')}
                            onClick={() => openLb(photos, i, captions)}
                            aria-label={'View photo ' + (i + 1) + ' of ' + photos.length}>
                      <img src={url} alt="" loading="lazy" onError={hideOnError} />
                      <span className="gpd-frame__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                      <span className="gpd-frame__z" aria-hidden="true">{I.zoom}</span>
                      {captions[i] && <span className="gpd-frame__c">{captions[i]}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {children.length > 0 && (
              <div className="gpd-sec reveal">
                <h2 className="gpd-sec__h">Project updates</h2>
                {/* Count + span, not a sentence. It says the same word the
                    Projects card said ("3 updates") and adds the one fact the
                    rows below cannot show at a glance: how long this has run. */}
                <p className="gpd-sec__cap">
                  {children.length} update{children.length === 1 ? '' : 's'}
                  {runSpan(children) && <span className="gpd-run__span"> · {runSpan(children)}</span>}
                </p>
                <ol className="gpd-runs">
                  {children.map((c) => {
                    const d = splitDate(c.date)
                    return (
                      <li key={c.id}>
                        <button type="button" className="gpd-run" onClick={() => setOpenChild(c)}>
                          {/* The date IS the identity of an update — which time
                              the club ran this. The old 01/02/03 numbered the
                              DISPLAY order of a newest-first list, so "01" sat on
                              the most recent one and meant nothing. */}
                          <span className="gpd-run__d" aria-hidden={!d}>
                            {d ? (<>
                              <b>{d.day}</b>
                              <i>{d.mon}</i>
                              <u>{d.year}</u>
                            </>) : <i>Undated</i>}
                          </span>
                          <span className="gpd-run__b">
                            <span className="gpd-run__t">{c.title}</span>
                            {/* One span per fact, so the CSS separator stays glued
                                to the text after it. Joining with " · " let the
                                bullet orphan at the end of a wrapped line. */}
                            <span className="gpd-run__m">
                              {c.location && <span>{c.location}</span>}
                              {c.beneficiaries > 0 && (
                                <span className="gpd-run__stat">{c.beneficiaries.toLocaleString('en-IN')} beneficiaries</span>
                              )}
                            </span>
                            <span className="gpd-run__rule" aria-hidden="true" />
                          </span>
                          <span className="gpd-run__p">
                            {c.photos.length > 0
                              ? <img src={c.photos[0]} alt="" loading="lazy" onError={hideOnError} />
                              : null}
                            {/* Always visible, never hover-only: a phone has no
                                hover and the row still has to say it opens. */}
                            <span className="gpd-run__z" aria-hidden="true">{I.zoom}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
          </div>

        </div>
      </section>

      {/* Portalled to <body>: <main class="route-enter"> keeps a filled transform,
          which makes it the containing block for position:fixed descendants, so
          an in-tree overlay would anchor to the page instead of the viewport. */}
      {createPortal(
        <div className={'gpd-modal' + (openChild ? ' is-open' : '')} role="dialog" aria-modal="true"
             aria-label="Project update">
          <div className="gpd-modal__bg" onClick={() => setOpenChild(null)} />
          <div className="gpd-panel">
            <button type="button" className="gpd-panel__x" aria-label="Close" onClick={() => setOpenChild(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
            <div className="gpd-panel__scroll">
              {openChild && <UpdateBody c={openChild} onPhoto={openLb} />}
            </div>
          </div>
        </div>, document.body)}
    </div>
  )
}
