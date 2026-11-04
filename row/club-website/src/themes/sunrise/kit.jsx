'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE — the theme's reusable pieces. Page agents build every inner page
// from these so thirteen routes read as one site (see DESIGN.md for the API and
// examples). Look lives in theme.css; motion helpers in motion.js.
//
// Self-animating pieces (PageHero, StatRow, Drum, People) run their own
// useScene: a page only has to render them. Everything else is plain markup the
// page animates with motion.js helpers inside its own useScene.
// ─────────────────────────────────────────────────────────────────────────────
import { Children, useEffect, useId, useRef, useState } from 'react'
import { useCurrentMenuName, usePageTitle, formatMoney, groupInt, plainText, adAnchorProps, externalUrl, socialLabel, formatYear } from '../_shared/data.js'
import { PersonPhoto, SafeImg, paragraphs, imgFallback, hideOnError, portraitFallback, isPlaceholderPhoto, useFitNumbers } from '../_shared/kit.jsx'
import { useScene, pageHeroIn, countUp, cleanups, drum, riseArches, prefersReducedMotion } from './motion.js'
import { ADMIN_LOGIN_URL } from '@/site/adminUrl.js'

export { PersonPhoto, SafeImg, paragraphs, imgFallback, hideOnError, portraitFallback, isPlaceholderPhoto }

export const ADMIN_URL = ADMIN_LOGIN_URL

// ── icons (stroke = currentColor) ───────────────────────────────────────────
const svg = (d, extra) => ({ className, ...p }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true" focusable="false" className={className} {...extra} {...p}>{d}</svg>
)
export const Arrow = svg(<path d="M2 8h11M9 4l4 4-4 4" />)
export const ArrowLeft = svg(<path d="M14 8H3M7 4 3 8l4 4" />)
export const ArrowUpRight = svg(<path d="M5 3h8v8M13 3 3 13" />)
export const Chevron = svg(<path d="M3.5 6 8 10.5 12.5 6" />)
export const SearchIcon = svg(<><circle cx="7" cy="7" r="4.6" /><path d="m10.5 10.5 3.5 3.5" /></>)
export const CloseIcon = svg(<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />)
export const PinIcon = svg(<><path d="M8 14.5s4.5-4.2 4.5-7.8a4.5 4.5 0 0 0-9 0c0 3.6 4.5 7.8 4.5 7.8z" /><circle cx="8" cy="6.7" r="1.6" /></>)
export const ClockIcon = svg(<><circle cx="8" cy="8" r="6.3" /><path d="M8 4.6V8l2.4 1.5" /></>)
export const CalendarIcon = svg(<><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></>)

/** target/rel for a link that opens in a new tab. */
export const ext = { target: '_blank', rel: 'noopener noreferrer' }
/** Screen-reader note to append inside a new-tab link. */
export const NewTab = () => <span className="sun-sr"> (opens in a new tab)</span>

// ── text helpers ────────────────────────────────────────────────────────────
/** A Rotary year label for display, the same on every page: "2026-2027" -> "2026–27". '' when none. */
export const yearText = (label) => (label ? String(formatYear(label)).replace('-', '–') : '')

/** Admin HTML can carry its own <h1>; every route keeps one h1 (the page head's). */
export const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2')

/** An admin-typed link for a new tab: a bare host gets https:// (else it opens as a site path); site paths stay. */
export const openHref = (u) => {
  const s = String(u || '').trim()
  return s.charAt(0) === '/' && s.charAt(1) !== '/' ? s : externalUrl(s)
}

export const noEmoji = (s) => String(s || '').replace(/\p{Extended_Pictographic}[\u{FE0F}]?/gu, '').replace(/\s{2,}/g, ' ').trim()

/** The API's address joins double up ("Thane,, Thane, …", "Wagle State , Thane"): one ", " between parts. */
export const venueText = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean).join(', ')

/**
 * A clean excerpt of API text (HTML or plain). API descriptions stop mid-word;
 * this keeps whole sentences when most of the text survives, else ends on a
 * word with an ellipsis. "Dr." / "Rtr." never count as sentence ends.
 */
export function excerpt(text, max = 220) {
  const s = noEmoji(plainText(text))
  if (s.length <= max) return s
  const zone = s.slice(0, max + 1)
  const re = /[.!?]["'’”)]?(?=\s)/g
  let m, cut = -1
  while ((m = re.exec(zone))) {
    const w = zone.slice(0, m.index).match(/(\S+)$/)
    if (w && (/\d$/.test(w[1]) || w[1].replace(/[^A-Za-z]/g, '').length > 3)) cut = m.index + m[0].length
  }
  if (cut > max * 0.55) return s.slice(0, cut).trim()
  const sp = zone.lastIndexOf(' ')
  return s.slice(0, sp > 0 ? sp : max).replace(/[,;:\s–—-]+$/, '') + '…'
}

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'
const DATE_RE = new RegExp('\\b(' + MONTH + '\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH + ',?\\s+\\d{4}|(?:18|19|20)\\d{2})\\b', 'g')
/** The lead-line accent from the sample: the first date (or year) in a sentence, in italic accent.
 *  A year inside a code or number is not one: "ISO 9001:2008" lit up its "2008". */
export function emFirstDate(text) {
  const s = String(text || '')
  for (const m of s.matchAll(DATE_RE)) {
    if (/[\d:./-]/.test(s[m.index - 1] || '')) continue
    return [s.slice(0, m.index), <em key="d">{m[0]}</em>, s.slice(m.index + m[0].length)]
  }
  return s
}

// ── breadcrumb + page hero ──────────────────────────────────────────────────
/** Home / …items; the last item is the current page (no href). */
export function Crumbs({ items }) {
  return (
    <nav className="sun-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/">Home</a></li>
        {items.map((it, i) => (
          <li key={i}>
            {i < items.length - 1
              ? (it.href ? <a href={it.href}>{it.label}</a> : <span>{it.label}</span>)
              : <span aria-current="page">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * THE page head, every inner page: a short band holding only the breadcrumb
 * and the page's ONE <h1> (client, 2026-09-29: "keep only main heading &
 * links"), a sun glow and ring behind. No eyebrow, lead or aside.
 *
 * title      - the page name. By default the club's own menu label for this
 *              route wins (what the visitor clicked), like every other theme.
 *              Pass menuTitle={false} on detail pages (a project's title).
 * crumbs     - items after Home, e.g. [{label:'Projects', href:'/projects'}, {label:p.title}].
 *              Omitted -> [{label: title}].
 * children   - functional controls only (search + count, filter chips, a month
 *              switch, a switcher, stats): rendered right AFTER the band, in
 *              <div class="sun-wrap sun-ph-after">, as the page body's first row.
 * size       - 'lg' (default) or 'md' for long titles (detail pages).
 * docTitle   - document <title>; defaults to the shown title.
 * Motion: pageHeroIn (sun rises, letters arrive from depth, title drifts past on scroll).
 */
export function PageHero({ title, crumbs, children, size = 'lg', menuTitle = true, docTitle, className = '' }) {
  const menuName = useCurrentMenuName()
  const t = (menuTitle && menuName && String(menuName).trim()) || title || ''
  usePageTitle(docTitle || t)
  const ref = useRef(null)
  const hid = useId()
  useScene(ref, (c, ctx) => pageHeroIn(ref.current, c, ctx), [t])
  const items = crumbs && crumbs.length ? crumbs : [{ label: t }]
  return (
    <>
      <section ref={ref} className={'sun-ph' + (size === 'md' ? ' sun-ph--md' : '') + (className ? ' ' + className : '')} aria-labelledby={hid}>
        <div className="sun-ph__sun" aria-hidden="true" />
        <div className="sun-ph__ring" aria-hidden="true" />
        <div className="sun-wrap">
          <Crumbs items={items} />
          {/* key: SplitText replaces the text node, so a new title (the menu label arriving) needs a fresh <h1> */}
          <h1 key={t} id={hid} className="sun-ph__title">{t}</h1>
        </div>
        <span className="sun-ph__horizon" aria-hidden="true" />
      </section>
      {/* always rendered (hidden while :empty): pageHeroIn finds it on mount, so tools that arrive with the data still fade in */}
      <div className="sun-wrap sun-ph-after">{children}</div>
    </>
  )
}

/**
 * Section heading: eyebrow, Unbounded h2 (.sun-fly - animate with flyTitle), intro, action on the right.
 * Every section heading is one size (--sun-h2-size, client 2026-10-05): no small variant.
 */
export function SectionHead({ eyebrow, title, intro, action, id, as: H = 'h2', center, className = '' }) {
  return (
    <div className={'sun-shead' + (center ? ' sun-shead--center' : '') + (className ? ' ' + className : '')}>
      <div className="sun-shead__main">
        {eyebrow ? <p className="sun-eyebrow">{eyebrow}</p> : null}
        <H id={id} className="sun-h2 sun-fly">{title}</H>
        {intro ? <p className="sun-shead__intro">{intro}</p> : null}
      </div>
      {action || null}
    </div>
  )
}

// ── buttons ─────────────────────────────────────────────────────────────────
/**
 * variant: 'sun' (gold gradient, the main action) | 'line' (outlined) | 'dark'
 * (on the sheet / sunrise grounds). href -> <a>, else <button type="button">.
 * external -> new tab + sr note. icon: 'arrow' | 'ext' | 'back' | false.
 */
export function Button({ href, variant = 'sun', small, external, icon, children, className = '', ...rest }) {
  const cls = 'sun-btn sun-btn--' + variant + (small ? ' sun-btn--sm' : '') + (className ? ' ' + className : '')
  const kind = icon === undefined ? (external ? 'ext' : 'arrow') : icon
  const ico = kind === 'ext' ? <ArrowUpRight /> : kind === 'arrow' ? <Arrow /> : kind === 'back' ? <ArrowLeft /> : null
  if (href) {
    return (
      <a className={cls} href={href} {...(external ? ext : {})} {...rest}>
        {kind === 'back' ? ico : null}{children}{external ? <NewTab /> : null}{kind !== 'back' ? ico : null}
      </a>
    )
  }
  return <button type="button" className={cls} {...rest}>{kind === 'back' ? ico : null}{children}{kind !== 'back' ? ico : null}</button>
}

// ── cards ───────────────────────────────────────────────────────────────────
/**
 * The sample's project card: photo (or a sunrise-glow ground when there is
 * none), accent meta line, Unbounded title whose link covers the whole card,
 * 3-line description, "Read more". Put cards in <ul className="sun-grid"><li>.
 * img: URL | '' (ground shows) | false (no photo block). ratio: CSS aspect, e.g. '16/9'.
 * fit: 'cover' (default: fills the frame, cropped, zooms on hover) | 'contain'
 * (the WHOLE photo over a blurred fill of itself - never cropped, no zoom).
 */
export function Card({ href, img, alt = '', ratio, fit = 'cover', meta, title, desc, more = 'Read more', level = 3, external, className = '', children, onImgError }) {
  const H = 'h' + level
  const whole = fit === 'contain'
  const err = onImgError ? { onError: onImgError } : {}
  return (
    <article className={'sun-card' + (className ? ' ' + className : '')}>
      {img === false ? null : (
        <div className={'sun-card__img' + (whole ? ' sun-card__img--contain' : '')} style={ratio ? { '--sun-ar': ratio } : undefined}>
          {/* the fill comes first: under the photo, and the img a scene's '.sun-card__img img' finds */}
          {img && whole ? <SafeImg className="sun-card__fill" src={img} alt="" aria-hidden="true" {...err} /> : null}
          {img ? <SafeImg src={img} alt={alt} width={800} height={600} {...err} /> : null}
        </div>
      )}
      <div className="sun-card__body">
        {meta ? <p className="sun-card__meta">{meta}</p> : null}
        <H className="sun-card__title">
          {href ? <a className="sun-card__link" href={href} {...(external ? ext : {})}>{title}{external ? <NewTab /> : null}</a> : title}
        </H>
        {desc ? <p className="sun-card__desc">{desc}</p> : null}
        {children}
        {href && more ? <span className="sun-card__more" aria-hidden="true">{more} →</span> : null}
      </div>
    </article>
  )
}

/** A plain surface (card ground, radius 24) for panels, forms, info blocks. */
export function Panel({ as: El = 'div', className = '', children, ...rest }) {
  return <El className={'sun-panel' + (className ? ' ' + className : '')} {...rest}>{children}</El>
}

// ── filters ─────────────────────────────────────────────────────────────────
/** Toggle-button group. options: [{ value, label, count?, aria? }] (aria = the spoken name, e.g. '#' -> 'Other names'). */
export function Chips({ label, options, value, onChange, className = '' }) {
  return (
    <div className={'sun-chips' + (className ? ' ' + className : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="sun-chip" aria-pressed={o.value === value}
                aria-label={o.aria} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && o.count !== null ? <span className="sun-chip__n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Search box (16px text so phones don't zoom), with a clear button once typed in. */
export function SearchField({ label = 'Search', placeholder, value, onChange, className = '' }) {
  const id = useId()
  const input = useRef(null)
  return (
    <div className={'sun-search' + (className ? ' ' + className : '')} role="search">
      <label htmlFor={id} className="sun-sr">{label}</label>
      <SearchIcon className="sun-search__ico" />
      <input ref={input} id={id} type="search" value={value} placeholder={placeholder || label} autoComplete="off"
             onChange={(e) => onChange(e.target.value)} />
      {/* the X leaves once the value is empty: hand focus to the field, not <body> */}
      {value ? (
        <button type="button" className="sun-search__clear" onClick={() => { onChange(''); input.current.focus() }} aria-label="Clear search"><CloseIcon /></button>
      ) : null}
    </div>
  )
}

/** "12 members" / "3 of 40 projects" - announced politely as filters change. */
export function ResultCount({ count, total, noun = 'result', plural, className = '' }) {
  const word = count === 1 ? noun : (plural || noun + 's')
  return (
    <p className={'sun-count' + (className ? ' ' + className : '')} aria-live="polite">
      <b>{count}</b>{total !== undefined && total !== null && total !== count ? ' of ' + total : ''} {word}
    </p>
  )
}

// ── figures ─────────────────────────────────────────────────────────────────
/**
 * The figure row: gradient Unbounded numbers over spaced caps labels, counting
 * up as they arrive. items: [{ label, value, money? } | { label, text }].
 * Zero values are dropped (a "0 Beneficiaries" tile says nothing); returns null
 * when nothing is left. currency: the CLUB's (club.currency / impact.currency).
 */
export function StatRow({ items, currency, center, className = '' }) {
  const shown = (items || []).filter((s) => (s.text && String(s.text).trim()) || Number(s.value) > 0)
  const fmt = (s) => (v) => (s.money ? formatMoney(v, currency) : groupInt(Math.round(v), currency))
  const ref = useRef(null)
  const key = shown.map((s) => s.label + ':' + (s.text || s.value)).join('|') + '|' + currency
  useScene(ref, () => {
    const nums = ref.current.querySelectorAll('.sun-stat__num')
    return cleanups(...shown.map((s, i) => (s.text ? null : countUp(nums[i], Number(s.value), fmt(s)))))
  }, [key])
  // one font size for every figure, the largest at which all fit (client, 2026-10-06)
  useFitNumbers(ref, '.sun-stat__num', '.sun-stat', [key])
  if (!shown.length) return null
  // tile count with a long figure counted twice - odd leaves the last tile alone on a two-up row
  const odd = shown.reduce((n, s) => n + ((s.text ? String(s.text) : fmt(s)(Number(s.value))).length >= 12 ? 2 : 1), 0) % 2 === 1
  return (
    <ul ref={ref} className={'sun-stats' + (center ? ' sun-stats--center' : '') + (odd ? ' is-odd' : '') + (className ? ' ' + className : '')}>
      {shown.map((s) => {
        const txt = s.text ? String(s.text) : fmt(s)(Number(s.value))
        return (
          <li key={s.label} className={'sun-stat' + (txt.length > 9 ? ' sun-stat--long' : '') + (txt.length >= 12 ? ' is-long' : '')}>
            <p className="sun-stat__num" data-fit={txt}>{txt}</p>
            <p className="sun-stat__label">{s.label}</p>
          </li>
        )
      })}
    </ul>
  )
}

// ── states ──────────────────────────────────────────────────────────────────
/** Designed "nothing here yet": a small sun on its horizon, title, message, action. */
export function EmptyState({ title = 'Nothing to show yet', message, action, as: H = 'h2', className = '' }) {
  return (
    <div className={'sun-empty' + (className ? ' ' + className : '')}>
      <span className="sun-empty__sun" aria-hidden="true" />
      <H className="sun-empty__t">{title}</H>
      {message ? <p className="sun-empty__m">{message}</p> : null}
      {action || null}
    </div>
  )
}

/** While a hook returns null / loading. */
export function Loading({ label = 'Loading' }) {
  return (
    <div className="sun-loading" role="status">
      <span className="sun-loading__sun" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  )
}

/** A whole page for an unknown id (ProjectDetail ?pid=0, EventDetail ?id=999): hero + empty state + way back. */
export function NotFound({ title = 'Page not found', message = 'It may have been removed, or it belongs to a different Rotary year.', crumbs, backHref = '/', backLabel = 'Back to home' }) {
  return (
    <div className="sun-page">
      <PageHero title={title} crumbs={crumbs} menuTitle={false} size="md" />
      <div className="sun-wrap sun-block">
        <EmptyState title="Nothing here" message={message} action={<Button href={backHref} variant="line" icon="back">{backLabel}</Button>} />
      </div>
    </div>
  )
}

// ── people ──────────────────────────────────────────────────────────────────
/**
 * The arch window: halo + arch-topped portrait (initials when there is no photo).
 * decorative - the name is printed right beside it: hidden from screen readers.
 * eager      - above the fold (a page's hero portrait): loads first, not lazily.
 */
export function Arch({ src, name, small, decorative, eager }) {
  return (
    <div className={'sun-arch' + (small ? ' sun-arch--sm' : '')} aria-hidden={decorative ? 'true' : undefined}>
      <div className="sun-arch__halo" aria-hidden="true" />
      <div className="sun-arch__win">
        <PersonPhoto src={src} name={name} alt={decorative ? '' : undefined} className="sun-arch__img" monoClass="sun-arch__mono"
                     width={400} height={500} {...(eager ? { loading: 'eager', fetchpriority: 'high' } : {})} />
      </div>
    </div>
  )
}

/**
 * One person: arch portrait (decorative - the name is right under it), role
 * caps, Unbounded name (whole card is the link when href), optional bio
 * (clamped) and "more" label, then children (an action such as a "Read full
 * bio" button - only on cards without an href). Renders an <li> by default
 * (put it inside <People>); as="div" otherwise.
 */
/** Where a role may wrap: never inside a year range (it orphaned "27" of "2026-27"), and after a slash
 *  ("DIRECTOR/" + "CHAIRMAN": as one word it split inside CHAIRMAN on a 320px phone). */
const roleText = (s) => (typeof s === 'string' ? s.replace(/(\d)-(\d)/g, '$1⁠-⁠$2').replace(/\/(?=\S)/g, '/​') : s)

export function Person({ src, name, role, bio, href, more, small, as: El = 'li', level = 3, className = '', children }) {
  const H = 'h' + level
  return (
    <El className={'sun-person' + (className ? ' ' + className : '')}>
      <Arch src={src} name={name} small={small} decorative />
      {role ? <p className="sun-person__role">{roleText(role)}</p> : null}
      <H className="sun-person__name">{href ? <a href={href}>{name}</a> : name}</H>
      {bio ? <p className="sun-person__bio">{bio}</p> : null}
      {href && more ? <span className="sun-person__more" aria-hidden="true">{more} →</span> : null}
      {children}
    </El>
  )
}

/** Centered rows of people (4 across wide, 2 on phones) whose portraits rise like suns. */
export function People({ children, className = '', cols, animate = true, deps = [] }) {
  const ref = useRef(null)
  const n = Children.count(children)
  useScene(ref, (c) => { if (animate) riseArches(ref.current.children, c, cols) }, [animate, cols, n, ...deps])
  return <ul ref={ref} className={'sun-people' + (className ? ' ' + className : '')}>{children}</ul>
}

// ── lists ───────────────────────────────────────────────────────────────────
/**
 * The drum: a numbered list whose lines turn on a cylinder under the reading
 * line as you scroll (a plain numbered list without motion).
 * items: [{ key, label, href? }].
 */
export function Drum({ items, label, className = '' }) {
  const ref = useRef(null)
  useScene(ref, () => drum(ref.current), [items.map((i) => i.key).join('|')])
  return (
    <ol ref={ref} className={'sun-drum' + (className ? ' ' + className : '')} aria-label={label}>
      {items.map((it) => <li key={it.key}>{it.href ? <a href={it.href}>{it.label}</a> : it.label}</li>)}
    </ol>
  )
}

// ── one-palette grounds ─────────────────────────────────────────────────────
/** The cream (dark mode) / white (light mode) sheet with the dawn rule on top. Dark text, dark focus rings. */
export function Sheet({ as: El = 'div', className = '', children, ...rest }) {
  return <El className={'sun-sheet sun-on-light' + (className ? ' ' + className : '')} {...rest}>{children}</El>
}

/** A newsletter cover: night-sky card, a sun rising from its foot, italic serif name, caps sub line.
 *  A narrow cover (theme.css container query) shows the month short: "September 2026" -> "Sep 2026". */
export function Cover({ name, sub }) {
  const short = sub ? sub.replace(/\b([A-Za-z]{3})[A-Za-z]+(?=\s+\d{4}\b)/, '$1') : sub
  // a long single word ("Announcement") sizes the name down until it fits the cover (theme.css --sun-lw)
  const lw = Math.max(0, ...String(name || '').split(/\s+/).map((w) => w.length))
  return (
    <span className="sun-cover">
      <span className="sun-cover__sun" aria-hidden="true" />
      <span className="sun-cover__name" style={lw > 10 ? { '--sun-lw': lw } : undefined}>{name}</span>
      {sub ? (
        <span className="sun-cover__month">
          {short === sub ? sub : <><span className="sun-cover__long">{sub}</span><span className="sun-cover__short">{short}</span></>}
        </span>
      ) : null}
    </span>
  )
}

/** A sun-disc date badge: "24" over "SEP". */
export function DateSun({ day, mon, small, className = '' }) {
  return (
    <span className={'sun-date' + (small ? ' sun-date--sm' : '') + (className ? ' ' + className : '')}>
      <span className="sun-date__d">{day}</span>
      <span className="sun-date__m">{mon}</span>
    </span>
  )
}

/**
 * A date sun rising off a horizon line inside a solid and a dashed ring
 * (decorative - print the date in text too). Size it with --d on className.
 * Motion: grow .sun-rise__ring, rise .sun-rise .sun-date.
 */
export function DateRise({ day, mon, className = '' }) {
  return (
    <div className={'sun-rise' + (className ? ' ' + className : '')} aria-hidden="true">
      <span className="sun-rise__ring" />
      <span className="sun-rise__ring sun-rise__ring--2" />
      <DateSun day={day} mon={mon} />
    </div>
  )
}

/**
 * The club crest: its logo on a white disc inside a glow and three rings (home
 * "about", About page). Motion: ringsRise('.sun-emblem__glow, .sun-emblem__ring').
 */
export function Emblem({ src, alt, onError, className = '' }) {
  return (
    <div className={'sun-emblem' + (className ? ' ' + className : '')}>
      <div className="sun-emblem__glow" aria-hidden="true" />
      <div className="sun-emblem__ring" aria-hidden="true" />
      <div className="sun-emblem__ring" aria-hidden="true" />
      <div className="sun-emblem__ring" aria-hidden="true" />
      <div className="sun-emblem__plate">
        <img src={src} alt={alt} width="191" height="191" loading="lazy" decoding="async" onError={onError} />
      </div>
    </div>
  )
}

// ── social links (footer, About) ────────────────────────────────────────────
const SOCIAL_ICON = {
  facebook: <path d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H6v4h3v9h4v-9h3l1-4h-4V9c0-.6.4-1 1-1z" fill="currentColor" />,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></>,
  linkedin: <path d="M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9h4v1.7c.6-1 1.9-2 3.8-2 4 0 4.2 2.6 4.2 6V21h-4v-5.4c0-1.5 0-3.3-2-3.3s-2.3 1.5-2.3 3.2V21h-4z" fill="currentColor" />,
  twitter: <path d="M4 3h4.5l4.2 5.8L17.8 3H21l-6.8 7.9L21.5 21H17l-4.6-6.3L6.9 21H3.6l7.2-8.4z" fill="currentColor" />,
  // an outline mark, so it reads on any ground (the footer hill, the sky, a card)
  youtube: <><rect x="2" y="5.5" width="20" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m10 15 5-3-5-3z" fill="currentColor" /></>,
  web: <><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" fill="none" stroke="currentColor" strokeWidth="2" /></>,
}
const iconKey = (k) => (k === 'x' ? 'twitter' : SOCIAL_ICON[k] ? k : 'web')

/** The club's social links as round icons (new tab). socials = about.socials rows ({ platform, linkUrl }). Null when none. */
export function SocialLinks({ socials, className = 'sun-socials', label = 'Social media' }) {
  const list = (socials || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim())
  if (!list.length) return null
  return (
    <ul className={className} aria-label={label}>
      {list.map((s, i) => {
        const k = String(s.platform || '').trim().toLowerCase()
        return (
          <li key={i}>
            <a href={externalUrl(s.linkUrl)} {...ext}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{SOCIAL_ICON[iconKey(k)]}</svg>
              <span className="sun-sr">{socialLabel(k)} (opens in a new tab)</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** The three hills (back, mid, front) - decorative; front hill is the footer's colour. */
export function Hills() {
  return (
    <div className="sun-hills" aria-hidden="true">
      <svg className="sun-hill sun-hill--back" viewBox="0 0 1440 320" preserveAspectRatio="none" focusable="false"><path d="M0 150C170 96 300 84 450 118S730 60 900 96S1230 62 1440 104V320H0Z" /></svg>
      <svg className="sun-hill sun-hill--mid" viewBox="0 0 1440 320" preserveAspectRatio="none" focusable="false"><path d="M0 206C160 168 330 150 520 186S860 136 1050 172S1320 150 1440 178V320H0Z" /></svg>
      <svg className="sun-hill sun-hill--front" viewBox="0 0 1440 320" preserveAspectRatio="none" focusable="false"><path d="M0 256C210 224 390 218 610 244S990 206 1190 236S1390 226 1440 232V320H0Z" /></svg>
    </div>
  )
}

// ── the window slideshow (home banners and advertisements; reusable) ────────
/** Slideshow state: autoplays only with motion allowed, pausable (WCAG 2.2.2). */
export function useSlides(n, interval) {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [calm] = useState(prefersReducedMotion)
  useEffect(() => { setIdx(0) }, [n])
  useEffect(() => {
    if (calm || paused || n < 2) return undefined
    const t = setInterval(() => { if (!document.hidden) setIdx((i) => (i + 1) % n) }, interval)
    return () => clearInterval(t)
  }, [calm, paused, n, interval, idx])
  return { idx: Math.min(idx, Math.max(0, n - 1)), setIdx, paused, setPaused, calm }
}

/** Dots + pause for a useSlides() state. Renders nothing for fewer than 2 slides. */
export function SlideCtrl({ n, s, label, className = '', pause = true }) {
  if (n < 2) return null
  return (
    <div className={'sun-slidectrl ' + className} role="group" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <button key={i} type="button" className="sun-dot" aria-current={i === s.idx ? 'true' : undefined} onClick={() => s.setIdx(i)}>
          <span className="sun-sr">Show {i + 1} of {n}</span>
        </button>
      ))}
      {pause && !s.calm && (
        <button type="button" className="sun-pause" aria-pressed={s.paused} onClick={() => s.setPaused((p) => !p)}>
          <span className="sun-sr">{s.paused ? 'Play slideshow' : 'Pause slideshow'}</span>
          <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            {s.paused ? <path d="M3 1.5v11l9.5-5.5z" /> : <><rect x="2" y="1" width="3.5" height="12" rx="1" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" /></>}
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * One slide of a window (.sun-win > .sun-win__slides): the whole picture
 * (contain) over a blurred fill of itself, never cropped. `fallbacks` = a
 * 'a|b|c' chain walked on error (homeData's banners/ads carry one). A slide with
 * a url is the anchor itself (new tab); hidden slides are aria-hidden, out of
 * the tab order and take no pointer.
 */
export function WinSlide({ src, fallbacks, alt, url, on, eager }) {
  const art = (
    <>
      <img className="sun-win__fill" src={src} data-fallbacks={fallbacks} alt="" aria-hidden="true" onError={imgFallback}
           loading={eager ? 'eager' : 'lazy'} decoding="async" />
      <img className="sun-win__img" src={src} data-fallbacks={fallbacks} alt={alt} width="1700" height="530" onError={imgFallback}
           loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchpriority: 'high' } : {})} />
    </>
  )
  const cls = 'sun-win__slide' + (on ? ' is-on' : '')
  return url && url !== '#'
    ? <a className={cls} href={url} {...adAnchorProps(url)} aria-hidden={on ? undefined : 'true'} tabIndex={on ? undefined : -1}>{art}<NewTab /></a>
    : <div className={cls} aria-hidden={on ? undefined : 'true'}>{art}</div>
}
