/* ============================================================================
   rotary-anim.js — dependency-free reimplementation of the React design's
   motion layer (Framer Motion + React Bits) for the ASP.NET Web Forms port.
   Pairs with rotary-design.css (compiled from src/index.css).

   Everything is opt-in via data-attributes / classes so it is safe to load on
   every page. Honors prefers-reduced-motion (the CSS already neutralises the
   resting states; here we simply mark things visible immediately).
   ========================================================================== */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ── 1. Reveal on scroll — REPEATABLE (.reveal / .split / .sr / section) ───────
  //   The ORIGINAL repeatable reveal — every marked element re-plays its entrance
  //   each time it enters the middle ~84% band (scrolling down AND back up),
  //   toggling .is-visible on/off at the same 8%/92% thresholds. Same feel.
  //
  //   THE SHAKE — and its actual fix. Hidden elements sit translated DOWN
  //   (translateY: 34px for a [data-reveal-sect], 28px for a .reveal), and
  //   getBoundingClientRect() INCLUDES that transform. So the instant an element
  //   toggles .is-visible, its measured box jumps by up to ~34px. At the TOP edge
  //   that jump crosses the `bottom > top` test the sweep uses to decide, which
  //   flips the element straight back — reveal → (box drops 34px) → hide →
  //   (box rises 34px) → reveal … a self-driven oscillation every frame = the
  //   judder you see as a section scrolls off the top toward the next one. It is
  //   NOT the observer (removing it didn't help); it's the transform feeding back
  //   into the measurement.
  //
  //   Fix: make the decision immune to that ~34px jump with a ONE-SIDED margin at
  //   the top edge, LARGER than the transform. Arm the reveal only once an element
  //   is REVEAL_M(48px) past the top edge, but HIDE exactly at the original edge.
  //   After hiding, the +34px drop can't reach the +48px arm line, so it can't
  //   re-reveal — the loop is broken. Reveal-on-enter from the bottom and the
  //   fade-out timing are byte-for-byte the original (the margin only binds at the
  //   very top of the viewport, never during the downward "next section" entrance).
  function initReveal() {
    var nodes = Array.prototype.slice.call(
      document.querySelectorAll('.reveal, .split, .sr, [data-reveal-sect]'));
    if (!nodes.length) return;
    if (REDUCED) { nodes.forEach(function (n) { n.classList.add('is-visible'); }); return; }
    function apply(n, vis) {
      if (vis !== n.classList.contains('is-visible')) n.classList.toggle('is-visible', vis);
    }
    var REVEAL_M = 48;   // > 34px (the largest hidden-state translateY) so a toggle can't re-cross
    var ticking = false;
    function sweep() {
      ticking = false;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var top = vh * 0.08, bot = vh * 0.92;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], r = n.getBoundingClientRect();
        if (n.classList.contains('is-visible')) {
          apply(n, r.top < bot && r.bottom > top);              // hide at the ORIGINAL edges
        } else {
          apply(n, r.top < bot && r.bottom > top + REVEAL_M);   // arm a hair inside the top edge
        }
      }
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(sweep); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    requestAnimationFrame(sweep);   // initial in-view pass (above-the-fold)
    // Fully-occluded/background windows can suspend rAF delivery entirely; timers
    // keep running there — re-run the sweep on a few ticks and when the tab is
    // (re)shown, so above-the-fold content is never stuck hidden.
    setTimeout(sweep, 250);
    setTimeout(sweep, 1200);
    setTimeout(sweep, 3000);
    document.addEventListener('visibilitychange', sweep);
    window.addEventListener('focus', sweep, { passive: true });
    window.addEventListener('pageshow', sweep, { passive: true });
  }

  // ── 2. SplitText: wrap [data-split] text into per-char spans ─────────────
  function initSplit() {
    document.querySelectorAll('[data-split]').forEach(function (el) {
      if (el.__split) return;
      el.__split = true;
      var text = el.textContent;
      el.textContent = '';
      el.classList.add('split');
      var staggerBase = parseFloat(el.getAttribute('data-split-stagger')) || 0.03;
      var ci = 0;
      text.split(/(\s+)/).forEach(function (token) {
        if (token.trim() === '') {
          var sp = document.createElement('span');
          sp.className = 'split-space';
          el.appendChild(sp);
          return;
        }
        var word = document.createElement('span');
        word.className = 'split-word';
        token.split('').forEach(function (ch) {
          var c = document.createElement('span');
          c.className = 'split-char';
          c.textContent = ch;
          c.style.transitionDelay = (ci * staggerBase) + 's';
          c.style.setProperty('--ci', ci);   // char index → per-char CSS stagger (footer wordmark wave)
          ci++;
          word.appendChild(c);
        });
        el.appendChild(word);
      });
    });
  }

  // ── 3. ScrollReveal: wrap [data-sr] text into per-word spans ─────────────
  function initSrWords() {
    document.querySelectorAll('[data-sr]').forEach(function (el) {
      if (el.__sr) return;
      el.__sr = true;
      var text = el.textContent;
      el.textContent = '';
      el.classList.add('sr');
      var i = 0;
      text.split(/(\s+)/).forEach(function (token) {
        if (token.trim() === '') { el.appendChild(document.createTextNode(' ')); return; }
        var w = document.createElement('span');
        w.className = 'sr-word';
        w.textContent = token;
        w.style.transitionDelay = (i * 0.05) + 's';
        i++;
        el.appendChild(w);
      });
    });
  }

  // ── 4. Spotlight cards ───────────────────────────────────────────────────
  function initSpotlight() {
    if (REDUCED) return;
    document.querySelectorAll('.spotlight-card').forEach(function (card) {
      if (card.__ra_initSpotlight) return; card.__ra_initSpotlight = 1;
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--spot-x', (e.clientX - r.left) + 'px');
        card.style.setProperty('--spot-y', (e.clientY - r.top) + 'px');
      });
    });
  }

  // ── 5. Tilted cards ──────────────────────────────────────────────────────
  function initTilt() {
    if (REDUCED) return;
    document.querySelectorAll('.tilted-card').forEach(function (card) {
      if (card.__ra_initTilt) return; card.__ra_initTilt = 1;
      var max = parseFloat(card.getAttribute('data-tilt-max')) || 9;
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        var ry = (px - 0.5) * 2 * max;
        var rx = -(py - 0.5) * 2 * max;
        card.setAttribute('data-tilt', 'on');
        card.style.setProperty('--rx', rx.toFixed(2) + 'deg');
        card.style.setProperty('--ry', ry.toFixed(2) + 'deg');
        card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        card.style.setProperty('--sx', ((px - 0.5) * -16).toFixed(0) + 'px');
        card.style.setProperty('--sy', (14 + (py - 0.5) * 16).toFixed(0) + 'px');
      });
      card.addEventListener('pointerleave', function () {
        card.setAttribute('data-tilt', 'off');
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      });
    });
  }

  // ── 6. Magnetic buttons ([data-magnetic]) ────────────────────────────────
  function initMagnetic() {
    if (REDUCED) return;
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      if (el.__ra_initMagnetic) return; el.__ra_initMagnetic = 1;
      var strength = parseFloat(el.getAttribute('data-magnetic-strength')) || 10;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var mx = e.clientX - (r.left + r.width / 2);
        var my = e.clientY - (r.top + r.height / 2);
        var d = Math.max(r.width, r.height);
        el.style.setProperty('--tx', (mx / d * strength).toFixed(1) + 'px');
        el.style.setProperty('--ty', (my / d * strength).toFixed(1) + 'px');
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--tx', '0px');
        el.style.setProperty('--ty', '0px');
      });
    });
  }

  // ── 7. Count-up stats ([data-count="1234"]) ──────────────────────────────
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  // Indian compact money display: 17,30,201 -> "17.3L", 2,35,00,000 -> "2.35 Cr"
  function fmtCompactINR(v) {
    if (v >= 1e7) return (v / 1e7).toFixed(v >= 1e8 ? 1 : 2).replace(/\.?0+$/, '') + ' Cr';
    if (v >= 1e5) return (v / 1e5).toFixed(1).replace(/\.0$/, '') + 'L';
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return v.toLocaleString();
  }
  function animateCount(el) {
    el.__counted = true;   // seen at least once (used by the occluded-window fallback)
    // Placeholder: when the value isn't available from the API, show the
    // placeholder text (e.g. "—") instead of animating a fabricated number.
    var placeholder = el.getAttribute('data-count-text');
    if (placeholder) { el.textContent = placeholder; return; }
    var target = parseFloat(el.getAttribute('data-count')) || 0;
    var dur = parseFloat(el.getAttribute('data-count-dur')) || 2000;
    var prefix = el.getAttribute('data-count-prefix') || '';
    var suffix = el.getAttribute('data-count-suffix') || '';
    var compact = el.getAttribute('data-count-compact');   // "inr" => 17.3L / 2.35 Cr
    function fmt(v) { return compact ? fmtCompactINR(v) : v.toLocaleString(); }
    if (REDUCED) { el.textContent = prefix + fmt(target) + suffix; return; }
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var val = Math.round(target * easeOutCubic(p));
      el.textContent = prefix + fmt(val) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function initCounters() {
    var nodes = document.querySelectorAll('[data-count]');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) { nodes.forEach(animateCount); return; }
    // Original behaviour: re-run the count-up EVERY time a number re-enters the
    // viewport (matches the repeatable reveals). Counters use a single driver (the
    // observer, no sweep), so they never had the reveal shake — left as-is.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) animateCount(e.target);
      });
    // A counter div is only ~32px tall, so threshold 0.4 is satisfied by a 13px
    // sliver poking above the fold: at 1920x953 the classic band sits at top=938
    // and the whole 2s count-up played out at scrollY=0 — by the time you
    // scrolled to it the figure was already static. Keep the number clear of the
    // bottom edge before arming. initReveal uses -8%; counters get more room
    // because a 2s count-up has to be WATCHED, not just faded in.
    }, { threshold: 0.4, rootMargin: '0px 0px -15% 0px' });
    nodes.forEach(function (n) {
      if (n.__ra_counter) return; n.__ra_counter = 1;
      io.observe(n);
    });
    // Occluded-window fallback (IO delivery can be suspended entirely): count
    // up any still-untouched number that is already in view once timers allow.
    function fallback() {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      nodes.forEach(function (n) {
        if (n.__counted) return;
        var r = n.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) animateCount(n);
      });
    }
    setTimeout(fallback, 1400);
    setTimeout(fallback, 3200);
    document.addEventListener('visibilitychange', fallback);
    window.addEventListener('focus', fallback, { passive: true });
    window.addEventListener('pageshow', fallback, { passive: true });
  }

  // ── 8. Navbar: scroll shrink, mobile drawer, projects accordion ──────────
  function initNav() {
    var header = document.querySelector('[data-nav]');
    if (header) {
      var onScroll = function () {
        var s = window.scrollY > 8;
        header.classList.toggle('pt-2', s);
        header.classList.toggle('pt-4', !s);
        var pill = header.querySelector('[data-nav-pill]');
        if (pill) { pill.classList.toggle('h-16', s); pill.classList.toggle('h-20', !s); }
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    var drawer = document.querySelector('[data-nav-drawer]');
    var backdrop = document.querySelector('[data-nav-backdrop]');
    function setOpen(open) {
      if (drawer) {
        drawer.classList.toggle('translate-x-0', open);
        drawer.classList.toggle('translate-x-full', !open);
        // Inline transform: the var-composed Tailwind translate utilities proved
        // fragile after CSS minification (drawer stayed off-screen); inline wins.
        drawer.style.transform = open ? 'translateX(0)' : 'translateX(100%)';
      }
      if (backdrop) {
        backdrop.classList.toggle('opacity-100', open);
        backdrop.classList.toggle('opacity-0', !open);
        backdrop.classList.toggle('pointer-events-none', !open);
      }
      document.body.style.overflow = open ? 'hidden' : '';
    }
    // ONE delegated listener, not per-node bindings. Two bugs came from binding
    // per node here:
    //   * the drawer stopped closing when you tapped a menu name — the React
    //     port re-renders the drawer's menu HTML on every navigation (the
    //     current page gets a tint), so the anchors initNav() bound to are
    //     thrown away and replaced by listener-less clones;
    //   * only the FIRST dropdown ever opened — querySelector (singular) bound
    //     one accordion and looked up the panel document-wide, so a club with
    //     two dropdowns had a dead second one on mobile (desktop was fine, it
    //     is CSS hover). Panel/chevron are now resolved from the CLICKED button.
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      if (t.closest('[data-nav-toggle]')) {
        setOpen(!(drawer && drawer.classList.contains('translate-x-0')));
        return;
      }
      if (t.closest('[data-nav-close]')) { setOpen(false); return; }
      if (backdrop && t === backdrop) { setOpen(false); return; }

      var acc = t.closest('[data-nav-accordion]');
      if (!acc) return;
      var panel = acc.parentNode && acc.parentNode.querySelector('[data-nav-accordion-panel]');
      if (!panel) return;
      var open = panel.classList.toggle('max-h-96');
      panel.classList.toggle('max-h-0', !open);
      var chev = acc.querySelector('[data-nav-chevron]');
      if (chev) chev.classList.toggle('rotate-180', open);
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

    // The Rotary-year <select> sits INSIDE the drawer. Under Web Forms picking a
    // year set window.location and the reload closed the drawer as a side effect;
    // the SPA port only re-renders, so the drawer stayed open — covering the very
    // page you had just asked to see, with body{overflow:hidden} still pinned.
    // Delegated for the same reason as the handler above: the drawer's markup is
    // re-rendered on navigation, so per-node listeners would be thrown away.
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-year-select]')) setOpen(false);
    });
  }

  // ── 9. Year selector: temporary, per-view year ───────────────────────────
  //
  // Picking a year reloads with ?yearId so the SERVER renders that year. On the
  // next load we strip ?yearId / ?year from the address bar (history.replaceState)
  // and clear any legacy rotary_year cookie, so a hard refresh reloads the clean
  // URL and returns to the current year. The year never sticks across a refresh,
  // navigation, or a revisit.
  function initYearSelect() {
    // Clear any 30-day rotary_year cookie left by older builds so it can't pin an
    // old year on future requests.
    document.cookie = 'rotary_year=;path=/;max-age=0';

    // Remove the year params from the visible URL without reloading — the picked
    // year is already rendered for THIS view; the next refresh then starts clean.
    try {
      var here = new URL(window.location.href);
      // Keep the year in the URL on YEAR-SCOPED DETAIL pages (ProjectDetail, diginitary)
      // so a refresh still resolves the right item; only strip it on listing pages, where
      // the year is a temporary view that resets to the current year on refresh.
      var isDetail = /(ProjectDetail|diginitary)\.aspx/i.test(here.pathname);
      if (!isDetail && (here.searchParams.has('yearId') || here.searchParams.has('year') || here.searchParams.has('statYear'))) {
        here.searchParams.delete('yearId');
        here.searchParams.delete('year');
        here.searchParams.delete('statYear');   // the counter's own year is temporary too: a refresh returns to "All Years"
        window.history.replaceState(null, '', here.pathname + here.search + here.hash);
      }
    } catch (e) { /* old browser w/o URL or history API — refresh just keeps the param */ }

    document.querySelectorAll('[data-year-select]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var url = new URL(window.location.href);
        url.searchParams.set('yearId', sel.value);
        window.location.href = url.toString();   // reload so the server renders that year
      });
    });

    // The counter band's OWN year picker: reloads with ?statYear so the SERVER re-totals
    // just the counter — "All Years" (a lifetime sum) by default, or one chosen year.
    // Independent of the header year select above.
    document.querySelectorAll('[data-count-year-select]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var url = new URL(window.location.href);
        if (sel.value && sel.value !== 'all') url.searchParams.set('statYear', sel.value);
        else url.searchParams.delete('statYear');
        window.location.href = url.toString();
      });
    });
  }

  // ── 9b. Year PICKER — a themed panel in place of the OS <select> popup ────
  //
  // WHY. The year chip was a native <select>, so however carefully the CLOSED
  // chip was styled, the OPEN list was the operating system's popup: system
  // font, white rectangle, blue selection bar, 22 flat rows. Hanging off the
  // ink ledger strip (and inside the ink drawer) that reads as a control from
  // another program, and in dark mode it glares. <option> cannot be styled
  // beyond colour, so the list has to become real markup.
  //
  // HOW — progressive enhancement, no server-side change. The <select> STAYS
  // in the DOM as the source of truth and the no-JS fallback; we only hide it,
  // insert a <button> that reuses .cv-yearsel__native (so every placement's
  // colour/type rules in civic-shell.css keep applying to the trigger for
  // free), and build a panel of year cells grouped by decade. Choosing a cell
  // writes select.value and fires `change`, so initYearSelect() above stays
  // the ONLY code that navigates.
  //
  // WHY THE PANEL LIVES IN <body> AND IS position:fixed. Three separate
  // reasons, all of which would clip or bury a nested absolute panel:
  //   1. .cv-yearsel is overflow:hidden in both placements (the strip/drawer
  //      rules clip the chip into a pill) — a child panel would be cut off;
  //   2. the strip carries an entrance transform, which would trap a nested
  //      position:fixed panel to the strip instead of the viewport;
  //   3. the sticky header is z-50 and paints over the strip's stacking group.
  // A body-level fixed panel positioned from the trigger's rect escapes all
  // three. It closes on window scroll, so it never drifts off its chip.
  var YRP_COLS = 3;        // cells per row — also the Up/Down keyboard stride
  var YRP_GROUP_MIN = 9;   // fewer years than this: a flat grid, no decade captions

  function initYearPicker() {
    var chips = document.querySelectorAll('.cv-yearsel');
    Array.prototype.forEach.call(chips, function (chip) { buildYearPicker(chip); });
  }

  // "2026-27" → "2026–27": an en dash is the correct glyph for a year span.
  // Display only — the option's value (the year id) is what gets submitted.
  function yrpLabel(text) {
    return String(text).replace(/\s*-\s*/g, '–').trim();
  }

  function buildYearPicker(chip) {
    var sel = chip.querySelector('select[data-year-select]');
    if (!sel || sel.options.length < 2) return;          // nothing to pick from
    if (chip.querySelector('.cv-yrp__btn')) return;      // already enhanced

    var opts = Array.prototype.slice.call(sel.options);
    var inDrawer = !!(chip.closest && chip.closest('[data-nav-drawer]'));

    // ── trigger: same class as the <select> it replaces, so it inherits the
    //    strip/drawer colour + type rules verbatim.
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cv-yearsel__native cv-yrp__btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var label = document.createElement('span');
    label.className = 'cv-yrp__val';
    btn.appendChild(label);
    sel.parentNode.insertBefore(btn, sel);

    // Keep the <select> functional but out of sight and out of the tab order —
    // it is now an implementation detail of the button above it.
    sel.style.display = 'none';
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');

    function syncTrigger() {
      var cur = sel.options[sel.selectedIndex] || sel.options[0];
      var text = cur ? yrpLabel(cur.text) : '';
      label.textContent = text;
      btn.setAttribute('aria-label', 'Rotary year ' + text + ' — change year');
      btn.title = 'Rotary year ' + text;
    }
    syncTrigger();

    // Re-read the <select> and make the picker agree with it.
    //
    // REACT PORT ONLY. In Web Forms, choose() is followed by a full page reload
    // that rebuilds this picker from scratch, so nothing here ever had to be
    // undone. The SPA never reloads, and without this the picker is left in its
    // mid-navigation state permanently: the chip keeps showing the OLD year, the
    // tick stays on the old cell, and — because
    // `.cv-yrp-panel.is-busy { pointer-events: none }` — the panel goes
    // click-proof, so the year can only ever be changed ONCE per page load.
    //
    // Declared as a function so it hoists above open()/choose() below.
    function sync(forceValue) {
      var v = forceValue != null ? forceValue : sel.value;
      if (sel.value !== v) sel.value = v;   // keep this chip's <select> in step
      syncTrigger();
      cells.forEach(function (c) {
        var on = c.getAttribute('data-yrp-val') === v;
        c.classList.toggle('is-selected', on);
        c.classList.remove('is-going');
        c.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panel.classList.remove('is-busy');
    }

    // Listen on the DOCUMENT, not just this <select>: the header strip and the
    // mobile drawer each build their own picker over their own <select>, and
    // React updates the other one's value silently (no `change` event). One pick
    // therefore has to update every chip on the page, so the event's value is
    // passed in rather than read back off a <select> React hasn't synced yet.
    // Capture phase, so it also sees the bubbling dispatch from choose().
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('select[data-year-select]')) sync(t.value);
    }, true);

    // ── panel
    var panel = document.createElement('div');
    panel.className = 'cv-yrp-panel' + (inDrawer ? ' cv-yrp-panel--drawer' : '');
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Select Rotary year');
    panel.hidden = true;

    var head = document.createElement('div');
    head.className = 'cv-yrp-panel__head';
    var cap = document.createElement('span');
    cap.className = 'cv-yrp-panel__cap';
    cap.textContent = 'Rotary year';
    head.appendChild(cap);

    var scroll = document.createElement('div');
    scroll.className = 'cv-yrp-panel__scroll';

    var cells = [];
    function makeCell(o) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'cv-yrp-opt';
      c.setAttribute('role', 'option');
      c.setAttribute('tabindex', '-1');
      c.setAttribute('data-yrp-val', o.value);
      c.setAttribute('aria-selected', o.selected ? 'true' : 'false');
      c.textContent = yrpLabel(o.text);
      if (o.selected) c.classList.add('is-selected');
      cells.push(c);
      return c;
    }
    function makeGrid(groupLabel) {
      var g = document.createElement('div');
      g.className = 'cv-yrp-grid';
      g.setAttribute('role', 'group');
      if (groupLabel) g.setAttribute('aria-label', groupLabel);
      return g;
    }

    // Decade groups ("2020s", "2010s", …) turn a long list with gaps in it into
    // a scannable register. Needs a 4-digit start year on every label; if any
    // label doesn't have one, fall back to one flat grid.
    var decades = [], byDecade = {}, flat = opts.length < YRP_GROUP_MIN;
    if (!flat) {
      for (var i = 0; i < opts.length && !flat; i++) {
        var m = /(\d{4})/.exec(opts[i].text);
        if (!m) { flat = true; break; }
        var d = Math.floor(parseInt(m[1], 10) / 10) * 10;
        if (!byDecade[d]) { byDecade[d] = []; decades.push(d); }
        byDecade[d].push(opts[i]);
      }
    }

    if (flat) {
      var only = makeGrid('');
      opts.forEach(function (o) { only.appendChild(makeCell(o)); });
      scroll.appendChild(only);
    } else {
      decades.forEach(function (d) {
        var name = d + 's';
        var c2 = document.createElement('div');
        c2.className = 'cv-yrp-grp__cap';
        c2.setAttribute('aria-hidden', 'true');
        c2.appendChild(document.createTextNode(name));
        scroll.appendChild(c2);
        var grid = makeGrid(name);
        byDecade[d].forEach(function (o) { grid.appendChild(makeCell(o)); });
        scroll.appendChild(grid);
      });
    }

    panel.appendChild(head);
    panel.appendChild(scroll);
    document.body.appendChild(panel);

    // ── placement: measured from the trigger, flipped up when there's no room
    function place() {
      var r = chip.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var w = Math.min(Math.max(r.width, 268), Math.max(200, vw - 20));
      panel.style.width = w + 'px';
      panel.style.maxHeight = '';
      var natural = panel.offsetHeight;
      var below = vh - r.bottom - 14, above = r.top - 14;
      var up = below < Math.min(natural, 240) && above > below;
      panel.classList.toggle('cv-yrp-panel--up', up);
      panel.style.maxHeight = Math.max(150, Math.min(natural, (up ? above : below))) + 'px';
      var h = panel.offsetHeight;
      panel.style.left = Math.round(Math.min(Math.max(10, r.right - w), vw - w - 10)) + 'px';
      panel.style.top = Math.round(up ? Math.max(8, r.top - 10 - h) : r.bottom + 10) + 'px';
    }

    // Scroll a cell into view inside the panel only — never the page (the
    // panel is fixed, so a page scroll would slide it away from its chip).
    function reveal(cell) {
      var t = cell.offsetTop, b = t + cell.offsetHeight;
      if (t < scroll.scrollTop) scroll.scrollTop = Math.max(0, t - 10);
      else if (b > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = b - scroll.clientHeight + 10;
    }
    function focusCell(i) {
      var cell = cells[i];
      if (!cell) return;
      try { cell.focus({ preventScroll: true }); } catch (e) { cell.focus(); }
      reveal(cell);
    }

    function isOpen() { return !panel.hidden; }

    function open() {
      if (isOpen()) return;
      // The year can also change without this picker (a WithYear() link, a
      // ?yearId= deep link — React syncs the <select> value silently, with no
      // `change` event). Re-reading here means the panel always opens showing
      // the year that is actually loaded, and focusCell() lands on it.
      sync();
      panel.hidden = false;
      panel.style.visibility = 'hidden';   // lay out for measuring, then show
      place();
      panel.style.visibility = '';
      // The strip plays a transform entrance on load; if the picker is opened
      // while that is still running, the first measurement is a few px stale.
      requestAnimationFrame(function () { if (!panel.hidden) place(); });
      panel.classList.add('is-in');
      chip.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
      var sIdx = 0;
      for (var i = 0; i < cells.length; i++) if (cells[i].classList.contains('is-selected')) { sIdx = i; break; }
      focusCell(sIdx);
    }

    function close(refocus) {
      if (!isOpen()) return;
      panel.classList.remove('is-in');
      panel.hidden = true;
      chip.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      if (refocus) btn.focus();
    }

    function onOutside(e) {
      if (!panel.contains(e.target) && !chip.contains(e.target)) close(false);
    }
    function onScroll(e) {
      // Capture-phase, so this also sees inner scrollers. Scrolling the panel's
      // own list must not dismiss it, and some other inner scroller (the
      // drawer's nav list) should re-anchor the panel rather than close it.
      // Only a PAGE scroll dismisses — that's what would slide the chip away.
      var t = e.target;
      if (t && t !== document && t !== document.documentElement && t !== document.body) {
        if (!panel.contains(t)) place();
        return;
      }
      close(false);
    }
    function onResize() { place(); }

    function choose(cell) {
      if (!cell) return;
      var v = cell.getAttribute('data-yrp-val');
      if (v === sel.value) { close(true); return; }   // same year — nothing to load
      // The page reloads for the chosen year; acknowledge the click meanwhile.
      panel.classList.add('is-busy');
      cell.classList.add('is-going');
      sel.value = v;
      var ev;
      try { ev = new Event('change', { bubbles: true }); }
      catch (e) { ev = document.createEvent('HTMLEvents'); ev.initEvent('change', true, false); }
      sel.dispatchEvent(ev);
      // sync() has already run off that dispatch (clearing is-busy and moving
      // the tick). Closing is what the Web Forms reload used to do; in the SPA
      // the new year on the chip is the acknowledgement.
      close(false);
    }

    btn.addEventListener('click', function () { isOpen() ? close(false) : open(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Down' || e.key === 'Up') {
        e.preventDefault();
        open();
      }
    });

    panel.addEventListener('click', function (e) {
      var cell = e.target.closest ? e.target.closest('.cv-yrp-opt') : null;
      if (cell) choose(cell);
    });

    panel.addEventListener('keydown', function (e) {
      var i = cells.indexOf(document.activeElement);
      var k = e.key;
      function step(d) { e.preventDefault(); focusCell(Math.min(cells.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))); }
      if (k === 'Escape' || k === 'Esc') { e.preventDefault(); close(true); }
      else if (k === 'Tab') { close(false); btn.focus(); }   // no preventDefault: let Tab move on
      else if (k === 'ArrowRight' || k === 'Right') step(1);
      else if (k === 'ArrowLeft' || k === 'Left') step(-1);
      else if (k === 'ArrowDown' || k === 'Down') step(YRP_COLS);
      else if (k === 'ArrowUp' || k === 'Up') step(-YRP_COLS);
      else if (k === 'Home') { e.preventDefault(); focusCell(0); }
      else if (k === 'End') { e.preventDefault(); focusCell(cells.length - 1); }
      else if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); choose(cells[i]); }
    });
  }

  // ── 10. Page loader: hide once loaded ────────────────────────────────────
  function initLoader() {
    var loader = document.getElementById('rotary-loader');
    if (!loader) return;
    var hide = function () {
      loader.classList.add('rotary-loader--hidden');
      // NOTE (React port): do NOT removeChild here — React owns this node and
      // its next reconcile would throw. The --hidden class already makes it
      // invisible, non-interactive and out of the way.
      loader.setAttribute('aria-hidden', 'true');
    };
    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide);
    // safety: never let the loader trap the page
    setTimeout(hide, 4000);
  }

  // ── On-load header entrance: add .civic-loaded on window-load (in sync with the
  //    loader fade) so the header assembles. Safety timer + idempotent add ensure
  //    the header can never stay hidden. No-op if .civic-preload was not set. ──
  function initOnLoad() {
    var el = document.documentElement;
    if (!el.classList.contains('civic-preload')) return;   // reduced-motion / JS-guarded
    var reveal = function () { el.classList.add('civic-loaded'); };
    if (document.readyState === 'complete') requestAnimationFrame(reveal);
    else window.addEventListener('load', reveal);
    setTimeout(reveal, 2200);   // safety if 'load' never fires
  }

  // ── 11. Lightbox ([data-lightbox] thumbnails -> overlay) ─────────────────
  function initLightbox() {
    var triggers = document.querySelectorAll('[data-lightbox]');
    if (!triggers.length) return;
    var overlay = document.querySelector('.rotary-lightbox');
    if (overlay) { overlay.__ra_reused = 1; }
    else { overlay = document.createElement('div'); }
    overlay.className = 'rotary-lightbox';
    overlay.innerHTML = '<button class="rotary-lightbox__close" aria-label="Close">&times;</button><img alt="">';
    overlay.style.display = 'none';
    if (!overlay.__ra_reused) document.body.appendChild(overlay);
    var img = overlay.querySelector('img');
    function open(src) { img.src = src; overlay.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    function close() { overlay.style.display = 'none'; document.body.style.overflow = ''; }
    triggers.forEach(function (t) {
      if (t.__ra_lightbox) return; t.__ra_lightbox = 1;
      t.addEventListener('click', function () { open(t.getAttribute('data-lightbox') || t.src); });
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay || e.target.classList.contains('rotary-lightbox__close')) close(); });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // ── 12. Simple auto/manual slider ([data-slider]) ────────────────────────
  function initSliders() {
    document.querySelectorAll('[data-slider]').forEach(function (root) {
      var slides = root.querySelectorAll('[data-slide]');
      if (slides.length < 1) return;
      if (root.__ra_initSliders) return; root.__ra_initSliders = 1;
      var i = 0;
      var interval = parseInt(root.getAttribute('data-slider-interval'), 10) || 5000;
      function show(n) {
        i = (n + slides.length) % slides.length;
        slides.forEach(function (s, idx) {
          s.classList.toggle('hidden', idx !== i);
          if (idx === i) { s.classList.remove('hero-slide-in'); void s.offsetWidth; s.classList.add('hero-slide-in'); }
        });
        root.querySelectorAll('[data-slide-dot]').forEach(function (d, idx) {
          d.classList.toggle('bg-gold', idx === i);
          d.classList.toggle('bg-white/40', idx !== i);
        });
      }
      root.querySelectorAll('[data-slide-prev]').forEach(function (b) { b.addEventListener('click', function () { show(i - 1); }); });
      root.querySelectorAll('[data-slide-next]').forEach(function (b) { b.addEventListener('click', function () { show(i + 1); }); });
      root.querySelectorAll('[data-slide-dot]').forEach(function (d, idx) { d.addEventListener('click', function () { show(idx); }); });
      show(0);
      if (slides.length > 1 && !REDUCED) setInterval(function () { show(i + 1); }, interval);
    });
  }

  // ── 13. Hero crossfade sliders ([data-hero]) ────────────────────────────
  function initHero() {
    document.querySelectorAll('[data-hero]').forEach(function (root) {
      // REACT PORT: the slide list, the arrows, the dots and the "01 / 04"
      // readout are all re-read on every show(). In Web Forms a year change
      // reloads the page, so a NodeList captured once here was always current.
      // The SPA never reloads: React REPLACES the slides when the data changes
      // (a year with fewer banners, or the single bundled placeholder), and a
      // captured list would keep toggling opacity on detached nodes while every
      // live slide stayed at the opacity-0 its JSX ships with — a blank hero
      // showing the frame's own background.
      //
      // Re-entry is a RESYNC, not a no-op: the guard used to return early, which
      // left a fresh slide set invisible until the next timer tick (or forever,
      // for a single slide, since the timer only ran when length > 1).
      if (root.__ra_initHero) { root.__ra_heroSync(); return; }
      if (!root.querySelectorAll('[data-hero-slide]').length) return;
      root.__ra_initHero = 1;

      function slides() { return root.querySelectorAll('[data-hero-slide]'); }
      function pad2(n) { return (n < 10 ? '0' : '') + n; }
      var i = 0;
      var interval = parseInt(root.getAttribute('data-hero-interval'), 10) || 5000;
      function show(n) {
        var s = slides();
        if (!s.length) return;
        i = ((n % s.length) + s.length) % s.length;
        s.forEach(function (el, idx) {
          el.classList.toggle('opacity-100', idx === i);
          el.classList.toggle('opacity-0', idx !== i);
          // Only the SHOWING slide may take clicks. The slides are stacked with
          // absolute inset-0, and opacity:0 does NOT stop pointer events — so the
          // LAST slide in the DOM sat on top of the visible one and swallowed
          // every click. On the advertisement slider that made a club's ad PDF or
          // link un-openable: the click landed on a hidden slide whose href was
          // "#" (adAnchorProps renders those inert), so nothing happened.
          el.style.pointerEvents = idx === i ? '' : 'none';
        });
        root.querySelectorAll('[data-hero-dot]').forEach(function (d, idx) {
          d.classList.toggle('w-6', idx === i);
          d.classList.toggle('bg-gold', idx === i);
          d.classList.toggle('w-2', idx !== i);
          d.classList.toggle('bg-white/60', idx !== i);
        });
        // Optional "01 / 04" readout (the civic hero poster-frame renders these).
        // The TOTAL has to be re-stamped too: a new year can change the count.
        root.querySelectorAll('[data-hero-total]').forEach(function (t) { t.textContent = pad2(s.length); });
        root.querySelectorAll('[data-hero-current]').forEach(function (c) { c.textContent = pad2(i + 1); });
      }
      // Called by the guard above on every later RotaryAnim.page() run, so a new
      // slide set becomes visible immediately. Clamped by show().
      root.__ra_heroSync = function () { show(i); };

      // Delegated: React re-creates the arrows and dots along with the slides,
      // which would drop listeners bound to the original nodes.
      root.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-hero-prev]')) { show(i - 1); return; }
        if (t.closest('[data-hero-next]')) { show(i + 1); return; }
        var dot = t.closest('[data-hero-dot]');
        if (dot) show(Array.prototype.indexOf.call(root.querySelectorAll('[data-hero-dot]'), dot));
      });
      show(0);
      // The length test moved INSIDE the tick: a hero that starts with one slide
      // can gain more when the year changes, and used to stay frozen.
      if (!REDUCED) setInterval(function () { if (slides().length > 1) show(i + 1); }, interval);
    });
  }

  // ── 14. Impact counters: click-to-load CTA -> skeleton -> count-up ───────
  function initImpact() {
    document.querySelectorAll('[data-impact]').forEach(function (section) {
      var cta = section.querySelector('[data-impact-cta]');
      var skeleton = section.querySelector('[data-impact-skeleton]');
      var grid = section.querySelector('[data-impact-grid]');
      if (!cta || !grid) return;
      if (section.__ra_initImpact) return; section.__ra_initImpact = 1;
      cta.addEventListener('click', function () {
        cta.parentNode.style.display = 'none';
        if (skeleton) skeleton.classList.remove('hidden');
        setTimeout(function () {
          if (skeleton) skeleton.classList.add('hidden');
          grid.classList.remove('hidden');
          grid.classList.add('impact-in');
          grid.querySelectorAll('[data-count]').forEach(animateCount);
        }, 900);
      });
    });
  }

  // ── 15. Scroll progress hairline (#cv-progress) ──────────────────────────
  function initScrollProgress() {
    var bar = document.querySelector('#cv-progress > span');
    if (!bar) return;
    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // ── 16. Click spark (React Bits) on the civic + classic-arm buttons ──────
  function initClickSpark() {
    if (REDUCED) return;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.civic-btn, .civic-btn-accent, .civic-btn-dark, .btn-gold, .btn-navy, .btn');
      if (!btn) return;
      var r = btn.getBoundingClientRect();
      var burst = document.createElement('span');
      burst.className = 'cv-spark';
      burst.style.left = (e.clientX - r.left) + 'px';
      burst.style.top = (e.clientY - r.top) + 'px';
      for (var i = 0; i < 6; i++) {
        var s = document.createElement('i');
        s.style.setProperty('--a', (i * 60) + 'deg');
        burst.appendChild(s);
      }
      btn.appendChild(burst);
      setTimeout(function () { if (burst.parentNode) burst.parentNode.removeChild(burst); }, 500);
    });
  }

  // ── 17. Civic page enhancer — runs BEFORE the engines above so the 33
  // shared content pages (whose markup is theme-neutral: it also renders under
  // classic/warm/madras, so it cannot carry civic attributes statically) get
  // the same motion treatment as the civic home. This script only loads under
  // the civic-bold master, so nothing here can leak into other themes.
  function initCivicEnhance() {
    // Kinetic page title: the Breadcrumb() civic band's <h1> (code-behind emits
    // it without data-split; RotaryPage.cs can't be recompiled on this machine).
    document.querySelectorAll('.civic-gridlines ~ .container-x > h1').forEach(function (h) {
      if (h.__ra_initCivicEnhance) return; h.__ra_initCivicEnhance = 1;
      var title = (h.textContent || '').trim();
      // Stash the page name BEFORE initSplit empties textContent.
      if (!h.hasAttribute('data-title')) h.setAttribute('data-title', title);

      // MASTHEAD MARQUEE — build a full-bleed kinetic band of the page name that
      // scrolls behind the solid title. Two identical halves so the -50% loop is
      // seamless. Decorative only (aria-hidden): the real <h1> still carries the
      // page name for assistive tech and SEO.
      var band = h.parentNode;                 // .container-x
      var sect = band && band.parentNode;      // the masthead <section>
      if (title && sect && !sect.querySelector('.cv-mast__marq')) {
        var half = function () {
          var f = document.createDocumentFragment();
          for (var i = 0; i < 6; i++) {
            var w = document.createElement('span');
            w.textContent = title;             // textContent, never innerHTML
            f.appendChild(w);
            var d = document.createElement('i');
            d.textContent = '◆';
            f.appendChild(d);
          }
          return f;
        };
        var wrap = document.createElement('div');
        wrap.className = 'cv-mast__marq';
        wrap.setAttribute('aria-hidden', 'true');
        var track = document.createElement('div');
        track.className = 'cv-mast__track';
        track.appendChild(half());
        track.appendChild(half());
        wrap.appendChild(track);
        sect.insertBefore(wrap, band);         // sits under .container-x
      }

      if (!h.hasAttribute('data-split')) {
        h.setAttribute('data-split', '');
        h.setAttribute('data-split-stagger', '0.025');
      }
    });

    // Cards: cursor spotlight + grouped reveal cascade. Only containers with
    // 2+ card children cascade (a lone hero/detail card stays static), and
    // client-JS-injected cards (e.g. Directory pagination) are left alone —
    // they render after this pass and simply never get .reveal.
    var units = document.querySelectorAll('main .shadow-card, main .img-zoom');
    var parents = [];
    units.forEach(function (u) {
      u.classList.add('spotlight-card');
      if (u.parentNode && parents.indexOf(u.parentNode) < 0) parents.push(u.parentNode);
    });
    parents.forEach(function (p) {
      var kids = Array.prototype.filter.call(p.children, function (k) {
        return k.classList && (k.classList.contains('shadow-card') || k.classList.contains('img-zoom'));
      });
      if (kids.length < 2) return;
      kids.forEach(function (k, i) {
        if (!k.classList.contains('reveal')) {
          k.classList.add('reveal');
          k.style.transitionDelay = (Math.min(i, 8) * 0.07) + 's';
        }
      });
    });

    // Smooth-scroll in-page anchor links only (not a global
    // html{scroll-behavior:smooth}, which would animate keyboard scrolling).
    if (!REDUCED) {
      document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href^="#"]');
        if (!a) return;
        var target = document.getElementById(a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Classic-arm CTAs (.btn-gold/.btn-navy ship the magnet transform +
    // spring transition compiled in — they only lack the attribute).
    document.querySelectorAll('main .btn-gold, main .btn-navy, main .btn').forEach(function (b) {
      if (!b.hasAttribute('data-magnetic')) b.setAttribute('data-magnetic', '');
    });

    // Once a staggered card has revealed, clear its transition-delay so hover
    // transitions respond instantly (a delay left in place lags every later
    // transition on the element — including the home grids' CSS nth-child
    // stagger, which this inline 0s also overrides).
    document.addEventListener('transitionend', function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains('reveal') && t.classList.contains('is-visible')) {
        t.style.transitionDelay = '0s';
      }
    });
  }

  // ── 18. 3D globe/cylinder slider ([data-arc]) ────────────────────────────
  // Cards are placed continuously around a 3D ring (rotateY + translateZ) that
  // spins right → left. Perspective makes the front card the largest (shows its
  // project title); cards recede + turn away toward the sides like a rotating
  // globe. Projects are cloned around the ring for a seamless, gap-free loop.
  //   TILE  : card width (px)      N     : cards around the ring (min)
  //   PERSP : perspective (px)     SPEED : degrees/frame     RADIUS_MULT: ring size
  // TOUCH_HOLD: ms the ring stays frozen after a finger lifts (touch devices only) —
  // long enough for the tap to land and for a second, deliberate tap on another card.
  var ARC = { TILE: 200, N: 30, PERSP: 2800, SPEED: 0.07, RADIUS_MULT: 1.0, TOUCH_HOLD: 2600 };
  function initArcSlider() {
    document.querySelectorAll('[data-arc]').forEach(function (root) {
      var track = root.querySelector('[data-arc-track]');
      if (!track) return;
      var originals = Array.prototype.slice.call(track.children);
      if (!originals.length) return;
      if (root.__ra_initArcSlider) return; root.__ra_initArcSlider = 1;

      // Fill the ring: clone the projects round-robin up to N cards.
      //
      // cloneNode does NOT carry React's delegated onError, and the clone's <img>
      // re-requests the same URL — so a project whose photograph 404s got the
      // designed "no photograph" plate on the ORIGINAL card and a broken image on
      // every clone of it. Bind the same marker natively on each clone, and cover
      // the case where the load already failed before we got here.
      // Show the Rotary wheel on white, matching what React's wheelFallback()
      // does for the rest of the theme (shared/rotaryPage.js). This used to add
      // .cv-arc__media--noimg, whose CSS hides the <img> and prints a
      // "NO PHOTOGRAPH" slug — that rule is still in civic-motion.css and can be
      // switched back to, but nothing adds the class any more.
      function markNoImg(img) {
        img.onerror = null;
        img.src = '/images/logo/wheel.png';
        img.setAttribute('data-wheel-fallback', '');
        img.style.objectFit = 'contain';
        img.style.background = '#fff';
        img.style.padding = '14%';
      }
      var N = Math.max(ARC.N, originals.length);
      while (track.children.length < N) {
        var clone = originals[track.children.length % originals.length].cloneNode(true);
        Array.prototype.forEach.call(clone.querySelectorAll('img'), function (img) {
          img.addEventListener('error', function () { markNoImg(img); });
          if (img.complete && img.naturalWidth === 0) markNoImg(img);
        });
        track.appendChild(clone);
      }
      var items = Array.prototype.slice.call(track.children);
      N = items.length;
      var step = 360 / N;
      var W = ARC.TILE;
      var H = Math.round(W * 4 / 3);
      var radius = Math.round((W / 2) / Math.tan(Math.PI / N) * ARC.RADIUS_MULT);

      root.style.perspective = ARC.PERSP + 'px';
      track.style.width = W + 'px';
      track.style.height = H + 'px';
      track.style.marginLeft = (-W / 2) + 'px';
      track.style.marginTop = (-H / 2) + 'px';

      items.forEach(function (el, i) {
        el.style.width = W + 'px';
        el.__ang = i * step;
        el.style.transform = 'rotateY(' + (i * step) + 'deg) translateZ(' + radius + 'px)';
      });

      var spin = 0, paused = false, manual = false, target = 0, running = false;

      // MOBILE TAP FIX (2026-07-29). On desktop the hover pause is what makes a tile
      // clickable — the ring stops under the cursor, so the click lands on a stationary
      // card. Touch devices have NO hover: pointerenter/pointerleave fire and unfire
      // within the tap itself, so the ring kept turning while the user aimed. Worse,
      // render() sets pointer-events:none on every tile with facing <= 0.6, so the card
      // being tapped could stop being a hit-target mid-gesture — the reported "can't
      // click any project card on mobile".
      //
      // On coarse pointers, freeze from the first touch and hold it briefly after the
      // finger lifts. The two branches are mutually exclusive: pointerleave must NOT be
      // bound on touch, or it would clear the hold the instant the finger lifts and
      // reintroduce the bug. Desktop keeps the original hover behaviour untouched.
      var COARSE = window.matchMedia && window.matchMedia('(hover: none)').matches;
      if (COARSE) {
        var resumeTimer = null;
        var freeze = function () {
          paused = true;
          if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
        };
        var resumeSoon = function () {
          if (resumeTimer) clearTimeout(resumeTimer);
          resumeTimer = setTimeout(function () { paused = false; resumeTimer = null; }, ARC.TOUCH_HOLD);
        };
        // Listeners sit on the arc root so they still fire for taps that pass THROUGH a
        // dimmed (pointer-events:none) tile — the ring then stops and the next tap works.
        root.addEventListener('pointerdown', freeze, { passive: true });
        root.addEventListener('pointerup', resumeSoon, { passive: true });
        root.addEventListener('pointercancel', resumeSoon, { passive: true });
      } else {
        root.addEventListener('pointerenter', function () { paused = true; });
        root.addEventListener('pointerleave', function () { paused = false; });
      }

      // MOBILE STEPPER (2026-07-30). The touch hold above buys ~2.6s to tap a
      // card, but not enough to read the ring and CHOOSE one — the reported
      // "can't stop the slider on mobile". The arrows (rendered mobile-only by
      // civic-home.css) take over instead of merely pausing: the first press
      // sets manual and never releases it, so the auto-spin is done for the
      // rest of the visit. `spin` then eases toward `target` rather than
      // jumping, so the ring still turns like a ring.
      //   spin decreases as the ring advances, so next = −step, prev = +step.
      //   Snapping target to a whole multiple of step lands a card dead front,
      //   where render() gives it full opacity, its caption and a hit-target.
      function step1(dir) {
        if (!manual) { manual = true; target = Math.round(spin / step) * step; }
        target += dir * step;
        start();                      // REDUCED never starts the loop — start it now
      }
      var prevBtn = root.querySelector('[data-arc-prev]');
      var nextBtn = root.querySelector('[data-arc-next]');
      if (prevBtn) prevBtn.addEventListener('click', function () { step1(1); });
      if (nextBtn) nextBtn.addEventListener('click', function () { step1(-1); });

      function render() {
        track.style.transform = 'rotateY(' + spin.toFixed(2) + 'deg)';
        for (var i = 0; i < items.length; i++) {
          var el = items[i];
          var facing = Math.cos((el.__ang + spin) * Math.PI / 180);   // 1 front → −1 back
          el.style.opacity = (facing > 0 ? (0.2 + 0.8 * facing) : 0).toFixed(3);
          el.style.zIndex = 200 + Math.round(facing * 100);
          el.style.pointerEvents = facing > 0.6 ? 'auto' : 'none';
          var cap = el.__cap || (el.__cap = el.querySelector('.cv-arc__cap'));
          var scrim = el.__scrim || (el.__scrim = el.querySelector('.cv-arc__scrim'));
          var capOp = facing > 0.965 ? (facing - 0.965) / 0.035 : 0; if (capOp > 1) capOp = 1;
          if (cap) cap.style.opacity = capOp.toFixed(3);
          // The scrim must LEAD the caption in. Fading both at capOp meant a
          // half-faded title sat on a half-faded scrim — unreadable over a
          // bright photo for the whole transit. Full dark by capOp 0.34.
          if (scrim) scrim.style.opacity = Math.min(1, capOp * 3).toFixed(3);
        }
      }
      function frame() {
        if (manual) {                                  // arrows own the ring
          var d = target - spin;
          spin = Math.abs(d) < 0.05 ? target : spin + d * 0.14;
        } else if (!REDUCED && !paused) {
          spin -= ARC.SPEED;                           // spin right → left
        }
        render();
        requestAnimationFrame(frame);
      }
      function start() { if (!running) { running = true; requestAnimationFrame(frame); } }
      render();
      if (!REDUCED) start();
    });
  }

  // ── Night-sky starfield ([data-stars]) — canvas-2D port of the Meridian
  //   reference's Three.js field: gold/blue/white additive points slowly
  //   rotating in 3D + a faint gold ring (the Rotary wheel, abstracted),
  //   camera drifting with the pointer. Dependency-free by design. ─────────
  function initStarfield() {
    if (!document.createElement('canvas').getContext) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-stars]'), initStarfieldHost);
  }
  function initStarfieldHost(host) {
    if (host.__ra_stars) return; host.__ra_stars = 1;
    var canvas = document.createElement('canvas');
    canvas.className = 'cv2-stars__canvas';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    function size() {
      var r = host.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    var N = W < 780 ? 380 : 1000;
    // Soft round glow sprites (offscreen) — one per star colour.
    function makeSprite(cr) {
      // Small CRISP dot (reference uses 2px additive points, not soft blobs):
      // solid core, tight falloff.
      var s = document.createElement('canvas');
      s.width = s.height = 32;
      var g = s.getContext('2d');
      var grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.5, 'rgba(' + cr + ',0.95)');
      grd.addColorStop(0.85, 'rgba(' + cr + ',0.12)');
      grd.addColorStop(1, 'rgba(' + cr + ',0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 32, 32);
      return s;
    }
    var SPRITES = [makeSprite('240,162,20'), makeSprite('111,160,255'), makeSprite('255,255,255')];
    // Stars live in SCREEN space (uniform coverage corner-to-corner by
    // construction — world-space projection could never reach the edges of a
    // wide band). `k` is the star's depth: it scales size, parallax and drift.
    var P = [];
    function scatter() {
      P.length = 0;
      for (var i = 0; i < N; i++) {
        var r = Math.random();
        var k = 0.3 + Math.random() * 0.7;
        P.push({
          x: Math.random() * W,
          y: Math.random() * H,
          k: k,
          sp: r > .82 ? 0 : (r > .48 ? 1 : 2),
          s: .9 + Math.random() * 1.8,
          // One-directional stream, faster when nearer — exactly what the
          // reference's slow Y-rotation looks like from the front, but with
          // wrap-around so coverage can never collapse to one side.
          vx: -(0.16 + 0.5 * k),
          vy: (Math.random() - .5) * .03
        });
      }
    }
    scatter();
    var RN = 96, RR = 115, RING = [];
    for (var i = 0; i < RN; i++) {
      var a = i / RN * Math.PI * 2;
      RING.push({ x: Math.cos(a) * RR, y: Math.sin(a) * RR, z: 0 });
    }
    var F = 320;
    var t = 0, rz = 0, mx = 0, my = 0, tx = 0, ty = 0, vis = true;
    window.addEventListener('pointermove', function (e) {
      tx = (e.clientX / window.innerWidth - .5) * 2;
      ty = (e.clientY / window.innerHeight - .5) * 2;
    }, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { vis = en[0].isIntersecting; }, { threshold: 0 }).observe(host);
    }
    var o = { x: 0, y: 0, k: 0 };
    function project(p, ry, rx, ox, oy, oz) {
      var cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
      var x = p.x * cy + p.z * sy;
      var z = -p.x * sy + p.z * cy;
      var y = p.y * cx - z * sx;
      z = p.y * sx + z * cx;
      x += ox; y += oy; z += oz;
      var d = F + 320 - z;
      if (d < 40) return false;
      var k = F / d;
      o.x = W / 2 + (x - mx * 34) * k;
      o.y = H / 2 + (y + my * 26) * k;
      o.k = k;
      return true;
    }
    function frame() {
      mx += (tx - mx) * .045; my += (ty - my) * .045;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        // constant sideways stream (the reference's rotation, linearised) + wrap
        p.x += p.vx; p.y += p.vy;
        if (p.x < -24) p.x += W + 48; else if (p.x > W + 24) p.x -= W + 48;
        if (p.y < -24) p.y += H + 48; else if (p.y > H + 24) p.y -= H + 48;
        // pointer parallax by depth — near stars shift more than far ones
        var X = p.x - mx * 42 * p.k;
        var Y = p.y + my * 30 * p.k;
        ctx.globalAlpha = 0.78 * (0.4 + 0.6 * p.k);   // steady, like the reference
        var s = Math.min(5, Math.max(1.4, p.s * p.k * 2.4));   // small crisp dots
        ctx.drawImage(SPRITES[p.sp], X - s / 2, Y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      // the wheel — a tilted wireframe ring drifting right of centre
      // (dashed = the reference's wireframe torus lattice)
      ctx.strokeStyle = 'rgba(240,162,20,0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      var first = true;
      for (i = 0; i <= RN; i++) {
        var q = RING[i % RN];
        if (!project(q, rz + mx * .3, .5 + my * .12, 150, 20, -140)) { first = true; continue; }
        if (first) { ctx.moveTo(o.x, o.y); first = false; }
        else ctx.lineTo(o.x, o.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (REDUCED) { frame(); return; }   // a single static sky, no motion
    (function loop() {
      requestAnimationFrame(loop);
      if (!vis || W === 0) return;
      t += .0016; rz += .0018;
      frame();
    })();
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { size(); scatter(); if (REDUCED) frame(); }, 160);
    });
  }

  // ── Pointer parallax ([data-plx="0.04"]) — hero floating shapes ──────────
  //   Elements drift with the pointer by their depth factor. Composes with the
  //   CSS float animation (which uses the `translate` property, not transform).
  //   Skipped for touch-only devices and reduced motion.
  function initParallax() {
    if (REDUCED) return;
    var els = document.querySelectorAll('[data-plx]');
    if (!els.length) return;
    if (window.__ra_parallax) return; window.__ra_parallax = 1;
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;
    var ticking = false, mx = 0, my = 0;
    function apply() {
      ticking = false;
      els.forEach(function (el) {
        var f = parseFloat(el.getAttribute('data-plx')) || 0.04;
        el.style.transform = 'translate3d(' + (mx * f * 1000).toFixed(1) + 'px,' + (my * f * 1000).toFixed(1) + 'px,0)';
      });
    }
    window.addEventListener('pointermove', function (e) {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
  }

  // ── Hero scroll cue — fade it out once the visitor starts scrolling ──────
  function initHeroCue() {
    var hero = document.querySelector('[data-hero-cue]');
    if (!hero) return;
    if (hero.__ra_herocue) return; hero.__ra_herocue = 1;
    var on = false;
    function upd() {
      var s = window.scrollY > 60;
      if (s !== on) { on = s; hero.classList.toggle('is-scrolled', s); }
    }
    window.addEventListener('scroll', upd, { passive: true });
    upd();
  }

  // ── React Bits "Waves" — animated Perlin wave-field background ───────────
  //  Vanilla port of the React component (promt.txt). Opt-in via [data-waves];
  //  props read from data-* attributes; stroke colour from the canvas' CSS
  //  `color` (so it flips with light/dark). Only animates while in view.
  function initWaves() {
    var containers = document.querySelectorAll('[data-waves]');
    if (!containers.length || !document.createElement('canvas').getContext) return;
    containers = Array.prototype.filter.call(containers, function (c) {
      if (c.__ra_waves) return false; c.__ra_waves = 1; return true;
    });
    if (!containers.length) return;

    function Grad(x, y, z) { this.x = x; this.y = y; this.z = z; }
    Grad.prototype.dot2 = function (x, y) { return this.x * x + this.y * y; };
    var PERM = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
    function Noise(seed) {
      this.grad3 = [new Grad(1,1,0),new Grad(-1,1,0),new Grad(1,-1,0),new Grad(-1,-1,0),new Grad(1,0,1),new Grad(-1,0,1),new Grad(1,0,-1),new Grad(-1,0,-1),new Grad(0,1,1),new Grad(0,-1,1),new Grad(0,1,-1),new Grad(0,-1,-1)];
      this.perm = new Array(512); this.gradP = new Array(512); this.seed(seed || 0);
    }
    Noise.prototype.seed = function (seed) {
      if (seed > 0 && seed < 1) seed *= 65536;
      seed = Math.floor(seed);
      if (seed < 256) seed |= seed << 8;
      for (var i = 0; i < 256; i++) {
        var v = (i & 1) ? PERM[i] ^ (seed & 255) : PERM[i] ^ ((seed >> 8) & 255);
        this.perm[i] = this.perm[i + 256] = v;
        this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12];
      }
    };
    Noise.prototype.fade = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };
    Noise.prototype.lerp = function (a, b, t) { return (1 - t) * a + t * b; };
    Noise.prototype.perlin2 = function (x, y) {
      var X = Math.floor(x), Y = Math.floor(y); x -= X; y -= Y; X &= 255; Y &= 255;
      var n00 = this.gradP[X + this.perm[Y]].dot2(x, y);
      var n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1);
      var n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y);
      var n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1);
      var u = this.fade(x);
      return this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), this.fade(y));
    };

    Array.prototype.forEach.call(containers, function (container) {
      var canvas = document.createElement('canvas');
      canvas.className = 'cv-waves__canvas';
      container.appendChild(canvas);
      var ctx = canvas.getContext('2d');

      function num(name, def) { var v = parseFloat(container.getAttribute('data-' + name)); return isNaN(v) ? def : v; }
      var cfg = {
        waveSpeedX: num('wave-speed-x', 0.0125), waveSpeedY: num('wave-speed-y', 0.005),
        waveAmpX: num('wave-amp-x', 32), waveAmpY: num('wave-amp-y', 16),
        xGap: num('x-gap', 10), yGap: num('y-gap', 32),
        friction: num('friction', 0.925), tension: num('tension', 0.005),
        maxCursorMove: num('max-cursor-move', 100)
      };

      var lineColor = 'rgba(0,0,0,0.2)';
      function readColor() { var c = getComputedStyle(canvas).color; if (c) lineColor = c; }
      readColor();
      if (window.MutationObserver) {
        new MutationObserver(readColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-civic-mode'] });
      }

      var bounding = { width: 0, height: 0, left: 0, top: 0 };
      var noise = new Noise(Math.random());
      var lines = [];
      var mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, v: 0, vs: 0, a: 0, set: false };
      var dpr = Math.min(window.devicePixelRatio || 1, 2);

      function setSize() {
        bounding = container.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(bounding.width * dpr));
        canvas.height = Math.max(1, Math.round(bounding.height * dpr));
        canvas.style.width = bounding.width + 'px';
        canvas.style.height = bounding.height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      function setLines() {
        var width = bounding.width, height = bounding.height;
        lines = [];
        var oWidth = width + 200, oHeight = height + 30;
        var totalLines = Math.ceil(oWidth / cfg.xGap);
        var totalPoints = Math.ceil(oHeight / cfg.yGap);
        var xStart = (width - cfg.xGap * totalLines) / 2;
        var yStart = (height - cfg.yGap * totalPoints) / 2;
        for (var i = 0; i <= totalLines; i++) {
          var pts = [];
          for (var j = 0; j <= totalPoints; j++) {
            pts.push({ x: xStart + cfg.xGap * i, y: yStart + cfg.yGap * j, wave: { x: 0, y: 0 }, cursor: { x: 0, y: 0, vx: 0, vy: 0 } });
          }
          lines.push(pts);
        }
      }
      function movePoints(time) {
        lines.forEach(function (pts) {
          pts.forEach(function (p) {
            var move = noise.perlin2((p.x + time * cfg.waveSpeedX) * 0.002, (p.y + time * cfg.waveSpeedY) * 0.0015) * 12;
            p.wave.x = Math.cos(move) * cfg.waveAmpX;
            p.wave.y = Math.sin(move) * cfg.waveAmpY;
            var dx = p.x - mouse.sx, dy = p.y - mouse.sy;
            var dist = Math.hypot(dx, dy), l = Math.max(175, mouse.vs);
            if (dist < l) {
              var s = 1 - dist / l, f = Math.cos(dist * 0.001) * s;
              p.cursor.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00065;
              p.cursor.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00065;
            }
            p.cursor.vx += (0 - p.cursor.x) * cfg.tension;
            p.cursor.vy += (0 - p.cursor.y) * cfg.tension;
            p.cursor.vx *= cfg.friction; p.cursor.vy *= cfg.friction;
            p.cursor.x += p.cursor.vx * 2; p.cursor.y += p.cursor.vy * 2;
            p.cursor.x = Math.min(cfg.maxCursorMove, Math.max(-cfg.maxCursorMove, p.cursor.x));
            p.cursor.y = Math.min(cfg.maxCursorMove, Math.max(-cfg.maxCursorMove, p.cursor.y));
          });
        });
      }
      function moved(point, withCursor) {
        var x = point.x + point.wave.x + (withCursor ? point.cursor.x : 0);
        var y = point.y + point.wave.y + (withCursor ? point.cursor.y : 0);
        return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
      }
      function drawLines() {
        var width = bounding.width, height = bounding.height;
        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        lines.forEach(function (points) {
          var p1 = moved(points[0], false);
          ctx.moveTo(p1.x, p1.y);
          points.forEach(function (p, idx) {
            var isLast = idx === points.length - 1;
            p1 = moved(p, !isLast);
            var p2 = moved(points[idx + 1] || points[points.length - 1], !isLast);
            ctx.lineTo(p1.x, p1.y);
            if (isLast) ctx.moveTo(p2.x, p2.y);
          });
        });
        ctx.stroke();
      }
      function tick(t) {
        mouse.sx += (mouse.x - mouse.sx) * 0.1;
        mouse.sy += (mouse.y - mouse.sy) * 0.1;
        var dx = mouse.x - mouse.lx, dy = mouse.y - mouse.ly, d = Math.hypot(dx, dy);
        mouse.v = d; mouse.vs += (d - mouse.vs) * 0.1; mouse.vs = Math.min(100, mouse.vs);
        mouse.lx = mouse.x; mouse.ly = mouse.y; mouse.a = Math.atan2(dy, dx);
        movePoints(t); drawLines();
        frameId = requestAnimationFrame(tick);
      }
      var frameId = null, running = false;
      function start() { if (running) return; running = true; frameId = requestAnimationFrame(tick); }
      function stop() { running = false; if (frameId) cancelAnimationFrame(frameId); frameId = null; }

      function updateMouse(x, y) {
        mouse.x = x - bounding.left; mouse.y = y - bounding.top;
        if (!mouse.set) { mouse.sx = mouse.x; mouse.sy = mouse.y; mouse.lx = mouse.x; mouse.ly = mouse.y; mouse.set = true; }
      }
      window.addEventListener('resize', function () { setSize(); setLines(); });
      window.addEventListener('scroll', function () { bounding = container.getBoundingClientRect(); }, { passive: true });
      window.addEventListener('mousemove', function (e) { updateMouse(e.clientX, e.clientY); });
      window.addEventListener('touchmove', function (e) { var tc = e.touches[0]; updateMouse(tc.clientX, tc.clientY); }, { passive: true });

      setSize(); setLines();
      if (REDUCED) { movePoints(0); drawLines(); return; }
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (e) { e.isIntersecting ? start() : stop(); });
        }, { rootMargin: '140px' }).observe(container);
      } else { start(); }
    });
  }

  // ── SPA bridge (React port) ──────────────────────────────────────────────
  // The Web Forms original ran every initialiser once on DOMContentLoaded. Here
  // the shell mounts once and only the page content swaps, so instead of
  // self-starting we expose the same initialisers and let React call them:
  //   shell() — once, after the nav has rendered (binds global listeners)
  //   page()  — after every route change / data load (finds the new elements)
  // Nothing above this line is modified.
  //
  // initYearSelect is deliberately NOT exposed: it rewrites the URL with
  // history.replaceState and does a full page reload on change, both of which
  // fight React Router. The layouts reproduce that behaviour through the router.
  //
  // ponytail: page() re-runs a few initialisers that also bind a window-level
  // fallback listener, so revisiting a route can leave a duplicate (idle) one.
  // Harmless; give them per-element guards if profiling ever says otherwise.
  var __shellDone = false;
  window.RotaryAnim = window.RotaryAnim || {};
  window.RotaryAnim.shell = function () {
    if (__shellDone) return;
    __shellDone = true;
    initNav();
    // initLoader is NOT run here: it hid the loader the moment readyState hit
    // 'complete', which in an SPA is before any API data has arrived. The
    // layouts call useLoader() instead, which waits for the club context.
    initYearPicker();
    initScrollProgress();
    initClickSpark();
    initOnLoad();
  };
  window.RotaryAnim.page = function () {
    initCivicEnhance();
    initSplit();
    initSrWords();
    initReveal();
    initSpotlight();
    initTilt();
    initMagnetic();
    initCounters();
    initLightbox();
    initSliders();
    initHero();
    initStarfield();
    initParallax();
    initHeroCue();
    initImpact();
    initArcSlider();
    initWaves();
  };
})();
