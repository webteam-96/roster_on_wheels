"use client";

import { useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Lightbox } from "@/components/motion/Lightbox";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * FILMSTRIP SCRUB — one horizontal gallery strip (h-72, natural widths) on
 * native overflow-x scrolling with snap, so touch users simply swipe. While
 * the strip crosses the viewport it drifts gently left (scrubbed); reduced
 * motion drops the drift and keeps the swipe. Clicking/activating a frame
 * opens the shared-element Lightbox.
 */
export function Filmstrip({
  images,
  className,
}: {
  images: { src: string; caption?: string }[];
  className?: string;
}) {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  // Photo rows can reference files missing from the server — drop those frames
  // instead of showing broken images.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const prefix = `film-${uid}`;
  const shown = images.filter((img) => !broken.has(img.src));
  const markBroken = (src: string) =>
    setBroken((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (!track.current || !root.current) return;
      gsap.fromTo(
        track.current,
        { xPercent: 0 },
        {
          xPercent: -8,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.6,
          },
        }
      );
    },
    { scope: root }
  );

  if (!shown.length) return null;

  return (
    <div ref={root} className={cn("relative", className)}>
      <div className="snap-x snap-proximity overflow-x-auto pb-3">
        <div ref={track} className="flex h-72 w-max items-stretch gap-3 will-change-transform">
          {shown.map((img, i) => (
            <motion.button
              key={img.src}
              type="button"
              layoutId={`${prefix}-${i}`}
              onClick={() => setIndex(i)}
              aria-label={img.caption ? `View: ${img.caption}` : `View image ${i + 1} of ${shown.length}`}
              className="media-grade h-full shrink-0 cursor-zoom-in snap-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2"
            >
              {/* Sources vary by API host — plain img keeps unknown domains working
                  and preserves each frame's natural width at h-72. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                // The error can fire before hydration — the mount ref re-checks
                // the settled state onError alone would miss.
                ref={(el) => {
                  if (el && el.complete && el.naturalWidth === 0) markBroken(img.src);
                }}
                src={img.src}
                alt={img.caption ?? ""}
                loading="lazy"
                className="h-full w-auto max-w-none rounded-xl object-cover"
                onError={() => markBroken(img.src)}
              />
            </motion.button>
          ))}
        </div>
      </div>

      <Lightbox
        images={shown}
        // Clamp: a frame erroring out while the viewer is open must not leave
        // it pointing past the end — that would strand the page scroll-locked
        // with no dialog rendered.
        index={index === null || !shown.length ? null : Math.min(index, shown.length - 1)}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
        layoutIdPrefix={prefix}
      />
    </div>
  );
}
