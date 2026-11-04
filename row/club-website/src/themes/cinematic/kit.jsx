'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC — the theme's shared vocabulary. Every inner page is built from
// these (styles in theme.css), so thirteen routes read as one film.
// DESIGN.md documents each piece with an example.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useRef, useState } from 'react'
import { usePageTitle, useCurrentMenuName, socialLabel, externalUrl, formatYear } from '../_shared/data.js'
import { PersonPhoto, SafeImg, paragraphs, imgFallback, hideOnError, useFitNumbers } from '../_shared/kit.jsx'
import { useScene, afterFonts, titleIn, pageHeroIn, countUp, cleanups, lockScroll } from './motion.js'
import { ADMIN_LOGIN_URL } from '@/site/adminUrl.js'

export { PersonPhoto, SafeImg, paragraphs, imgFallback, hideOnError }

export const ADMIN_URL = ADMIN_LOGIN_URL

// ── icons ────────────────────────────────────────────────────────────────────
export const Arrow = () => (
  <svg className="cin-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
)
export const ArrowOut = () => (
  <svg className="cin-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M7 17 17 7" /><polyline points="8 7 17 7 17 16" />
  </svg>
)
export const ArrowBack = () => (
  <svg className="cin-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
)
export const Pin = () => (
  <svg className="cin-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
)
export const Chevron = () => (
  <svg className="cin-ico cin-ico--chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

// ── text helpers ─────────────────────────────────────────────────────────────
/**
 * "Thane Hills" -> { full: 'Rotary Club of Thane Hills', short: 'Thane Hills', pre: 'Rotary Club of' }.
 * A name the club already files in full is split the same way; a name that is
 * not "Rotary Club of …" (an e-club, a Rotaract club) is shown as it is.
 */
export function clubNames(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').trim()
  const m = raw.match(/^(?:the\s+)?rotary\s+club\s+of\s+(.+)$/i)
  if (m) return { full: raw, short: m[1].trim(), pre: 'Rotary Club of' }
  if (/^rota/i.test(raw)) return { full: raw, short: raw, pre: '' }
  return { full: 'Rotary Club of ' + raw, short: raw, pre: 'Rotary Club of' }
}

/** The API cuts long text mid-word; drop the broken word and close with an ellipsis. */
export function cutText(s, limit) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  if (t.length <= limit) return t
  return t.slice(0, limit).replace(/\s+\S*$/, '').replace(/[\s,;:\-–]+$/, '') + '…'
}

/** "2025-2026" -> "2025–26", the way every route prints the Rotary year ('' when none). */
export const yearText = (label) => (label ? String(formatYear(label)).replace('-', '–') : '')

/** Admin HTML can carry its own <h1>; a page's only h1 is its hero's. Pair with .cin-prose. */
export const demoteH1 = (html) => String(html || '').replace(/<(\/?)h1\b/gi, '<$1h2')

/** Menu label for this page (the club's own wording) or the fallback; also sets <title>. */
export function usePageName(fallback) {
  const menu = useCurrentMenuName()
  const name = (menu && menu.trim()) || fallback
  usePageTitle(name)
  return name
}

// ── images ───────────────────────────────────────────────────────────────────
/** An <img> that walks `sources` (best first) on error; renders nothing when all fail. */
export function Logo({ sources, alt = '', className = '', ...img }) {
  const list = (sources || []).filter(Boolean)
  const [i, setI] = useState(0)
  const key = list.join('|')
  const [seen, setSeen] = useState(key)
  if (seen !== key) { setSeen(key); setI(0) }
  if (i >= list.length) return null
  return <img src={list[i]} alt={alt} className={className} onError={() => setI(i + 1)} {...img} />
}

// ── page structure ───────────────────────────────────────────────────────────
/** Breadcrumb: Home / … / current. The last item is the current page. */
export function Crumbs({ items = [] }) {
  return (
    <nav className="cin-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/">Home</a></li>
        {items.map((it, i) => {
          const last = i === items.length - 1
          return (
            <li key={i}>
              {it.href && !last ? <a href={it.href}>{it.label}</a> : <span aria-current={last ? 'page' : undefined}>{it.label}</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * The inner-page opening and the page's ONE <h1>. Night band, royal glow, gold
 * beam along its foot; `backdrop` (a photo URL) adds a blurred projection behind
 * it for detail pages. Animates itself (pageHeroIn) - nothing to wire.
 *   crumbs  [{ label, href }] after Home; default [{ label: title }]
 *   eyebrow small gold line above the title
 *   lede    one or two plain sentences under it
 *   meta    a row under the lede (chips, a count, a date, buttons)
 *   children anything else inside the band (a search field)
 */
export function PageHero({ title, crumbs, eyebrow, lede, meta, backdrop, children, className = '' }) {
  const ref = useRef(null)
  useScene(ref, () => { pageHeroIn(ref.current) }, [title])
  const long = String(title || '').length > 26
  const lw = Math.max(4, ...String(title || '').split(/\s+/).map((w) => w.length))
  return (
    <section ref={ref} className={'cin-phero' + (long ? ' is-long' : '') + (backdrop ? ' has-back' : '') + (className ? ' ' + className : '')}>
      {backdrop ? (
        <div className="cin-phero__back" aria-hidden="true">
          <img src={backdrop} alt="" onError={hideOnError} />
        </div>
      ) : null}
      <div className="cin-phero__in">
        <Crumbs items={crumbs && crumbs.length ? crumbs : [{ label: title }]} />
        {eyebrow ? <p className="cin-phero__eyebrow">{eyebrow}</p> : null}
        <h1 className="cin-phero__title" key={title} style={{ '--lw': lw }}>{title}</h1>
        {lede ? <p className="cin-phero__lede">{lede}</p> : null}
        {meta ? <div className="cin-phero__meta">{meta}</div> : null}
        {children}
      </div>
      <span className="cin-phero__beam" aria-hidden="true" />
    </section>
  )
}

/**
 * A section heading whose letters rise out of their line (title card) when it
 * scrolls in. `action` sits at the right (a Button), `lede` under the title.
 */
export function SectionHead({ title, id, action, lede, as: H = 'h2', className = '' }) {
  const ref = useRef(null)
  useScene(ref, (c, ctx) => afterFonts(ctx, () => titleIn(ref.current && ref.current.querySelector('.cin-h2'))), [title])
  return (
    <div ref={ref} className={'cin-shead' + (className ? ' ' + className : '')}>
      <div className="cin-shead__main">
        <H id={id} className="cin-h2" key={title}>{title}</H>
        {lede ? <p className="cin-shead__lede">{lede}</p> : null}
      </div>
      {action ? <div className="cin-shead__act">{action}</div> : null}
    </div>
  )
}

// ── actions ──────────────────────────────────────────────────────────────────
/**
 * Pill button/link. variant: 'gold' (primary) | 'line' (outlined) | 'text'
 * (quiet link with an arrow). With `href` it is an <a>; `external` opens a new
 * tab and says so to screen readers. Magnetic on a mouse unless magnet={false}.
 */
export function Button({ href, children, variant = 'gold', external = false, magnet = true, small = false, className = '', ...rest }) {
  const cls = 'cin-btn cin-btn--' + variant + (small ? ' cin-btn--sm' : '') + (magnet && variant !== 'text' ? ' cin-magnet' : '') + (className ? ' ' + className : '')
  if (href) {
    const ext = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
    return (
      <a className={cls} href={href} {...ext} {...rest}>
        {children}
        {external ? <span className="cin-sr"> (opens in a new tab)</span> : null}
      </a>
    )
  }
  return <button type="button" className={cls} {...rest}>{children}</button>
}

/** Filter/tab row. options [{ value, label, count? }]; buttons carry aria-pressed. */
export function ChipGroup({ label, options, value, onChange, className = '' }) {
  return (
    <div className={'cin-chips' + (className ? ' ' + className : '')} role="group" aria-label={label}>
      {(options || []).map((o) => (
        <button key={String(o.value)} type="button" className="cin-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          <span>{o.label}</span>
          {o.count != null ? <span className="cin-chip__n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Search box with a real <label> (visually hidden) and a clear button. `inputRef` reaches the <input>. */
export function SearchField({ value, onChange, label = 'Search', placeholder, inputRef, className = '' }) {
  const id = useId()
  return (
    <div className={'cin-search' + (className ? ' ' + className : '')}>
      <label htmlFor={id} className="cin-sr">{label}</label>
      <svg className="cin-search__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
        <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input id={id} ref={inputRef} type="search" value={value} placeholder={placeholder || label} autoComplete="off"
        onChange={(e) => onChange(e.target.value)} />
      {value ? (
        <button type="button" className="cin-search__clear"
          onClick={(e) => { const input = e.currentTarget.parentElement.querySelector('input'); onChange(''); if (input) input.focus() }}>
          <span className="cin-sr">Clear search</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      ) : null}
    </div>
  )
}

/** "12 members" / "3 of 120 members", announced politely as filters change. */
export function ResultCount({ count, total, noun = 'result', plural, className = '' }) {
  const word = (n) => (n === 1 ? noun : (plural || noun + 's'))
  const text = total != null && total !== count ? count + ' of ' + total + ' ' + word(total) : count + ' ' + word(count)
  return <p className={'cin-count' + (className ? ' ' + className : '')} aria-live="polite">{text}</p>
}

// ── figures ──────────────────────────────────────────────────────────────────
const plain = (n) => Math.round(Number(n) || 0).toLocaleString()

/**
 * A row of condensed gold figures that count up when they scroll in.
 * items [{ label, value (number), format?(n) -> string, text? (fixed string, no count) }]
 * Use formatMoney(n, currency) / groupInt(n, currency) as `format`.
 */
export function StatRow({ items, className = '' }) {
  const ref = useRef(null)
  const list = (items || []).filter(Boolean)
  const sig = list.map((it) => it.label + ':' + (it.text != null ? it.text : it.value)).join('|')
  useScene(ref, () => {
    const off = cleanups()
    ref.current.querySelectorAll('.cin-stat__v').forEach((el, i) => {
      const it = list[i]
      if (it && it.text == null) off(countUp(el, it.value, it.format || plain))
    })
    return off.run
  }, [sig])
  // one font size for every figure, the largest at which all fit (client, 2026-10-06)
  useFitNumbers(ref, '.cin-stat__v', '.cin-stat', [sig])
  // tile count with a long figure counted twice - odd leaves the last tile alone on a two-up row
  const odd = list.reduce((n, it) => n + (String(it.text != null ? it.text : (it.format || plain)(it.value)).length >= 12 ? 2 : 1), 0) % 2 === 1
  return (
    <dl ref={ref} className={'cin-stats' + (odd ? ' is-odd' : '') + (className ? ' ' + className : '')}>
      {list.map((it) => (
        <div key={it.label + ':' + (it.text != null ? it.text : it.value)} className={'cin-stat' + (String(it.text != null ? it.text : (it.format || plain)(it.value)).length >= 12 ? ' is-long' : '')}>
          <dt className="cin-stat__l">{it.label}</dt>
          <dd className="cin-stat__v" data-fit={it.text != null ? it.text : (it.format || plain)(it.value)}>{it.text != null ? it.text : (it.format || plain)(it.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A date read like a clapperboard slate: big condensed day, month + year beside it. */
export function DateStamp({ day, mon, year, weekday, className = '' }) {
  if (!day) return null
  return (
    <span className={'cin-date' + (className ? ' ' + className : '')}>
      <span className="cin-date__d">{day}</span>
      <span className="cin-date__my"><span>{mon}</span>{year ? <span>{year}</span> : null}{weekday ? <span className="cin-date__wd">{weekday}</span> : null}</span>
    </span>
  )
}

// ── cards ────────────────────────────────────────────────────────────────────
export function Pill({ children, className = '' }) {
  if (!children) return null
  return <span className={'cin-pill' + (className ? ' ' + className : '')}>{children}</span>
}

/** Sizes a reel frame to its picture once it arrives (clamped against odd uploads). */
function fitFrame(e) {
  const img = e.currentTarget
  const card = img.closest('.cin-card')
  if (!card || !img.naturalWidth || !img.naturalHeight) return
  card.style.setProperty('--ar', String(Math.min(1.9, Math.max(0.62, img.naturalWidth / img.naturalHeight))))
}

/**
 * The film-frame card (projects, events, gallery albums). The heading link is
 * stretched over the whole card; the frame gets a gold ring on hover/focus.
 *   layout 'reel' - fixed height, width follows the photo (for .cin-track rows)
 *   layout 'grid' - fills its grid cell, 4:3 frame (for listing pages)
 *   meta   node above the title (a Pill, a date)   text  plain text, clamped to 2 lines
 */
export function FrameCard({ href, img, fallbacks, title, meta, text, external = false, layout = 'grid', whole = false, as: Tag = 'li', level = 3, className = '', children }) {
  const H = 'h' + level
  const ext = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  // whole: the full photo, never cropped - letterboxed over a blurred copy of itself
  return (
    <Tag className={'cin-card cin-card--' + layout + (whole ? ' cin-card--whole' : '') + (className ? ' ' + className : '')}>
      <div className="cin-card__media">
        {img && whole ? (
          <img className="cin-card__fill" src={img} data-fallbacks={fallbacks} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={imgFallback} />
        ) : null}
        {img ? (
          <img className="cin-card__pic" src={img} data-fallbacks={fallbacks} alt="" loading="lazy" decoding="async" width="800" height="600"
            onLoad={layout === 'reel' ? fitFrame : undefined} onError={imgFallback} />
        ) : <span className="cin-card__blank" aria-hidden="true" />}
      </div>
      <div className="cin-card__body">
        {meta ? <div className="cin-card__meta">{meta}</div> : null}
        <H className="cin-card__t">
          {href ? <a href={href} {...ext}>{title}{external ? <span className="cin-sr"> (opens in a new tab)</span> : null}</a> : title}
        </H>
        {text ? <p className="cin-card__x">{text}</p> : null}
        {children}
      </div>
    </Tag>
  )
}

/**
 * The royal panel tile (newsletters, notices, a featured item): an expanded
 * title and date at the top, actions in `foot` at the bottom. `kicker` sits
 * above the title (a DateStamp) and is read before it. Pair with wipeIn() for
 * the bottom-edge wipe.
 */
export function PanelCard({ title, date, kicker, children, foot, as: Tag = 'li', level = 3, className = '' }) {
  const H = 'h' + level
  return (
    <Tag className={'cin-panel' + (className ? ' ' + className : '')}>
      <div className="cin-panel__top">
        {kicker ? <div className="cin-panel__kick">{kicker}</div> : null}
        <H className="cin-panel__t">{title}</H>
        {date ? <p className="cin-panel__date">{date}</p> : null}
        {children}
      </div>
      {foot ? <div className="cin-panel__foot">{foot}</div> : null}
    </Tag>
  )
}

/**
 * The leader card: 4:5 portrait (no hover effect on the photo - client), role in
 * gold, name, optional bio (clamped to 4 lines). The name
 * becomes a stretched link when `href` is given. Photo falls back to initials.
 */
export function PersonCard({ name, role, img, bio, href, external = false, as: Tag = 'li', level = 3, className = '', children }) {
  const H = 'h' + level
  const ext = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  return (
    <Tag className={'cin-pcard' + (className ? ' ' + className : '')}>
      <div className="cin-pcard__in">
        <div className="cin-pcard__photo">
          <PersonPhoto key={img || name} src={img} name={name} alt={name} className="cin-pcard__img" monoClass="cin-pcard__mono" width="400" height="500" />
        </div>
        <div className="cin-pcard__txt">
          {role ? <p className="cin-pcard__role">{role}</p> : null}
          <H className="cin-pcard__name">{href ? <a href={href} {...ext}>{name}</a> : name}</H>
          {bio ? <p className="cin-pcard__bio">{bio}</p> : null}
          {children}
        </div>
      </div>
    </Tag>
  )
}

// ── dialogs ──────────────────────────────────────────────────────────────────
let held = 0
/**
 * Makes a dialog portalled to <body> (the shared PhotoLightbox, a page's own
 * panel) modal while `open`: the site behind is inert, the page stops
 * scrolling (Lenis too), focus moves to `focusSel` (null = the dialog focuses
 * itself) and returns to `returnRef.current` on close. Counted, so a viewer
 * opened from a panel stacks on it and closing it leaves the panel modal.
 */
export function useModal(open, returnRef, focusSel = '.pdm-lb.open .pdm-lb__close') {
  useEffect(() => {
    if (!open) return undefined
    const back = returnRef ? returnRef.current : null
    const site = document.querySelector('.cin-site')
    held += 1
    if (site) site.inert = true
    document.body.style.overflow = 'hidden'
    lockScroll(true)
    const raf = requestAnimationFrame(() => {
      const el = focusSel ? document.querySelector(focusSel) : null
      if (el) el.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      held -= 1
      if (held > 0) {
        // the shared viewer clears body overflow in its own cleanup, which runs after this one
        requestAnimationFrame(() => { if (held > 0) document.body.style.overflow = 'hidden' })
      } else {
        if (site) site.inert = false
        document.body.style.overflow = ''
        lockScroll(false)
      }
      requestAnimationFrame(() => { if (back && back.isConnected) back.focus({ preventScroll: true }) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

// ── states ───────────────────────────────────────────────────────────────────
/** Designed "nothing here yet" card. Never a blank box. */
export function EmptyState({ title, message, action, as: H = 'h2', className = '' }) {
  return (
    <div className={'cin-empty' + (className ? ' ' + className : '')}>
      <span className="cin-empty__ico" aria-hidden="true"><span /></span>
      <H className="cin-empty__t">{title}</H>
      {message ? <p className="cin-empty__m">{message}</p> : null}
      {action || null}
    </div>
  )
}

/** A whole not-found page: hero with the h1, the film-leader mark, a way back. */
export function NotFound({ title = 'Page not found', message = 'It may have been moved or removed.', backHref = '/', backLabel = 'Back to home', crumbs }) {
  usePageTitle(title)
  return (
    <>
      <PageHero title={title} crumbs={crumbs} />
      <div className="cin-nf">
        <span className="cin-nf__leader" aria-hidden="true"><span /></span>
        <p className="cin-nf__m">{message}</p>
        <Button href={backHref}>{backLabel} <Arrow /></Button>
      </div>
    </>
  )
}

/** Loading strip: a reel of frames sliding past. Announced once to screen readers. */
export function Loading({ label = 'Loading' }) {
  return (
    <div className="cin-loading" role="status">
      <span className="cin-loading__reel" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span className="cin-sr">{label}…</span>
    </div>
  )
}

// ── socials ──────────────────────────────────────────────────────────────────
const SOCIAL = {
  facebook: <path fill="currentColor" stroke="none" d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.5 1.6-1.5h1.7V4.4c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2v2.3H7.6V14h2.7v8h3.2z" />,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" /></>,
  linkedin: <path fill="currentColor" stroke="none" d="M3 9h4v12H3zM5 2.7a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM10 9h3.8v1.8c.6-1.1 2-2.1 4-2.1 3.5 0 4.2 2.2 4.2 5.2V21h-4v-6.2c0-1.5-.1-3.3-2.1-3.3s-2.3 1.5-2.3 3.2V21H10V9z" />,
  twitter: <path fill="currentColor" stroke="none" d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" />,
  youtube: <><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8z" /><path fill="currentColor" stroke="none" d="m10 15 5.2-3L10 9z" /></>,
  globe: <><circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19M12 2.5a14.5 14.5 0 0 0 0 19" /></>,
}

/** The club's social links as round icon buttons (new tab). Renders nothing when there are none. */
export function SocialLinks({ socials, className = '' }) {
  const list = (socials || []).filter((s) => s && s.linkUrl && String(s.linkUrl).trim())
  if (!list.length) return null
  return (
    <ul className={'cin-socials' + (className ? ' ' + className : '')} aria-label="Social media">
      {list.map((s, i) => {
        let key = String(s.platform || '').trim().toLowerCase()
        if (key === 'x') key = 'twitter'
        return (
          <li key={i}>
            <a href={externalUrl(s.linkUrl)} target="_blank" rel="noopener noreferrer">
              <span className="cin-sr">{socialLabel(key)} (opens in a new tab)</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                {SOCIAL[key] || SOCIAL.globe}
              </svg>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
