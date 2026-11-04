'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION — the theme's building blocks. Every page is composed from
// these so thirteen routes read as one site: ink / paper / azure / gold bands
// with a liquid top edge, Unbounded display type that sweeps in, Instrument
// Serif italic accents, rolling numbers, liquid photos.
//
// Look lives in theme.css (liq-* classes). Motion lives in motion.js and is
// switched on by class hooks (see usePageMotion there): anything rendered here
// is fully visible with no JS and with reduced motion.
// ─────────────────────────────────────────────────────────────────────────────
import { Fragment, forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { formatYear } from '../_shared/data.js'
import { PersonPhoto, useFitNumbers } from '../_shared/kit.jsx'
import { useScene, gsap, heroIn, prefersReducedMotion, lockScroll } from './motion.js'

export { PersonPhoto, SafeImg, paragraphs, imgFallback, hideOnError, isPlaceholderPhoto } from '../_shared/kit.jsx'

// ── text helpers ─────────────────────────────────────────────────────────────
export const pad2 = (n) => String(n).padStart(2, '0')
/** One line of clean text: U+FFFD from bad encodings -> ’, every whitespace run (nbsp included) -> one space. */
export const clean = (s) => String(s == null ? '' : s).replace(/�/g, '’').replace(/\s+/g, ' ').trim()
/**
 * Shorten API text for a card. Cuts at a word boundary under `max`; also mends
 * the API's own hard cuts (bios arrive at ~200-220 chars, descriptions at 260,
 * mid-word): a long string that doesn't end a sentence loses its broken last
 * word and gets an ellipsis.
 */
export function clip(s, max = 220) {
  s = clean(s)
  if (s.length > max) return s.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,;:–-]+$/, '') + '…'
  if (s.length < 195 || /[.!?)"”’]$/.test(s)) return s
  if (/[,;:]$/.test(s)) return s.slice(0, -1) + '…'
  return s.replace(/\s+\S*$/, '').replace(/[\s,;:–-]+$/, '') + '…'
}
/** "Rotary Club of Thane Hills" -> { pre: 'Rotary Club of', short: 'Thane Hills' }; anything else -> { pre: '', short: name }. */
export function splitClubName(name) {
  const s = clean(name)
  const m = s.match(/^((?:the\s+)?(?:rotary|rotaract|interact|inner\s+wheel)\s+(?:e-?)?club(?:\s+of)?)\s+(.+)$/i)
  return m ? { pre: m[1], short: m[2] } : { pre: '', short: s }
}
/** Length of the longest word — drives the display-type fit (`--liq-lw`) so no word overflows at 390px. */
export const longestWord = (s) => Math.max(1, ...clean(s).split(' ').map((w) => Array.from(w).length))
/** "2026-2027" / "2026-27" -> "2026–27" (en dash), '' when unknown. */
export const yearText = (label) => (label ? String(formatYear(label)).replace('-', '–') : '')

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?'
const DATE_RX = new RegExp('\\b\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH + ',?\\s+(?:18|19|20)\\d\\d\\b|\\b' + MONTH + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:18|19|20)\\d\\d\\b|\\b(?:18|19|20)\\d\\d\\b', 'i')

/**
 * The club's own about text -> the sample's three parts: a statement (the
 * opening sentence or two, set large), a short story (the next paragraphs,
 * clipped - the full text lives on /about), and the first year it mentions
 * (the outlined year drifting behind the statement; usually the charter year).
 * Parsed with DOMParser, which never loads or runs anything in admin HTML.
 */
export function splitAbout(html) {
  if (!html || !String(html).trim()) return null
  let text = ''
  try {
    const marked = String(html).replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/tr)\b[^>]*>/gi, '$&\n')
    text = new DOMParser().parseFromString(marked, 'text/html').body.textContent || ''
  } catch (e) { return null }
  const paras = text.split(/\n+/).map(clean).filter((p) => p.length > 1)
  // an opening title line ("Rotary Club of X – An overview") is a heading, not the statement
  if (paras.length > 1 && paras[0].length < 90 && !/[.!?]["”’)]?$/.test(paras[0])) paras.shift()
  if (!paras.length) return null
  const first = paras[0]
  const sentences = first.match(/[^.!?]+(?:[.!?]+|$)/g) || [first]
  let raw = ''
  for (const s of sentences) {
    if (raw && (raw + s).length > 260) break
    raw += s
    if (raw.length >= 120) break
  }
  const statement = clip(raw, 280)
  const rest = [first.slice(raw.length).trim(), ...paras.slice(1)].filter(Boolean)
  const story = []
  let total = 0
  for (const p of rest) {
    if (story.length >= 3 || total > 700) break
    const t = clip(p, Math.max(180, 900 - total))
    story.push(t)
    total += t.length
  }
  const now = new Date().getFullYear()
  const year = (first.match(/\b(18[5-9]\d|19\d\d|20\d\d)\b/) || [])[1]
  const em = (statement.match(DATE_RX) || [])[0]
  return { statement, story, year1: year && Number(year) <= now ? year : '', em }
}

// ── icons ────────────────────────────────────────────────────────────────────
const svg = (d, extra) => (
  <svg className="liq-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...extra}>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const Arrow = () => svg('M5 12h14M13 6l6 6-6 6')
export const ArrowOut = () => svg('M7 17 17 7M9 7h8v8')
export const ArrowLeft = () => svg('M19 12H5M11 6l-6 6 6 6')
export const Chevron = () => svg('M6 9l6 6 6-6')
export const CloseIco = () => svg('M6 6l12 12M18 6 6 18')
export const SearchIco = () => svg('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5')
const Drop = () => svg('M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11z')

// ── type ─────────────────────────────────────────────────────────────────────
/**
 * Text split into per-character spans (React-owned: no DOM surgery, safe to
 * re-render). Screen readers get one clean copy. Words never break inside, so
 * size display text with the fit (`--liq-lw`) and it always fits its column.
 * `mask` wraps each char in a clip (for charsRise / the meeting day).
 */
export function Chars({ text, mask = false }) {
  const t = clean(text)
  const words = t ? t.split(' ') : []
  return (
    <>
      <span className="liq-sr">{t}</span>
      <span className="liq-split" aria-hidden="true">
        {words.map((w, i) => (
          <Fragment key={i}>
            {i > 0 ? ' ' : null}
            <span className="liq-word">
              {Array.from(w).map((ch, j) => (mask
                ? <span className="liq-chm" key={j}><span className="liq-ch">{ch}</span></span>
                : <span className="liq-ch" key={j}>{ch}</span>))}
            </span>
          </Fragment>
        ))}
      </span>
    </>
  )
}

/**
 * Text as word spans for the scrubbed ink-in (give the parent className="liq-ink").
 * `em` = a substring to set in the accent italic (e.g. a charter date).
 */
export function Words({ text, em }) {
  const t = clean(text)
  const at = em ? t.indexOf(clean(em)) : -1
  const end = at < 0 ? -1 : at + clean(em).length
  let pos = 0
  return t.split(' ').filter(Boolean).map((w, i) => {
    const start = t.indexOf(w, pos)
    pos = start + w.length
    const isEm = at >= 0 && start >= at && start < end
    return <Fragment key={i}>{i ? ' ' : null}{isEm ? <em className="liq-w liq-em">{w}</em> : <span className="liq-w">{w}</span>}</Fragment>
  })
}

/** Outlined name that fills with ink as it crosses the screen (fillIn). Reads once to screen readers. */
export function OutlineFill({ text }) {
  return (
    <span className="liq-fill">
      <span className="liq-fill__base" aria-hidden="true">{text}</span>
      <span className="liq-fill__ink">{text}</span>
    </span>
  )
}

// ── bands ────────────────────────────────────────────────────────────────────
/** The liquid top edge every band carries: flat at rest, bulges with scroll velocity. */
export const Edge = () => (
  <svg className="liq-edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M0 100 Q50 100 100 100 Z" />
  </svg>
)

/**
 * A full-width colour band. tone: ink | ink2 | paper | azure | gold. Children go
 * in the 1344px wrap unless `bleed`. `tight` halves the vertical padding.
 * Any other prop (id, aria-labelledby, ref…) lands on the section.
 */
export const Band = forwardRef(function Band({ tone = 'ink', edge = true, bleed = false, tight = false, as: Tag = 'section', className = '', children, ...rest }, ref) {
  return (
    <Tag ref={ref} className={'liq-band liq-band--' + tone + (tight ? ' liq-band--tight' : '') + (className ? ' ' + className : '')} {...rest}>
      {edge ? <Edge /> : null}
      {bleed ? children : <div className="liq-wrap">{children}</div>}
    </Tag>
  )
})

export function Kicker({ as: Tag = 'p', className = '', children, ...rest }) {
  return <Tag className={'liq-kicker' + (className ? ' ' + className : '')} {...rest}>{children}</Tag>
}

/**
 * Section heading: kicker line, then EITHER `title` (h2, 36-88px) OR `big` =
 * ['Our', 'projects'] (the giant title, on ONE line; the second word in the accent colour, solid -
 * no outline, client 2026-09-29). Optional lede and action (a <Pill>).
 */
export function SectionHead({ kicker, title, big, id, lede, action, as: H = 'h2', className = '' }) {
  return (
    <div className={'liq-sh' + (className ? ' ' + className : '')}>
      <div className="liq-sh__main">
        {kicker ? <p className="liq-kicker liq-rv">{kicker}</p> : null}
        {big
          ? (
            <H id={id} className="liq-bigtitle" style={{ '--liq-lw': Array.from(big.filter(Boolean).join(' ')).length }}>
              <span className="liq-bt liq-bt--1">{big[0]}</span>{big[1] ? ' ' : null}
              {big[1] ? <span className="liq-bt liq-bt--2">{big[1]}</span> : null}
            </H>
          )
          : <H id={id} className="liq-h2 liq-rv">{title}</H>}
        {lede ? <p className="liq-sh__lede liq-rv">{lede}</p> : null}
      </div>
      {action ? <div className="liq-sh__act liq-rv">{action}</div> : null}
    </div>
  )
}

// ── actions ──────────────────────────────────────────────────────────────────
/**
 * The capsule button/link. variant: ink (dark fill - on paper/gold), light (white
 * fill - on ink/azure), ghost (hairline - on ink), line (hairline - on paper).
 * With `href` it's an <a>; `external` opens a new tab and says so. Without
 * `href` it's a <button type="button"> (pass onClick, aria-pressed…).
 */
export function Pill({ href, variant = 'ink', external = false, icon = true, back = false, className = '', children, ...rest }) {
  const cls = 'liq-pill liq-pill--' + variant + (back ? ' liq-pill--back' : '') + (className ? ' ' + className : '')
  const Ico = back ? ArrowLeft : external ? ArrowOut : Arrow
  const inner = (
    <>
      {back && icon ? <Ico /> : null}
      <span>{children}</span>
      {!back && icon ? <Ico /> : null}
      {external ? <span className="liq-sr"> (opens in new tab)</span> : null}
    </>
  )
  if (!href) return <button type="button" className={cls} {...rest}>{inner}</button>
  return <a className={cls} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>{inner}</a>
}

// ── page hero ────────────────────────────────────────────────────────────────
/** Breadcrumb: Home / … / current. items = [{ label, href? }]; the last one is the current page (a middle one without href is plain text). */
export function Crumbs({ items = [] }) {
  return (
    <nav className="liq-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/">Home</a></li>
        {items.map((it, i) => (
          <li key={i}>
            {i === items.length - 1
              ? <span aria-current="page">{it.label}</span>
              : it.href ? <a href={it.href}>{it.label}</a> : <span>{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * THE page opening (the breadcrumb band) — ink, under the header, the page's one <h1>.
 * Client, 2026-09-29: a short band with the crumbs and the main heading only - no line
 * above the heading, no extra text under it, no outlined word/number behind it.
 *   crumbs    [{label, href?}] after Home (default: [{ label: title }])
 *   title     the h1 (use the club's menu label: useCurrentMenuName() || 'Directory')
 *   children  the page's controls only (SearchField, Chips…), never text
 */
export function PageHero({ title, crumbs, children, className = '' }) {
  const ref = useRef(null)
  const id = useId()
  const t = clean(title)
  const size = t.length > 44 ? 'sm' : t.length > 20 ? 'md' : 'lg'
  useScene(ref, () => { heroIn(ref.current) }, [])
  return (
    <section className={'liq-ph' + (className ? ' ' + className : '')} aria-labelledby={id} ref={ref}>
      <div className="liq-wrap">
        <div className="liq-ph__top">
          <Crumbs items={crumbs || [{ label: t }]} />
        </div>
        <h1 className="liq-ph__title" id={id}>
          <span className={'liq-ph__name liq-ph__name--' + size} style={{ '--liq-lw': longestWord(t) }}><Chars text={t} /></span>
        </h1>
        {children ? <div className="liq-ph__slot">{children}</div> : null}
      </div>
    </section>
  )
}

// ── media & cards ────────────────────────────────────────────────────────────
/**
 * The liquid photo frame. On desktop its reveal is painted by WebGL, on phones
 * a clip wipe; either way the <img> is real. Missing or broken photo -> the
 * frame keeps its ground and shows `label` in outline type (never a broken icon).
 * ratio: CSS aspect-ratio string ('4 / 3'). fallbacks: 'url|url' chain (banners/ads).
 * Add className="liq-media--still" to opt one out of the motion. `whole` shows the full photo
 * (contain) and the frame takes the photo's own shape once it loads, so there are no dark bars either (client, 2026-10-01).
 * (continued) referrerPolicy: 'no-referrer'
 * for gallery photos (the media host 403s some hot-linked requests that send one).
 */
export function Media({ src, alt = '', ratio, fallbacks, label, eager = false, whole = false, width, height, referrerPolicy, className = '', children }) {
  const [broken, setBroken] = useState(!src)
  const [shape, setShape] = useState(null) // `whole`: the loaded photo's own width / height
  useEffect(() => { setBroken(!src); setShape(null) }, [src])
  const onLoad = (e) => {
    const im = e.currentTarget
    if (whole && im.naturalWidth && im.naturalHeight) setShape(Math.min(2.4, Math.max(0.5, im.naturalWidth / im.naturalHeight)).toFixed(3))
  }
  const onError = (e) => {
    const el = e.currentTarget
    const rest = (el.getAttribute('data-fallbacks') || '').split('|').filter(Boolean)
    if (rest.length) { el.setAttribute('data-fallbacks', rest.slice(1).join('|')); el.src = rest[0] } else setBroken(true)
  }
  return (
    <div className={'liq-media' + (whole ? ' liq-media--whole' : '') + (broken ? ' liq-media--empty' : '') + (className ? ' ' + className : '')}
         style={shape ? { '--liq-ar': shape } : ratio ? { '--liq-ar': ratio } : undefined}>
      {!broken
        ? <img src={src} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy={referrerPolicy} data-fallbacks={fallbacks || undefined} onError={onError} onLoad={onLoad} />
        : (label ? <span className="liq-media__ph" aria-hidden="true">{label}</span> : null)}
      {children}
    </div>
  )
}

/**
 * The project card from the home grid: liquid photo, then a meta row (gold
 * index, azure avenue, date), the title as the link, a 3-line description.
 * portrait = 4:5 frame (else 4:3). Works on ink and paper bands.
 */
export function ProjectCard({ href, title, img, avenue, date, desc, n, portrait = false, more = false, headingLevel = 3, className = '' }) {
  const H = 'h' + headingLevel
  return (
    <article className={'liq-pcard' + (portrait ? ' liq-pcard--port' : '') + (className ? ' ' + className : '')}>
      <div className="liq-pcard__in">
        {/* project photos keep their scroll reveal but have no hover effect (client, 2026-09-28) */}
        <Media src={img} alt="" ratio={portrait ? '4 / 5' : '4 / 3'} label={avenue || 'Rotary'} className="liq-media--nohover" whole />
        <div className="liq-pcard__meta">
          <p className="liq-pcard__row">
            {/* no 01 / 02 number above the title (client, 2026-10-06) */}
            {avenue ? <span className="liq-pcard__av">{avenue}</span> : null}
            {date ? <span>{date}</span> : null}
          </p>
          <H className="liq-pcard__t"><a href={href}>{clean(title)}</a></H>
          {desc ? <p className="liq-pcard__d">{clip(desc, 240)}</p> : null}
          {more ? <Pill href={href} variant="ghost" className="liq-pcard__more">Read more<span className="liq-sr"> about {clean(title)}</span></Pill> : null}
        </div>
      </div>
    </article>
  )
}

/** A panel: white on paper (soft shadow), ink-2 with a hairline on ink. `as` any tag. */
export function Card({ as: Tag = 'div', className = '', children, ...rest }) {
  return <Tag className={'liq-card' + (className ? ' ' + className : '')} {...rest}>{children}</Tag>
}

/** Label / value rows (a <dl>). items = [[label, value], …]; empty values are dropped. Values may be nodes (a link). */
export function Facts({ items, className = '' }) {
  const rows = items.filter(([, v]) => v !== null && v !== undefined && v !== false && String(v).trim() !== '')
  if (!rows.length) return null
  return (
    <dl className={'liq-facts' + (className ? ' ' + className : '')}>
      {rows.map(([k, v]) => <div className="liq-rv" key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}

/**
 * A portrait in the theme's arch (photo, or initials when there is none). Decorative by default - put the name in text beside it.
 * Keyed by src: PersonPhoto remembers a failed photo, so a different person's photo must start fresh.
 */
export function Portrait({ src, name, className = '', decorative = true }) {
  return (
    <span className={'liq-portrait' + (className ? ' ' + className : '')} aria-hidden={decorative ? 'true' : undefined}>
      <PersonPhoto key={src || ''} src={src} name={name} alt={decorative ? '' : name} className="liq-portrait__img" monoClass="liq-portrait__mono" width="400" height="500" />
    </span>
  )
}

/** The leadership row: arched portrait, role, outline->ink name (linked when `href`), a clipped bio, `more` = a "Read more" button to `href`. Render inside <ul className="liq-roll">. */
export function PersonRow({ name, role, img, bio, href, more = false, headingLevel = 3 }) {
  const H = 'h' + headingLevel
  return (
    <li className="liq-person">
      <Portrait src={img} name={name} className="liq-person__pic" />
      <div className="liq-person__txt">
        {role ? <p className="liq-person__role liq-rv">{role}</p> : null}
        <H className="liq-person__name">{href ? <a href={href}><OutlineFill text={name} /></a> : <OutlineFill text={name} />}</H>
        {bio && clean(bio) ? <p className="liq-person__bio liq-rv">{clip(bio, 220)}</p> : null}
        {more && href ? <Pill href={href} variant="line" className="liq-person__more liq-rv">Read more<span className="liq-sr"> about {name}</span></Pill> : null}
      </div>
    </li>
  )
}

// ── numbers ──────────────────────────────────────────────────────────────────
const STRIP = Array.from({ length: 30 }, (_, i) => <span key={i}>{i % 10}</span>)
/**
 * A number that rolls like an odometer. `value` is the finished TEXT
 * (formatMoney / groupInt output) - digits roll, everything else ("₹", ",",
 * " L") stays put. Renders the final figure statically; usePageMotion rolls it
 * up on scroll. `live` = it changes with filters: it then re-rolls on every
 * change instead of on scroll.
 */
export function Odometer({ value, live = false, className = '' }) {
  const text = String(value == null ? '' : value)
  const ref = useRef(null)
  const first = useRef(true)
  const nd = (text.match(/\d/g) || []).length
  let seen = 0
  const parts = Array.from(text).map((ch, i) => {
    if (!/\d/.test(ch)) return <span className="liq-odo__sep" key={i}>{ch}</span>
    const fromRight = nd - 1 - seen++
    const to = Number(ch) + 10 * (fromRight === 0 ? 2 : fromRight === 1 ? 1 : 0) // right-hand columns spin further
    return (
      <span className="liq-odo__col" key={i}>
        <span className="liq-odo__ghost">{ch}</span>
        <span className="liq-odo__strip" style={{ top: -to + 'em' }} data-to={to}>{STRIP}</span>
      </span>
    )
  })
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return undefined }
    if (!live || !ref.current || prefersReducedMotion()) return undefined
    const strips = ref.current.querySelectorAll('.liq-odo__strip')
    if (!strips.length) return undefined // "—" while loading: no digits to roll
    const tw = gsap.fromTo(strips, { top: '0em' }, { top: (i, el) => -Number(el.getAttribute('data-to')) + 'em', duration: 0.9, stagger: 0.04, ease: 'power3.out' })
    return () => tw.kill()
  }, [text, live])
  return (
    <span className={'liq-odo' + (live ? ' liq-odo--live' : '') + (className ? ' ' + className : '')} ref={ref}>
      <span className="liq-sr">{text}</span>
      <span className="liq-odo__vis" aria-hidden="true">{parts}</span>
    </span>
  )
}

/** The home's giant figure list: hairline rows (no 01/02 index - client, 2026-10-01), label left, rolling figure right. items = [{ label, value }]. */
export function Figures({ items }) {
  // one size for every figure (client, 2026-10-06): the size the LONGEST one needs to fit its column
  const longest = Math.max(4, ...items.map((f) => Array.from(String(f.value)).length))
  return (
    <ul className="liq-figs" style={{ '--len': longest, '--n': items.length }}>
      {items.map((f) => (
        <li className="liq-fig" key={f.label}>
          <span className="liq-fig__line liq-line" aria-hidden="true" />
          <span className="liq-fig__label">{f.label}</span>
          <span className="liq-fig__val"><Odometer value={f.value} /></span>
        </li>
      ))}
    </ul>
  )
}

/** Compact stat strip (dl) for a page hero or a filtered list. items = [{ label, value }]; `live` for filter-driven figures. */
export function StatRow({ items, live = false, className = '' }) {
  const ref = useRef(null)
  // one font size for every figure, the largest at which all fit (client, 2026-10-06)
  useFitNumbers(ref, '.liq-stat__v', '.liq-stat', [items.map((s) => s.value).join('|')])
  // tile count with a long figure counted twice - odd leaves the last tile alone on a two-up row
  const odd = items.reduce((n, s) => n + (String(s.value).length >= 12 ? 2 : 1), 0) % 2 === 1
  return (
    <dl ref={ref} className={'liq-stats' + (odd ? ' is-odd' : '') + (className ? ' ' + className : '')}>
      {items.map((s) => (
        <div className={'liq-stat' + (String(s.value).length >= 12 ? ' is-long' : '')} key={s.label}>
          <dt className="liq-stat__l">{s.label}</dt>
          <dd className="liq-stat__v"><Odometer value={s.value} live={live} /></dd>
        </div>
      ))}
    </dl>
  )
}

// ── controls ─────────────────────────────────────────────────────────────────
/** Filter chips: a labelled group of toggle buttons (aria-pressed). options = [{ value, label, count? }]. */
export function Chips({ label, options, value, onChange, className = '' }) {
  return (
    <div className={'liq-chips' + (className ? ' ' + className : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} className="liq-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          <span>{o.label}</span>
          {o.count != null ? <span className="liq-chip__n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Search input with a visible-to-AT label, a search glyph and a clear button. */
export function SearchField({ label = 'Search', value, onChange, placeholder, id, className = '' }) {
  const uid = useId()
  const iid = id || uid
  return (
    <div className={'liq-search' + (className ? ' ' + className : '')}>
      <label className="liq-sr" htmlFor={iid}>{label}</label>
      <SearchIco />
      <input id={iid} type="search" value={value} placeholder={placeholder} autoComplete="off" spellCheck="false" onChange={(e) => onChange(e.target.value)} />
      {value ? <button type="button" className="liq-search__clear" onClick={() => onChange('')}><CloseIco /><span className="liq-sr">Clear search</span></button> : null}
    </div>
  )
}

/** "Showing 12 of 125 members" - announced politely when it changes. */
export function ResultCount({ count, total, one = 'result', many = 'results', className = '' }) {
  const filtered = total != null && total !== count
  return (
    <p className={'liq-count' + (className ? ' ' + className : '')} aria-live="polite">
      {filtered
        ? <>Showing <b>{count}</b> of {total} {total === 1 ? one : many}</>
        : <><b>{count}</b> {count === 1 ? one : many}</>}
    </p>
  )
}

/**
 * The liquid-fill row (home newsletters): a big title, a meta cell, an action
 * cell; on hover/focus an ink circle floods from where the pointer entered.
 * Render inside <ul className="liq-rows"><li>…</li></ul>.
 */
export function RowLink({ href, title, meta, action = 'Open', external = false, className = '' }) {
  const onEnter = (e) => {
    const el = e.currentTarget, r = el.getBoundingClientRect()
    el.style.setProperty('--liq-mx', (e.clientX - r.left) + 'px')
    el.style.setProperty('--liq-my', (e.clientY - r.top) + 'px')
  }
  return (
    <a className={'liq-row' + (className ? ' ' + className : '')} href={href} onPointerEnter={onEnter} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      <span className="liq-row__t">{title}</span>
      {meta ? <span className="liq-row__m">{meta}</span> : null}
      <span className="liq-row__go">{action}{external ? <ArrowOut /> : <Arrow />}{external ? <span className="liq-sr"> (opens in new tab)</span> : null}</span>
    </a>
  )
}

// ── overlays ─────────────────────────────────────────────────────────────────
/**
 * While `open`: every child of <body> except the overlay(s) matching `keep` is
 * inert (no Tab or clicks behind it) and smooth scroll pauses. For overlays
 * portalled to <body> - the shared PhotoLightbox always is. Declare it BEFORE
 * any effect that returns focus on close, so the page is live again by then.
 */
export function useInertBehind(open, keep = '[data-pdm-lightbox]') {
  useEffect(() => {
    if (!open) return undefined
    const behind = [...document.body.children].filter((el) => !el.matches(keep) && !el.inert)
    behind.forEach((el) => { el.inert = true })
    lockScroll(true)
    return () => { behind.forEach((el) => { el.inert = false }); lockScroll(false) }
  }, [open, keep])
}

// ── states ───────────────────────────────────────────────────────────────────
/** The designed "nothing here" block (never a broken box). Works on any band. */
export function EmptyState({ title, text, action, as: H = 'h2', className = '' }) {
  return (
    <div className={'liq-empty' + (className ? ' ' + className : '')}>
      <span className="liq-empty__drop" aria-hidden="true"><Drop /></span>
      <H className="liq-empty__t">{title}</H>
      {text ? <p className="liq-empty__x">{text}</p> : null}
      {action ? <div className="liq-empty__a">{action}</div> : null}
    </div>
  )
}

/** A whole-page "not found" (unknown ?pid= / ?id=): the page hero with a way back. Carries the page's h1. */
export function NotFound({ title = 'Page not found', text, crumbs, backHref = '/', backLabel = 'Back to home' }) {
  return (
    <PageHero title={title} crumbs={crumbs} lede={text}>
      <Pill href={backHref} variant="light" back>{backLabel}</Pill>
    </PageHero>
  )
}

/** Loading placeholder (role=status). */
export function Loading({ label = 'Loading' }) {
  return (
    <div className="liq-loading" role="status">
      <span className="liq-loading__bar" aria-hidden="true"><i /></span>
      <span className="liq-loading__l">{label}</span>
    </div>
  )
}
