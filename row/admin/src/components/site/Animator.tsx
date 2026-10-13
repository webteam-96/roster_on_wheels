"use client";

import { usePathname } from "next/navigation";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { appLocale } from "@/lib/appFormat";
gsap.registerPlugin(useGSAP, ScrollTrigger);

/** Starting offsets for each reveal preset. Elements animate FROM these TO rest. */
const FROM: Record<string, gsap.TweenVars> = {
  /** SETTLE — the site default: short travel, long expo ease. */
  up: { y: 20, opacity: 0 },
  down: { y: -20, opacity: 0 },
  left: { x: -48, opacity: 0 },
  right: { x: 48, opacity: 0 },
  in: { opacity: 0 },
  zoom: { scale: 0.92, opacity: 0 },
  blur: { y: 28, opacity: 0, filter: "blur(10px)" },
  /** HAIRLINE DRAW — gold rule scaleX 0→1 from the left. */
  rule: { scaleX: 0, opacity: 1, transformOrigin: "left center" },
  /** Clip-path wipe, left-to-right — for images and framed media. */
  mask: { clipPath: "inset(0% 100% 0% 0%)", opacity: 1 },
  /** Clip-path wipe, right-to-left — MASK DUET partner for adjacent text. */
  "mask-right": { clipPath: "inset(0% 0% 0% 100%)", opacity: 1 },
  /** Clip-path rise, bottom-to-top — for cards/panels. */
  "mask-up": { clipPath: "inset(100% 0% 0% 0%)", opacity: 1 },
};

const REST: gsap.TweenVars = {
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  opacity: 1,
  filter: "blur(0px)",
  clipPath: "inset(0% 0% 0% 0%)",
};

/** A counter node's in-flight tween, so a new target can re-aim it mid-count. */
type CounterRun = {
  state: { v: number };
  target: number;
  tween: gsap.core.Tween | null;
  /** Reveal gate has fired — until then the count must not start. */
  revealed: boolean;
};

/** Format a number the way it was authored (en-IN grouping preserved via toLocaleString). */
function formatCount(value: number, decimals: number) {
  return value.toLocaleString(appLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Site-wide scroll-animation engine.
 *
 * Reveals: any element tagged `data-animate="up|down|left|right|in|zoom|blur|rule|mask|mask-right|mask-up"`
 * settles in when it scrolls into view. Wrap a group in a parent with
 * `data-animate-stagger[="preset"]` and its tagged children reveal in a staggered sweep.
 * Per-element `data-animate-delay` / `data-animate-duration` (seconds) tune it.
 *
 * Pacing contract: hero moments 1.1–1.2s, content reveals 0.7s, directory/utility
 * rows 0.35s — authored via data-animate-duration; the default is 1.0s SETTLE.
 *
 * Parallax: `data-parallax="0.15"` gives an element a subtle scrubbed vertical drift
 * (fraction of its height) as it moves through the viewport. Use on hero/section media.
 *
 * Counters: `data-counter="428570"` counts the element's text up from 0 when it enters
 * the viewport, then lands with a 0.2s 1.02→1 settle. Optional `data-counter-prefix` /
 * `data-counter-suffix` and `data-counter-decimals`. Authored text is the no-JS fallback.
 * Always pair with `.figure` so digits never jitter width.
 *
 * Robust to client-side interactivity: a MutationObserver buffers `[data-animate]`
 * elements added later (filtered lists, explorers) per animation frame and reveals each
 * batch as ONE stagger group, so nothing pops one-by-one or gets stuck hidden.
 * Respects `prefers-reduced-motion` and re-scans on route changes.
 */
export function Animator() {
  const pathname = usePathname();

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const seen = new WeakSet<HTMLElement>();
      /* Headline splits run once per node — the text is rewritten in place. */
      const split = new WeakSet<HTMLElement>();
      /* One run per counter node, kept so a changed target can re-aim the tween
         in flight instead of starting a second one from 0. */
      const counters = new WeakMap<HTMLElement, CounterRun>();
      const countTo = (
        el: HTMLElement,
        state: { v: number },
        target: number,
        prefix: string,
        suffix: string,
        decimals: number
      ) =>
        gsap.to(state, {
          v: target,
          // Shorter when re-aiming a figure already on screen — the full 1.8s
          // reveal ramp would read as a second intro animation.
          duration: state.v === 0 ? 1.8 : 0.6,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = prefix + formatCount(state.v, decimals) + suffix;
          },
          onComplete: () => {
            el.textContent = prefix + formatCount(target, decimals) + suffix;
            // NUMERAL SETTLE — the figure lands with a barely-there compress.
            gsap.fromTo(
              el,
              { scale: 1.02, transformOrigin: "left bottom" },
              { scale: 1, duration: 0.2, ease: "power2.out", clearProps: "transform" }
            );
          },
        });

      const durationFor = (el: HTMLElement, preset: string) => {
        const fallback = preset === "rule" ? 0.6 : 1.0;
        return parseFloat(el.dataset.animateDuration || "") || fallback;
      };
      const easeFor = (preset: string) =>
        preset.startsWith("mask") ? "power4.inOut" : "expo.out";

      // Reveal gating runs on an IntersectionObserver, NOT cached ScrollTrigger
      // positions: data-driven pages (project grids, filtered directories) shift
      // layout long after positions would be computed, and a stale trigger can
      // point past the reachable scroll range — leaving content hidden forever.
      // The browser recomputes intersections natively on every layout change.
      // An element already scrolled past (top above the viewport) reveals
      // immediately via the initial entry each observe() emits.
      const pendingReveal = new WeakMap<Element, () => void>();
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting && entry.boundingClientRect.top >= 0) continue;
            const run = pendingReveal.get(entry.target);
            if (!run) continue;
            pendingReveal.delete(entry.target);
            io.unobserve(entry.target);
            run();
          }
        },
        { rootMargin: "0px 0px -10% 0px" }
      );
      const arm = (watch: Element, run: () => void) => {
        // Anything already at or above the reveal line plays NOW, synchronously:
        // IntersectionObserver delivery pauses in occluded/background tabs and
        // prerendered pages, and first-viewport content must never wait on it.
        if (watch.getBoundingClientRect().top < window.innerHeight * 0.9) {
          run();
          return;
        }
        pendingReveal.set(watch, run);
        io.observe(watch);
      };

      const revealSingle = (el: HTMLElement) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (reduce) {
          gsap.set(el, { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, clearProps: "filter,clipPath" });
          return;
        }
        const preset = el.dataset.animate || "up";
        const delay = parseFloat(el.dataset.animateDelay || "0") || 0;
        const duration = durationFor(el, preset);
        arm(el, () =>
          gsap.fromTo(el, FROM[preset] ?? FROM.up, {
            ...REST,
            duration: preset.startsWith("mask") ? Math.max(duration, 1.1) : duration,
            delay,
            ease: easeFor(preset),
            // Drop the identity transform once revealed so it doesn't leave a
            // stacking context that would trap popovers/dropdowns inside the card.
            clearProps: "transform,filter,clipPath",
          })
        );
      };

      /**
       * Word-level headline reveal: `data-split` splits the element's text into
       * masked word units that rise in with a stagger. Nested elements (accent
       * spans) are kept intact as single units; <br> is preserved.
       */
      const runSplit = (el: HTMLElement) => {
        if (split.has(el)) return;
        split.add(el);
        if (reduce || el.dataset.splitDone) return;
        const units: HTMLElement[] = [];
        // Mask wrapper with breathing room: descenders (j, y, g) and italic
        // overhangs paint outside the em box, so the clip window is padded and
        // the padding cancelled with negative margins to keep layout intact.
        const makeMask = () => {
          const outer = document.createElement("span");
          outer.style.display = "inline-block";
          outer.style.overflow = "hidden";
          outer.style.verticalAlign = "bottom";
          outer.style.padding = "0.12em 0.1em 0.24em";
          outer.style.margin = "-0.12em -0.1em -0.24em";
          const inner = document.createElement("span");
          inner.style.display = "inline-block";
          outer.appendChild(inner);
          units.push(inner);
          return { outer, inner };
        };
        const wrap = (node: Node): Node => {
          if (node.nodeType === Node.TEXT_NODE) {
            const frag = document.createDocumentFragment();
            const words = (node.textContent || "").split(/(\s+)/);
            words.forEach((w) => {
              if (!w) return;
              if (/^\s+$/.test(w)) {
                frag.appendChild(document.createTextNode(w));
                return;
              }
              const { outer, inner } = makeMask();
              inner.textContent = w;
              frag.appendChild(outer);
            });
            return frag;
          }
          if (node instanceof HTMLElement && node.tagName !== "BR") {
            const { outer, inner } = makeMask();
            inner.appendChild(node.cloneNode(true));
            return outer;
          }
          return node.cloneNode(true);
        };
        const nodes = Array.from(el.childNodes).map(wrap);
        el.textContent = "";
        nodes.forEach((n) => el.appendChild(n));
        el.dataset.splitDone = "1";
        // 130% (not 100%) so the padded clip window never leaks the word
        // while it waits below the mask.
        gsap.set(units, { yPercent: 130 });
        arm(el, () =>
          gsap.to(units, {
            yPercent: 0,
            duration: 0.9,
            ease: "power4.out",
            stagger: 0.055,
            // Once settled, release the clip entirely — fonts that swap in
            // late can shift metrics, and nothing should clip at rest.
            onComplete: () => {
              units.forEach((u) => {
                if (u.parentElement) u.parentElement.style.overflow = "visible";
              });
            },
          })
        );
      };

      const runCounter = (el: HTMLElement) => {
        const target = parseFloat(el.dataset.counter || "");
        if (!isFinite(target)) return;
        const prefix = el.dataset.counterPrefix || "";
        const suffix = el.dataset.counterSuffix || "";
        const decimals = parseInt(el.dataset.counterDecimals || "0", 10) || 0;
        if (reduce) {
          el.textContent = prefix + formatCount(target, decimals) + suffix;
          return;
        }
        // A figure whose data-counter changes (filters applied, a slower total
        // landing after the first paint) RE-AIMS the running tween from where it
        // is now. Restarting at 0 is what made the strip visibly count up, drop
        // back and count again while the API answers trickled in.
        const live = counters.get(el);
        if (live) {
          if (live.target === target) return;
          live.target = target;
          // Below the fold and never revealed: the armed run reads .target when
          // it fires, so re-aiming now would count a figure nobody has seen yet
          // AND leave a second tween running once the reveal did fire.
          if (!live.revealed) return;
          live.tween?.kill();
          live.tween = countTo(el, live.state, target, prefix, suffix, decimals);
          return;
        }
        const entry: CounterRun = { state: { v: 0 }, target, tween: null, revealed: false };
        counters.set(el, entry);
        arm(el, () => {
          entry.revealed = true;
          // The target can move between arming and reveal — read it fresh, and
          // never leave an earlier tween running alongside this one.
          entry.tween?.kill();
          entry.tween = countTo(el, entry.state, entry.target, prefix, suffix, decimals);
        });
      };

      const runParallax = (el: HTMLElement) => {
        if (reduce) return;
        const speed = parseFloat(el.dataset.parallax || "0.15") || 0.15;
        gsap.fromTo(
          el,
          { yPercent: -speed * 100 * 0.5 },
          {
            yPercent: speed * 100 * 0.5,
            ease: "none",
            scrollTrigger: {
              trigger: el.parentElement ?? el,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.6,
            },
          }
        );
      };

      // Grouped, staggered reveals (static groups present at scan time).
      const groups = gsap.utils.toArray<HTMLElement>("[data-animate-stagger]");
      groups.forEach((group) => {
        const items = gsap.utils
          .toArray<HTMLElement>("[data-animate]")
          .filter((el) => el.closest("[data-animate-stagger]") === group && !seen.has(el));
        if (!items.length) return;
        items.forEach((el) => seen.add(el));
        if (reduce) {
          gsap.set(items, { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, clearProps: "filter" });
          return;
        }
        const preset = group.dataset.animateStagger || items[0].dataset.animate || "up";
        arm(group, () =>
          gsap.fromTo(items, FROM[preset] ?? FROM.up, {
            ...REST,
            duration: 0.7,
            ease: easeFor(preset),
            stagger: 0.09,
            // Drop the identity transform once revealed so it doesn't leave a
            // stacking context that would trap popovers/dropdowns inside the
            // card — and the identity clip-path, which would clip ring/shadow
            // (box-shadow paints outside the border box) on revealed cards.
            clearProps: "transform,filter,clipPath",
          })
        );
      });

      // Individual reveals for everything not inside a stagger group.
      gsap.utils
        .toArray<HTMLElement>("[data-animate]")
        .filter((el) => !el.closest("[data-animate-stagger]"))
        .forEach(revealSingle);

      // Counters, parallax & headline splits.
      gsap.utils.toArray<HTMLElement>("[data-counter]").forEach(runCounter);
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach(runParallax);
      gsap.utils.toArray<HTMLElement>("[data-split]").forEach(runSplit);

      // BATCHED REVEAL — safety net for `[data-animate]` elements inserted after
      // the initial scan (client-side filtering, pagination). Added nodes are
      // buffered per animation frame and revealed as ONE stagger group, so a
      // re-filtered directory sweeps in instead of popping row by row.
      let buffer: HTMLElement[] = [];
      let raf = 0;
      const flushBatch = () => {
        raf = 0;
        const batch = buffer.filter((el) => !seen.has(el) && el.isConnected);
        buffer = [];
        if (!batch.length) return;
        batch.forEach((el) => seen.add(el));
        if (reduce) {
          gsap.set(batch, { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, clearProps: "filter,clipPath" });
          return;
        }
        const preset = batch[0].dataset.animate || "up";
        gsap.fromTo(batch, FROM[preset] ?? FROM.up, {
          ...REST,
          duration: 0.5,
          ease: easeFor(preset),
          stagger: 0.04,
          clearProps: "transform,filter,clipPath",
        });
      };
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          // A figure that re-aims in place (filters, a late total) mutates its
          // data-counter rather than remounting — re-run it against the new value.
          if (m.type === "attributes") {
            if (m.target instanceof HTMLElement) runCounter(m.target);
            continue;
          }
          m.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.matches?.("[data-animate]")) buffer.push(node);
            node.querySelectorAll?.<HTMLElement>("[data-animate]").forEach((el) => buffer.push(el));
            const counters: HTMLElement[] = [];
            if (node.matches?.("[data-counter]")) counters.push(node);
            node.querySelectorAll?.<HTMLElement>("[data-counter]").forEach((el) => counters.push(el));
            counters.forEach(runCounter);
          });
        }
        if (buffer.length && !raf) raf = requestAnimationFrame(flushBatch);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-counter"],
      });

      // Recalculate once late-loading images settle the layout.
      const onLoad = () => ScrollTrigger.refresh();
      window.addEventListener("load", onLoad, { once: true });
      const t = window.setTimeout(() => ScrollTrigger.refresh(), 350);

      // Late layout shifts (fetch-driven grids, skeleton swaps, filters) move
      // content after scrubbed triggers (parallax, marquees, pins) cached their
      // positions. Refresh when the document height genuinely changes, at most
      // every 300ms so refresh-induced reflow can't feed back into a storm.
      let lastHeight = document.documentElement.scrollHeight;
      let lastRefresh = 0;
      const resizeObserver = new ResizeObserver(() => {
        const h = document.documentElement.scrollHeight;
        const now = performance.now();
        if (Math.abs(h - lastHeight) > 24 && now - lastRefresh > 300) {
          lastHeight = h;
          lastRefresh = now;
          ScrollTrigger.refresh();
        }
      });
      resizeObserver.observe(document.body);

      return () => {
        observer.disconnect();
        resizeObserver.disconnect();
        io.disconnect();
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener("load", onLoad);
        window.clearTimeout(t);
      };
    },
    { dependencies: [pathname], revertOnUpdate: true }
  );

  return null;
}
