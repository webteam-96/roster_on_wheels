'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Photo Collage — the theme's reusable pieces (ported from the G sample's
// vocabulary: taped white prints, kraft tags and memos, stickers, hand-drawn
// strokes, photo-filled Shrikhand headlines). Styles live in theme.css.
// Page agents: read DESIGN.md first — it shows every piece in use.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useCurrentMenuName, usePageTitle, formatMoney, groupInt, formatYear } from '../_shared/data.js'
import { PersonPhoto, imgFallback, hideOnError, useFitNumbers } from '../_shared/kit.jsx'
import { useScene, refreshSoon, lockScroll, gsap, prefersReducedMotion } from '../_shared/motion.js'
import { heroIn, heroPhotosIn, DEV0, DEV1 } from './motion.js'
import { ADMIN_LOGIN_URL } from '@/site/adminUrl.js'

export const ADMIN_URL = ADMIN_LOGIN_URL

// ── hand-drawn strokes ──────────────────────────────────────────────────────
/** Path data from the sample; every stroke is drawn with pathLength=1. */
export const P = {
  under: 'M3 9 C 50 3, 110 13, 160 7 S 250 4, 297 9',
  circle: 'M182 16 C 150 2, 60 4, 24 22 C -4 36, 12 72, 84 80 C 150 86, 214 66, 212 38 C 210 18, 170 6, 118 8',
  arrow: 'M8 10 C 44 4, 82 20, 94 56 C 98 66, 98 74, 96 82',
  arrowHead: 'M80 70 L 96 84 L 110 66',
  tick: 'M4 14 L 10 20 L 22 5',
  down: 'M20 3 C 13 17, 27 27, 20 44',
  downHead: 'M10 35 L 20 46 L 30 35',
  string: 'M20 0 C 8 34, 32 70, 20 112',
  clip: 'M8 20 V 50 A 6 6 0 0 0 20 50 V 8 A 9 9 0 0 0 2 8 V 44',
}

/** An inline stroke drawing. `scroll` = drawn by decor()/drawIn() as it scrolls in. */
export function Draw({ d, viewBox, className = '', stretch = false, scroll = false }) {
  return (
    <svg className={('col-svg ' + (scroll ? 'col-scroll-draw ' : '') + className).trim()} viewBox={viewBox}
      preserveAspectRatio={stretch ? 'none' : undefined} aria-hidden="true" focusable="false">
      {[].concat(d).map((p, i) => <path key={i} className="col-draw" d={p} pathLength={1} />)}
    </svg>
  )
}
export const Underline = ({ className = '', scroll = false }) =>
  <Draw d={P.under} viewBox="0 0 300 14" stretch scroll={scroll} className={'col-uline ' + className} />
export const HeadArrow = ({ className = '', scroll = true }) =>
  <Draw d={[P.arrow, P.arrowHead]} viewBox="0 0 120 90" scroll={scroll} className={'col-head-arrow ' + className} />
/** A word circled in pen (drawn on scroll). */
export function Circled({ children, className = '' }) {
  return <span className={'col-circled ' + className}>{children}<Draw d={P.circle} viewBox="0 0 220 90" stretch scroll /></span>
}

// ── photo-filled type ───────────────────────────────────────────────────────
export const TINT = { cran: 'var(--col-cran)', azure: 'var(--col-azure)', royal: 'var(--col-royal)', violet: 'var(--col-violet)' }
/**
 * { className, style } for a headline whose letters are filled with `img`
 * multiplied by a Rotary tint (never lighter than the tint, so contrast holds).
 * No img -> the letters are simply the tint colour.
 */
export function photoType(img, tint = 'cran') {
  const style = { '--col-tint': TINT[tint] || tint }
  if (img) style['--col-img'] = 'url(' + JSON.stringify(String(img)) + ')'
  return { className: 'col-pt' + (img ? ' is-img' : ''), style }
}

// ── washi tape ──────────────────────────────────────────────────────────────
export const TAPE_CYCLE = ['turq', 'cran', 'gold', 'azure']
const TAPE_CLS = { turq: '', cran: ' is-cran', gold: ' is-gold', azure: ' is-azure' }
export function Tape({ tone = 'turq', left, tilt }) {
  const style = {}
  if (left != null) style['--col-tl'] = left
  if (tilt != null) style['--col-tr'] = tilt + 'deg'
  return <span className={'col-tape' + (TAPE_CLS[tone] || '')} style={style} aria-hidden="true" />
}

// ── text helpers ────────────────────────────────────────────────────────────
const BLOCK_END = /<(\/(p|div|li|h[1-6]|tr|blockquote)|br\s*\/?)>/gi
const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu
/** Admin HTML/plain text -> one clean line (DOMParser: nothing loads, nothing runs). */
export function htmlText(html) {
  const s = String(html == null ? '' : html)
  if (!/[<&]/.test(s)) return s.replace(/\s+/g, ' ').trim()
  const doc = new DOMParser().parseFromString(s.replace(BLOCK_END, ' $&'), 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}
/** Admin HTML -> its paragraphs as clean strings (headings/list items count as paragraphs). */
export function htmlParagraphs(html) {
  const s = String(html == null ? '' : html)
  if (!s.trim()) return []
  if (!/</.test(s)) return s.split(/\n\s*\n|\r\n\s*\r\n/).map((p) => htmlText(p)).filter(Boolean)
  const doc = new DOMParser().parseFromString(s.replace(BLOCK_END, ' $&'), 'text/html')
  const blocks = Array.from(doc.body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'))
    .filter((el) => !el.querySelector('p, li'))
  const list = (blocks.length ? blocks.map((el) => el.textContent) : [doc.body.textContent])
  return list.map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
}
/** Plain text without emoji (API titles/descriptions carry them). */
export const cleanText = (s) => htmlText(s).replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim()
/** A clean excerpt cut at a word boundary with an ellipsis. */
export function excerpt(s, max = 180) {
  const t = cleanText(s)
  if (t.length <= max) return t
  return t.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[\s,;:–-]+$/, '') + '…'
}
/** "2026-2027" / "2026-27" -> "2026–27" ('' when unknown). */
export const yearDash = (label) => (label ? String(formatYear(label)).replace('-', '–') : '')

// ── menu labels + page name ─────────────────────────────────────────────────
const SMALL = new Set(['of', 'and', 'the', 'for', 'to', 'in', 'at', 'on', 'a', 'an', '&'])
const WORDS = new Set(['home', 'news', 'club', 'team', 'our', 'us', 'who', 'we', 'are', 'join', 'blog', 'main', 'more', 'year', 'info', 'past', 'all', 'my', 'gift', 'wall'])
/**
 * Club menu names arrive in ANY case ("DIRECTORY", "PAST PRESIDENTS"). An
 * all-caps name is set in title case; short all-caps words that are not common
 * words stay as acronyms (RYLA, TRF, BOD). Mixed-case names are left alone.
 */
export function menuLabel(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim()
  if (!s || /[a-z]/.test(s) || !/[A-Z]{2}/.test(s)) return s
  return s.split(' ').map((w, i) => {
    const lw = w.toLowerCase()
    if (i > 0 && SMALL.has(lw)) return lw
    if (w.length <= 4 && !WORDS.has(lw) && !SMALL.has(lw)) return w
    return lw.charAt(0).toUpperCase() + lw.slice(1)
  }).join(' ')
}
/** The page's display name: the club's own menu label for this route, else `fallback`. Sets <title>. */
export function usePageName(fallback) {
  const name = menuLabel(useCurrentMenuName()) || fallback
  usePageTitle(name)
  return name
}

// ── fit one line (the home club name) ───────────────────────────────────────
/**
 * Shrinks a nowrap line until its INK fits its parent (measured with a Range —
 * an element's box says nothing about nowrap text). Below `minRatio` of the CSS
 * size it gives up shrinking and lets the line wrap instead.
 */
export function useFitLine(ref, deps = [], minRatio = 0.55) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const fit = () => {
      el.style.fontSize = ''
      el.style.whiteSpace = ''
      const r = document.createRange()
      r.selectNodeContents(el)
      const w = r.getBoundingClientRect().width
      const fs = parseFloat(getComputedStyle(el).fontSize)
      const avail = el.parentElement.clientWidth - fs * 0.46
      if (w > avail && w > 0) {
        const k = avail / w
        if (k < minRatio) { el.style.fontSize = (fs * minRatio).toFixed(1) + 'px'; el.style.whiteSpace = 'normal' }
        else el.style.fontSize = (fs * k).toFixed(1) + 'px'
      }
      refreshSoon()
    }
    fit()
    let raf = 0
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit) }
    window.addEventListener('resize', on)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', on) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** An image with a fallback chain: { src, onError, last, done }. */
// URLs that already failed this visit (a club logo the server lost was requested by the header, the footer and
// the About crest, twice each in dev) - every chain skips them instead of asking the server again
const DEAD = new Set()
export function useImgChain(srcs) {
  const list = srcs.filter((s) => s && !DEAD.has(s))
  const key = list.join('|')
  const [st, setSt] = useState({ key: '', i: 0 })
  const i = st.key === key ? st.i : 0
  return { src: list[i] || '', index: i, last: i >= list.length - 1, done: i >= list.length, onError: () => { if (list[i]) DEAD.add(list[i]); setSt({ key, i: i + 1 }) } }
}

// ── page furniture ──────────────────────────────────────────────────────────
/** Breadcrumb: Home / … / current. `items` = [{ label, href? }], the last is the current page. */
export function Crumbs({ items = [] }) {
  return (
    <nav className="col-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/">Home</a></li>
        {items.map((it, i) => (
          <li key={i}>{i === items.length - 1 ? <span aria-current="page">{it.label}</span> : it.href ? <a href={it.href}>{it.label}</a> : <span>{it.label}</span>}</li>
        ))}
      </ol>
    </nav>
  )
}

/** Four paper cut-outs (gold dot, cranberry arch, turquoise star, azure wave). Decorative. */
export function Cutouts({ className = '' }) {
  return (
    <div className={'col-cuts ' + className} aria-hidden="true">
      <span className="col-cut is-dot"><i className="col-cut-in" /></span>
      <span className="col-cut is-arch"><i className="col-cut-in" /></span>
      <span className="col-cut is-star"><i className="col-cut-in" /></span>
      <span className="col-cut is-wave"><svg viewBox="0 0 170 40" focusable="false"><path d="M5 20 Q 25 2 45 20 T 85 20 T 125 20 T 165 20" /></svg></span>
    </div>
  )
}

/**
 * THE page head — every inner page opens with it and it holds the page's one <h1>.
 * Client, 2026-09-29: no extra content in it - no kicker, no lead line, no strip of prints.
 *   crumbs  [{label, href}] after "Home" (default: [{label: title}])
 *   img     a photo to fill the title's letters (from the page's own data)
 *   tint    'cran' | 'azure' | 'royal' | 'violet'
 *   card    at most ONE taped card on the right: a print {src, caption?, ratio?, fallbacks?}
 *           (About's crest) or a count {value, label} (Directory's members)
 *   children  the page's controls only (SearchField, FilterGroup…)
 * (kicker / lead / prints are still accepted from older callers and ignored.)
 * Runs its own entrance: the words once per title (heroIn), the photos whenever
 * they arrive (heroPhotosIn) — late data never replays the title wipe.
 */
export function PageHero({ title, crumbs, img, tint = 'cran', card, children, className = '', titleId }) {
  const ref = useRef(null)
  const shot = card && (card.src || card.value !== undefined) ? card : null
  useScene(ref, () => heroIn(ref.current), [title])
  useScene(ref, () => heroPhotosIn(ref.current), [img, shot ? String(shot.src || shot.value) : ''])
  const pt = photoType(img, tint)
  return (
    <header ref={ref} className={'col-ph' + (shot ? ' has-prints' : '') + (className ? ' ' + className : '')}>
      <Cutouts />
      <div className="col-ph-in">
        <div className="col-ph-copy">
          <Crumbs items={crumbs || [{ label: title }]} />
          <div className="col-ph-titlerow">
            <h1 id={titleId} className={'col-ph-title ' + pt.className} style={pt.style}>{title}</h1>
            <HeadArrow className="col-ph-arrow" scroll={false} />
          </div>
          {children ? <div className="col-ph-tools">{children}</div> : null}
        </div>
        {shot ? (
          <ul className="col-ph-prints">
            <li className="col-ph-print is-0">
              {shot.src
                ? <div aria-hidden="true"><Print src={shot.src} caption={shot.caption} fallbacks={shot.fallbacks} tape={TAPE_CYCLE[0]} r={-4} k={0.8} ratio={shot.ratio || '4 / 3'} /></div>
                : (
                  <div className="col-print-fl">
                    <p className="col-ph-count">
                      <Tape tone="gold" tilt={-6} />
                      <b>{shot.value}</b>
                      <span>{shot.label}</span>
                    </p>
                  </div>
                )}
            </li>
          </ul>
        ) : null}
      </div>
    </header>
  )
}

/**
 * Section heading: photo-filled Shrikhand title + a hand-drawn arrow + an
 * optional handwritten kicker. decor(root) wipes it in and draws the arrow.
 */
export function SectionHead({ title, id, kicker, img, tint = 'cran', as: H = 'h2', center = false, arrow = true, className = '' }) {
  const pt = photoType(img, tint)
  return (
    <div className={'col-head' + (center ? ' is-center' : '') + (className ? ' ' + className : '')}>
      <H id={id} className={'col-head-title ' + pt.className} style={pt.style}>{title}</H>
      {arrow ? <HeadArrow /> : null}
      {kicker ? <p className="col-head-kick">{kicker}</p> : null}
    </div>
  )
}

// ── actions ─────────────────────────────────────────────────────────────────
const ext = (external) => (external ? { target: '_blank', rel: 'noopener noreferrer' } : null)
/**
 * Pill button. `href` -> <a>, else <button type="button">.
 * variant: 'cran' (default, primary) | 'ink' | 'ghost' (outlined, for secondary)
 */
export function Button({ href, external, variant = 'cran', className = '', children, ...rest }) {
  const cls = 'col-btn' + (variant !== 'cran' ? ' is-' + variant : '') + (className ? ' ' + className : '')
  if (href) {
    return (
      <a className={cls} href={href} {...ext(external)} {...rest}>
        {children}{external ? <span className="col-sr"> (opens in a new tab)</span> : null}
      </a>
    )
  }
  return <button type="button" className={cls} {...rest}>{children}</button>
}
/** Underlined cranberry text link (≥44px tall). Put the item name in `sr` for "View project: <title>". */
export function TextLink({ href, external, sr, className = '', children, ...rest }) {
  return (
    <a className={'col-link' + (className ? ' ' + className : '')} href={href} {...ext(external)} {...rest}>
      {children}{sr ? <span className="col-sr">: {sr}</span> : null}{external ? <span className="col-sr"> (opens in a new tab)</span> : null}
    </a>
  )
}

// ── prints and paper ────────────────────────────────────────────────────────
/**
 * A taped white photo print (polaroid). Three nested wrappers, one job each:
 *   .col-print-move  parallax — `speed` (0.85–1.15) -> house()/parallax() drift
 *   .col-print-fl    deal / swing — `deal` -> house() deals it in on scroll
 *   .col-print       CSS tilt `r` + scroll sway `k` + hover — never tweened
 * ratio: CSS aspect ratio of the photo ('4 / 3' default, 'auto' = natural size).
 * href: the print itself becomes the link (hover lifts it).
 * A missing/broken photo leaves a paper frame with a faint photo mark.
 */
export function Print({
  src, alt = '', caption, captionAs: Cap = 'p', tape = 'turq', tapeLeft, tapeTilt, r = 0, k = 1,
  ratio = '4 / 3', href, external, fallbacks, speed, deal = false, className = '', children, imgProps, ...rest
}) {
  const Card = href ? 'a' : 'div'
  const natural = ratio === 'auto'
  return (
    <div className={'col-print-move' + (className ? ' ' + className : '')} data-col-speed={speed} style={{ '--col-r': r + 'deg', '--col-k': k }}>
      <div className="col-print-fl" data-col-deal={deal ? '' : undefined}>
        <Card className={'col-print' + (href ? ' is-link' : '')} {...(href ? { href, ...ext(external) } : null)} {...rest}>
          {tape ? <Tape tone={tape} left={tapeLeft} tilt={tapeTilt != null ? tapeTilt : (r > 0 ? 5 : -5)} /> : null}
          <div className={'col-print-photo' + (natural ? ' is-natural' : '')} style={natural ? undefined : { aspectRatio: String(ratio) }}>
            {src ? (
              <img src={src} alt={alt} loading="lazy" decoding="async" data-fallbacks={fallbacks || undefined}
                onError={fallbacks ? imgFallback : hideOnError} {...imgProps} />
            ) : null}
          </div>
          {caption ? <Cap className="col-print-cap">{caption}</Cap> : null}
          {href && external ? <span className="col-sr"> (opens in a new tab)</span> : null}
        </Card>
      </div>
      {children}
    </div>
  )
}

/**
 * A person's taped portrait print (4:5); no photo -> Shrikhand initials on kraft.
 * alt="" when the name is printed right beside it (caption, heading): the photo
 * or initials are then hidden from screen readers, so the name is read once.
 */
export function Portrait({ src, name, alt, r = 0, k = 1, tape = 'cran', caption, deal = false, className = '' }) {
  const photo = <PersonPhoto src={src} name={name} alt={alt} className="col-portrait-img" monoClass="col-portrait-mono" />
  return (
    <div className={'col-portrait' + (className ? ' ' + className : '')} data-col-deal={deal ? '' : undefined} style={{ '--col-r': r + 'deg', '--col-k': k }}>
      <div className="col-portrait-card">
        {tape ? <Tape tone={tape} tilt={r > 0 ? 5 : -4} /> : null}
        {alt === '' ? <span className="col-portrait-ph" aria-hidden="true">{photo}</span> : photo}
        {caption ? <p className="col-portrait-cap">{caption}</p> : null}
      </div>
    </div>
  )
}

/** A plain paper note (grain, no shadow) — the text block under a print. */
export function Note({ as: El = 'div', className = '', children, ...rest }) {
  return <El className={'col-note' + (className ? ' ' + className : '')} {...rest}>{children}</El>
}

/** Kraft memo with a taped top and pen ticks. items: strings or nodes. */
export function Memo({ title, titleAs: H = 'h3', items = [], tape = 'azure', className = '', children }) {
  return (
    <div className={'col-memo' + (className ? ' ' + className : '')}>
      <div className="col-memo-move">
        <div className="col-memo-in">
          <Tape tone={tape} tilt={-3} />
          {title ? <H className="col-memo-title">{title}</H> : null}
          {items.length ? (
            <ul className="col-ticks">
              {items.map((it, i) => <li key={i}><Draw d={P.tick} viewBox="0 0 26 26" scroll /><span>{it}</span></li>)}
            </ul>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  )
}

/** Kraft luggage tag on a drawn string; swing() / house() swings it in. */
export function Tag({ children, className = '', string = true }) {
  return (
    <div className={'col-tag-wrap' + (string ? '' : ' no-string') + (className ? ' ' + className : '')}>
      {string ? <Draw d={P.string} viewBox="0 0 40 112" className="col-tag-string" scroll /> : null}
      <div className="col-tag">{children}</div>
    </div>
  )
}

/** Small label pill. tone: 'ink' (default) | 'cran' | 'azure' | 'royal' | 'violet' | 'gold' | 'turq' | 'kraft' */
export function Chip({ tone, className = '', children }) {
  return <span className={'col-chip' + (tone && tone !== 'ink' ? ' is-' + tone : '') + (className ? ' ' + className : '')}>{children}</span>
}

// ── filters, search, counts ─────────────────────────────────────────────────
/** Toggle-button group (aria-pressed). options: [{ value, label, count? }]. */
export function FilterGroup({ label, options = [], value, onChange, className = '' }) {
  return (
    <div className={'col-filter' + (className ? ' ' + className : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="col-filter-btn" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          <span>{o.label}</span>{o.count != null ? <span className="col-filter-n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Search box on a taped paper strip, with a clear button. Controlled: value + onChange(string). */
export function SearchField({ label = 'Search', value, onChange, placeholder, className = '', id }) {
  const auto = useId()
  const fid = id || 'col-s' + auto.replace(/[^a-zA-Z0-9]/g, '')
  return (
    <div className={'col-search' + (className ? ' ' + className : '')} role="search">
      <label htmlFor={fid} className="col-search-label">{label}</label>
      <div className="col-search-box">
        <svg className="col-search-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input id={fid} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} />
        {value ? <button type="button" className="col-search-clear" onClick={() => onChange('')} aria-label="Clear search"><span aria-hidden="true">&#x2715;</span></button> : null}
      </div>
    </div>
  )
}

/** Live result count ("12 members" / "Showing 12 of 140 members"), handwritten. */
export function ResultCount({ shown, total, noun = 'result', plural, className = '' }) {
  const word = (x) => (x === 1 ? noun : (plural || noun + 's'))
  const text = total == null || shown === total ? shown + ' ' + word(shown) : 'Showing ' + shown + ' of ' + total + ' ' + word(total)
  return <p className={'col-count' + (className ? ' ' + className : '')} role="status" aria-live="polite">{text}</p>
}

// ── stickers ────────────────────────────────────────────────────────────────
const pt2 = (a, r) => (100 + r * Math.cos(a)).toFixed(1) + ' ' + (100 + r * Math.sin(a)).toFixed(1)
const burst = (n, R, r) => { let d = ''; for (let i = 0; i < n * 2; i++) d += (i ? 'L' : 'M') + pt2(Math.PI * i / n - Math.PI / 2, i % 2 ? r : R); return d + 'Z' }
const scallop = (n, r, c) => {
  let d = 'M' + pt2(-Math.PI / 2, r)
  for (let i = 1; i <= n; i++) { const a = 2 * Math.PI * i / n - Math.PI / 2; d += 'Q' + pt2(a - Math.PI / n, c) + ' ' + pt2(a, r) }
  return d + 'Z'
}
const SHAPES = {
  burst: ['0 0 200 200', <path className="col-sh" d={burst(18, 94, 80)} />],
  circle: ['0 0 200 200', <circle className="col-sh" cx="100" cy="100" r="92" />],
  flower: ['0 0 200 200', <path className="col-sh" d={scallop(8, 78, 104)} />],
  scallop: ['0 0 200 200', <path className="col-sh" d={scallop(16, 88, 100)} />],
  pill: ['0 0 360 180', <rect className="col-sh" x="5" y="5" width="350" height="170" rx="85" />],
}
// the sample's five stickers, in order; money figures always get the wide pill
const LOOKS = [
  { shape: 'burst', tone: 'gold', xl: true, t: -6, sp: 1.1, k: 0.8 },
  { shape: 'circle', tone: 'cran', t: 8, sp: 0.88, k: -1 },
  { shape: 'flower', tone: 'azure', t: -10, sp: 1.14, k: 0.9 },
  { shape: 'scallop', tone: 'turq', t: 7, sp: 1.06, k: 0.7 },
  { shape: 'circle', tone: 'violet', t: -5, sp: 0.92, k: -0.8 },
]
const DARK_TEXT = new Set(['gold', 'turq'])

/**
 * A row of stickers for headline figures.
 * items: [{ value, label, money?, shape?, tone? }]; currency = club currency (formatMoney).
 * Zero/empty values are dropped (hideZero). stickersIn()/house() pops them in and counts up.
 */
export function StatRow({ items = [], currency, hideZero = true, className = '' }) {
  const list = items.filter((s) => s && (!hideZero || Number(s.value) > 0))
  const ref = useRef(null)
  // one font size for every figure, the largest at which all fit (client, 2026-10-06)
  useFitNumbers(ref, '.col-stk-num', '.col-stk-card', [list.map((s) => s.value).join('|')], 0.76)
  if (!list.length) return null
  let n = 0
  return (
    <ul ref={ref} className={'col-stickers' + (className ? ' ' + className : '')}>
      {list.map((s, i) => {
        const look = s.money ? { shape: 'pill', tone: 'royal', wide: true, t: 4, sp: 0.94, k: -0.6 } : LOOKS[n++ % LOOKS.length]
        const shape = SHAPES[s.shape || look.shape] || SHAPES.circle
        const tone = s.tone || look.tone
        const text = s.money ? formatMoney(s.value, currency) : groupInt(s.value, currency)
        return (
          <li key={s.label + i} className={'col-stk' + (look.wide ? ' is-wide' : '') + (look.xl ? ' is-xl' : '') + (text.length >= 12 ? ' is-long' : '')} data-col-speed={look.sp}
            style={{ '--col-c': 'var(--col-' + tone + ')', '--col-fg': DARK_TEXT.has(tone) ? 'var(--col-ink)' : '#fff', '--col-t': look.t + 'deg', '--col-k': look.k, '--col-len': text.length }}>
            <div className="col-stk-move"><div className="col-stk-fl"><div className="col-stk-card">
              <svg className="col-stk-shape" viewBox={shape[0]} aria-hidden="true" focusable="false">{shape[1]}</svg>
              <p className="col-stk-num" data-fit={text} data-col-to={Number(s.value) || 0} data-col-cur={currency || undefined} data-col-money={s.money ? '' : undefined}>{text}</p>
              <p className="col-stk-label">{s.label}</p>
            </div></div></div>
          </li>
        )
      })}
    </ul>
  )
}

// ── states ──────────────────────────────────────────────────────────────────
const EmptyFrame = () => (
  <svg className="col-empty-frame" viewBox="0 0 80 90" aria-hidden="true" focusable="false">
    <rect x="6" y="6" width="68" height="78" rx="2" /><rect x="14" y="14" width="52" height="46" rx="1" />
    <path d="M18 54 L32 38 L42 48 L50 40 L62 54" />
  </svg>
)
/** The designed "nothing here yet": a taped kraft note with an empty print outline. */
export function EmptyState({ title = 'Nothing here yet', message, action, as: H = 'h2', className = '' }) {
  return (
    <div className={'col-empty' + (className ? ' ' + className : '')}>
      <div className="col-empty-in">
        <Tape tone="gold" tilt={-4} />
        <EmptyFrame />
        <H className="col-empty-title">{title}</H>
        {message ? <p className="col-empty-msg">{message}</p> : null}
        {action ? <div className="col-empty-act">{action}</div> : null}
      </div>
    </div>
  )
}

/** Not found (unknown project/event/profile): a torn note + the way back. The page's PageHero keeps the h1. */
export function NotFound({ title = 'We couldn’t find that', message, backHref = '/', backLabel = 'Back to home', as: H = 'h2' }) {
  return (
    <div className="col-notfound">
      <div className="col-notfound-in">
        <Tape tone="cran" tilt={4} />
        <p className="col-notfound-mark" aria-hidden="true">?</p>
        <H className="col-notfound-title">{title}</H>
        {message ? <p className="col-notfound-msg">{message}</p> : null}
        <Button href={backHref}>{backLabel}</Button>
      </div>
    </div>
  )
}

/** Loading: blank prints waiting to develop (shimmer only with motion allowed). */
export function Loading({ label = 'Loading', count = 3, className = '' }) {
  return (
    <div className={'col-loading' + (className ? ' ' + className : '')} role="status">
      <span className="col-sr">{label}…</span>
      <ul aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} style={{ '--col-r': [-4, 3, -2, 5][i % 4] + 'deg', '--col-i': i }}><i /></li>
        ))}
      </ul>
    </div>
  )
}

// ── the shared PhotoLightbox, made modal ────────────────────────────────────
/**
 * State + behaviour for the shared <PhotoLightbox> (it brings Esc, arrows, swipe):
 * while it is open the page behind is inert and smooth scroll is held, focus
 * moves to its Close button and returns to the control that opened it, and each
 * photo develops from sepia (motion allowed only).
 *   const lb = useLightbox()
 *   <PhotoLightbox urls={urls} index={lb.index} onIndex={lb.setIndex} />
 *   <button onClick={(e) => lb.open(i, e)}>…</button>
 */
export function useLightbox() {
  const [index, setIndex] = useState(null)
  const back = useRef(null)
  const open = (i, e) => { back.current = e && e.currentTarget ? e.currentTarget : document.activeElement; setIndex(i) }
  const isOpen = index !== null && index !== undefined

  useEffect(() => {
    if (!isOpen) return undefined
    const app = document.getElementById('root')
    const opener = back.current
    if (app) app.inert = true
    lockScroll(true)
    const raf = requestAnimationFrame(() => { const b = document.querySelector('.pdm-lb.open .pdm-lb__close'); if (b) b.focus() })
    return () => {
      cancelAnimationFrame(raf)
      if (app) app.inert = false
      lockScroll(false)
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || prefersReducedMotion()) return undefined
    const img = document.querySelector('.pdm-lb.open .pdm-lb__img')
    if (!img) return undefined
    let t = null
    const run = () => { t = gsap.fromTo(img, { filter: DEV0 }, { filter: DEV1, duration: 1.2, ease: 'power2.out', clearProps: 'filter' }) }
    if (img.complete) run(); else img.addEventListener('load', run, { once: true })
    return () => { img.removeEventListener('load', run); if (t) t.kill(); gsap.set(img, { clearProps: 'filter' }) }
  }, [index, isOpen])

  return { index, setIndex, open, isOpen }
}

// ── socials ─────────────────────────────────────────────────────────────────
const ICONS = {
  facebook: '<path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.6V21z" fill="currentColor"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>',
  linkedin: '<rect x="4" y="9.5" width="3.2" height="10" fill="currentColor"/><circle cx="5.6" cy="5.8" r="1.9" fill="currentColor"/><path d="M10 9.5h3.1v1.4c.5-.9 1.7-1.7 3.4-1.7 3 0 3.5 2 3.5 4.5v5.8h-3.2v-5.1c0-1.2 0-2.7-1.7-2.7s-1.9 1.3-1.9 2.6v5.2H10z" fill="currentColor"/>',
  twitter: '<path d="M4 4h4.6l3.9 5.3L17 4h2.6l-5.9 6.8L20.5 20h-4.6l-4.2-5.7L6.8 20H4.2l6.3-7.2z" fill="currentColor"/>',
  youtube: '<path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z" fill="currentColor"/>',
  web: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="2"/>',
}
export function SocialIcon({ platform }) {
  const k = String(platform || '').trim().toLowerCase()
  const html = ICONS[k === 'x' ? 'twitter' : k] || ICONS.web
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: html }} />
}
