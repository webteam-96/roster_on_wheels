"use client";

import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { ArrowRight } from "@/components/icons";
import Galaxy from "@/components/motion/Galaxy";

const STRIP = ["Service Above Self", "People of Action", "One Fellowship", "Est. 1920"];

/**
 * ORBIT hero, space register — deep blue-to-black sky with golden stars,
 * bold cream statement left, the living emblem right: the zones in constant
 * motion around the golden wheel.
 */
export function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="relative flex min-h-[calc(100svh-var(--chrome-h))] flex-col overflow-hidden bg-midnight text-cream">
      {/* Galaxy star field (React Bits, WebGL) — tuned toward golden stars */}
      <div aria-hidden className="absolute inset-0">
        <Galaxy
          density={1.2}
          hueShift={45}
          saturation={0.85}
          glowIntensity={0.35}
          twinkleIntensity={0.6}
          starSpeed={0.3}
          rotationSpeed={0.03}
          repulsionStrength={1.5}
          disableAnimation={!!reduce}
        />
      </div>

      <div className="container-wide relative flex flex-1 flex-col items-center justify-center gap-8 py-12 text-center">
        {/* Statement */}
        <div className="flex flex-col items-center">
          <span data-animate="rule" className="rule-gold" />
          <p data-animate="up" className="eyebrow-light mt-4">
            Rotary International · the zones
          </p>
          <h1
            data-animate="up"
            data-animate-delay="0.08"
            data-animate-duration="1.1"
            className="mt-5 font-sans text-[clamp(2.8rem,5.6vw,4.8rem)] font-extrabold leading-[1.02] tracking-[-0.03em] text-cream"
          >
            One fellowship.
            <br />
            <em className="accent-serif text-glow-gold">Endless impact.</em>
          </h1>
          <p
            data-animate="up"
            data-animate-delay="0.18"
            className="mt-6 max-w-xl text-[15px] leading-relaxed text-cream/75 sm:text-base"
          >
            180,000 people of action across the zones: building
            schools, clean water, health and peace where they&apos;re needed most.
          </p>
          <div
            data-animate="up"
            data-animate-delay="0.3"
            className="mt-9 flex flex-wrap items-center justify-center gap-4"
          >
            <Link href="/projects" className="btn-primary group">
              Explore Our Projects
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <Link href="/websites" className="btn-ghost-dark">
              District &amp; Club Websites
            </Link>
          </div>
        </div>
      </div>

      {/* Credential strip — pinned to the fold, crisp hairline, gold stars */}
      <div className="container-wide relative">
        <div
          data-animate="up"
          data-animate-delay="0.45"
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-cream/15 py-5"
        >
          {STRIP.map((n, i) => (
            <span key={n} className="flex items-center gap-6">
              {i > 0 && (
                <span aria-hidden className="text-[10px] text-gold">
                  ✦
                </span>
              )}
              <span className="text-[12px] font-semibold uppercase tracking-[0.2em] text-cream/60">
                {n}
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
