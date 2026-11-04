'use client'
// The image viewer from ProjectDetail, made reusable.
//
// ProjectDetail keeps its OWN copy of the open/close state because that page
// coordinates the viewer with its child-project popup (shared Esc handling and a
// single body-scroll lock across both overlays). Pulling that apart would mean
// restructuring that page's interaction logic for no benefit, so what is shared
// here is the DESIGN — the stylesheet and the portal markup — while each page
// keeps whatever state model it needs.
//
// Class names stay `pdm-*` so the two pages remain visually identical and so the
// existing selectors in ProjectDetail's own CSS keep matching.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The viewer's stylesheet. ProjectDetail interpolates this into its PAGE_CSS;
 * pages that only need the viewer can render it through <LightboxStyles />.
 * Kept as a string (not a .css file) because this port ships PRECOMPILED
 * stylesheets — a new .css import would not be in any theme's built sheet.
 */
export const LIGHTBOX_CSS = `
        @keyframes pdmIn{from{opacity:0;transform:translateY(26px) scale(.965);}to{opacity:1;transform:none;}}
        @keyframes pdmFade{from{opacity:0;}}
        /* portalled to <body>: inside <main class="route-enter"> a filled transform
           makes position:fixed resolve against the PAGE, not the viewport. */
        .pdm-lb{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;padding:2rem;}
        .pdm-lb.open{display:flex;}
        .pdm-lb__bg{position:absolute;inset:0;background:rgba(10,6,12,.93);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:pdmFade .3s ease;}
        .pdm-lb__img{position:relative;z-index:1;max-width:min(1200px,94vw);max-height:84vh;border-radius:10px;box-shadow:0 40px 90px -30px rgba(0,0,0,.8);animation:pdmIn .35s cubic-bezier(.2,.7,.2,1);user-select:none;}
        .pdm-lb__btn{position:absolute;z-index:2;display:flex;height:44px;width:44px;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;transition:background .25s,transform .25s;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}
        .pdm-lb__btn:hover{background:rgba(255,255,255,.24);}
        .pdm-lb__btn:focus-visible{outline:2px solid #fff;outline-offset:2px;}
        .pdm-lb__btn svg{height:20px;width:20px;}
        .pdm-lb__close{top:1.1rem;right:1.1rem;}
        .pdm-lb__prev{left:1.1rem;top:50%;margin-top:-22px;}
        .pdm-lb__next{right:1.1rem;top:50%;margin-top:-22px;}
        .pdm-lb__count{position:absolute;bottom:1.1rem;left:50%;transform:translateX(-50%);z-index:2;font-size:12.5px;letter-spacing:.14em;color:rgba(255,255,255,.88);background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:.3rem .85rem;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-variant-numeric:tabular-nums;}
        /* Per-photo caption (the description typed in the dashboard on upload).
           Sits ABOVE .pdm-lb__count so the two never overlap; on a single-image
           set the counter is hidden, so it drops down into that space. */
        .pdm-lb__cap{position:absolute;bottom:3.4rem;left:50%;transform:translateX(-50%);z-index:2;margin:0;max-width:min(760px,90vw);padding:.45rem .9rem;border-radius:10px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.95);font-size:13px;line-height:1.5;text-align:center;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}
        .pdm-lb.single .pdm-lb__cap{bottom:1.1rem;}
        /* one image: nothing to page through */
        .pdm-lb.single .pdm-lb__prev,.pdm-lb.single .pdm-lb__next,.pdm-lb.single .pdm-lb__count{display:none;}
        @media(max-width:640px){.pdm-lb{padding:1rem;}.pdm-lb__prev{left:.5rem;}.pdm-lb__next{right:.5rem;}}
        @media(prefers-reduced-motion:reduce){.pdm-lb__bg,.pdm-lb__img{animation:none;}}
`

/** Drop-in <style> for pages that use the viewer without their own CSS block. */
export function LightboxStyles() {
  return <style dangerouslySetInnerHTML={{ __html: LIGHTBOX_CSS }} />
}

/**
 * Self-contained viewer: owns Esc/arrow keys, the body-scroll lock, touch swipe
 * and next-image pre-warm.
 *
 * @param {string[]} urls   images to page through
 * @param {number|null} index  open at this index; null = closed
 * @param {(i:number|null)=>void} onIndex  set the index, or null to close
 * @param {string[]} [captions]  per-photo caption, index-aligned with `urls`.
 *   Travels WITH the urls rather than being read off the page, because a page can
 *   open the viewer on more than one set (a project's gallery and one of its
 *   updates) and each set has its own captions. Omit for no captions.
 */
export default function PhotoLightbox({ urls, index, onIndex, captions }) {
  const touchX = useRef(null)
  // Portalled into <body>, which exists only in the browser: render after mount (pages are server-rendered).
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const open = index !== null && index !== undefined && urls && urls.length > 0
  const step = (d) => { if (open) onIndex(((index + d) % urls.length + urls.length) % urls.length) }

  // pre-warm the next slide
  useEffect(() => {
    if (open && urls.length > 1) new Image().src = urls[(index + 1) % urls.length]
  }, [open, index, urls])

  useEffect(() => {
    if (!open) return undefined
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') onIndex(null)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  })

  if (!mounted) return null
  return createPortal(
    <div className={'pdm-lb' + (open ? ' open' : '') + (open && urls.length < 2 ? ' single' : '')}
         data-pdm-lightbox="" role="dialog" aria-modal="true" aria-label="Image viewer"
         onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
         onTouchEnd={(e) => {
           if (touchX.current === null) return
           const dx = e.changedTouches[0].clientX - touchX.current
           touchX.current = null
           if (Math.abs(dx) > 40 && open && urls.length > 1) step(dx < 0 ? 1 : -1)
         }}>
      <div className="pdm-lb__bg" data-lb-close="" onClick={() => onIndex(null)}></div>
      <img className="pdm-lb__img" data-lb-img="" src={open ? urls[index] : undefined}
           alt={open ? 'Photo ' + (index + 1) + ' of ' + urls.length : ''} draggable={false} />
      <button type="button" className="pdm-lb__btn pdm-lb__close" data-lb-close="" onClick={() => onIndex(null)} aria-label="Close image">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button type="button" className="pdm-lb__btn pdm-lb__prev" data-lb-prev="" onClick={() => step(-1)} aria-label="Previous image">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button type="button" className="pdm-lb__btn pdm-lb__next" data-lb-next="" onClick={() => step(1)} aria-label="Next image">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      {open && captions && captions[index] && (
        <p className="pdm-lb__cap" aria-live="polite">{captions[index]}</p>
      )}
      <span className="pdm-lb__count" data-lb-count="" aria-live="polite">{open ? (index + 1) + ' / ' + urls.length : ''}</span>
    </div>, document.body)
}
