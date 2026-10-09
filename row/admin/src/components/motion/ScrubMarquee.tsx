"use client";

import { Fragment, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Giant word strip scrubbed to scroll. The text drifts horizontally as the
 * strip crosses the viewport — ease "none", tied 1:1 to scroll.
 *
 * `serif` — the ONE site-wide marquee voice (home + about only): Fraunces
 * italic 340, mixed case, hairline-navy outline on light (cream on dark).
 * `chips` — 40px circular photo chips rendered inline between repeats.
 *
 * Respects prefers-reduced-motion (renders static).
 */
export function ScrubMarquee({
  text,
  outline = false,
  dark = false,
  serif = false,
  chips,
  className,
}: {
  text: string;
  /** Stroked (outlined) letters instead of faint solid fill. */
  outline?: boolean;
  /** Set when the marquee sits on a dark band (cream strokes instead of navy). */
  dark?: boolean;
  /** Fraunces italic 340 voice, mixed case, hairline outline. */
  serif?: boolean;
  /** Photo chip srcs (40px circles) shown between phrase repeats. */
  chips?: string[];
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (!track.current || !root.current) return;
      gsap.fromTo(
        track.current,
        { xPercent: 4 },
        {
          xPercent: -22,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.5,
          },
        }
      );
    },
    { scope: root }
  );

  const words = Array.from({ length: 3 }, () => text);

  const phraseClass = serif
    ? cn(
        "font-display font-[340] italic leading-none tracking-[-0.01em] text-[clamp(5rem,8vw,7rem)]",
        dark ? "text-outline-cream" : "text-outline-ink"
      )
    : cn(
        "font-display text-[clamp(4rem,11vw,10rem)] font-extrabold uppercase leading-none tracking-tight",
        outline
          ? dark
            ? "text-outline-cream"
            : "text-outline-ink"
          : dark
            ? "text-cream/[0.06]"
            : "text-navy-950/[0.06]"
      );

  return (
    <div
      ref={root}
      aria-hidden
      className={cn("pointer-events-none select-none overflow-hidden py-6 lg:py-10", className)}
    >
      <div
        ref={track}
        className="flex w-max items-center gap-10 whitespace-nowrap will-change-transform"
      >
        {words.map((w, i) => (
          <Fragment key={i}>
            <span className={phraseClass}>{w}</span>
            {chips?.length ? (
              <span className="inline-flex items-center gap-3">
                {chips.map((src, j) => (
                  <Image
                    key={j}
                    src={src}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-cover ring-1 ring-navy-950/10"
                  />
                ))}
              </span>
            ) : (
              <span
                className={cn(
                  "inline-block rounded-full",
                  serif ? "h-1.5 w-6 bg-gold/60" : "h-3 w-3 bg-gold/50"
                )}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
