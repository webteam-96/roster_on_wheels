'use client'
// ─────────────────────────────────────────────────────────────────────────────
// GOLD — the small pieces every redesigned page shares.
//
// This is deliberately THIN. The brief for Stage B is one brand, fourteen
// different page experiences, so what is shared here is the brand's vocabulary —
// the crumb rail, the word-mask headline, the arrow, the empty state, the image
// fallbacks — and never a page layout. Compositions live in the page files.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { formatMoney, groupInt } from '@/themes/shared/money.js'

export const REDUCED = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
)

/** Walks a `data-fallbacks` chain, then hides — never a broken-image glyph. */
export function imgFallback(e) {
  const el = e.currentTarget
  const rest = (el.getAttribute('data-fallbacks') || '').split('|').filter(Boolean)
  if (rest.length) {
    el.setAttribute('data-fallbacks', rest.slice(1).join('|'))
    el.src = rest[0]
  } else {
    el.style.visibility = 'hidden'
  }
}

/** A photo that simply isn't there — hide it and let whatever sits behind
 *  (initials, a crest, a tint) show through. */
export function hideOnError(e) { e.currentTarget.style.visibility = 'hidden' }

/** Portrait fallback: the Rotary wheel on the card's own ground. The class check
 *  is the re-entry guard — clearing el.onerror does nothing to React's delegated
 *  handler, so a failing wheel.png would otherwise loop forever. */
export function portraitFallback(e) {
  const el = e.currentTarget
  if (el.classList.contains('is-ph')) { el.style.visibility = 'hidden'; return }
  el.src = '/images/logo/wheel.png'
  el.classList.add('is-ph')
}

/** homeData hands "Not available" leaders the legacy grey headshot — that IS a
 *  missing photo, so treat it as one rather than showing the placeholder art. */
export const isPlaceholderPhoto = (src) => !src || /profile_pic\.png$/i.test(src)

/**
 * The theme's headline motif: a gold eyebrow, an Anton title whose words rise
 * out of their own masks, and a short rule drawn left to right. Identical
 * mechanics to the home page's SHead (gold.css owns the animation), so a visitor
 * moving between pages meets the same gesture even though the layouts differ.
 *
 * `em` is the gold tail. Both are plain strings — splitting arbitrary JSX into
 * words is not worth the machinery.
 */
export function GHead({ eyebrow, title, em, action, align, className }) {
  const words = [
    ...String(title || '').split(' ').filter(Boolean).map((w) => [w, false]),
    ...String(em || '').split(' ').filter(Boolean).map((w) => [w, true]),
  ]
  return (
    <div className={'gld-shead reveal' + (align === 'center' ? ' gp-head--center' : '') + (className ? ' ' + className : '')}>
      <div className="gld-shead__main">
        {eyebrow ? <p className="gld-shead__e">{eyebrow}</p> : null}
        <h2 className="gld-shead__t">
          {words.map(([w, isEm], i) => (
            // the trailing space is a TEXT NODE between masks, so lines still
            // wrap between words and screen readers hear normal prose
            <span key={i} className={'gld-w' + (isEm ? ' gld-w--em' : '')} style={{ '--wi': i }}><span>{w}</span></span>
          )).reduce((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
        </h2>
        <span className="gld-shead__r" aria-hidden="true" />
      </div>
      {action || null}
    </div>
  )
}

/**
 * THE STANDARD PAGE HEAD — one masthead, every page.
 *
 * Stage B originally let each page open with its own top band: cream on five,
 * navy on five, no band at all on three, five different eyebrow classes and six
 * different H1 sizes. Same brand, but a visitor moving between pages met a
 * different masthead each time. This promotes the About page's band — the one
 * that read best — into the shared vocabulary:
 *
 *   crumb rail → gold eyebrow with its drawn lead → Anton title →
 *   one line of sub-copy → an optional aside on the right
 *
 * and then whatever that page needs underneath as `children` (an impact ledger,
 * a search field, view toggles). Page CHARACTER now starts BELOW this band
 * rather than replacing it, so the way in is identical everywhere.
 *
 * It is CREAM on every page and stays that way — a gold-ground variant was tried
 * on two pages and pulled (user's call): the point of the band is that it is the
 * same one everywhere.
 */
export function GPageHead({ crumbs, eyebrow, title, sub, aside, children, className }) {
  return (
    <section className={'gp-head' + (className ? ' ' + className : '')}>
      <div className="gld-x">
        <GCrumbs items={crumbs} />
        <div className="gp-head__in">
          <div className="gp-head__main reveal">
            {eyebrow ? <p className="gld-cap">{eyebrow}</p> : null}
            <h1 className="gp-head__t">{title}</h1>
            {sub ? <p className="gp-head__s">{sub}</p> : null}
          </div>
          {aside ? <div className="gp-head__aside reveal">{aside}</div> : null}
        </div>
        {children}
      </div>
    </section>
  )
}

/** Crumb rail. Detail pages that open on a photograph use this alone — their
 *  headline is already IN the picture, so the band would print it twice. */
export function GCrumbs({ items }) {
  return (
    <nav className="gp-crumbs" aria-label="Breadcrumb">
      <a href="/">Home</a>
      {items.map((it, i) => (
        <span key={i}>
          <span className="gp-crumbs__sep" aria-hidden="true">/</span>
          {it.href
            ? <a href={it.href}>{it.label}</a>
            : <span aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  )
}

/** The on-brand "nothing here yet" card. Every page uses the same one so an
 *  empty club still reads as designed rather than broken. */
export function GEmpty({ title, message, action, icon }) {
  return (
    <div className="gp-empty reveal">
      <span className="gp-empty__ico" aria-hidden="true">
        {icon || (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        )}
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action || null}
    </div>
  )
}

/**
 * Re-arms the shared reveal observer on the way back INTO the viewport.
 *
 * rotary-anim's observer only ever ADDS .is-visible and then unobserves, so an
 * entrance plays once per page load. Gold's home page replays instead, and these
 * pages have to match or the theme would animate differently depending on which
 * page you are on. Removing the class restarts the CSS animation; the removal
 * happens at zero pixels visible, so it is never seen.
 */
export function useRevealReplay(root, deps) {
  useEffect(() => {
    if (REDUCED) return undefined
    const els = document.querySelectorAll('.' + root + ' .reveal')
    if (!els.length) return undefined
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        // A ratio alone is not enough: a club's About copy can be 11,000px
        // tall, and 10% of that never fits on screen — the block stayed at
        // opacity 0 forever, reading as a page of empty space. Anything
        // taller than the viewport counts as visible the moment it touches it.
        if (e.isIntersecting
            && (e.intersectionRatio >= 0.1 || e.boundingClientRect.height >= window.innerHeight))
          e.target.classList.add('is-visible')
        else if (!e.isIntersecting) e.target.classList.remove('is-visible')
      }
    }, { threshold: [0, 0.1] })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Compact money for the headline figures: ₹3.90 Cr / ₹4.25 L / ₹12,000 on an
 *  INR club, Rs 8.16 M on a Sri Lankan one. `currency` omitted => INR. */
export function money(n, currency) { return formatMoney(n, currency, { compact: true }) }

export function count(n, currency) { return groupInt(n, currency) }
