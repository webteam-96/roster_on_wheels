'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Split Story — the theme's reusable pieces. Derived from the approved sample
// (Theme8-Samples/C-split-story): the royal page hero with ScrollFloat letters,
// the sticky side panel that re-titles itself per chapter, the stacked cards,
// the gold-to-azure timeline, the gold wipe rows, the diagonal-wipe slider, the
// gold band. Styles live in theme.css (all `spl-` classes). See DESIGN.md.
//
// Components that carry motion run their own useScene, so a page only has to
// render them. Nothing here hides anything in CSS: with reduced motion every
// piece is simply visible and static.
// ─────────────────────────────────────────────────────────────────────────────
import { Children, Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatMoney, groupInt, adAnchorProps, plainText, formatYear } from '../_shared/data.js'
import { PersonPhoto, SafeImg, imgFallback, paragraphs, useFitNumbers } from '../_shared/kit.jsx'
import {
  gsap, ScrollTrigger, useScene, SPL_WIDE, motionOn, titleIn, titleOnScroll, riseIn, countUp,
  swingStack, timelineIn, goldBand, magnet, wipeSlide, swapChars, lockScroll,
} from './motion.js'

export { PersonPhoto, SafeImg, imgFallback, paragraphs }

/** "2026-2027" -> "2026–27" (every page shows the Rotary year this way); '' when none. */
export const yearText = (label) => (label ? String(formatYear(label)).replace('-', '–') : '')

/**
 * The charter year a club's own About text states ("was chartered on May 20,
 * 1991", "chartered in 1985" - never "a chartered accountant since 1995"), else 0.
 * One rule for Home, About and Past presidents.
 */
export function charterYear(html) {
  const m = /\bchartered\s+(?:on|in)\b[^.]{0,40}?\b(19\d{2}|20\d{2})\b/i.exec(plainText(html))
  const y = m ? +m[1] : 0
  return y >= 1905 && y <= new Date().getFullYear() ? y : 0
}

/**
 * Admin HTML -> one line of plain text with EVERY entity decoded (the shared
 * plainText knows only a handful, so "&ndash;" / "&rsquo;" showed literally).
 * Tags become spaces first; DOMParser then only decodes text, nothing loads or runs.
 */
export function htmlText(html) {
  const s = String(html || '').replace(/<[^>]*>/g, ' ')
  const t = typeof DOMParser === 'undefined' ? s : new DOMParser().parseFromString(s, 'text/html').documentElement.textContent
  return t.replace(/\s+/g, ' ').trim()
}

/**
 * The shared PhotoLightbox moves no focus. While it is open (`open`), this makes
 * everything else in <body> inert, pauses smooth scroll, puts focus on its close
 * button, and on close gives focus back to `backRef.current` (the opener, as it
 * was when the viewer opened).
 */
export function useLightboxFocus(open, backRef) {
  useEffect(() => {
    if (!open) return undefined
    const box = document.querySelector('[data-pdm-lightbox].open')
    const others = box ? [...document.body.children].filter((el) => el !== box && !el.inert) : []
    others.forEach((el) => { el.inert = true })
    lockScroll(true)
    const close = box && box.querySelector('.pdm-lb__close')
    if (close) close.focus()
    const back = backRef && backRef.current
    return () => {
      others.forEach((el) => { el.inert = false })
      lockScroll(false)
      if (back && back.isConnected) back.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

// ── icons ────────────────────────────────────────────────────────────────────
export const Arrow = ({ dir = 1 }) => (
  <svg className="spl-ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d={dir < 0 ? 'M16 10H4m5-5-5 5 5 5' : 'M4 10h12m-5-5 5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
export const Chevron = ({ dir = 'down' }) => (
  <svg className="spl-ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d={dir === 'left' ? 'M12.5 4 6.5 10l6 6' : dir === 'right' ? 'M7.5 4l6 6-6 6' : 'M4 7.5l6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ── numbers ──────────────────────────────────────────────────────────────────
/**
 * Text for a figure. fmt: 'group' (default, digit grouping in the club's
 * locale), 'money' (compact: ₹3.90 Cr / Rs 8.16 M), 'moneyFull', 'plain', 'pad'
 * (two digits). A non-number value is returned as text.
 */
export function formatFig(fmt, v, currency, suffix = '') {
  if (typeof v !== 'number') return String(v == null ? '' : v) + suffix
  const n = Math.round(v)
  let t
  switch (fmt) {
    case 'money': t = formatMoney(n, currency, { compact: true }); break
    case 'moneyFull': t = formatMoney(n, currency); break
    case 'plain': t = String(n); break
    case 'pad': t = String(n).padStart(2, '0'); break
    default: t = groupInt(n, currency)
  }
  return t + suffix
}

/**
 * A figure whose text is owned by the DOM, not React, so motion can count it
 * (countUp in motion.js) without fighting React's text node. Always shows the
 * final value when nothing animates it.
 */
export function Num({ value, fmt = 'group', currency, suffix = '', className = '', as: Tag = 'span' }) {
  const ref = useRef(null)
  const v = typeof value === 'number' ? value : Number(value)
  const numeric = Number.isFinite(v)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const f = (x) => formatFig(fmt, x, currency, suffix)
    el._splValue = numeric ? v : undefined
    el._splFormat = numeric ? f : undefined
    el.textContent = numeric ? f(v) : String(value == null ? '' : value)
  }, [v, numeric, value, fmt, currency, suffix])
  return <Tag ref={ref} className={('spl-num ' + className).trim()} />
}

// ── page hero ────────────────────────────────────────────────────────────────
/** Home / … / current page. `items` = [{ label, href? }] after Home; the last one is the current page. */
export function Crumbs({ items = [] }) {
  return (
    <nav className="spl-crumbs" aria-label="Breadcrumb">
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
 * THE page hero — every inner page opens with it (royal field, crumbs, the one
 * <h1> in condensed Archivo rising letter by letter). Optional: eyebrow, lead,
 * `stat` = { value, label, fmt?, currency? } counted up in gold on the right
 * (pass it only once the data has loaded), `media` = { src, alt, fallbacks? }
 * a wide photo that opens through the iris as the page scrolls, `children`
 * (search/filters/buttons) under the title.
 */
// eslint-disable-next-line no-unused-vars -- eyebrow / lead / stat are still passed by pages, deliberately not shown
export function PageHero({ title, crumbs, eyebrow, lead, stat, media, children, className = '' }) {
  const ref = useRef(null)
  const trail = crumbs || [{ label: title }]
  // Three scenes, so data that lands after the title (the stat, the photo) never replays its entrance.
  useScene(ref, (c, ctx) => {
    const r = ref.current
    titleIn(ctx, r.querySelector('.spl-hero-title'))
    riseIn(r.querySelectorAll('.spl-crumbs, .spl-hero-eyebrow, .spl-hero-lead, .spl-hero-extra'), { delay: 0.45 })
  }, [title])
  // the photo (project detail) rises in WHOLE - no circle crop (client, 2026-10-05)
  useScene(ref, () => {
    const m = ref.current.querySelector('.spl-hero-media')
    if (m) riseIn(m, { delay: 0.3 })
  }, [media ? media.src : null])

  return (
    <section className={('spl-hero spl-on-dark ' + className).trim()} ref={ref}>
      <div className="spl-x">
        <Crumbs items={trail} />
        {/* breadcrumb + title (+ the page's own controls) only: no eyebrow, lead or count (client, 2026-10-05) */}
        <div className="spl-hero-grid">
          <div className="spl-hero-main">
            <h1 className="spl-hero-title" key={title}>{title}</h1>
          </div>
        </div>
        {children ? <div className="spl-hero-extra">{children}</div> : null}
        {media && media.src ? (
          <div className="spl-hero-media">
            <img src={media.src} alt={media.alt || ''} data-fallbacks={media.fallbacks || ''} onError={imgFallback} width="1600" height="700" decoding="async" />
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** A section title (condensed, rises once on scroll) with optional eyebrow and a right-hand action. */
export function SectionHead({ eyebrow, title, id, as: Tag = 'h2', action, tone = 'light', className = '' }) {
  const ref = useRef(null)
  useScene(ref, (c, ctx) => { titleOnScroll(ctx, ref.current.querySelector('.spl-sh-title')) }, [title])
  return (
    <div className={('spl-sh spl-sh--' + tone + ' ' + className).trim()} ref={ref}>
      <div className="spl-sh-main">
        {eyebrow ? <p className="spl-sh-eyebrow">{eyebrow}</p> : null}
        <Tag className="spl-sh-title" id={id} key={title}>{title}</Tag>
      </div>
      {action ? <div className="spl-sh-action">{action}</div> : null}
    </div>
  )
}

// ── actions ──────────────────────────────────────────────────────────────────
/**
 * Pill button. variant: 'gold' | 'royal' | 'ghost' (royal outline, on white) |
 * 'light' (white outline, on royal/night). With `href` it is a link (plain
 * internal hrefs route in-app); `external` opens a new tab and says so
 * (`srHint` replaces the default " (opens in a new tab)", e.g. " (PDF, opens in a new tab)").
 */
export function Button({ href, variant = 'royal', external = false, srHint, arrow = true, children, className = '', ...rest }) {
  const cls = ('spl-btn spl-btn--' + variant + ' ' + className).trim()
  const inner = (
    <>
      <span>{children}</span>
      {arrow ? <Arrow /> : null}
      {external ? <span className="spl-sr">{srHint || ' (opens in a new tab)'}</span> : null}
    </>
  )
  if (href) {
    return <a className={cls} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>{inner}</a>
  }
  return <button type="button" className={cls} {...rest}>{inner}</button>
}

/** The underlined azure text link of the sample ("Read our full story"). */
export function TextLink({ href, external = false, children, className = '', ...rest }) {
  return (
    <a className={('spl-textlink ' + className).trim()} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>
      {children}{external ? <span className="spl-sr"> (opens in a new tab)</span> : null}
    </a>
  )
}

/** "← Back to …" for detail pages. */
export function BackLink({ href, children }) {
  return <a className="spl-back" href={href}><Arrow dir={-1} /><span>{children}</span></a>
}

/** A small mist pill (avenue, category, status). */
export function Tag({ children, tone = 'mist', className = '' }) {
  return <span className={('spl-tag spl-tag--' + tone + ' ' + className).trim()}>{children}</span>
}

// ── cards ────────────────────────────────────────────────────────────────────
/**
 * Photo card: 4:3 frame (ringed mist ground when there is no photo), tag,
 * condensed title, meta line, free children. The TITLE is the one link and it
 * stretches over the whole card. The frame is `.spl-card-media`, so a page can
 * run photosIn('.spl-card-media') on its grid.
 */
export function Card({ href, img, alt = '', tag, title, meta, children, external = false, titleAs: T = 'h3', className = '' }) {
  return (
    <article className={('spl-card ' + className).trim()}>
      <div className="spl-card-media">
        {img ? <SafeImg src={img} alt={alt} width="800" height="600" /> : null}
      </div>
      <div className="spl-card-body">
        {tag ? <Tag>{tag}</Tag> : null}
        <T className="spl-card-title">
          {href
            ? <a className="spl-stretch" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{title}</a>
            : title}
        </T>
        {meta ? <p className="spl-card-meta">{meta}</p> : null}
        {children}
      </div>
    </article>
  )
}

/** The sample's leader card: 4:5 portrait (initials when there is none), azure role, condensed name, clamped bio. */
export function PersonCard({ name, role, img, href, bio, more, nameAs: T = 'h3', className = '' }) {
  return (
    <article className={('spl-person ' + className).trim()}>
      <div className="spl-person-photo" aria-hidden="true">
        <PersonPhoto src={img} name={name} alt="" className="spl-person-img" monoClass="spl-person-mono" width="400" height="500" draggable="false" />
      </div>
      <div className="spl-person-body">
        {role ? <p className="spl-person-role">{role}</p> : null}
        <T className="spl-person-name">{href ? <a className="spl-stretch" href={href}>{name}</a> : name}</T>
        {bio ? <p className="spl-person-bio">{bio}</p> : null}
        {more && href ? <a className="spl-person-more" href={href}>{more}<span className="spl-sr">: {name}</span></a> : null}
      </div>
    </article>
  )
}

// ── filters ──────────────────────────────────────────────────────────────────
/** Filter chips — real buttons with aria-pressed. items = [{ value, label, count?, ariaLabel? }]. */
export function Chips({ label, items, value, onChange, className = '' }) {
  return (
    <div className={('spl-chips ' + className).trim()} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={String(it.value)} type="button" className="spl-chip" aria-pressed={value === it.value ? 'true' : 'false'} aria-label={it.ariaLabel} onClick={() => onChange(it.value)}>
          <span>{it.label}</span>
          {it.count != null ? <span className="spl-chip-n">{it.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Labelled search input. `id` must be unique on the page. */
export function SearchField({ id, label, value, onChange, placeholder = '', className = '' }) {
  return (
    <div className={('spl-search ' + className).trim()}>
      <label className="spl-search-label" htmlFor={id}>{label}</label>
      <div className="spl-search-box">
        <svg className="spl-ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m13 13 4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <input id={id} type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  )
}

/** "12 members" / "Showing 3 of 48 members" — announced politely when it changes. */
export function ResultCount({ count, total, noun = ['result', 'results'], className = '' }) {
  const word = (total != null ? total : count) === 1 ? noun[0] : noun[1]
  const text = total != null && total !== count ? 'Showing ' + count + ' of ' + total + ' ' + word : count + ' ' + (count === 1 ? noun[0] : noun[1])
  return <p className={('spl-count ' + className).trim()} aria-live="polite">{text}</p>
}

// ── figures ──────────────────────────────────────────────────────────────────
/**
 * A row of figures that count up when they scroll in. items = [{ value, label,
 * fmt?, currency? }]. tone 'light' (royal figures on white) or 'dark' (gold on royal/night).
 */
export function StatRow({ items, tone = 'light', className = '' }) {
  const ref = useRef(null)
  const key = items.map((i) => i.label + ':' + i.value).join('|')
  useScene(ref, (c, ctx) => {
    ref.current.querySelectorAll('.spl-num').forEach((n) => countUp(ctx, n, { trigger: ref.current, duration: 1.6 }))
  }, [key])
  // one font size for every figure, the largest at which all fit (client, 2026-10-06)
  useFitNumbers(ref, 'dd', '.spl-statrow-item', [key])
  return (
    <dl className={('spl-statrow spl-statrow--' + tone + ' ' + className).trim()} ref={ref}>
      {items.map((it) => (
        <div className={'spl-statrow-item' + ((typeof it.value === 'number' ? formatFig(it.fmt || 'group', it.value, it.currency) : String(it.value)).length >= 12 ? ' is-long' : '')} key={it.label}>
          <dt>{it.label}</dt>
          <dd data-fit={typeof it.value === 'number' ? formatFig(it.fmt || 'group', it.value, it.currency) : String(it.value)}><Num value={it.value} fmt={it.fmt} currency={it.currency} /></dd>
        </div>
      ))}
    </dl>
  )
}

const STAT_TONES = ['gold', 'azure', 'night', 'mist', 'royal']

/**
 * The stacked figure cards (sticky; each swings in, then sinks back as the next
 * lands). items = [{ value, label, fmt?, currency? }]. Inside a <Split>, pass
 * `panel` = { title, sub } and each card also re-titles the side panel.
 */
export function StatStack({ items, panel, grid = false, className = '' }) {
  const ref = useRef(null)
  const key = items.map((i) => i.label + ':' + i.value).join('|')
  useScene(ref, (c, ctx) => {
    const r = ref.current
    if (grid) {
      // the grid (home, client 2026-10-05): two cards a row, each rises in and counts as it arrives
      r.querySelectorAll('.spl-stat').forEach((card) => {
        gsap.fromTo(card, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', clearProps: 'transform,opacity,translate', scrollTrigger: { trigger: card, start: 'top 90%', once: true } })
        const n = card.querySelector('.spl-num'); if (n) countUp(ctx, n, { trigger: card, start: 'top 88%' })
      })
      return
    }
    const cards = r.querySelectorAll('.spl-stat'), sents = r.querySelectorAll('.spl-sentinel')
    swingStack(cards, sents)
    cards.forEach((card, i) => { const n = card.querySelector('.spl-num'); if (n) countUp(ctx, n, { trigger: sents[i], start: 'top 85%' }) })
  }, [key])
  return (
    grid ? (
      <div className={('spl-stack is-grid ' + className).trim()} ref={ref}>
        {items.map((it, i) => (
          <article key={it.label} className={'spl-stat spl-stat--' + (it.tone || STAT_TONES[i % STAT_TONES.length])}
                   {...(panel ? fig({ title: panel.title, value: it.value, fmt: it.fmt || 'group', currency: it.currency, caption: it.label, sub: panel.sub || '' }) : {})}>
            <span className="spl-stat-ring" aria-hidden="true" />
            <p className="spl-stat-num" style={{ '--len': formatFig(it.fmt, Number(it.value) || 0, it.currency).length }}>
              <Num value={it.value} fmt={it.fmt} currency={it.currency} />
            </p>
            <p className="spl-stat-label">{it.label}</p>
          </article>
        ))}
      </div>
    ) :
    <div className={('spl-stack ' + className).trim()} ref={ref}>
      {items.map((it, i) => (
        <Fragment key={it.label}>
          <div className="spl-sentinel" {...(panel ? fig({ title: panel.title, value: it.value, fmt: it.fmt || 'group', currency: it.currency, caption: it.label, sub: panel.sub || '' }) : {})} />
          <article className={'spl-stat spl-stat--' + (it.tone || STAT_TONES[i % STAT_TONES.length])} style={{ '--i': i }}>
            <span className="spl-stat-ring" aria-hidden="true" />
            <p className="spl-stat-num" style={{ '--len': formatFig(it.fmt, Number(it.value) || 0, it.currency).length }}>
              <Num value={it.value} fmt={it.fmt} currency={it.currency} />
            </p>
            <p className="spl-stat-label">{it.label}</p>
          </article>
        </Fragment>
      ))}
    </div>
  )
}

// ── the split: sticky side panel + story column ──────────────────────────────
/** Spread onto any element inside a <Split>'s story column to make it a panel state. */
export function fig(state) { return { 'data-spl-fig': JSON.stringify(state) } }

const fmtState = (st, v) => formatFig(st.fmt || 'plain', v === undefined ? st.value : v, st.currency, st.suffix || '')

/**
 * THE signature layout. Left (wide): a royal panel, sticky for the viewport's
 * height, whose chapter title rises letter by letter and whose big gold figure
 * counts to the state of whatever marker last crossed the middle of the screen.
 * Phones: the panel is a 60px sticky strip (title + figure).
 *
 * Markers: any element in `children` carrying fig({ title, value, from?, fmt?,
 * currency?, suffix?, caption?, sub? }) — <Chapter> does it for you. `rail` =
 * the chapter titles in order (the panel lists them and lights the current
 * one; more than 6 flow into two columns). `deps` MUST change whenever the
 * markers change (data loaded, filter applied) and keep a constant length.
 */
export function Split({ rail = [], deps = [], children, className = '' }) {
  const root = useRef(null)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return undefined
    const panel = el.querySelector('.spl-panel'), story = el.querySelector('.spl-story')
    const q = (s) => panel.querySelector(s)
    const pTitle = q('.spl-p-title'), pFig = q('.spl-p-mid .spl-p-fig'), pCap = q('.spl-p-cap'), pSub = q('.spl-p-sub'), probe = q('.spl-p-probe')
    const railLis = [...panel.querySelectorAll('.spl-p-rail li')]
    const wide = window.matchMedia(SPL_WIDE)
    const moving = motionOn()
    const markers = [...story.querySelectorAll('[data-spl-fig]')]
    const states = markers.map((m) => { try { return JSON.parse(m.getAttribute('data-spl-fig')) } catch (e) { return null } })
    let curKey = null, curState = null, killTitle = null, figTw = null, capTw = null, tops = [], dirty = true, alive = true

    const fitFig = (text) => {
      if (!wide.matches) { pFig.style.removeProperty('--spl-fs'); return }
      probe.textContent = text
      const w = probe.getBoundingClientRect().width, avail = pFig.clientWidth
      if (w && avail) pFig.style.setProperty('--spl-fs', Math.min(window.innerHeight * 0.22, (avail / w) * 96) + 'px')
    }
    const swapFig = (st) => {
      if (figTw) { figTw.kill(); figTw = null }
      fitFig(fmtState(st))
      if (!moving) { pFig.textContent = fmtState(st); return }
      const tl = gsap.timeline()
      if (typeof st.value === 'number') {
        const o = { v: typeof st.from === 'number' ? st.from : 0 }
        pFig.textContent = fmtState(st, o.v)
        tl.to(o, { v: st.value, duration: 1.1, ease: 'expo.out', onUpdate: () => { pFig.textContent = fmtState(st, Math.round(o.v)) }, onComplete: () => { pFig.textContent = fmtState(st) } }, 0)
      } else {
        pFig.textContent = fmtState(st)
      }
      // fromTo with explicit filters: tweening from "none" starts at brightness(0).
      tl.fromTo(pFig, { yPercent: 25, opacity: 0, filter: 'blur(10px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.55, ease: 'power3.out', clearProps: 'transform,opacity,filter' }, 0)
      figTw = tl
    }
    const setState = (st, force) => {
      const key = st.title + '|' + st.value + '|' + (st.caption || '') + '|' + (st.sub || '')
      if (!force && key === curKey) return
      const sameTitle = !force && curState && curState.title === st.title
      curKey = key; curState = st
      if (!sameTitle) { if (killTitle) killTitle(); killTitle = swapChars(pTitle, st.title || '') }
      swapFig(st)
      pCap.textContent = st.caption || ''
      pSub.textContent = st.sub || ''
      if (moving) {
        if (capTw) capTw.kill()
        capTw = gsap.fromTo([pCap, pSub], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: 'power2.out', clearProps: 'transform,opacity' })
      }
      railLis.forEach((li) => li.classList.toggle('is-on', li.getAttribute('data-t') === st.title))
    }
    // The active state = the last marker whose top is above the middle of the viewport.
    const pick = (force) => {
      if (!alive || !markers.length) return
      // minus any GSAP y a reveal left on the marker, so a card still fading up does not shift its state
      if (dirty) { const y = window.scrollY; tops = markers.map((m) => m.getBoundingClientRect().top + y - (Number(gsap.getProperty(m, 'y')) || 0)); dirty = false }
      const line = window.scrollY + window.innerHeight * 0.5
      let i = 0
      for (let k = 0; k < tops.length; k++) if (tops[k] <= line) i = k
      if (states[i]) setState(states[i], force)
    }
    const onRefresh = () => { dirty = true; pick(); if (curState) fitFig(fmtState(curState)) }
    ScrollTrigger.addEventListener('refresh', onRefresh)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { dirty = true }) : null
    if (ro) ro.observe(story)

    const ctx = gsap.context(() => {
      ScrollTrigger.create({ trigger: el, start: 'top bottom', end: 'bottom top', onUpdate: () => pick() })
      if (moving) {
        const range = { trigger: story, start: 'top top', end: 'bottom bottom' }
        gsap.fromTo(q('.spl-p-progress i'), { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { ...range, scrub: true } })
        gsap.to(q('.spl-p-orbit'), { rotation: 360, ease: 'none', scrollTrigger: { ...range, scrub: 1 } })
      }
    }, el)
    el.classList.toggle('is-motion', moving)
    const raf = requestAnimationFrame(() => pick(true))
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive && curState) fitFig(fmtState(curState)) })

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ScrollTrigger.removeEventListener('refresh', onRefresh)
      if (ro) ro.disconnect()
      if (killTitle) killTitle()
      if (figTw) figTw.kill()
      if (capTw) capTw.kill()
      ctx.revert()
      gsap.set([pFig, pCap, pSub], { clearProps: 'transform,opacity,filter' })
      el.classList.remove('is-motion')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return (
    <div className={('spl-split ' + className).trim()} ref={root}>
      <aside className="spl-panel spl-on-dark" aria-hidden="true">
        <div className="spl-p-orbit"><i /></div>
        <p className="spl-p-title" />
        <div className="spl-p-mid">
          <p className="spl-p-fig" />
          <p className="spl-p-cap" />
          <p className="spl-p-sub" />
        </div>
        {rail.length > 0 ? (
          <ol className={'spl-p-rail' + (rail.length > 6 ? ' is-dense' : '')} style={{ '--spl-rail-rows': Math.ceil(rail.length / 2) }}>{rail.map((t) => <li key={t} data-t={t}>{t}</li>)}</ol>
        ) : null}
        <span className="spl-p-fig spl-p-probe" />
        <div className="spl-p-progress"><i /></div>
      </aside>
      <div className="spl-story">{children}</div>
    </div>
  )
}

/**
 * One chapter of a <Split>. `state` is the panel state it opens with (title is
 * filled in). Its heading is visually hidden by default — the panel shows it —
 * set `showTitle` for a visible SectionHead instead.
 */
export function Chapter({ id, title, state = {}, showTitle = false, className = '', children }) {
  return (
    <section className={('spl-chapter ' + className).trim()} id={id} aria-labelledby={id + '-t'} {...fig({ value: '', ...state, title })}>
      {showTitle ? <SectionHead id={id + '-t'} title={title} /> : <h2 className="spl-sr" id={id + '-t'}>{title}</h2>}
      {children}
    </section>
  )
}

// ── lists ────────────────────────────────────────────────────────────────────
/**
 * The gold-to-azure timeline. Children are <TimelineItem>s. The line draws,
 * dots pop, labels slide, photos alternate iris / diagonal wipe (all built in).
 * `watch`: any value that changes when the items change (e.g. the year id).
 */
export function Timeline({ children, watch = '', className = '' }) {
  const ref = useRef(null)
  useScene(ref, (c, ctx) => { timelineIn(ctx, ref.current) }, [Children.count(children), watch])
  return (
    <div className={('spl-tl ' + className).trim()} ref={ref}>
      <div className="spl-tl-line" aria-hidden="true"><i /></div>
      <ol className="spl-tl-list">{children}</ol>
    </div>
  )
}

/**
 * label: the big condensed line (a date, a year, a number); tag: mist pill;
 * photo/photoAlt: optional frame (portrait photos get a narrower frame
 * automatically); title: <h3>; state: optional panel state inside a <Split>.
 */
export function TimelineItem({ label, tag, photo, photoAlt = '', title, titleAs: T = 'h3', state, children, className = '' }) {
  const onLoad = (e) => {
    const img = e.currentTarget
    if (img.naturalHeight > img.naturalWidth && img.parentElement) img.parentElement.classList.add('is-portrait')
  }
  return (
    <li className={('spl-tl-item ' + className).trim()} {...(state ? fig(state) : {})}>
      <span className="spl-tl-dot" aria-hidden="true" />
      {label ? <p className="spl-tl-label">{label}</p> : null}
      {tag ? <Tag>{tag}</Tag> : null}
      {photo ? <div className="spl-tl-photo"><SafeImg src={photo} alt={photoAlt} width="800" height="600" onLoad={onLoad} /></div> : null}
      {title ? <T className="spl-tl-title">{title}</T> : null}
      {children}
    </li>
  )
}

/**
 * Rows that fill with gold from the left on hover/focus, with a royal pill that
 * leans toward the pointer (the sample's newsletters). Children: <WipeRow>s;
 * `watch` as for <Timeline>.
 */
export function WipeList({ children, watch = '', className = '' }) {
  const ref = useRef(null)
  useScene(ref, (c, ctx) => {
    if (!c.fine) return
    ref.current.querySelectorAll('.spl-row').forEach((a) => magnet(ctx, a, a.querySelector('.spl-row-cta')))
  }, [Children.count(children), watch])
  return <ul className={('spl-rows ' + className).trim()} ref={ref}>{children}</ul>
}

/**
 * One wipe row. `srHint` is read after the CTA (e.g. " (PDF, opens in a new tab)").
 * Without `href` the row is not a link: no wipe, no pill, `status` in its place.
 */
export function WipeRow({ href, title, meta, cta = 'Open', external = false, srHint, status = 'Not available', state }) {
  if (!href) {
    return (
      <li {...(state ? fig(state) : {})}>
        <div className="spl-row is-off">
          <span className="spl-row-title">{title}</span>
          {meta ? <span className="spl-row-meta">{meta}</span> : null}
          <span className="spl-row-na">{status}</span>
        </div>
      </li>
    )
  }
  return (
    <li {...(state ? fig(state) : {})}>
      <a className="spl-row" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <span className="spl-row-title">{title}</span>
        {meta ? <span className="spl-row-meta">{meta}</span> : null}
        <span className="spl-row-cta">{cta}{srHint ? <span className="spl-sr">{srHint}</span> : external ? <span className="spl-sr"> (opens in a new tab)</span> : null}</span>
      </a>
    </li>
  )
}

// ── the diagonal-wipe slider ─────────────────────────────────────────────────
/**
 * slides = [{ src, fallbacks?, url?, alt }]. A slide with `url` is itself the
 * link (new tab). Hidden slides are visibility:hidden, so they never swallow a
 * click. Autoplay pauses on hover and focus; reduced motion starts paused.
 * tone 'dark' (on royal) | 'light' (on white); fit 'cover' | 'contain';
 * `frameClass` sizes the frame (theme.css: spl-frame--banner 16:5, spl-frame--ad 4:3).
 */
export function Slider({ slides, label, itemLabel = 'banner', tone = 'dark', fit = 'cover', frameClass = 'spl-frame--banner', interval = 6000, className = '', pause = true }) {
  const n = slides.length
  const [cur, setCur] = useState(0)
  const [prev, setPrev] = useState(-1)
  const [paused, setPaused] = useState(() => !motionOn())
  const [hold, setHold] = useState(false)
  const frame = useRef(null)
  const shown = useRef(0)
  const idx = Math.min(cur, Math.max(0, n - 1))
  // fit="auto" (the home banner, client 2026-10-06): the frame takes the SHOWN picture's own shape once it has
  // loaded, so nothing is cropped; very tall / very wide pictures are clamped and shown whole (contain) inside it
  const [shapes, setShapes] = useState({})
  const shapeOf = (i) => (e) => {
    const im = e.currentTarget
    if (fit === 'auto' && im.naturalWidth && im.naturalHeight) setShapes((m) => (m[i] ? m : { ...m, [i]: im.naturalWidth / im.naturalHeight }))
  }
  const autoAr = fit === 'auto' ? Math.min(3.6, Math.max(1.3, shapes[idx] || 16 / 5)) : null

  useEffect(() => { setCur(0); setPrev(-1); shown.current = 0 }, [n])

  const go = (k) => {
    if (n < 2) return
    const next = ((k % n) + n) % n
    if (next === idx) return
    setPrev(idx)
    setCur(next)
  }

  useLayoutEffect(() => {
    if (shown.current === idx) return undefined
    shown.current = idx
    const el = frame.current && frame.current.children[idx]
    if (!el || !motionOn()) { setPrev(-1); return undefined }
    const tw = wipeSlide(el, () => setPrev(-1))
    return () => { tw.kill(); gsap.set(el, { clearProps: 'clipPath' }) }
  }, [idx])

  useEffect(() => {
    if (paused || hold || n < 2) return undefined
    const t = setTimeout(() => go(idx + 1), interval)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, paused, hold, n, interval])

  return (
    <div className={('spl-slider spl-slider--' + tone + ' ' + className).trim()} role="region" aria-roledescription="carousel" aria-label={label}
         onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHold(true) }}
         onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHold(false) }}
         onFocusCapture={() => setHold(true)}
         onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHold(false) }}>
      <div className={'spl-frame ' + frameClass + (fit === 'contain' ? ' is-contain' : '') + (fit === 'auto' ? ' is-auto' : '')} ref={frame}
           style={autoAr ? { aspectRatio: autoAr.toFixed(3), width: 'min(100%, calc(72svh * ' + autoAr.toFixed(3) + '))', marginInline: 'auto' } : undefined}>
        {slides.map((s, i) => {
          const cls = 'spl-slide' + (i === idx ? ' is-on' : '') + (i === prev && prev !== idx ? ' is-off' : '')
          const img = <img src={s.src} data-fallbacks={s.fallbacks || ''} alt={s.url ? '' : (s.alt || '')} onError={imgFallback} onLoad={shapeOf(i)} width="1600" height="500" decoding="async" />
          return s.url
            ? <a key={i} className={cls} href={s.url} {...adAnchorProps(s.url)} aria-label={(s.alt || 'Open ' + itemLabel + ' ' + (i + 1)) + ' (opens in a new tab)'}>{img}</a>
            : <figure key={i} className={cls}>{img}</figure>
        })}
      </div>
      {n > 1 ? (
        <div className="spl-slider-ctrl">
          <div className="spl-dots">
            {slides.map((_, i) => (
              <button key={i} type="button" className="spl-dot" aria-label={'Show ' + itemLabel + ' ' + (i + 1) + ' of ' + n} aria-current={i === idx ? 'true' : 'false'} onClick={() => go(i)}><i /></button>
            ))}
          </div>
          {pause ? <button type="button" className="spl-pause" aria-label={(paused ? 'Play ' : 'Pause ') + itemLabel + ' slideshow'} onClick={() => setPaused((p) => !p)}>{paused ? 'Play' : 'Pause'}</button> : null}
        </div>
      ) : null}
    </div>
  )
}

// ── bands and states ─────────────────────────────────────────────────────────
/**
 * The gold closing band: rises from the bottom edge as a circle, its title's
 * letters float up with the scroll, `giant` (optional, decorative) slides
 * sideways. Put the real content in children.
 */
export function GoldBand({ id, title, giant, children, className = '' }) {
  const ref = useRef(null)
  useScene(ref, (c, ctx) => { goldBand(ctx, ref.current) }, [title, typeof giant === 'string' ? giant : !!giant])
  return (
    <section className={('spl-band ' + className).trim()} aria-labelledby={id} ref={ref}>
      <div className="spl-x">
        <h2 className="spl-band-title" id={id} key={title}>{title}</h2>
        {giant ? <p className="spl-band-giant" aria-hidden="true"><span>{giant}</span></p> : null}
        {children}
      </div>
    </section>
  )
}

/** The designed "nothing here yet". tone 'light' | 'dark'. */
export function EmptyState({ title, message, action, headingAs: T = 'h2', tone = 'light', className = '' }) {
  return (
    <div className={('spl-empty spl-empty--' + tone + ' ' + className).trim()}>
      <span className="spl-empty-ring" aria-hidden="true"><i /></span>
      <T className="spl-empty-title">{title}</T>
      {message ? <p className="spl-empty-msg">{message}</p> : null}
      {action || null}
    </div>
  )
}

/** A whole-page not-found (detail pages): hero with the <h1>, message, way back. */
export function NotFound({ title = 'Not found', message, crumbs, backHref = '/', backLabel = 'Back to home' }) {
  return (
    <>
      <PageHero title={title} crumbs={crumbs} lead={message} />
      <div className="spl-x spl-notfound">
        <Button href={backHref} variant="gold">{backLabel}</Button>
      </div>
    </>
  )
}

/** Resting state while a hook returns null. */
export function Loading({ label = 'Loading' }) {
  return (
    <div className="spl-loading" role="status">
      <span className="spl-loading-orbit" aria-hidden="true"><i /></span>
      <span>{label}…</span>
    </div>
  )
}

/** First-sentence + excerpt helpers for API text (plain text in, plain text out). */
export function excerpt(text, max = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[,;:.\s]+$/, '') + '…'
}
