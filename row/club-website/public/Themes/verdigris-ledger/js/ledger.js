/* ============================================================================
   ledger.js — The Verdigris Ledger home rail. Drives ONLY the persistent left
   "service ledger" spine on HomeVerdigrisLedger: the marigold scroll-depth fill
   and the active section index. No-ops on every other page (guards on .vl-home).
   Reveals, counters (data-count) and the year <select> are handled by the shared
   rotary-anim.js; this file adds only the rail behaviour.
   ========================================================================== */
(function () {
  "use strict";

  // SPA bridge (React port): this file used to run once on load and return
  // immediately when .vl-home was not in the DOM yet — which is ALWAYS the case
  // here, because the script is injected while the boot loader is still up. The
  // whole rail, the project deck fan-out and the collapse button were therefore
  // never wired. Expose init() so the page calls it once its markup exists.
  function init() {
  var home = document.querySelector(".vl-home");
  if (!home) return;
  // Guard PER FEATURE, not per page: init() is called again whenever more of the
  // page renders (the project deck only exists once its data arrives), so a single
  // page-level flag would permanently skip whatever had not rendered on the first
  // pass — which left the deck unbound and its cards behaving as plain links.
  var railDone = !!home.__ledgerRail;
  home.__ledgerRail = 1;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fill = home.querySelector(".vl-rail__fill");
  var index = home.querySelector(".vl-rail__index");
  var sections = Array.prototype.slice.call(home.querySelectorAll("[data-vl-section]"));

  // Active-section index: light the rail node whose section owns the viewport middle.
  if (!railDone && index && sections.length && "IntersectionObserver" in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.getAttribute("data-vl-section");
        var lis = index.querySelectorAll("li");
        for (var i = 0; i < lis.length; i++) {
          lis[i].classList.toggle("on", lis[i].getAttribute("data-for") === id);
        }
      });
    }, { threshold: 0.01, rootMargin: "-45% 0px -45% 0px" });
    sections.forEach(function (s) { obs.observe(s); });
  }

  // Marigold scroll-depth fill: fraction of the page scrolled -> scaleY(0..1).
  if (!railDone && fill) {
    var ticking = false;
    function update() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
      fill.style.setProperty("--vl-progress", p.toFixed(3));
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      (window.requestAnimationFrame || function (f) { f(); })(update);
    }, { passive: true });
    update();
  }

  // ── The Community: click-to-fan project deck (ux-india style) ─────────────
  // Collapsed = a tilted stack; a click (or Enter/Space) fans the cards into a
  // horizontal row. While collapsed, the opening click must NOT follow a card's
  // link — so we preventDefault on the deck until it is open. Once open, each
  // card behaves as a normal anchor to its project.
  Array.prototype.slice.call(home.querySelectorAll("[data-vl-comm]")).forEach(function (comm) {
    if (comm.__deckInit) return;          // this deck is already wired
    var deck = comm.querySelector("[data-vl-deck]");
    if (!deck) return;                    // not rendered yet — a later init() gets it
    comm.__deckInit = 1;
    var track = deck.querySelector("[data-vl-track]") || deck;
    var collapseBtn = comm.querySelector("[data-vl-collapse]");
    var CARD_MARGIN = 20; // must match .vl-comm.is-open .vl-tcard margin-right

    function realCards() {
      return Array.prototype.slice.call(track.querySelectorAll(".vl-tcard")).filter(function (c) {
        return !c.hasAttribute("data-clone");
      });
    }
    function clearClones() {
      Array.prototype.slice.call(track.querySelectorAll(".vl-tcard[data-clone]")).forEach(function (c) { c.remove(); });
    }

    // FLIP the stack<->row change so cards SLIDE between layouts (flex reflow itself
    // cannot be transitioned): freeze each card at its old on-screen spot with an inline
    // translate, then release it — the transition back to the CSS value glides it
    // (rotation included) into its new place, dealt with a stagger. Only REAL cards.
    function flipDeck(mutate) {
      if (reduce) { mutate(); return; }
      var cards = realCards();
      var first = cards.map(function (c) { return c.getBoundingClientRect(); });
      mutate();
      var last = cards.map(function (c) { return c.getBoundingClientRect(); });
      cards.forEach(function (c, i) {
        if (c.__flipT) clearTimeout(c.__flipT);
        var dx = first[i].left - last[i].left, dy = first[i].top - last[i].top;
        c.style.transition = "none";
        c.style.transform = "translate(" + dx + "px," + dy + "px)";
      });
      void track.offsetWidth; // commit the frozen frame before releasing
      cards.forEach(function (c, i) {
        c.style.transition = "transform .55s cubic-bezier(.22,.61,.36,1) " + (i * 35) + "ms";
        c.style.transform = "";
        c.__flipT = setTimeout(function () { c.style.transition = ""; }, 680 + i * 35);
      });
    }

    // One set's on-screen width (card box + its right margin). Uses the computed WIDTH
    // (unaffected by the stacked cards' rotation, unlike getBoundingClientRect), so it can
    // be estimated BEFORE the fan-out too.
    function setWidth() {
      var cards = realCards();
      if (!cards.length) return 0;
      var cw = parseFloat(getComputedStyle(cards[0]).width) || 280;
      return cards.length * (cw + CARD_MARGIN);
    }
    // Scroll the row when the cards make a full-looking band (≥60% of the viewport);
    // fewer than that just sit centred and still (a 2-card marquee would only repeat).
    function wantsScroll() {
      // the open row is full-bleed (100vw), so gauge against the viewport, not the deck's
      // current width (which is still the collapsed size when open() first asks).
      return !reduce && realCards().length >= 2 && setWidth() >= window.innerWidth * 0.6;
    }

    // Append one inert duplicate of the real set. Clones carry each card's colour
    // inline because nth-child would otherwise recolour the repeats.
    function cloneSet() {
      realCards().forEach(function (c) {
        var cl = c.cloneNode(true);
        cl.setAttribute("data-clone", "");
        cl.setAttribute("aria-hidden", "true");
        cl.setAttribute("tabindex", "-1");
        var cs = getComputedStyle(c);
        cl.style.setProperty("--cbg", cs.getPropertyValue("--cbg").trim());
        cl.style.setProperty("--cfg", cs.getPropertyValue("--cfg").trim());
        track.appendChild(cl);
      });
    }

    // Run the seamless one-directional marquee (ux-india "The Community" deck): clone the
    // set enough times to always cover the viewport through a full one-set shift, then
    // translate by exactly one set width so the loop is gap-free AND seamless. Clones keep
    // each card's colour (nth-child would otherwise recolour the repeats) and are inert.
    function startMarquee() {
      stopMarquee();
      if (!wantsScroll()) return;
      var setW = setWidth();
      var sets = Math.ceil(window.innerWidth / setW) + 1; // >=1 extra set past the viewport
      for (var s = 1; s < sets; s++) cloneSet();
      track.style.setProperty("--marq-shift", Math.round(setW) + "px");
      track.style.setProperty("--marq-dur", Math.max(16, Math.round(setW / 55)) + "s"); // ~55px/sec
      track.classList.add("is-marquee");
    }
    function stopMarquee() {
      track.classList.remove("is-marquee");
      track.style.removeProperty("--marq-shift");
      track.style.removeProperty("--marq-dur");
      clearClones();
    }

    // -- Phones: auto-scroll until you touch it, then you steer -----------
    // Desktop keeps the CSS marquee (wide row, hover pauses it). On a phone only
    // ~1.3 cards are visible and there is no hover, so the marquee alone left no
    // way to reach a project except waiting for it to drift past. Below 680px the
    // row therefore still auto-scrolls on open, but as a NATIVE scroll (the deck's
    // own scrollLeft) rather than a transform animation -- which is what lets the
    // very first swipe or arrow press take over mid-motion. A CSS transform cannot
    // be handed off like that: the next animation frame would overwrite whatever
    // the user did.
    //
    // The hand-off is one-way and permanent, by request: once you interact the
    // drift never returns for that opening (collapsing and re-opening starts it
    // again). Mode is decided when the deck OPENS; rotating mid-open keeps
    // whichever mode it started in, which is why close() clears all of it.
    var MOBILE_MAX = 680;   // keep in sync with ledger.css
    function isManual() { return window.innerWidth <= MOBILE_MAX && realCards().length > 1; }

    var autoRaf = null, autoPrev = 0, taken = false;
    var AUTO_SPEED = 55;   // px/sec -- same pace as the desktop marquee

    // Drift the row by nudging scrollLeft. One cloned set past the end makes the
    // wrap invisible: at exactly one set width we jump back by that amount, and
    // the clone sitting there is pixel-identical to what was just on screen.
    function startAuto() {
      stopAuto();
      if (reduce) return;               // prefers-reduced-motion: no drift at all
      taken = false;
      cloneSet();
      var setW = setWidth();
      autoPrev = 0;
      autoRaf = requestAnimationFrame(function step(ts) {
        if (taken) return;
        if (!autoPrev) autoPrev = ts;
        var dt = (ts - autoPrev) / 1000;
        autoPrev = ts;
        deck.scrollLeft += AUTO_SPEED * dt;
        if (deck.scrollLeft >= setW) deck.scrollLeft -= setW;
        autoRaf = requestAnimationFrame(step);
      });
    }
    function stopAuto() {
      if (autoRaf) cancelAnimationFrame(autoRaf);
      autoRaf = null;
      autoPrev = 0;
    }

    // First swipe / wheel / arrow press hands control over for good.
    function takeOver() {
      if (taken) return;
      taken = true;
      stopAuto();
      // Drop the duplicate set now that nothing loops, keeping the row where the
      // eye left it (scrollLeft can sit past one set width mid-wrap).
      var setW = setWidth();
      var pos = deck.scrollLeft;
      clearClones();
      deck.scrollLeft = setW > 0 ? pos % setW : pos;
      comm.classList.add("is-taken");   // turns on scroll-snap (see ledger.css)
    }

    var nav = null;
    function buildNav() {
      if (nav) return;
      nav = document.createElement("div");
      nav.className = "vl-deck__nav";
      nav.innerHTML =
        '<button type="button" class="vl-deck__arrow" data-vl-prev aria-label="Previous project">←</button>' +
        '<button type="button" class="vl-deck__arrow" data-vl-next aria-label="Next project">→</button>';
      nav.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-vl-prev],[data-vl-next]");
        if (!b) return;
        e.stopPropagation();   // the deck's own click opens cards once open
        takeOver();
        var card = realCards()[0];
        var step = (card ? card.getBoundingClientRect().width : 280) + CARD_MARGIN;
        // Instant, deliberately. Measured in Chrome: a smooth scroll on this
        // container — via behavior:"smooth" OR CSS scroll-behavior — is cancelled
        // and the deck jumps back to 0. A plain scrollBy lands every time.
        deck.scrollBy({ left: b.hasAttribute("data-vl-next") ? step : -step });
      });
      // Sibling of the deck, not a child: the deck is the scroll container and
      // anything inside it would scroll away with the cards.
      deck.parentNode.insertBefore(nav, deck.nextSibling);
    }
    function destroyNav() {
      if (!nav) return;
      nav.remove();
      nav = null;
    }

    function open() {
      var manual = isManual();
      var scroll = !manual && wantsScroll();
      // left-align up front so clones (marquee) / the scroller don't shift the row
      if (manual || scroll) comm.classList.add("is-scroll");
      if (manual) comm.classList.add("is-manual");
      flipDeck(function () { comm.classList.add("is-open"); });
      if (manual) {
        buildNav();
        setTimeout(startAuto, reduce ? 0 : 700);    // let the fan-out settle, then drift
      } else if (scroll) {
        setTimeout(startMarquee, reduce ? 0 : 700); // let the fan-out settle, then scroll
      }
    }
    function close() {
      stopMarquee();
      stopAuto();
      taken = false;
      destroyNav();
      clearClones();
      deck.scrollLeft = 0;
      flipDeck(function () { comm.classList.remove("is-open"); });
      comm.classList.remove("is-scroll");
      comm.classList.remove("is-manual");
      comm.classList.remove("is-taken");
      deck.focus();
    }
    // Touching the row counts as taking over. pointerdown fires before the browser
    // turns the gesture into a scroll, so the drift stops on the FIRST swipe
    // rather than the one after it.
    deck.addEventListener("pointerdown", function () { if (comm.classList.contains("is-manual")) takeOver(); });
    deck.addEventListener("wheel", function () { if (comm.classList.contains("is-manual")) takeOver(); }, { passive: true });
    deck.addEventListener("click", function (e) {
      if (!comm.classList.contains("is-open")) { e.preventDefault(); open(); }
    });
    deck.addEventListener("keydown", function (e) {
      if (comm.classList.contains("is-open")) return;
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); open(); }
    });
    if (collapseBtn) collapseBtn.addEventListener("click", function (e) { e.stopPropagation(); close(); });
  });
  }

  window.LedgerHome = { init: init };
  init();   // in case the markup is already there
})();
