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

  // ── 1. Reveal on scroll (.reveal / .split / .sr) ─────────────────────────
  function initReveal() {
    var nodes = document.querySelectorAll('.reveal, .split, .sr');
    if (!nodes.length) return;
    if (REDUCED || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    nodes.forEach(function (n) {
      if (n.__ra_reveal) return; n.__ra_reveal = 1;
      io.observe(n);
    });

    // Reveal anything already in the viewport on load. The IntersectionObserver's
    // first callback can be delayed or skipped for in-view elements (it races with
    // the page loader / initial layout), which would leave above-the-fold content —
    // notably the breadcrumb title (data-split) — stuck invisible until the user
    // scrolls. This guarantees on-load reveal for what's already visible.
    requestAnimationFrame(function () {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      nodes.forEach(function (n) {
        if (n.classList.contains('is-visible')) return;
        var r = n.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) {
          n.classList.add('is-visible');
          io.unobserve(n);
        }
      });
    });
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
  function animateCount(el) {
    // Placeholder: when the value isn't available from the API, show the
    // placeholder text (e.g. "—") instead of animating a fabricated number.
    var placeholder = el.getAttribute('data-count-text');
    if (placeholder) { el.textContent = placeholder; return; }
    var target = parseFloat(el.getAttribute('data-count')) || 0;
    var dur = parseFloat(el.getAttribute('data-count-dur')) || 2000;
    var prefix = el.getAttribute('data-count-prefix') || '';
    var suffix = el.getAttribute('data-count-suffix') || '';
    if (REDUCED) { el.textContent = prefix + target.toLocaleString() + suffix; return; }
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var val = Math.round(target * easeOutCubic(p));
      el.textContent = prefix + val.toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function initCounters() {
    var nodes = document.querySelectorAll('[data-count]');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) { nodes.forEach(animateCount); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateCount(e.target); io.unobserve(e.target); }
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
        here.searchParams.delete('statYear');   // the impact band's own year is temporary too: a refresh returns to "All years"
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

    // The impact band's OWN year picker: reloads with ?statYear so the SERVER re-totals
    // just that band — "All years" (a lifetime sum) by default, or one chosen year.
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
      // REACT PORT: the slide list, the arrows and the dots are all re-read on
      // every show(). In Web Forms a year change reloads the page, so a NodeList
      // captured once here was always current. The SPA never reloads: React
      // REPLACES the slides when the data changes (a year with fewer banners, or
      // the single bundled placeholder), and a captured list would keep toggling
      // opacity on detached nodes while every live slide stayed at the opacity-0
      // its JSX ships with — a blank hero showing the box's own background.
      //
      // Re-entry is a RESYNC, not a no-op: the guard used to return early, which
      // left a fresh slide set invisible until the next timer tick (or forever,
      // for a single slide, since the timer only ran when length > 1).
      if (root.__ra_initHero) { root.__ra_heroSync(); return; }
      if (!root.querySelectorAll('[data-hero-slide]').length) return;
      root.__ra_initHero = 1;

      function slides() { return root.querySelectorAll('[data-hero-slide]'); }
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
  };
  window.RotaryAnim.page = function () {
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
    initImpact();
  };
})();
