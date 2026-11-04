'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY — the theme's reusable pieces (read DESIGN.md first).
//
// Derived from the approved sample (Theme8-Samples/F-horizontal-journey): the
// ridges, the chapter kicker + Unbounded title, the pill buttons, the white
// photo card, the arch portrait, the shape figures, the dawn/night skies.
// Styles live in theme.css (every class starts hj-). Motion lives in motion.js;
// the components that animate themselves (PageHero, StatRow) do it through
// useScene, so reduced motion shows them complete and still.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { usePageTitle, useCurrentMenuName, groupInt } from '../_shared/data.js'
import { PersonPhoto, useFitNumbers } from '../_shared/kit.jsx'
import { RIDGE, ridgeD, useScene, afterFonts, heroIn, countUp, statsIn, lockScroll } from './motion.js'

export { PersonPhoto, SafeImg, paragraphs, imgFallback, hideOnError, isPlaceholderPhoto } from '../_shared/kit.jsx'

// ── text helpers ─────────────────────────────────────────────────────────────
/** Admin rich HTML -> plain text. DOMParser builds an inert document: no image loads, no handlers run. */
export function htmlText(html) {
  if (!html || !String(html).trim()) return ''
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

/** Cut to about `n` characters on a word boundary, with an ellipsis. */
export function cut(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const h = t.slice(0, n)
  const sp = h.lastIndexOf(' ')
  return (sp > n * 0.6 ? h.slice(0, sp) : h).replace(/[\s,;:.\-–]+$/, '') + '…'
}

/** "2026-2027" -> "2026–27" (display form of a Rotary year label). */
export function yearText(label) {
  const s = String(label || '').trim()
  const m = s.match(/^(\d{4})\s*[-–]\s*(\d{2,4})$/)
  return m ? m[1] + '–' + m[2].slice(-2) : s
}

/** "August 2026- Hill Echoes" -> cover name "Hill Echoes", edition "August 2026" (newsletter covers: home + Newsletters). */
const EDITION = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(vol|volume|issue|edition)\b/i
export function coverTitle(t) {
  const s = String(t || '').trim()
  const parts = s.split(/\s*[-–—|:]\s+|\s+[-–—|]\s*/)
  if (parts.length === 2 && parts[0] && parts[1]) {
    const a = EDITION.test(parts[0]), b = EDITION.test(parts[1])
    if (a && !b) return { name: parts[1], ed: parts[0] }
    if (b && !a) return { name: parts[0], ed: parts[1] }
  }
  return { name: s, ed: '' }
}

/** Chapter tone for an avenue (label or code) — used by <Chip> and filters. */
export function avenueTone(v) {
  const s = String(v || '').toLowerCase()
  if (s === 'cp' || s.includes('community')) return 'cran'
  if (s === 'cs' || s.includes('club service')) return 'turq'
  if (s === 'vs' || s.includes('vocational')) return 'gold'
  if (s === 'is' || s.includes('international')) return 'azure'
  if (s === 'ngs' || s.includes('generation') || s.includes('youth')) return 'violet'
  if (s === 'pii' || s.includes('public image')) return 'royal'
  return 'ink'
}

// ── icons ────────────────────────────────────────────────────────────────────
export const IconArrow = () => (
  <svg className="hj-ico" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" /></svg>
)
export const IconOut = () => (
  <svg className="hj-ico" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 11 11 5M6 5h5v5" /></svg>
)
export const IconBack = () => (
  <svg className="hj-ico" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 8h-11M7 3.5 2.5 8 7 12.5" /></svg>
)

// ── ridges ───────────────────────────────────────────────────────────────────
/**
 * One hill silhouette, drawn at its real pixel width (so hills keep their
 * shape on a phone instead of being squeezed). `preset` is a RIDGE key from
 * motion.js; `seed` offsets the line so stacked ridges differ; `fill`/`rim`
 * override the preset (any CSS colour or var()). Position it with className.
 */
export function Ridge({ preset = 'far', seed = 0, fill, rim, className = '' }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const nw = Math.round(el.getBoundingClientRect().width)
      if (nw > 0) setW((o) => (o === nw ? o : nw))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const base = RIDGE[preset] || RIDGE.far
  const o = { ...base, seed: base.seed + seed, fill: fill || base.fill, rim: rim === undefined ? base.rim : rim }
  const d = w > 0 ? ridgeD(w, o) : null
  return (
    <svg ref={ref} className={'hj-rg ' + className} viewBox={'0 0 ' + (w || 100) + ' 100'} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {d && <path d={d.area} style={{ fill: o.fill }} />}
      {d && o.rim && <path d={d.line} fill="none" style={{ stroke: o.rim }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

// ── buttons, chips ───────────────────────────────────────────────────────────
/**
 * Pill button. With `href` it is a link (http(s) => new tab + sr note), else a
 * <button>. variant: gold | line (currentColor outline) | ink | white | ghost.
 * size: 'sm' for dense rows. `icon`: 'arrow' | 'out' | 'back' | element.
 */
export function Button({ href, variant = 'gold', size, icon, external, className = '', children, ...rest }) {
  const cls = 'hj-btn hj-btn--' + variant + (size === 'sm' ? ' hj-btn--sm' : '') + (className ? ' ' + className : '')
  const ico = icon === 'arrow' ? <IconArrow /> : icon === 'out' ? <IconOut /> : icon === 'back' ? <IconBack /> : icon || null
  if (!href) return <button type="button" className={cls} {...rest}>{icon === 'back' && ico}{children}{icon !== 'back' && ico}</button>
  const ext = external === undefined ? /^https?:\/\//i.test(href) : external
  return (
    <a className={cls} href={href} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : null)} {...rest}>
      {icon === 'back' && ico}{children}{ext && <span className="hj-sr"> (opens in a new tab)</span>}{icon !== 'back' && (ico || (ext ? <IconOut /> : null))}
    </a>
  )
}

/** Small coloured label. tone: cran gold azure turq violet royal ink night (see avenueTone). */
export function Chip({ tone = 'cran', children, className = '' }) {
  return <span className={'hj-chip' + (className ? ' ' + className : '')} data-tone={tone}>{children}</span>
}

/**
 * Filter group: toggle buttons with aria-pressed (one value at a time).
 * options: [{ value, label, count?, tone? }]. Put '' first for "All".
 */
export function ChipGroup({ label, options, value, onChange, className = '' }) {
  return (
    <div className={'hj-chips' + (className ? ' ' + className : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="hj-chipbtn" data-tone={o.tone || undefined}
                aria-pressed={value === o.value ? 'true' : 'false'} onClick={() => onChange(o.value)}>
          <span>{o.label}</span>
          {o.count != null && <span className="hj-chipbtn__n">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Search input with a visible-on-focus label for screen readers and a clear button. */
export function SearchField({ value, onChange, label = 'Search', placeholder, className = '' }) {
  const id = useId()
  const input = useRef(null)
  return (
    <div className={'hj-search' + (className ? ' ' + className : '')}>
      <label className="hj-sr" htmlFor={id}>{label}</label>
      <svg className="hj-search__ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={input} id={id} type="search" value={value} placeholder={placeholder || label} autoComplete="off"
             onChange={(e) => onChange(e.target.value)} />
      {value ? (
        <button type="button" className="hj-search__x" aria-label="Clear search"
                onClick={() => { onChange(''); if (input.current) input.current.focus() }}>
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      ) : null}
    </div>
  )
}

/** "Showing 12 of 120 members" — announced politely when it changes. */
export function ResultCount({ count, total, noun = 'result', plural, className = '' }) {
  const word = (n) => (n === 1 ? noun : (plural || noun + 's'))
  const text = total != null && total !== count ? 'Showing ' + count + ' of ' + total + ' ' + word(total) : count + ' ' + word(count)
  return <p className={'hj-count' + (className ? ' ' + className : '')} aria-live="polite">{text}</p>
}

// ── headings ─────────────────────────────────────────────────────────────────
/** Chapter kicker ("01 ——") + Unbounded title (+ sub, + action on the right). */
export function SectionHead({ k, title, sub, action, id, as: H = 'h2', className = '' }) {
  const numeric = k != null && /^\d+$/.test(String(k))
  return (
    <div className={'hj-sh' + (className ? ' ' + className : '')}>
      <div className="hj-sh__main">
        {/* a plain number (01, 02 ...) is not shown above headings (client, 2026-10-06); word labels still are */}
        {k != null && k !== '' && !numeric && <p className="hj-kicker">{k}</p>}
        <H className="hj-h2" id={id}>{title}</H>
        {sub ? <p className="hj-sh__sub">{sub}</p> : null}
      </div>
      {action ? <div className="hj-sh__act">{action}</div> : null}
    </div>
  )
}

/** Breadcrumb: Home / …items / current. items: [{ label, href }]. */
export function Crumbs({ items = [], current }) {
  return (
    <nav className="hj-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/">Home</a></li>
        {items.map((it, i) => <li key={i}>{it.href ? <a href={it.href}>{it.label}</a> : <span>{it.label}</span>}</li>)}
        {current ? <li><span aria-current="page">{current}</span></li> : null}
      </ol>
    </nav>
  )
}

/**
 * THE inner-page opening: a sky in a chapter colour over layered ridges that
 * fall into the page ground, with a low sun (a moon for tone="night"), the
 * breadcrumb, an optional eyebrow, the page's ONE <h1>, a sub line, optional
 * children (filters, stats) and an optional aside (right column on wide).
 *
 * tone:   dawn | cran | gold | azure | turq | violet | royal | night
 * ground: paper | cream — the colour the front ridge falls into; omit to inherit
 *         --hj-ground from the page wrapper (.hj-page.hj-ground--cream).
 * title follows the club's own menu label for this page when it has one
 * (menuTitle={false} to keep yours); the document title is set here.
 */
export function PageHero({ title, crumbs = [], tone = 'dawn', ground, aside, children, docTitle, menuTitle = true, className = '' }) {
  const menuName = useCurrentMenuName()
  const t = (menuTitle && menuName && String(menuName).trim()) || title || ''
  usePageTitle(docTitle || t)
  const ref = useRef(null)
  useScene(ref, (c, ctx) => afterFonts(ctx, () => heroIn(ref.current)), [t])
  const night = tone === 'night'
  return (
    <section ref={ref} className={'hj-ph hj-tone--' + tone + (ground ? ' hj-ground--' + ground : '') + (aside ? ' hj-ph--aside' : '') + (className ? ' ' + className : '')}>
      <div className="hj-ph__sky" aria-hidden="true">{(night || tone === 'dawn') && <span className="hj-stars" />}</div>
      <div className="hj-ph__orb" aria-hidden="true">{night ? <span className="hj-ph__moon hj-moon" /> : <span className="hj-ph__sun" />}</div>
      <div className="hj-ph__grid">
        <div className="hj-ph__main">
          <Crumbs items={crumbs} current={t} />
          {/* breadcrumb and title only: the band carries no eyebrow or intro line (client, 2026-09-29) */}
          <h1 key={t} className={'hj-ph__t' + (t.length > 26 ? ' hj-ph__t--long' : '')}>{t}</h1>
          {children ? <div className="hj-ph__more">{children}</div> : null}
        </div>
        {aside ? <div className="hj-ph__aside">{aside}</div> : null}
      </div>
      <div className="hj-ph__hills" aria-hidden="true">
        <Ridge preset="far" className="hj-rg--far" />
        <Ridge preset="mid" className="hj-rg--mid" seed={1.1} />
        <Ridge preset="ground" className="hj-rg--ground" />
      </div>
    </section>
  )
}

/**
 * A full-bleed chapter band in one tone, closing on ridges in the NEXT band's
 * colour (`next`: a CSS colour, default the page ground). Optional giant
 * outlined numeral `num` drifting behind. Content goes in children.
 */
export function Band({ tone = 'cran', next = 'var(--hj-ground)', num, id, labelledBy, className = '', children, as: T = 'section' }) {
  return (
    <T id={id} aria-labelledby={labelledBy} className={'hj-band hj-tone--' + tone + (className ? ' ' + className : '')} style={{ '--hj-next': next }}>
      {num ? <span className="hj-band__num" aria-hidden="true">{num}</span> : null}
      <div className="hj-band__ridge" aria-hidden="true">
        <Ridge preset="pnFar" />
        <Ridge preset="pnFront" className="hj-rg--front" />
      </div>
      <div className="hj-band__in">{children}</div>
    </T>
  )
}

// ── cards ────────────────────────────────────────────────────────────────────
/**
 * The white photo card (sample's project card). The title link is stretched
 * over the whole card, so the card is ONE link. A missing or broken photo
 * leaves the frame's own painted hills. `as`: element for the root (li in lists).
 */
export function PhotoCard({ href, img, alt = '', chip, chipTone, meta, title, desc, external, as: T = 'article', headingAs: H = 'h3', className = '', imgProps, children }) {
  const [broken, setBroken] = useState(false)
  const ext = external === undefined ? /^https?:\/\//i.test(String(href || '')) : external
  return (
    <T className={'hj-card' + (className ? ' ' + className : '')}>
      {/* --hj-ph: the photo again, blurred, behind the whole one (RIZO-30: cover showed only the middle) */}
      <div className="hj-card__m" style={img && !broken ? { '--hj-ph': 'url("' + encodeURI(img) + '")' } : undefined}>
        {img && !broken ? <img src={img} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} {...imgProps} /> : null}
      </div>
      <div className="hj-card__b">
        {(chip || meta) ? (
          <p className="hj-card__meta">
            {chip ? <Chip tone={chipTone || avenueTone(chip)}>{chip}</Chip> : null}
            {meta ? <span>{meta}</span> : null}
          </p>
        ) : null}
        <H className="hj-card__t">
          {href ? (
            <a href={href} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : null)}>
              {title}{ext && <span className="hj-sr"> (opens in a new tab)</span>}
            </a>
          ) : title}
        </H>
        {desc ? <p className="hj-card__d">{desc}</p> : null}
        {children}
      </div>
    </T>
  )
}

/** Arch portrait (sample's leaders): photo, or initials when there is none. Extra props go to the <img> (loading, width…). */
export function Portrait({ src, name, alt, className = '', ...img }) {
  return (
    <div className={'hj-arch' + (className ? ' ' + className : '')}>
      <PersonPhoto src={src} name={name} alt={alt} className="hj-arch__img" monoClass="hj-arch__mono" width="400" height="500" {...img} />
    </div>
  )
}

// ── figures ──────────────────────────────────────────────────────────────────
const SHAPES = ['circle', 'arch', 'square', 'pill', 'dome']
const TONES = ['royal', 'cran', 'ink', 'gold', 'azure', 'violet', 'turq']
/** A figure too long for its shape moves to a roomier one, so nothing spills at 390px. */
function fitShape(shape, text) {
  const n = String(text).length
  return n > 7 ? 'pill' : (n > 5 && (shape === 'arch' || shape === 'square')) ? 'circle' : shape
}

/**
 * The shape figures (sample's "By the numbers"), compact for inner pages.
 * items: [{ value: number, label, fmt?(n) -> string, text?: string }].
 * Zero/empty values are the caller's to drop. Counts up on scroll-in.
 * `fmt` defaults to grouped digits (pass formatMoney for money).
 */
export function StatRow({ items, className = '', currency }) {
  const ref = useRef(null)
  const key = items.map((i) => i.value).join('|')
  useScene(ref, () => {
    statsIn(ref.current)
    ref.current.querySelectorAll('[data-hj-n]').forEach((el, i) => {
      const it = items[i]
      if (it && it.text == null) countUp(el, it.value, it.fmt || ((n) => groupInt(n, currency)), { trigger: el, start: 'top 90%', once: true })
    })
  }, [key])
  // one font size for every figure, the largest at which all fit (client, 2026-10-06)
  useFitNumbers(ref, '.hj-stat__n', '.hj-stat', [key], 0.8)
  if (!items.length) return null
  return (
    <ul ref={ref} className={'hj-stats' + (className ? ' ' + className : '')}>
      {items.map((it, i) => {
        const txt = it.text != null ? it.text : (it.fmt ? it.fmt(it.value) : groupInt(it.value, currency))
        return (
          <li key={it.label} className={'hj-stat' + (txt.length >= 12 ? ' is-long' : '')} data-hj-stat="" data-shape={fitShape(it.shape || SHAPES[i % SHAPES.length], txt)} data-tone={it.tone || TONES[i % TONES.length]}>
            <span className="hj-stat__n" data-fit={txt}><span aria-hidden="true" data-hj-n="">{txt}</span><span className="hj-sr">{txt}</span></span>
            <span className="hj-stat__l">{it.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ── the shared photo viewer as a modal ───────────────────────────────────────
/**
 * The shared PhotoLightbox moves no focus and traps nothing. While `open`:
 * everything else on <body> is inert, smooth scroll holds still (lock: false
 * when the page already holds it for its own overlay), focus sits on the
 * viewer's close button; on close it returns to `openerRef.current`.
 */
export function useLightboxModal(open, openerRef, { lock = true } = {}) {
  useEffect(() => {
    if (!open) return undefined
    const box = document.querySelector('[data-pdm-lightbox].open')
    const others = box ? [...document.body.children].filter((el) => el !== box && !el.inert) : []
    others.forEach((el) => { el.inert = true })
    if (lock) lockScroll(true)
    const close = box && box.querySelector('.pdm-lb__close')
    if (close) close.focus()
    return () => {
      others.forEach((el) => { el.inert = false })
      if (lock) lockScroll(false)
      const o = openerRef && openerRef.current
      if (o && o.isConnected) o.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

// ── states ───────────────────────────────────────────────────────────────────
function Scene({ night }) {
  return (
    <svg className="hj-scene" viewBox="0 0 120 64" aria-hidden="true" focusable="false">
      <circle className={night ? 'hj-scene__moon' : 'hj-scene__sun'} cx="78" cy="34" r="15" />
      <path className="hj-scene__far" d="M0 64V40c14-8 24-10 36-4s22 4 34-4 28-8 50 2v30Z" />
      <path className="hj-scene__near" d="M0 64V50c18-9 34-8 50-2s30 6 44-2 20-6 26-4v22Z" />
    </svg>
  )
}

/** The designed "nothing here yet" card. Never leave an empty box. */
export function EmptyState({ title, message, action, as: H = 'h2', night = false, className = '' }) {
  return (
    <div className={'hj-empty' + (className ? ' ' + className : '')}>
      <Scene night={night} />
      <H className="hj-empty__t">{title}</H>
      {message ? <p className="hj-empty__m">{message}</p> : null}
      {action ? <div className="hj-empty__a">{action}</div> : null}
    </div>
  )
}

/** Loading placeholder (a sun bobbing over the hills), announced once. */
export function Loading({ label = 'Loading', className = '' }) {
  return (
    <div className={'hj-loading' + (className ? ' ' + className : '')} role="status">
      <Scene />
      <span>{label}…</span>
    </div>
  )
}

/**
 * Designed not-found page body: the night sky hero (it carries the page's h1)
 * and a way back. Use INSTEAD of PageHero when a detail record is missing.
 */
export function NotFound({ title = 'We couldn’t find that', message, crumbs = [], backHref = '/', backLabel = 'Back to home' }) {
  return (
    <>
      <PageHero tone="night" title={title} crumbs={crumbs} menuTitle={false} />
      <div className="hj-wrap hj-sec">
        <EmptyState as="h2" night title="It may have moved, or it is not published for this Rotary year."
                    message={message} action={<Button href={backHref} icon="back" variant="ink">{backLabel}</Button>} />
      </div>
    </>
  )
}
