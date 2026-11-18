// AccordionGallery — React Bits (JavaScript + CSS variant), integrated 2026-09-09.
//
// Kept as close to the upstream source as possible ON PURPOSE, so it can be
// diffed against reactbits.dev when they publish a fix. Everything this project
// needs to change about it is done through PROPS at the call site
// (HomeHandloom.jsx), never by editing the body:
//
//   radius / accentColor / overlayColor / textColor  — carry the handloom tokens
//   trigger / tilt / expandRatio                     — tuned to this theme's motion law
//
// TWO THINGS TO KNOW BEFORE REUSING IT ELSEWHERE:
//
//   1. It pulls in GSAP. That is the only reason gsap is a dependency of this
//      app, and the bundle ships to every theme, not just the one that renders
//      this. If the accordion is ever removed, drop gsap with it.
//   2. It shows ONE label per panel and nothing else. A project card here used
//      to carry title + description + avenue chip; the accordion can only carry
//      the title. That loss is inherent to the component, not a wiring mistake.
import { useRef, useEffect, useState, useCallback } from 'react';
import { gsap } from 'gsap';

import './AccordionGallery.css';

const DEFAULT_ITEMS = [
  { image: 'https://picsum.photos/id/1015/900/1200', label: 'Canyon', link: '#' },
  { image: 'https://picsum.photos/id/1018/900/1200', label: 'Ridgeline', link: '#' },
  { image: 'https://picsum.photos/id/1039/900/1200', label: 'Falls', link: '#' },
  { image: 'https://picsum.photos/id/1043/900/1200', label: 'Harbour', link: '#' },
  { image: 'https://picsum.photos/id/1044/900/1200', label: 'Skyline', link: '#' }
];

const AccordionGallery = ({
  items = DEFAULT_ITEMS,
  defaultIndex = 2,
  accentColor = '#ffffff',
  overlayColor = '#060010',
  textColor = '#ffffff',
  height = 460,
  gap = 10,
  radius = 16,
  expandRatio = 0.52,
  orientation = 'horizontal',
  duration = 0.6,
  ease = 'power3.out',
  parallax = 0.5,
  tilt = 8,
  stagger = 0.06,
  trigger = 'hover',
  showLabels = true,
  grayscale = true,
  className = '',
  onImageError,
  autoplay = false,        // ADDED (2026-09-09)
  autoplayDelay = 4        // ADDED — seconds each panel holds
}) => {
  const rootRef = useRef(null);
  const panelRefs = useRef([]);
  const mediaRefs = useRef([]);
  const barRefs = useRef([]);
  const textRefs = useRef([]);
  const tlRef = useRef(null);
  const firstRunRef = useRef(true);
  const mediaSizeRef = useRef(320);

  const vertical = orientation === 'vertical';
  const count = items.length;
  const [active, setActive] = useState(Math.min(Math.max(defaultIndex, 0), count - 1));
  // ADDED (2026-09-09): autoplay holds while a pointer is over the gallery or a
  // panel has focus, so hovering and keyboard use still take precedence — the
  // deck must never move under someone who is reading or tabbing through it.
  const [held, setHeld] = useState(false);

  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const applyLayout = useCallback(
    animate => {
      const panels = panelRefs.current;
      if (!panels.length) return;

      const r = Math.min(Math.max(expandRatio, 0.2), 0.9);
      const grow = count > 1 ? (r * (count - 1)) / (1 - r) : 1;
      const mediaSize = mediaSizeRef.current;

      tlRef.current?.kill();
      const dur = animate && !prefersReduced ? duration : 0;
      const tl = gsap.timeline();

      panels.forEach((panel, i) => {
        if (!panel) return;
        const isActive = i === active;
        const media = mediaRefs.current[i];
        const bar = barRefs.current[i];
        const text = textRefs.current[i];

        const rot = isActive ? 0 : i < active ? tilt : -tilt;
        const rotProp = vertical ? { rotateX: -rot } : { rotateY: rot };

        // FIX (2026-09-09): '--ag-dim' is tweened HERE, on the panel, not on
        // the media below. It is consumed by .ag-panel__overlay, which is a
        // SIBLING of .ag-panel__media inside .ag-panel__frame — and custom
        // properties inherit DOWNWARD only, so writing it on the media never
        // reached the overlay and var(--ag-dim, 0.35) took its fallback in
        // every state. The visible symptom was a permanent 35% wash over every
        // photograph and an active panel that never resolved to full colour.
        // The panel is an ancestor of both, so from here it actually lands.
        // '--ag-gray' stays on the media, because filter: grayscale() is
        // declared on that element.
        tl.to(panel, {
          flexGrow: isActive ? grow : 1,
          ...rotProp,
          '--ag-dim': isActive ? 0 : 0.35,
          duration: dur,
          ease
        }, 0);

        if (media) {
          const drift = Math.max(-1.5, Math.min(1.5, active - i));
          const shift = drift * parallax * mediaSize * 0.06;
          const gray = grayscale ? (isActive ? 0 : 1) : 0;
          tl.to(
            media,
            {
              xPercent: -50,
              yPercent: -50,
              x: vertical ? 0 : isActive ? 0 : shift,
              y: vertical ? (isActive ? 0 : shift) : 0,
              '--ag-gray': gray,
              duration: dur,
              ease
            },
            0
          );
        }

        if (showLabels && bar && text) {
          if (isActive) {
            tl.to([bar, text], { opacity: 1, x: 0, duration: dur, ease, stagger: prefersReduced ? 0 : stagger }, 0);
          } else {
            tl.to([bar, text], { opacity: 0, x: -14, duration: dur * 0.6, ease }, 0);
          }
        }
      });

      tlRef.current = tl;
    },
    [
      active,
      count,
      expandRatio,
      duration,
      ease,
      vertical,
      tilt,
      parallax,
      grayscale,
      showLabels,
      stagger,
      prefersReduced
    ]
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const total = vertical ? rect.height : rect.width;
      const usable = Math.max(total - gap * (count - 1), 120);
      const size = Math.max(140, usable * Math.min(Math.max(expandRatio, 0.2), 0.9) * 1.22);
      mediaSizeRef.current = size;
      el.style.setProperty('--ag-media-size', `${size}px`);
      applyLayout(!firstRunRef.current);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyLayout, gap, count, expandRatio, vertical]);

  // FIX (2026-09-09): re-clamp when the list shrinks. `active` is seeded once
  // from defaultIndex; a year change that returns fewer projects left it
  // pointing past the end, and then NO panel matched `i === active` — the whole
  // band rendered with nothing expanded and no label.
  useEffect(() => {
    setActive(a => (a > count - 1 ? Math.max(count - 1, 0) : a));
  }, [count]);

  useEffect(() => {
    applyLayout(!firstRunRef.current);
    firstRunRef.current = false;
  }, [applyLayout]);

  useEffect(
    () => () => {
      tlRef.current?.kill();
    },
    []
  );

  // ADDED (2026-09-09): advance on a timer so the band shows its projects
  // without anyone touching it. `active` is in the deps on purpose — each tick
  // schedules exactly the next one, so a hover that changes `active` also
  // restarts the clock instead of firing early.
  // prefersReduced disables it outright: an auto-advancing gallery is precisely
  // the motion that opt-out exists for.
  useEffect(() => {
    if (!autoplay || held || prefersReduced || count < 2) return undefined;
    const id = setTimeout(
      () => setActive(a => (a + 1) % count),
      Math.max(autoplayDelay, 1) * 1000
    );
    return () => clearTimeout(id);
  }, [autoplay, autoplayDelay, held, prefersReduced, count, active]);

  const handleEnter = i => {
    if (trigger === 'hover') setActive(i);
  };

  const handleClick = (i, e) => {
    if (i !== active) {
      e.preventDefault();
      setActive(i);
    }
  };

  // FIX (2026-09-09), two defects in four lines:
  //  1. It moved `active` without moving FOCUS. The ring stayed on the panel
  //     you came from while a different one expanded, and because handleClick
  //     preventDefaults any click on a non-active panel, the Enter that
  //     followed was swallowed and never navigated. Moving focus instead fixes
  //     both: onFocus already calls setActive, so the two cannot diverge.
  //  2. It swallowed ArrowUp/ArrowDown in a HORIZONTAL accordion, so a
  //     keyboard user who tabbed into the band could no longer scroll the page
  //     — Down just cycled pictures. The keys are now gated on orientation.
  const handleKeyDown = (i, e) => {
    const fwd = vertical ? 'ArrowDown' : 'ArrowRight';
    const back = vertical ? 'ArrowUp' : 'ArrowLeft';
    if (e.key !== fwd && e.key !== back) return;
    e.preventDefault();
    const next = e.key === fwd ? (i + 1) % count : (i - 1 + count) % count;
    const el = panelRefs.current[next];
    if (el && el.focus) el.focus();
    else setActive(next);
  };

  return (
    <div
      ref={rootRef}
      className={`accordion-gallery${vertical ? ' accordion-gallery--vertical' : ''}${className ? ` ${className}` : ''}`}
      style={{
        '--ag-accent': accentColor,
        '--ag-overlay': overlayColor,
        '--ag-text': textColor,
        '--ag-gap': `${gap}px`,
        '--ag-radius': `${radius}px`,
        height: vertical ? `${Math.round(height * 1.6)}px` : `${height}px`
      }}
      aria-label="Image accordion gallery"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      {items.map((item, i) => {
        const isActive = i === active;
        const Tag = item.link ? 'a' : 'div';
        // FIX (2026-09-09): role="listitem" REMOVED from the panel below, and
        // role="list" from the wrapper above. On an <a> it OVERRODE the native
        // link role, so all six project links vanished from every screen-reader
        // link list — the only route from the home page to a project detail. A
        // row of links needs no list semantics. tabIndex is now only for an
        // item with no href, since an anchor that has one is already focusable.
        //
        // (A JSX comment cannot live in an attribute list; that is what broke
        // the first attempt at recording this.)
        return (
          <Tag
            key={i}
            ref={el => (panelRefs.current[i] = el)}
            className={`ag-panel${isActive ? ' ag-panel--active' : ''}`}
            style={{ borderRadius: `${radius}px` }}
            href={item.link || undefined}
            onClick={e => handleClick(i, e)}
            onMouseEnter={() => handleEnter(i)}
            onFocus={() => setActive(i)}
            onKeyDown={e => handleKeyDown(i, e)}
            tabIndex={item.link ? undefined : 0}
            aria-current={isActive ? 'true' : undefined}
            aria-label={item.label}
          >
            <span className="ag-panel__frame">
              <span className="ag-panel__media" ref={el => (mediaRefs.current[i] = el)}>
                {/* loading="lazy" (2026-09-09) — this band is below the fold
                    and every other image in this app already lazy-loads. */}
                <img src={item.image} alt={item.alt || item.label || ''} draggable="false"
                     loading="lazy" onError={onImageError} />
              </span>
              <span className="ag-panel__overlay" aria-hidden="true" />
            </span>
            {/* ADDED (2026-09-09): the BADGE and the SPINE.
                The card this replaced carried the project's avenue chip as well
                as its title, and the accordion dropped both. The badge puts the
                avenue back on the open panel.
                The spine is the title again, set vertically, shown only while a
                panel is COLLAPSED — five anonymous photographs was the standing
                complaint about this band. It is driven by the .ag-panel--active
                class in CSS rather than by the timeline, deliberately: GSAP
                owns opacity on .ag-panel__bar/__text, and two writers on one
                property is how that kind of thing ends up stuck at 0. */}
            {item.badge && (
              <span className="ag-panel__badge" aria-hidden="true">{item.badge}</span>
            )}
            {showLabels && (
              <>
                <span className="ag-panel__spine" aria-hidden="true">{item.label}</span>
                <span className="ag-panel__label" aria-hidden="true">
                  <span className="ag-panel__bar" ref={el => (barRefs.current[i] = el)} />
                  <span className="ag-panel__text" ref={el => (textRefs.current[i] = el)}>
                    {item.label}
                  </span>
                </span>
              </>
            )}
          </Tag>
        );
      })}
    </div>
  );
};

export default AccordionGallery;
