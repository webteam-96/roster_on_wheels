'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Share controls for records the API publishes NO /share payload for.
//
// Projects have GET /api/public/projects/{id}/share. Events have no equivalent —
// six URL shapes were probed live against a real event id and every one is 404,
// while the same probe against a project returns 200. So there is no shareUrl,
// no shareText and no 1200x630 card for an event, and there is no rich
// WhatsApp/Facebook preview to be had until a backend endpoint exists.
//
// What there IS: useProjectShare() already degrades to a locally-built fallback
// when it has no project id (that path exists for API builds predating the
// endpoint). Passing no id therefore gives the SAME resolved share object and
// the SAME channel list the project row uses, built entirely from page data.
// Only the chrome is re-declared here — ProjectDetail keeps its own copy inline,
// tuned across six themes, and is not worth destabilising for this.
// ─────────────────────────────────────────────────────────────────────────────
import { useProjectShare, shareChannels, sharePopup, SHARE_ICONS } from './projectShare.jsx'

/** A share object built purely from page data — no API call is made. */
export function useLocalShare(fallback) {
  return useProjectShare({ projectId: 0, yearId: null, fallback })
}

/** Injected ONCE per page, not per card. Bespoke because this port ships
 *  precompiled Tailwind: hover:bg-[#25D366] and friends exist in no theme's
 *  built stylesheet, so the brand colour has to arrive as a CSS variable. */
export const SHARE_CSS = `
.shr{display:flex;flex-wrap:wrap;gap:.5rem;}
.shr__b{position:relative;transition:background-color .25s,color .25s,transform .25s;}
.shr__b svg{height:16px;width:16px;}
.shr__b:hover,.shr__b:focus-visible{background:var(--shr-brand,#12284c);color:#fff;transform:translateY(-2px);}
.shr__t{pointer-events:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;border-radius:6px;background:#1c1c24;color:#fff;padding:.25rem .5rem;font-size:10px;font-weight:700;opacity:0;transition:opacity .2s;}
.shr__t.is-on{opacity:1;}
`

/** The full channel row — WhatsApp / Facebook / X / LinkedIn / mail / copy (/ OS sheet). */
export function ShareRow({ share, isWarm, caption = 'Share' }) {
  const channels = shareChannels(share)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
        <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        {caption}
      </p>
      <div className="shr">
        {channels.map((ch) => {
          const base = (isWarm
            ? 'flex h-9 w-9 items-center justify-center rounded-full bg-gold/10 text-gold-cta'
            : 'flex h-9 w-9 items-center justify-center rounded-full bg-navy/5 text-navy') + ' shr__b'
          const style = ch.brand ? { '--shr-brand': ch.brand } : undefined
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
               className={base} style={style}
               /* mailto must navigate normally; the rest open in the centred
                  share window, or a new tab when the popup is blocked */
               target={ch.key === 'mail' ? undefined : '_blank'}
               rel={ch.key === 'mail' ? undefined : 'noopener noreferrer'}
               onClick={ch.popup ? sharePopup : undefined}>
              {glyph}
            </a>
          ) : (
            <button key={ch.key} type="button" aria-label={ch.label} title={ch.label}
                    className={base} style={style} onClick={ch.onClick}>
              {glyph}
              {ch.doneLabel && <span className={'shr__t' + (ch.done ? ' is-on' : '')}>{ch.doneLabel}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One button, for a LIST card where a row of eight would drown the card.
 * Phones get the OS share sheet, which reaches every app the visitor actually
 * has; desktop browsers mostly have no sheet, so there it copies the link and
 * says so rather than opening a control that does nothing.
 */
export function ShareButton({ share, isWarm }) {
  const done = share.copied === 'link'
  const label = done ? 'Copied' : 'Share'
  const cls = isWarm
    ? 'inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-gold-cta transition-all duration-300 hover:border-gold hover:bg-gold/10'
    : 'inline-flex items-center gap-1.5 rounded-full border-2 border-navy/10 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-navy transition-all duration-300 hover:border-gold hover:bg-gold/5'
  return (
    <button type="button" className={cls}
            aria-label={share.canNative ? 'Share this event' : 'Copy the link to this event'}
            title={share.canNative ? 'Share this event' : 'Copy the link to this event'}
            onClick={share.canNative ? share.native : share.copyLink}>
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {done ? SHARE_ICONS.check : SHARE_ICONS.more}
      </svg>
      {label}
    </button>
  )
}
