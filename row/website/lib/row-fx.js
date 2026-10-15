/* Roster On Wheels — Concept 03 "Fellowship"
   Plain JS + GSAP 3.15 (ScrollTrigger, SplitText, DrawSVG, MotionPath, Draggable, Inertia, CustomEase) + Lenis.
   Every feature is guarded: a missing element or plugin skips that feature and never throws. */
import { gsap as gsapLib } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { Draggable } from 'gsap/Draggable';
import { InertiaPlugin } from 'gsap/InertiaPlugin';
import { CustomEase } from 'gsap/CustomEase';

const W = { gsap: gsapLib, ScrollTrigger, SplitText, DrawSVGPlugin, MotionPathPlugin, Draggable, InertiaPlugin, CustomEase };

/* Builds every scene present on the current page; returns a cleanup that reverts all of it. */
export function initPage() {
  const cleanups = [];

  const doc = document;
  const root = doc.documentElement;
  const $ = (sel, ctx = doc) => ctx.querySelector(sel);
  const $$ = (sel, ctx = doc) => Array.from(ctx.querySelectorAll(sel));
  const media = (q) => window.matchMedia(q);
  const reducedMQ = media('(prefers-reduced-motion: reduce)');
  window.__rowReady = true;

  const gsap = W.gsap;
  const ST = W.ScrollTrigger;
  let EASE_OUT = 'expo.out';
  let EASE_INOUT = 'power3.inOut';
  const SPRING = 'back.out(1.6)';

  if (gsap) {
    gsap.registerPlugin(...['ScrollTrigger', 'SplitText', 'DrawSVGPlugin', 'MotionPathPlugin', 'Draggable', 'InertiaPlugin', 'CustomEase']
      .map((name) => W[name]).filter(Boolean));
    if (W.CustomEase) {
      W.CustomEase.create('rowOut', '0.22,1,0.36,1');
      W.CustomEase.create('rowInOut', '0.65,0,0.35,1');
      EASE_OUT = 'rowOut';
      EASE_INOUT = 'rowInOut';
    }
    if (ST) ST.config({ ignoreMobileResize: true });
  } else {
    root.classList.remove('js'); // no animation library: everything stays in its final, visible state
  }
  const animateUI = () => !!gsap && !reducedMQ.matches;

  /* =====================================================================
     1. Interface that works with or without GSAP
     ===================================================================== */

  /* In-page anchors: Lenis when active, native smooth scroll otherwise; focus follows */
  const goTo = (el) => {
    if (window.rowLenis) window.rowLenis.scrollTo(el);
    else el.scrollIntoView({ block: 'start' }); // CSS scroll-behavior decides smooth vs instant
    if (!el.matches('a[href], button, input, select, textarea, summary, [tabindex]')) {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-nav-target', '');
    }
    el.focus({ preventScroll: true });
  };
  const onAnchorClick = (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const id = decodeURIComponent(a.hash.slice(1));
    const el = id && doc.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (el.matches('details')) el.open = true;
    goTo(el);
    if (location.hash !== a.hash) history.pushState(null, '', a.hash);
  };
  doc.addEventListener('click', onAnchorClick);
  cleanups.push(() => doc.removeEventListener('click', onAnchorClick));

  /* FAQ: native <details>; CSS animates the height; the URL hash follows the open item */
  const faqItems = $$('.faq__item');
  const onFaqToggle = (e) => {
    const d = e.currentTarget;
    if (d.open) history.replaceState(null, '', `#${d.id}`);
    else if (location.hash === `#${d.id}`) history.replaceState(null, '', location.pathname + location.search);
  };
  faqItems.forEach((d) => d.addEventListener('toggle', onFaqToggle));
  cleanups.push(() => faqItems.forEach((d) => d.removeEventListener('toggle', onFaqToggle)));
  const openFromHash = () => {
    const t = location.hash && doc.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t && t.matches('details')) t.open = true;
  };
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
  cleanups.push(() => window.removeEventListener('hashchange', openFromHash));

  if (!gsap) return () => cleanups.forEach((off) => off());

  /* =====================================================================
     2. Shared helpers for motion
     ===================================================================== */

  /* A loop runs only while on screen, the tab is visible and the viewer has not paused it. */
  const loops = new Set();
  const onVisibility = () => loops.forEach((l) => l.sync());
  doc.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => doc.removeEventListener('visibilitychange', onVisibility));
  function makeLoop(el, { play, pause, toggle }) {
    const loop = { visible: false, paused: false, running: false };
    loop.sync = () => {
      const run = loop.visible && !loop.paused && !doc.hidden;
      if (run === loop.running) return;
      loop.running = run;
      if (run) play(); else pause();
    };
    const io = new IntersectionObserver(([entry]) => { loop.visible = entry.isIntersecting; loop.sync(); }, { threshold: 0.12 });
    io.observe(el);
    const onToggle = () => {
      loop.paused = !loop.paused;
      toggle.dataset.paused = String(loop.paused);
      toggle.setAttribute('aria-label', toggle.getAttribute('aria-label').replace(/^(Pause|Play)/, loop.paused ? 'Play' : 'Pause'));
      loop.sync();
    };
    if (toggle) { toggle.hidden = false; toggle.addEventListener('click', onToggle); }
    loop.kill = () => {
      io.disconnect();
      loops.delete(loop);
      if (toggle) toggle.removeEventListener('click', onToggle);
      if (loop.running) pause();
    };
    loops.add(loop);
    return loop;
  }

  /* Re-measure DOM-derived paths whenever ScrollTrigger refreshes (resize, fonts, pins). */
  const onRefreshInit = (fn) => {
    if (ST) { ST.addEventListener('refreshInit', fn); return () => ST.removeEventListener('refreshInit', fn); }
    let t = 0;
    const h = () => { clearTimeout(t); t = setTimeout(fn, 150); };
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  };
  const listen = (offs, el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    offs.push(() => el.removeEventListener(type, fn, opts));
  };
  /* DrawSVG leaves a round-cap dot at 0%, so a draw always fades in with it. */
  const drawFrom = () => ({ drawSVG: '0%', autoAlpha: 0 }); // fresh object: GSAP stores from-vars on the tween
  const drawTo = (vars) => ({ drawSVG: '100%', autoAlpha: 1, ...vars });
  /* Seconds until the first-visit handshake loader lifts (components/Loader.tsx); 0 when it is not showing. */
  const loaderWait = () => {
    const lift = $('.loader')?.getAnimations?.().find((a) => a.animationName === 'loader-out');
    return lift ? Math.max(0, (lift.effect.getComputedTiming().delay - (lift.currentTime || 0)) / 1000) : 0;
  };
  const hasDraw = !!W.DrawSVGPlugin;

  /* One scene failing must not take the rest of the page with it. The failure is still reported, and the
     scene's half-built state is reverted so its content falls back to the static (final) frame. */
  const guard = (name, fn) => (ctx) => {
    try { return fn(ctx); } catch (err) {
      console.error(`[ROW] ${name} scene failed`, err);
      try { ctx.revert(); } catch (e) { /* already reverted */ }
      if (name === 'global') root.classList.remove('js'); // nothing else would reveal the hidden content
      return undefined;
    }
  };

  const MOTION = '(prefers-reduced-motion: no-preference)';
  const REDUCE = '(prefers-reduced-motion: reduce)';
  const mm = gsap.matchMedia();
  const COLORS = { cream: '#F7F9FC', cream2: '#EDF4FB', marigold: '#F7A81B', coral: '#FFC65C', azure: '#17458F', mint: '#0067C8', lilac: '#A9C6EA', sky: '#CFE2F6', stone: '#CBD5E1', muted: '#94A3B8' };

  /* =====================================================================
     3. Global motion: Lenis, hero intro, reveals, split headings, counters
     ===================================================================== */
  mm.add({ motion: MOTION, reduce: REDUCE, fine: '(pointer: fine)' }, guard('global', (ctx) => {
    const { motion, fine } = ctx.conditions;
    const offs = [];
    const toggles = $$('[data-motion-toggle]');

    if (!motion || !ST) {
      gsap.set('[data-intro], [data-reveal], .stat', { autoAlpha: 1 });
      gsap.set('[data-split]', { visibility: 'visible' });
      toggles.forEach((t) => { t.hidden = true; });
      return () => toggles.forEach((t) => { t.hidden = false; });
    }

    /* Hero intro: the H1 is never hidden (it is the LCP); everything around it arrives */
    const intro = $$('.hero [data-intro], .phero [data-intro]');
    // First page of a visit: hold the entrance until the handshake loader lifts
    const heroTl = gsap.timeline({ defaults: { ease: EASE_OUT }, delay: loaderWait() });
    if (intro.length) heroTl.fromTo(intro, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08, clearProps: 'transform' }, 0.12);
    const heroUnderline = $('.hero .scribble path, .phero .scribble path');
    if (heroUnderline && hasDraw) heroTl.fromTo(heroUnderline, drawFrom(), drawTo({ duration: 1, ease: EASE_INOUT }), 0.45);

    /* Generic reveals */
    $$('[data-reveal]').forEach((el) => {
      const fade = el.dataset.reveal === 'fade';
      const st = { trigger: el, start: 'top 88%', once: true };
      if (fade) gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7, ease: EASE_OUT, scrollTrigger: st });
      else gsap.fromTo(el, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: EASE_OUT, clearProps: 'transform', scrollTrigger: st });
    });

    /* Section scribbles draw on scroll (created after the headings are split) */
    const drawScribbles = () => {
      if (!hasDraw) return;
      $$('main section:not(.hero):not(.phero) .scribble path').forEach((p) => {
        gsap.fromTo(p, drawFrom(), drawTo({ duration: 1.1, ease: EASE_INOUT, delay: 0.35, scrollTrigger: { trigger: p.closest('h2') || p, start: 'top 82%', once: true } }));
      });
    };

    /* Proof wheels roll in from the left with a spring; numbers count up once over 1.2s */
    const proof = $('[data-proof]');
    const stats = $$('.stat');
    const counters = $$('[data-count]').map((el) => ({ el, final: el.textContent }));
    if (proof && stats.length) {
      ST.create({
        trigger: proof, start: 'top 85%', once: true,
        onEnter: () => {
          gsap.fromTo(stats, { autoAlpha: 0, x: -90, rotation: -200 }, { autoAlpha: 1, x: 0, rotation: 0, duration: 1.1, ease: SPRING, stagger: 0.14, clearProps: 'transform' });
          counters.forEach(({ el, final }, i) => {
            const to = Number(el.dataset.count) || 0;
            const suffix = el.dataset.suffix || '';
            const n = { v: 0 };
            el.textContent = `0${suffix}`;
            gsap.to(n, {
              v: to, duration: 1.2, ease: 'power2.out', delay: 0.1 + i * 0.08,
              onUpdate: () => { el.textContent = Math.round(n.v).toLocaleString('en-US') + suffix; },
              onComplete: () => { el.textContent = final; },
            });
          });
        },
      });
      offs.push(() => counters.forEach(({ el, final }) => { el.textContent = final; }));
    }

    /* Headings: split into words after fonts load, words hop into place */
    let alive = true;
    offs.push(() => { alive = false; });
    const splitTargets = $$('[data-split]');
    if (W.SplitText && splitTargets.length) {
      const fontsReady = Promise.race([doc.fonts ? doc.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
      fontsReady.then(() => {
        if (!alive) return;
        try {
          ctx.add(() => {
            splitTargets.forEach((h) => {
              const split = W.SplitText.create(h, { type: 'words', tag: 'span', wordsClass: 'w', ignore: '.scribble' });
              // SplitText folds the scribble into the adjacent word; a transformed word would then become its
              // containing block mid-hop. Hand it back to its wrapper so it always spans the whole phrase.
              $$('.scribble', h).forEach((s) => { const wrap = s.closest('.scribble-wrap'); if (wrap && s.parentNode !== wrap) wrap.appendChild(s); });
              gsap.set(h, { visibility: 'visible' });
              gsap.fromTo(split.words, { yPercent: 70, rotation: (i) => (i % 2 ? 5 : -5), autoAlpha: 0 }, {
                yPercent: 0, rotation: 0, autoAlpha: 1, duration: 0.75, ease: SPRING, stagger: 0.05, clearProps: 'transform',
                scrollTrigger: { trigger: h, start: 'top 86%', once: true },
              });
            });
            drawScribbles();
          });
        } catch (err) {
          console.error('[ROW] heading split failed', err);
          gsap.set(splitTargets, { visibility: 'visible' });
        }
        ST.sort();
        ST.refresh();
      });
    } else {
      gsap.set(splitTargets, { visibility: 'visible' });
      drawScribbles();
    }

    /* Magnetic primary CTAs (hero + closing band), fine pointers only, max 6px lean */
    if (fine) {
      $$('[data-magnet]').forEach((m) => {
        const xTo = gsap.quickTo(m, 'x', { duration: 0.5, ease: 'power3.out' });
        const yTo = gsap.quickTo(m, 'y', { duration: 0.5, ease: 'power3.out' });
        let box = null;
        listen(offs, m, 'pointerenter', () => { box = m.getBoundingClientRect(); });
        listen(offs, m, 'pointermove', (e) => {
          if (!box) box = m.getBoundingClientRect();
          xTo(gsap.utils.clamp(-6, 6, (e.clientX - (box.left + box.width / 2)) * 0.25));
          yTo(gsap.utils.clamp(-6, 6, (e.clientY - (box.top + box.height / 2)) * 0.35));
        });
        listen(offs, m, 'pointerleave', () => { box = null; xTo(0); yTo(0); });
        offs.push(() => gsap.set(m, { clearProps: 'transform' }));
      });
    }

    return () => offs.forEach((off) => off());
  }));

  /* =====================================================================
     4. Hero — Spin the Roster
     ===================================================================== */
  let heroIndex = 0; // survives breakpoint rebuilds so the same member stays under the marker

  mm.add({ motion: MOTION, reduce: REDUCE, side: '(min-width: 1180px)', fine: '(pointer: fine)' }, guard('hero', (ctx) => {
    const { motion, side, fine } = ctx.conditions;
    const wheel = $('[data-wheel]');
    const visual = $('[data-hero-visual]');
    if (!wheel || !visual) return undefined;
    const avatars = $$('.wheel__avatar', wheel);
    const N = avatars.length;
    if (!N) return undefined;
    const STEP = 360 / N;
    const offs = [];
    const members = avatars.map((el) => ({ el, email: el.dataset.email, wa: el.dataset.wa, c: el.dataset.c, name: el.dataset.name, initials: el.dataset.initials }));
    const describe = (m) => `${m.name ? m.name + '. ' : ''}Email ${m.email}, WhatsApp ${m.wa}.`; // screen readers only: the phone mock is aria-hidden

    /* Geometry comes from CSS: --marker per layout; radius measured from the DOM */
    const M = parseFloat(getComputedStyle(visual).getPropertyValue('--marker')) || (side ? 180 : 270);
    let R = 300;
    const measure = () => {
      const w = wheel.getBoundingClientRect();
      const a = avatars[0].getBoundingClientRect();
      R = Math.hypot(a.left + a.width / 2 - (w.left + w.width / 2), a.top + a.height / 2 - (w.top + w.height / 2)) || R;
    };
    measure();
    offs.push(onRefreshInit(measure));

    const getRot = () => gsap.getProperty(wheel, 'rotation');
    const setRot = (v) => gsap.set(wheel, { rotation: v });
    const indexFor = (r) => (((Math.round((M - r) / STEP)) % N) + N) % N;
    const rotFor = (i, from = getRot()) => from + ((((M - i * STEP - from) % 360) + 540) % 360 - 180);
    const snapRot = (v) => M + Math.round((v - M) / STEP) * STEP;

    /* Phone profile card: the avatar colour and the two privacy choices follow the marker */
    const prof = {
      avatar: $('[data-p-avatar]'), email: $('[data-p-email]'), wa: $('[data-p-wa]'),
      actEmail: $('[data-p-act-email]'), actWa: $('[data-p-act-wa]'),
      name: $('[data-p-name]'),
    };
    const popTargets = [$('[data-p-name]'), $('[data-p-meta]'), prof.email, prof.wa].filter(Boolean);
    const pin = $('[data-marker-pin]');
    const status = $('[data-wheel-status]');
    let active = -1;
    let goal = heroIndex;

    function setActive(i) {
      const first = active === -1;
      active = i;
      heroIndex = i;
      const m = members[i];
      members.forEach((mem, k) => mem.el.classList.toggle('is-active', k === i));
      if (prof.avatar) prof.avatar.dataset.c = m.c;
      // the phone shows whoever is under the marker
      if (m.name && prof.name) prof.name.textContent = m.name;
      if (m.initials && prof.avatar) prof.avatar.textContent = m.initials;
      [[prof.email, m.email], [prof.actEmail, m.email], [prof.wa, m.wa], [prof.actWa, m.wa]].forEach(([el, state]) => { if (el) el.dataset.state = state; });
      wheel.setAttribute('aria-valuenow', String(i + 1));
      wheel.setAttribute('aria-valuetext', describe(m));
      if (motion && !first) {
        if (prof.avatar) gsap.fromTo(prof.avatar, { scale: 0.55, rotation: -14 }, { scale: 1, rotation: 0, duration: 0.55, ease: 'back.out(2)', overwrite: true });
        gsap.fromTo(popTargets, { y: 8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.04, ease: EASE_OUT, overwrite: true });
        if (pin) gsap.fromTo(pin, { rotation: -20 }, { rotation: 0, duration: 0.45, ease: 'back.out(3)', overwrite: true });
      }
    }
    const announce = () => { if (status && active > -1) status.textContent = describe(members[active]); };

    let lastRot = null;
    const render = () => {
      const r = getRot();
      if (r === lastRot) return;
      lastRot = r;
      wheel.style.setProperty('--rot', `${r}deg`);
      const i = indexFor(r);
      if (i !== active) setActive(i);
    };

    /* Start with the remembered member under the marker */
    setRot(M - heroIndex * STEP);
    render();

    let drag = null;
    let spinTween = null;
    function spinTo(i, { idle = false, speak = true } = {}) {
      goal = ((i % N) + N) % N;
      const target = rotFor(goal);
      gsap.killTweensOf(wheel, 'rotation'); // includes the entrance swing, so the viewer always wins
      if (!motion) {
        setRot(target);
        render();
        if (drag) drag.update();
        if (speak) announce();
        return;
      }
      spinTween = gsap.to(wheel, {
        rotation: target,
        duration: idle ? 1.1 : 0.75,
        ease: idle ? 'power2.inOut' : 'back.out(1.4)',
        onComplete: () => { if (drag) drag.update(); if (speak) announce(); },
      });
    }

    /* Idle spin: one member every few seconds while the hero is on screen and nobody is using it */
    let idleCall = null;
    let userPaused = false;
    let heroVisible = false;
    let hovering = false;
    let holding = false; // focus on the wheel
    let dragging = false;
    const canIdle = () => motion && !userPaused && heroVisible && !doc.hidden && !hovering && !holding && !dragging;
    const killIdle = () => { if (idleCall) idleCall.kill(); idleCall = null; };
    function scheduleIdle(delay = 3.2) {
      killIdle();
      if (!canIdle()) return;
      idleCall = gsap.delayedCall(delay, () => {
        if (!canIdle()) return;
        spinTo(goal + 1, { idle: true, speak: false });
        scheduleIdle(3.6);
      });
    }
    const interacted = () => { killIdle(); scheduleIdle(6); };

    /* Controls */
    const prevBtn = $('[data-wheel-prev]');
    const nextBtn = $('[data-wheel-next]');
    const pauseBtn = $('[data-wheel-pause]');
    listen(offs, prevBtn, 'click', () => { interacted(); spinTo(goal - 1); });
    listen(offs, nextBtn, 'click', () => { interacted(); spinTo(goal + 1); });
    if (pauseBtn) {
      pauseBtn.hidden = !motion;
      listen(offs, pauseBtn, 'click', () => {
        userPaused = !userPaused;
        pauseBtn.dataset.paused = String(userPaused);
        pauseBtn.setAttribute('aria-label', userPaused ? 'Resume spinning' : 'Pause spinning');
        if (userPaused) killIdle(); else scheduleIdle(0.6);
      });
      offs.push(() => { pauseBtn.hidden = false; });
    }
    listen(offs, wheel, 'keydown', (e) => {
      const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, PageDown: 4, PageUp: -4 };
      let to = null;
      if (e.key in moves) to = goal + moves[e.key];
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = N - 1;
      if (to === null) return;
      e.preventDefault();
      interacted();
      spinTo(to, { speak: false }); // the slider's aria-valuetext is announced on its own
    });

    /* Hold the idle spin while someone is looking at or using the widget */
    const holdZones = [wheel, $('.phone', visual)].filter(Boolean);
    holdZones.forEach((z) => {
      listen(offs, z, 'pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; killIdle(); } });
      listen(offs, z, 'pointerleave', (e) => { if (e.pointerType === 'mouse') { hovering = false; scheduleIdle(2.5); } });
    });
    listen(offs, wheel, 'focus', () => { holding = true; killIdle(); });
    listen(offs, wheel, 'blur', () => { holding = false; scheduleIdle(4); });

    /* Drag / flick with inertia, snapping to a member */
    const hasInertia = !!W.InertiaPlugin;
    const settle = () => {
      dragging = false;
      goal = indexFor(getRot());
      announce();
      scheduleIdle(6);
    };
    const clickAvatar = (e) => {
      const av = e.target.closest && e.target.closest('.wheel__avatar');
      if (!av) return;
      interacted();
      spinTo(avatars.indexOf(av));
    };
    if (motion && W.Draggable) {
      const common = {
        inertia: hasInertia,
        maxDuration: 1.6,
        onPressInit() { gsap.killTweensOf(wheel, 'rotation'); killIdle(); dragging = true; },
        onRelease() { if (!this.isDragging && !this.isThrowing) dragging = false; },
        onDragEnd() { if (!hasInertia) { spinTo(indexFor(getRot())); settle(); } },
        onThrowComplete: settle,
        onClick: clickAvatar,
      };
      if (side && fine) {
        drag = W.Draggable.create(wheel, { ...common, type: 'rotation', snap: snapRot })[0];
      } else {
        // Touch / stacked layout: horizontal drags spin the wheel, vertical swipes keep scrolling the page.
        const proxy = doc.createElement('div');
        let start = 0;
        const k = () => 180 / (Math.PI * R);
        const apply = function () { setRot(start + this.x * k()); };
        drag = W.Draggable.create(proxy, {
          ...common,
          type: 'x', trigger: wheel, allowNativeTouchScrolling: true,
          onPressInit() { common.onPressInit(); start = getRot(); gsap.set(proxy, { x: 0 }); },
          onDrag: apply,
          onThrowUpdate: apply,
          snap: (x) => (snapRot(start + x * k()) - start) / k(),
        })[0];
      }
      offs.push(() => { if (drag) drag.kill(); drag = null; });
    } else {
      listen(offs, wheel, 'click', clickAvatar);
    }

    /* Render only while the hero is on screen */
    let ticking = false;
    const startTick = () => { if (!ticking && motion) { gsap.ticker.add(render); ticking = true; } };
    const stopTick = () => { if (ticking) { gsap.ticker.remove(render); ticking = false; } };
    const io = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      if (heroVisible) { startTick(); scheduleIdle(2.5); } else { stopTick(); killIdle(); }
    }, { threshold: 0.05 });
    io.observe(visual);
    const onVis = () => { if (doc.hidden) killIdle(); else scheduleIdle(2.5); };
    listen(offs, doc, 'visibilitychange', onVis);

    /* Entrance: the wheel swings in and the avatars arrive one by one */
    if (motion) {
      const home = M - heroIndex * STEP;
      gsap.timeline({ delay: 0.15, onComplete: () => { if (drag) drag.update(); } })
        .fromTo(wheel, { rotation: home - 110, scale: 0.86 }, { rotation: home, scale: 1, duration: 1.7, ease: 'expo.out' }, 0)
        .fromTo(avatars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, stagger: 0.035 }, 0.1);
    }

    offs.push(() => {
      io.disconnect();
      stopTick();
      killIdle();
      if (spinTween) spinTween.kill();
      wheel.style.removeProperty('--rot');
    });
    return () => offs.forEach((off) => off());
  }));

  /* =====================================================================
     5. What is ROW — postcards trade both ways between My Rotary and ROW
     ===================================================================== */
  mm.add({ motion: MOTION, reduce: REDUCE }, guard('sync', (ctx) => {
    const { motion } = ctx.conditions;
    const sync = $('[data-sync]');
    const stage = sync && $('[data-sync-stage]', sync);
    const svg = stage && $('[data-sync-svg]', stage);
    if (!stage || !svg || !W.MotionPathPlugin) return undefined;
    const arcIn = $('[data-arc="in"]', svg);
    const arcOut = $('[data-arc="out"]', svg);
    const cardRI = $('[data-card="ri"]', stage);
    const cardROW = $('[data-card="row"]', stage);
    const pcIn = $('[data-postcard="in"]', stage);
    const pcOut = $('[data-postcard="out"]', stage);
    const toggle = $('[data-motion-toggle]', sync);
    // The return leg (ROW -> My Rotary) is optional: without it the scene is a one-way feed.
    if (!arcIn || !cardRI || !cardROW || !pcIn) return undefined;
    const offs = [];

    function layoutArcs() {
      const s = stage.getBoundingClientRect();
      const a = cardRI.getBoundingClientRect();
      const b = cardROW.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${s.width} ${s.height}`);
      const ax = a.left - s.left; const ay = a.top - s.top;
      const bx = b.left - s.left; const by = b.top - s.top;
      const ab = ay + a.height; const bb = by + b.height;
      if (b.left >= a.right - 1) {
        // side by side: My Rotary -> ROW over the top, ROW -> My Rotary under the bottom.
        // Paths leave one card edge and stop just short of the other, so the arrowhead stays visible.
        sideBySide = true;
        const lift = Math.max(24, Math.min(ay, by) - 10);
        const x1 = ax + a.width * 0.62; const x2 = bx + b.width * 0.38;
        arcIn.setAttribute('d', `M${x1} ${ay - 2}C${x1} ${ay - lift * 1.25},${x2} ${by - lift * 1.25},${x2} ${by - 12}`);
        const drop = Math.max(24, s.height - Math.max(ab, bb) - 10);
        arcOut?.setAttribute('d', `M${x2} ${bb + 2}C${x2} ${bb + drop * 1.25},${x1} ${ab + drop * 1.25},${x1} ${ab + 12}`);
      } else {
        // stacked: down the left side, back up the right side
        sideBySide = false;
        const bulge = Math.max(16, Math.min(40, ax - 2)) * 1.4;
        const y1 = ay + a.height * 0.72; const y2 = by + b.height * 0.28;
        arcIn.setAttribute('d', `M${ax - 2} ${y1}C${ax - bulge} ${y1},${bx - bulge} ${y2},${bx - 12} ${y2}`);
        const ar = ax + a.width; const br = bx + b.width;
        arcOut?.setAttribute('d', `M${br + 2} ${y2}C${br + bulge} ${y2},${ar + bulge} ${y1},${ar + 12} ${y1}`);
      }
    }

    let sideBySide = true;
    // Stacked layout: the postcard hangs inward from its path so it never pushes past the screen edge.
    const origin = (path) => {
      if (sideBySide) return [0.5, 0.5];
      return path === arcIn ? [0.08, 0.5] : [0.92, 0.5];
    };
    const mp = (path, end) => ({ path, align: path, alignOrigin: origin(path), start: 0, end });
    if (!motion) {
      // Parked mid-arc by plain x/y (a repeated motionPath set compounds its offset on every refresh)
      const park = () => {
        layoutArcs();
        // Stacked, both midpoints share one height over the "Two-way sync" label: the arrowed arcs say it alone.
        if (!sideBySide) { gsap.set([pcIn, pcOut].filter(Boolean), { autoAlpha: 0 }); return; }
        [[pcIn, arcIn], [pcOut, arcOut]].filter(([pc, path]) => pc && path).forEach(([pc, path]) => {
          const p = path.getPointAtLength(path.getTotalLength() / 2);
          const [ox, oy] = origin(path);
          gsap.set(pc, { autoAlpha: 1, x: p.x - pc.offsetWidth * ox, y: p.y - pc.offsetHeight * oy, rotation: 0 });
        });
      };
      park();
      offs.push(onRefreshInit(park));
      return () => offs.forEach((off) => off());
    }

    // [postcard label, the card row it lands on]
    // Postcard words come from the page's own row labels, so each page shows only its own copy.
    const ITEMS = $$('li[data-row]', cardRI).map((li) => [li.firstElementChild ? li.firstElementChild.textContent.trim() : li.textContent.trim(), li.dataset.row]);
    if (!ITEMS.length) return () => offs.forEach((off) => off());
    const pulse = (card, row) => {
      const li = $(`[data-row="${row}"]`, card);
      const state = li && $('.sync-card__state', li);
      if (!li || !state) return;
      gsap.timeline()
        .fromTo(li, { backgroundColor: '#FFE1A1' }, { backgroundColor: COLORS.cream2, duration: 1.2, ease: 'power2.out' }, 0)
        .fromTo(state, { scale: 0.6 }, { scale: 1, duration: 0.45, ease: SPRING }, 0);
    };
    const flight = (pc, path, item, toCard) => gsap.timeline()
      .call(() => { const type = $('[data-pc-type]', pc); if (type) type.textContent = item[0]; }, null, 0)
      .fromTo(pc, { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: SPRING }, 0)
      .to(pc, { motionPath: mp(path, 1), duration: 1.7, ease: 'power1.inOut' }, 0)
      .fromTo(pc, { rotation: -7 }, { rotation: 7, duration: 1.7, ease: 'sine.inOut' }, 0)
      .to(pc, { autoAlpha: 0, scale: 0.6, duration: 0.25, ease: 'power2.in' }, 1.5)
      .call(() => pulse(toCard, item[1]), null, 1.6);

    let master = null;
    const build = () => {
      const wasRunning = master && !master.paused();
      if (master) master.kill();
      layoutArcs();
      master = gsap.timeline({ paused: true, repeat: -1 });
      for (let k = 0; k < 3; k += 1) {
        master.add(flight(pcIn, arcIn, ITEMS[k % ITEMS.length], cardROW), k * 2.2);
        if (pcOut && arcOut) master.add(flight(pcOut, arcOut, ITEMS[(k + 1) % ITEMS.length], cardRI), k * 2.2 + 1.1);
      }
      if (wasRunning) master.play();
    };
    build();
    const loop = makeLoop(sync, { play: () => master.play(), pause: () => master.pause(), toggle });
    offs.push(onRefreshInit(build), loop.kill, () => { if (master) master.kill(); });
    return () => offs.forEach((off) => off());
  }));

  /* =====================================================================
     6. Plan next year — the Year Dial (pinned + scrubbed on desktop)
     ===================================================================== */
  mm.add({ motion: MOTION, reduce: REDUCE, desktop: '(min-width: 1024px)', stacked: '(max-width: 1023px) and (min-height: 600px)' }, guard('plan', (ctx) => {
    const { motion, desktop, stacked } = ctx.conditions;
    const stage = $('[data-plan-stage]');
    const dial = $('[data-dial]');
    if (!stage || !dial) return undefined;
    const hand = $('[data-dial-hand]', dial);
    const ringNow = $('[data-ring-now]', dial);
    const ringNext = $('[data-ring-next]', dial);
    const fills = $$('.dial__fill', dial);
    const items = $$('[data-launch-item]', stage);
    const monthEl = $('[data-dial-month]', dial);
    const capEl = $('[data-dial-caption]', dial);
    const SWAP_OUT = 262 / 168;
    const SWAP_IN = 168 / 262;
    let shown = null;
    const setReadout = (angle) => {
      const july = angle >= 360 - 1e-4; // the hand has reached 1 July
      if (july === shown) return;
      shown = july;
      if (monthEl) monthEl.textContent = july ? '1 July' : 'Next year';
      if (capEl) capEl.textContent = july ? 'Changeover' : 'from January';
    };
    // The hand and rings pivot on the dial centre through native SVG transforms written from plain numbers.
    // (GSAP transforms on these groups re-parse their matrix on every refresh; rotation 360 decomposes as 0 and
    // the error compounds until the hand orbits off the dial.)
    const dialState = { hand: 180, next: 1, now: 1 };
    const paint = () => {
      if (hand) hand.setAttribute('transform', `rotate(${dialState.hand} 300 300)`);
      if (ringNext) ringNext.setAttribute('transform', `translate(300 300) scale(${dialState.next}) translate(-300 -300)`);
      if (ringNow) ringNow.setAttribute('transform', `translate(300 300) scale(${dialState.now}) translate(-300 -300)`);
      setReadout(dialState.hand);
    };
    const unpaint = () => [hand, ringNext, ringNow].forEach((el) => el && el.removeAttribute('transform'));

    if (!motion || !ST) {
      Object.assign(dialState, { hand: 360, next: SWAP_OUT, now: SWAP_IN });
      paint();
      if (ringNow) gsap.set(ringNow, { opacity: 0.4 });
      return unpaint;
    }

    paint();
    const tl = gsap.timeline({ defaults: { ease: 'none' } });
    if (hand) tl.fromTo(dialState, { hand: 180 }, { hand: 360, duration: 6, onUpdate: paint }, 0);
    items.forEach((li, k) => {
      const at = k + 0.6;
      const dot = $('.launch__dot', li);
      const check = $('.launch__check', li);
      const tint = $('.launch__tint', li);
      if (dot) tl.fromTo(dot, { attr: { r: 0 } }, { attr: { r: 13 }, duration: 0.25, ease: 'back.out(2)' }, at);
      if (check && hasDraw) tl.fromTo(check, drawFrom(), drawTo({ duration: 0.3, ease: 'power2.out' }), at + 0.12);
      if (tint) tl.fromTo(tint, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, at + 0.4);
      const segs = fills.filter((f) => f.dataset.item === String(k));
      if (segs.length && hasDraw) tl.fromTo(segs, drawFrom(), drawTo({ duration: 0.45, stagger: 0.2, ease: 'power1.inOut' }), at);
    });
    // 1 July: the dial clicks and the rings swap — next year becomes the current year
    tl.to(dial, { scale: 1.035, duration: 0.15, ease: 'power2.out' }, 6.02)
      .to(dial, { scale: 1, duration: 0.4, ease: 'back.out(3)' }, 6.17);
    if (ringNext) tl.fromTo(dialState, { next: 1 }, { next: SWAP_OUT, duration: 0.6, ease: SPRING, onUpdate: paint }, 6.05);
    if (ringNow) {
      tl.fromTo(dialState, { now: 1 }, { now: SWAP_IN, duration: 0.6, ease: EASE_INOUT, onUpdate: paint }, 6.05)
        .fromTo(ringNow, { opacity: 1 }, { opacity: 0.4, duration: 0.6, ease: EASE_INOUT }, 6.05);
    }
    tl.to({}, { duration: 0.5 });

    const pinIt = desktop && media('(min-height: 700px)').matches;
    // Stacked: the dial is CSS-sticky (styles.css), so the checklist rising beneath it drives the scrub and each
    // item ticks just after it comes into view. Otherwise (short screens) scrub while the dial crosses the view.
    const list = stacked && $('.launch__list', stage);
    ST.create({
      animation: tl,
      trigger: pinIt ? stage : (list || dial),
      start: pinIt ? 'center center' : (list ? 'top 88%' : 'top 80%'),
      end: pinIt ? '+=1400' : (list ? 'bottom 72%' : 'bottom 30%'),
      pin: pinIt ? stage : false,
      anticipatePin: 1,
      scrub: 0.6,
      onRefresh: paint, // refresh restores progress with callbacks suppressed: repaint from the restored state
    });
    ST.sort();
    return unpaint;
  }));

  /* =====================================================================
     7. Features bento — each tile's micro-demo
     Each timeline ends its build-up at the label "done", which equals the HTML's static state.
     ===================================================================== */
  const DEMOS = {
    dir(q) {
      const [knob] = q('knob'); const [sw] = q('switch'); const [on] = q('on'); const [off] = q('off');
      if (!knob || !sw || !on || !off) return null;
      return gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.4 })
        .set(knob, { x: 20 }).set(sw, { backgroundColor: COLORS.mint, scale: 1 })
        .set(on, { autoAlpha: 1, y: 0 }).set(off, { autoAlpha: 0, y: 6 })
        .to(sw, { scale: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0.7)
        .to(knob, { x: 0, duration: 0.45, ease: SPRING }, 0.82)
        .to(sw, { backgroundColor: COLORS.stone, duration: 0.3 }, 0.82)
        .to(on, { autoAlpha: 0, y: -6, duration: 0.25 }, 0.9)
        .to(off, { autoAlpha: 1, y: 0, duration: 0.35, ease: SPRING }, 1)
        .addLabel('done', 1.6)
        .to({}, { duration: 1.6 });
    },
    sync(q) {
      const [dot] = q('dot'); const [wait] = q('wait'); const [ok] = q('ok');
      if (!dot || !wait || !ok) return null;
      return gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.3 })
        .set(dot, { xPercent: 0 }).set(wait, { autoAlpha: 0, scale: 1 }).set(ok, { autoAlpha: 0, scale: 1 })
        .to(dot, { xPercent: 100, duration: 0.9, ease: 'power2.inOut' }, 0.3)
        .to(wait, { autoAlpha: 1, duration: 0.2 }, 1.3)
        .to(dot, { xPercent: 0, duration: 0.9, ease: 'power2.inOut' }, 1.5)
        .to(wait, { autoAlpha: 0, scale: 0.8, duration: 0.2 }, 2.4)
        .fromTo(ok, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: SPRING }, 2.45)
        .addLabel('done', 2.9)
        .to({}, { duration: 1.4 });
    },
    qr(q) {
      const [scan] = q('scan'); const [ok] = q('ok');
      if (!scan || !ok) return null;
      return gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.3 })
        .set(ok, { autoAlpha: 0, scale: 0.5 }).set(scan, { autoAlpha: 1, yPercent: 0 })
        .to(scan, { yPercent: 94, duration: 0.9, ease: 'power1.inOut', yoyo: true, repeat: 1 }, 0.2)
        .to(scan, { autoAlpha: 0, duration: 0.2 }, 2)
        .to(ok, { autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(2.6)' }, 2.05)
        .addLabel('done', 2.7)
        .to({}, { duration: 1.4 });
    },
    inv(q) {
      const lines = q('line'); const [sum] = q('sum'); const [chip] = q('chip');
      if (!lines.length || !sum || !chip) return null;
      return gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.3 })
        .set(lines, { autoAlpha: 0, x: -12 }).set(chip, { autoAlpha: 0, scale: 0.5, rotation: 5 })
        .to(lines, { autoAlpha: 1, x: 0, duration: 0.35, stagger: 0.22, ease: EASE_OUT }, 0.2)
        .fromTo(sum, { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'power2.out' }, 0.3)
        .to(chip, { autoAlpha: 1, scale: 1, rotation: 5, duration: 0.5, ease: 'back.out(2)' }, 1.5)
        .addLabel('done', 2.1)
        .to({}, { duration: 1.5 });
    },
    chat(q, tile) {
      const [msg] = q('msg'); const [t2] = q('t2');
      const ticks = $$('.msg__ticks svg', tile);
      if (!msg || !t2 || !ticks.length) return null;
      return gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.3 })
        .set(msg, { autoAlpha: 0, y: 16, scale: 0.9 }).set(t2, { autoAlpha: 0 })
        .set(ticks, { stroke: COLORS.muted })
        .to(msg, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: SPRING }, 0.2)
        .to(t2, { autoAlpha: 1, duration: 0.2 }, 1)
        .to(ticks, { stroke: COLORS.azure, duration: 0.3 }, 1.7)
        .addLabel('done', 2.3)
        .to({}, { duration: 1.5 });
    },
    proj(q) {
      const [btn] = q('btn'); const [a] = q('a'); const [b] = q('b'); const [burst] = q('burst');
      if (!btn || !a || !b) return null;
      const dots = burst ? Array.from(burst.children) : [];
      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.3 })
        .set(a, { autoAlpha: 1, yPercent: 0 }).set(b, { autoAlpha: 0, yPercent: 100 })
        .to(btn, { scale: 0.95, duration: 0.12, yoyo: true, repeat: 1 }, 0.6)
        .to(a, { autoAlpha: 0, yPercent: -100, duration: 0.3, ease: 'power2.in' }, 0.85)
        .to(b, { autoAlpha: 1, yPercent: 0, duration: 0.45, ease: SPRING }, 0.95);
      if (dots.length) {
        tl.fromTo(dots, { x: 0, y: 0, autoAlpha: 1, scale: 1 }, {
          x: (i) => [-34, 30, -16, 42][i % 4], y: (i) => [-30, -38, -48, -14][i % 4],
          autoAlpha: 0, scale: 0.4, duration: 0.7, ease: 'power2.out',
        }, 1);
      }
      return tl.addLabel('done', 1.9).to({}, { duration: 1.5 });
    },
    grant(q) {
      const [stamp] = q('stamp'); const [card] = q('card');
      if (!stamp || !card) return null;
      return gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.3 })
        .set(stamp, { autoAlpha: 0, scale: 2.2, rotation: -26 }).set(card, { y: 0 })
        .to(stamp, { autoAlpha: 1, scale: 1, rotation: -12, duration: 0.42, ease: 'back.out(1.8)' }, 0.8)
        .to(card, { y: 4, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.out' }, 1.12)
        .addLabel('done', 1.7)
        .to({}, { duration: 1.6 });
    },
    web(q) {
      const [track] = q('track'); const bars = q('sk');
      if (!track || !bars.length) return null;
      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.3, repeatRefresh: true })
        .set(track, { y: 0 }).set(bars, { scaleX: 1 });
      [[-60, 0.6], [-90, 1.6], [-30, 2.6]].forEach(([y, at]) => {
        tl.to(track, { y, duration: 0.45, ease: SPRING }, at)
          .to(bars, { scaleX: () => gsap.utils.random(0.55, 1, 0.05), duration: 0.5, ease: EASE_OUT, stagger: 0.05 }, at + 0.05);
      });
      return tl.addLabel('done', 3.3).to({}, { duration: 1.4 });
    },
  };

  mm.add({ motion: MOTION, reduce: REDUCE, hover: '(hover: hover) and (pointer: fine)' }, guard('bento', (ctx) => {
    const { motion, hover } = ctx.conditions;
    if (!motion) return undefined; // the HTML already shows every demo's finished state
    const offs = [];
    const cells = $$('.bento__cell');
    if (ST && cells.length) {
      gsap.set(cells, { autoAlpha: 0, y: 40 });
      ST.batch(cells, {
        start: 'top 90%', once: true,
        onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE_OUT, stagger: 0.06, clearProps: 'transform' }),
      });
    }

    const players = [];
    $$('[data-tile]').forEach((tile) => {
      const make = DEMOS[tile.dataset.tile];
      const q = (key) => $$(`[data-d="${key}"]`, tile);
      const tl = make ? make(q, tile) : null;
      if (!tl) return;
      // start on the finished frame, which is the static HTML state
      tl.pause('done', false);
      let toDone = null;
      const play = () => { if (toDone) toDone.kill(); tl.restart(false, false); };
      const rest = () => { if (toDone) toDone.kill(); toDone = tl.tweenTo('done'); };
      const once = () => { if (toDone) toDone.kill(); tl.pause(0, false); toDone = tl.tweenTo('done'); };
      players.push({ tile, tl, rest, once });
      if (hover) {
        listen(offs, tile, 'pointerenter', (e) => { if (e.pointerType === 'mouse') play(); });
        listen(offs, tile, 'pointerleave', (e) => { if (e.pointerType === 'mouse') rest(); });
      }
      listen(offs, tile, 'focus', play);
      listen(offs, tile, 'blur', rest);
    });

    /* Offscreen: stop. Touch screens: play once per visit (under 5s), then hold the finished frame. */
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const p = players.find((x) => x.tile === entry.target);
        if (!p) return;
        if (!entry.isIntersecting) { p.tl.pause(); return; }
        if (!hover && entry.intersectionRatio >= 0.55) p.once();
      });
    }, { threshold: [0, 0.55] });
    players.forEach((p) => io.observe(p.tile));
    const onVis = () => { if (doc.hidden) players.forEach((p) => p.tl.pause()); };
    listen(offs, doc, 'visibilitychange', onVis);
    offs.push(() => io.disconnect());
    return () => offs.forEach((off) => off());
  }));

  /* =====================================================================
     8. Languages — the chat takes turns, one language at a time
     ===================================================================== */
  mm.add({ motion: MOTION, reduce: REDUCE }, guard('languages', (ctx) => {
    const { motion } = ctx.conditions;
    const chat = $('[data-chat]');
    if (!chat) return undefined;
    const bubbles = $$('.bubble', chat);
    if (!bubbles.length) return undefined;
    if (!motion) {
      bubbles.forEach((b) => b.classList.add('is-on'));
      return () => bubbles.forEach((b) => b.classList.remove('is-on'));
    }
    const parts = $$('.bubble__who, .bubble__body', chat);
    if (ST) {
      gsap.fromTo(parts, { autoAlpha: 0, scale: 0.4 }, {
        autoAlpha: 1, scale: 1, duration: 0.6, ease: SPRING, stagger: 0.045, clearProps: 'transform',
        transformOrigin: (i, el) => (el.closest('.bubble--r') ? '100% 100%' : '0% 100%'),
        scrollTrigger: { trigger: chat, start: 'top 80%', once: true },
      });
    }
    const setOn = (k) => bubbles.forEach((b, j) => b.classList.toggle('is-on', j === k));
    const turn = 1.6;
    const tl = gsap.timeline({ paused: true, repeat: -1 });
    bubbles.forEach((b, k) => {
      const body = $('.bubble__body', b);
      const text = $('.bubble__text', b);
      const dots = $('.bubble__dots', b);
      const at = k * turn;
      tl.call(setOn, [k], at);
      if (dots && text) {
        tl.set(text, { opacity: 0 }, at) // opacity only: the word stays in the accessibility tree
          .fromTo(dots, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12 }, at)
          .fromTo(dots.children, { y: 0 }, { y: -4, duration: 0.16, stagger: 0.07, yoyo: true, repeat: 1, ease: 'sine.inOut' }, at + 0.05)
          .to(dots, { autoAlpha: 0, duration: 0.1 }, at + 0.55)
          .to(text, { opacity: 1, duration: 0.12 }, at + 0.6);
      }
      if (body) tl.fromTo(body, { scale: 0.9 }, { scale: 1, duration: 0.5, ease: 'back.out(3)', transformOrigin: b.classList.contains('bubble--r') ? '100% 100%' : '0% 100%' }, at + 0.6);
    });
    tl.to({}, { duration: 0.2 });
    const texts = $$('.bubble__text', chat);
    const allDots = $$('.bubble__dots', chat);
    const pause = () => {
      tl.pause();
      gsap.set(texts, { opacity: 1 });
      gsap.set(allDots, { autoAlpha: 0 });
    };
    const loop = makeLoop(chat, { play: () => tl.play(), pause, toggle: $('[data-motion-toggle]', chat) });
    return () => {
      loop.kill();
      bubbles.forEach((b) => b.classList.remove('is-on'));
    };
  }));

  /* =====================================================================
     9. Districts — threads run from the district hub and each club switches on
     ===================================================================== */
  const hubPaths = [];
  mm.add({ motion: MOTION, reduce: REDUCE }, guard('districts', (ctx) => {
    const { motion } = ctx.conditions;
    const hub = $('[data-hub]');
    const svg = hub && $('[data-hub-svg]', hub);
    const core = hub && $('[data-hub-core]', hub);
    if (!svg || !core) return undefined;
    const clubs = $$('.club', hub);
    if (!hubPaths.length) {
      clubs.forEach((c) => {
        const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('data-c', c.dataset.c || 'ink');
        svg.appendChild(p);
        hubPaths.push(p);
      });
    }
    const layout = () => {
      const s = hub.getBoundingClientRect();
      const k = core.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${s.width} ${s.height}`);
      const x0 = k.right - s.left - 8;
      const y0 = k.top + k.height / 2 - s.top;
      clubs.forEach((c, i) => {
        const dot = $('.club__dot', c);
        if (!dot || !hubPaths[i]) return;
        const d = dot.getBoundingClientRect();
        const x1 = d.left - s.left + d.width / 2;
        const y1 = d.top - s.top + d.height / 2;
        const mx = (x0 + x1) / 2;
        hubPaths[i].setAttribute('d', `M${x0} ${y0}C${mx} ${y0},${mx} ${y1},${x1} ${y1}`);
      });
    };
    layout();
    const offs = [onRefreshInit(layout)];
    if (!motion || !ST) return () => offs.forEach((off) => off());

    const tl = gsap.timeline({ paused: true });
    tl.fromTo(core, { scale: 0.7 }, { scale: 1, duration: 0.5, ease: SPRING }, 0);
    clubs.forEach((c, i) => {
      const at = 0.3 + i * 0.35;
      if (hasDraw && hubPaths[i]) tl.fromTo(hubPaths[i], drawFrom(), drawTo({ duration: 0.5, ease: 'power1.inOut' }), at);
      tl.fromTo(c, { opacity: 0.35 }, { opacity: 1, duration: 0.2 }, at + 0.4);
      const dot = $('.club__dot', c);
      const plan = $('.club__plan', c);
      if (dot) tl.fromTo(dot, { scale: 0.6 }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, at + 0.4);
      if (plan) tl.fromTo(plan, { autoAlpha: 0, x: -6 }, { autoAlpha: 1, x: 0, duration: 0.3 }, at + 0.45);
    });
    // Plays through once (about 2s) as soon as the hub is in view, so it is never left half drawn
    tl.timeScale(Math.max(1, tl.duration() / 2.2));
    ST.create({ trigger: hub, start: 'top 82%', once: true, onEnter: () => gsap.delayedCall(loaderWait(), () => tl.play()) });
    return () => offs.forEach((off) => off());
  }));

  /* =====================================================================
     10. Migration — a wheel rolls across ten stepping stones to the signed report
     ===================================================================== */
  mm.add({ motion: MOTION, reduce: REDUCE }, guard('migration', (ctx) => {
    const { motion } = ctx.conditions;
    const trail = $('[data-trail]');
    const track = trail && $('[data-trail-track]', trail);
    const svg = track && $('[data-trail-svg]', track);
    const line = svg && $('[data-trail-path]', svg);
    const done = svg && $('[data-trail-done]', svg);
    const roller = trail && $('[data-roller]', trail);
    const stones = trail ? $$('.stone', trail) : [];
    if (!line || !done || !roller || stones.length < 2 || !W.MotionPathPlugin) return undefined;
    const noteEl = $('[data-trail-note]', trail);
    const stamp = $('[data-stamp]', trail);
    const sig = $('[data-signature]', trail);
    // The doc's own terms, in its order, as the wheel rolls; the last one is the static HTML state
    const NOTES = ['My Rotary', 'Attendance history', 'Balances', 'Contacts', 'Events', 'Documents', 'Your secretary signs a reconciliation report'];
    // No lilac (the panel colour, the stone would vanish) and no cream (the resting colour, no change shows).
    const STONE_COLORS = [COLORS.coral, COLORS.sky, COLORS.mint, COLORS.marigold, COLORS.coral, COLORS.sky, COLORS.mint, COLORS.marigold, COLORS.coral, COLORS.marigold];

    const smooth = (p) => {
      let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
      for (let i = 0; i < p.length - 1; i += 1) {
        const p0 = p[i - 1] || p[i]; const p1 = p[i]; const p2 = p[i + 1]; const p3 = p[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6; const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6; const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)},${c2x.toFixed(1)} ${c2y.toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
      }
      return d;
    };
    const layout = () => {
      const s = track.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${s.width} ${s.height}`);
      const pts = stones.map((st) => {
        const r = st.getBoundingClientRect();
        return [r.left - s.left + r.width / 2, r.top - s.top + r.height / 2];
      });
      const d = smooth(pts);
      line.setAttribute('d', d);
      done.setAttribute('d', d);
    };
    layout();
    const offs = [onRefreshInit(layout)];
    const mp = (end) => ({ path: line, align: line, alignOrigin: [0.5, 0.5], start: 0, end });

    if (!motion || !ST) {
      // Parked on the last stone by plain x/y: a motionPath set re-aligns from the transform it left last time, so
      // repeating it on every refresh compounded the offset (the roller ended up thousands of px away).
      const park = () => {
        const end = line.getPointAtLength(line.getTotalLength());
        gsap.set(roller, { x: end.x - roller.offsetWidth / 2, y: end.y - roller.offsetHeight / 2, rotation: 0 });
      };
      stones.forEach((st, i) => gsap.set(st, { backgroundColor: STONE_COLORS[i] })); // same end frame: all ten done
      park();
      offs.push(onRefreshInit(() => { layout(); park(); }));
      return () => offs.forEach((off) => off());
    }

    let shown = -1;
    const setNote = (p) => {
      const i = Math.min(NOTES.length - 1, Math.round(p * (NOTES.length - 1)));
      if (i === shown) return;
      shown = i;
      if (noteEl) noteEl.textContent = NOTES[i];
    };
    const ROLL = 10;
    gsap.set(roller, { motionPath: mp(0) });
    const tl = gsap.timeline({ defaults: { ease: 'none' } });
    tl.to(roller, { motionPath: mp(1), duration: ROLL, onUpdate() { setNote(this.progress()); } }, 0)
      .fromTo(roller, { rotation: 0 }, { rotation: () => (line.getTotalLength() / (Math.PI * (roller.offsetWidth || 52))) * 360, duration: ROLL }, 0);
    if (hasDraw) tl.fromTo(done, drawFrom(), drawTo({ duration: ROLL }), 0);
    stones.forEach((st, i) => {
      const at = (i / (stones.length - 1)) * ROLL;
      tl.fromTo(st, { backgroundColor: COLORS.cream }, { backgroundColor: STONE_COLORS[i] || COLORS.marigold, duration: 0.3 }, Math.max(0, at - 0.15));
      if (st.firstElementChild) tl.fromTo(st.firstElementChild, { scale: 1 }, { scale: 1.3, duration: 0.18, yoyo: true, repeat: 1, ease: 'power1.out' }, Math.max(0, at - 0.15));
    });
    if (sig && hasDraw) tl.fromTo(sig, drawFrom(), drawTo({ duration: 1.2, ease: 'power1.inOut' }), ROLL);
    if (stamp) tl.fromTo(stamp, { autoAlpha: 0, scale: 2.4, rotation: -30 }, { autoAlpha: 1, scale: 1, rotation: -10, duration: 0.5, ease: 'back.out(1.7)' }, ROLL + 1.1);
    tl.to({}, { duration: 0.3 });
    ST.create({
      animation: tl, trigger: trail, start: 'top 75%', end: 'bottom 72%', scrub: 0.6, invalidateOnRefresh: true,
      onRefresh: () => setNote(Math.min(1, tl.time() / ROLL)), // refresh restores progress silently; resync the readout
    });
    return () => offs.forEach((off) => off());
  }));

  /* =====================================================================
     11. About hero — the printed roster book turns into the ROW app
     ===================================================================== */
  mm.add({ motion: MOTION, reduce: REDUCE }, guard('book', (ctx) => {
    const { motion } = ctx.conditions;
    const art = $('[data-book-app]');
    if (!art || !motion || !ST || !W.MotionPathPlugin) return undefined; // the markup is the last frame
    const shift = $('[data-book-shift]', art);
    const right = $('[data-book-right]', art);
    const cover = $('[data-book-cover]', art);
    const rows = $$('[data-app-row]', art);
    const flyers = [...$$('[data-strip]', art), $('[data-note]', art)].filter(Boolean);
    if (!shift || !right || !cover || !flyers.length || flyers.length > rows.length) return undefined;
    const phone = $('[data-phone]', art);
    const tick = $('[data-tick]', art);
    const arrow = $$('[data-arrow]', art);
    const pops = $$('[data-pop]', art);
    const centre = (el) => { const b = el.getBBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; };

    // First frame: the book open with its rows and the note on it, the phone's list empty
    const shut = { x: gsap.getProperty(shift, 'x'), y: gsap.getProperty(shift, 'y') };
    gsap.set(shift, { x: 0, y: 0 });
    gsap.set(right, { autoAlpha: 1 });
    gsap.set(cover, { scaleX: 0, transformOrigin: '100% 50%' });
    gsap.set([...rows, ...pops, phone, tick].filter(Boolean), { transformOrigin: '50% 50%' });
    gsap.set(rows, { autoAlpha: 0 });
    if (tick) gsap.set(tick, { autoAlpha: 0, scale: 0 });
    if (hasDraw) gsap.set(arrow, drawFrom());

    const tl = gsap.timeline({ paused: true });
    if (hasDraw && arrow.length) tl.to(arrow, drawTo({ duration: 0.4, stagger: 0.38, ease: EASE_INOUT }), 0);
    flyers.forEach((el, i) => {
      // x/y move the flyer's own centre: from its spot on the book to the centre of its row in the phone
      const own = centre(el);
      const to = centre(rows[i]);
      const [ax, ay, tilt] = el.dataset.at.split(' ').map(Number);
      const from = { x: ax - own.x, y: ay - own.y };
      const end = { x: to.x - own.x, y: to.y - own.y };
      gsap.set(el, { transformOrigin: '50% 50%' });
      gsap.set(el, { x: from.x, y: from.y, rotation: tilt || 0, autoAlpha: 1 });
      const at = 0.35 + i * 0.34;
      tl.set(el, { attr: { filter: 'url(#book-app-lift)' } }, at)
        .to(el, { scale: 1.08, duration: 0.18, ease: 'power2.out' }, at)
        .to(el, {
          motionPath: { path: [from, { x: (from.x + end.x) / 2, y: Math.min(from.y, end.y) - 70 }, end], curviness: 1.2 },
          rotation: 0, scale: el.matches('[data-strip]') ? to.w / own.w : 1, duration: 0.8, ease: EASE_INOUT,
        }, at + 0.18)
        .to(el, { autoAlpha: 0, duration: 0.15 }, at + 0.95)
        .fromTo(rows[i], { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: SPRING }, at + 0.91)
        .fromTo($$('[data-pop]', rows[i]), { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)', stagger: 0.08 }, at + 1);
    });
    // Then the book shuts: the right-hand half folds onto the spine, the cover opens out over the left
    const shutAt = 0.35 + flyers.length * 0.34 + 0.85;
    tl.to(right, { scaleX: 0, duration: 0.24, ease: 'power2.in', transformOrigin: '0% 50%' }, shutAt)
      .set(right, { autoAlpha: 0 }, shutAt + 0.24)
      .to(cover, { scaleX: 1, duration: 0.3, ease: 'power2.out' }, shutAt + 0.24)
      .to(shift, { x: shut.x, y: shut.y, duration: 0.6, ease: EASE_INOUT }, shutAt + 0.5);
    if (phone) tl.to(phone, { scale: 1.03, duration: 0.18, yoyo: true, repeat: 1, ease: 'power1.out' }, shutAt + 0.6);
    if (tick) tl.to(tick, { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'back.out(2.2)' }, shutAt + 0.7);
    // Plays once, 1.7x speed (about 2.3s), when half the picture is on screen (at once on desktop), after the loader
    tl.timeScale(1.7);
    ST.create({ trigger: art, start: 'center bottom', once: true, onEnter: () => gsap.delayedCall(loaderWait(), () => tl.play()) });
    return undefined;
  }));

  /* =====================================================================
     12. Small pictures that build themselves once in view: [data-in] pops in (or slides in from [data-in-move]
         "dx dy", or grows up with [data-in-grow]) and [data-in-draw] draws, each at its own start time in seconds.
         Put data-in on an element without its own transform: the tweens set x/y/scale absolutely.
     ===================================================================== */
  mm.add({ motion: MOTION, reduce: REDUCE }, guard('build', (ctx) => {
    const pics = $$('[data-build]');
    if (!pics.length || !ctx.conditions.motion || !ST) return undefined; // the markup is the finished picture
    pics.forEach((pic) => {
      const tl = gsap.timeline({ paused: true });
      $$('[data-in]', pic).forEach((el) => {
        const at = Number(el.dataset.in) || 0;
        const grow = el.hasAttribute('data-in-grow');
        const done = el instanceof SVGElement ? {} : { clearProps: 'transform,translate,rotate,scale' }; // CSS hovers keep working
        gsap.set(el, { transformOrigin: grow ? '50% 100%' : '50% 50%' });
        if (el.dataset.inMove) {
          const [dx, dy] = el.dataset.inMove.split(' ').map(Number);
          tl.fromTo(el, { autoAlpha: 0, x: dx || 0, y: dy || 0 }, { autoAlpha: 1, x: 0, y: 0, duration: 0.6, ease: EASE_OUT, ...done }, at);
        } else if (grow) tl.fromTo(el, { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: EASE_OUT, ...done }, at);
        else tl.fromTo(el, { autoAlpha: 0, scale: 0 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'back.out(2.2)', ...done }, at);
      });
      if (hasDraw) $$('[data-in-draw]', pic).forEach((el) => tl.fromTo(el, drawFrom(), drawTo({ duration: 0.45, ease: EASE_INOUT }), Number(el.dataset.inDraw) || 0));
      // A hero picture plays on load once any of it shows (on phones it starts below the copy); others when well in view
      const start = pic.closest('.hero, .phero') ? 'top bottom' : 'top 80%';
      ST.create({ trigger: pic, start, once: true, onEnter: () => gsap.delayedCall(loaderWait(), () => tl.play()) });
    });
    return undefined;
  }));

  /* Final ordering pass once everything above has registered its triggers */
  if (ST) {
    ST.sort();
    ST.refresh();
    const onLoad = () => ST.refresh();
    if (doc.readyState !== 'complete') {
      window.addEventListener('load', onLoad, { once: true });
      cleanups.push(() => window.removeEventListener('load', onLoad));
    }
  }

  return () => {
    mm.revert();
    cleanups.forEach((off) => off());
  };
}
