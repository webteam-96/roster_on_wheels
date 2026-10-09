"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * SCROLL-SPY RAIL — 240px sticky left rail for long-read pages (leaders,
 * forms, detail pages). Each item's id must match a section id on the page.
 * A 2px gold progress line scrubs with overall progress through the chapters;
 * the active link gets gold text + a translated marker. Hidden below lg.
 */
export function ChapterRail({
  items,
  className,
}: {
  items: { id: string; label: string }[];
  className?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  // Scroll-spy: the active chapter is the last one whose top has crossed a
  // line 45% down the viewport — recomputed live from getBoundingClientRect
  // (NOT cached positions: leader photos load late and reveal animations shift
  // layout). An IntersectionObserver with a zero-height band at that 45% line
  // drives the recompute: it fires only when a section edge crosses the line
  // (not on every scroll frame), is compositor-driven so it stays reliable
  // under heavy animation load, and re-fires automatically when late images or
  // reveals move a section across the line. `resize` is kept because the band
  // is viewport-relative.
  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => !!el);
    if (!sections.length) return;
    const update = () => {
      const line = window.innerHeight * 0.45;
      let current = sections[0].id;
      for (const sec of sections) {
        if (sec.getBoundingClientRect().top <= line) current = sec.id;
      }
      setActive(current);
    };
    const io = new IntersectionObserver(update, {
      rootMargin: "-45% 0px -55% 0px",
      threshold: 0,
    });
    sections.forEach((sec) => io.observe(sec));
    update();
    window.addEventListener("resize", update);
    return () => {
      io.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [items]);

  // Native anchor jump: scrollIntoView targets the element itself (not a pixel
  // fixed at click time) and honours the target's scroll-margin-top for the
  // sticky-header offset. ALWAYS instant — smooth scrolling here has broken
  // three times now: a custom rAF scroller fought scroll-behavior, and
  // behavior:"smooth" gets cancelled by mid-flight layout shifts (late images,
  // reveal animations) and paused by tab occlusion. Instant cannot be
  // interrupted and always lands exactly on the target.
  const jumpTo = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "auto", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  useGSAP(
    () => {
      const sections = items
        .map((i) => document.getElementById(i.id))
        .filter((el): el is HTMLElement => !!el);
      if (!sections.length) return;

      // Gold progress line, scrubbed across the whole chapter span.
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (progress.current && !reduce) {
        gsap.fromTo(
          progress.current,
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: "none",
            transformOrigin: "top center",
            scrollTrigger: {
              trigger: sections[0],
              endTrigger: sections[sections.length - 1],
              start: "top 55%",
              end: "bottom 55%",
              scrub: 0.4,
            },
          }
        );
      }
    },
    { scope: root, dependencies: [items] }
  );

  return (
    <nav
      ref={root}
      aria-label="On this page"
      className={cn("hidden w-[240px] shrink-0 lg:sticky lg:top-24 lg:block lg:self-start", className)}
    >
      <div className="relative pl-5">
        <div aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded bg-navy-950/10" />
        <div
          ref={progress}
          aria-hidden
          className="absolute bottom-1 left-0 top-1 w-0.5 origin-top scale-y-0 rounded bg-gold"
        />
        <ul className="space-y-1">
          {items.map((it) => {
            const isActive = active === it.id;
            return (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  onClick={(e) => jumpTo(e, it.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] font-medium transition-all duration-300 motion-reduce:transition-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark",
                    isActive
                      ? "translate-x-1 font-semibold text-gold-deep"
                      : "text-muted hover:text-navy-950"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-px w-3 shrink-0 bg-gold transition-all duration-300 motion-reduce:transition-none",
                      isActive ? "translate-x-0 opacity-100" : "-translate-x-1.5 opacity-0"
                    )}
                  />
                  {it.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
