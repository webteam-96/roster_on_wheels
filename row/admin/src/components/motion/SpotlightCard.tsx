"use client";

import { useRef, useCallback, useEffect } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";

/**
 * Card with a mouse-tracked radial spotlight + border highlight. Pure CSS
 * variables — no re-renders on move. Renders children as-is; style the card
 * surface via className.
 *
 * AUTO-SHEEN: on touch devices (hover: none) a single diagonal spotlight
 * sweep plays when the card enters the viewport, so the premium layer is
 * seen once per card without a pointer.
 *
 * `tilt` — bento anchors / featured cards ONLY (never grids): pointer-tracked
 * rotateX/rotateY (max 2.5°) with perspective(900px) and a spring-back on
 * leave. Active only on hover-capable devices; reduced-motion disables it.
 */
export function SpotlightCard({
  children,
  className,
  color = "10, 87, 168", // royal, as "r, g, b"
  tilt = false,
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  /** Spotlight tint as an "r, g, b" string. */
  color?: string;
  /** Pointer-tracked 3D tilt (max 2.5°) — featured cards only. */
  tilt?: boolean;
  as?: React.ElementType;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const tiltOn = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hoverable = window.matchMedia("(hover: hover)").matches;
    tiltOn.current = tilt && hoverable && !reduce;

    // AUTO-SHEEN — one diagonal sweep on viewport entry for touch devices.
    const el = ref.current;
    if (!el || hoverable || reduce) return;
    let played = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (played || !entries.some((e) => e.isIntersecting)) return;
        played = true;
        io.disconnect();
        const r = el.getBoundingClientRect();
        const layers = el.querySelectorAll<HTMLElement>("[data-spot-layer]");
        layers.forEach((d) => (d.style.opacity = "1"));
        const state = { p: -0.15 };
        gsap.to(state, {
          p: 1.15,
          duration: 1.2,
          ease: "power2.inOut",
          onUpdate: () => {
            el.style.setProperty("--spot-x", `${state.p * r.width}px`);
            el.style.setProperty("--spot-y", `${state.p * r.height}px`);
          },
          onComplete: () => layers.forEach((d) => (d.style.opacity = "")),
        });
      },
      { threshold: 0.45 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tilt]);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    el.style.setProperty("--spot-x", `${x}px`);
    el.style.setProperty("--spot-y", `${y}px`);
    if (tiltOn.current) {
      gsap.to(el, {
        rotateY: (x / r.width - 0.5) * 5, // ±2.5°
        rotateX: -(y / r.height - 0.5) * 5,
        transformPerspective: 900,
        duration: 0.35,
        ease: "power2.out",
      });
    }
  }, []);

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el || !tiltOn.current) return;
    gsap.to(el, {
      rotateX: 0,
      rotateY: 0,
      duration: 0.6,
      ease: "elastic.out(1, 0.55)",
      // Release the transform so the card leaves no stacking context at rest.
      onComplete: () => gsap.set(el, { clearProps: "transform" }),
    });
  }, []);

  return (
    <Tag
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn("group/spot relative overflow-hidden", className)}
      style={{ "--spot-x": "50%", "--spot-y": "50%" } as React.CSSProperties}
      {...rest}
    >
      {/* spotlight wash */}
      <div
        aria-hidden
        data-spot-layer
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/spot:opacity-100"
        style={{
          background: `radial-gradient(380px circle at var(--spot-x) var(--spot-y), rgba(${color}, 0.10), transparent 65%)`,
        }}
      />
      {/* border highlight */}
      <div
        aria-hidden
        data-spot-layer
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover/spot:opacity-100"
        style={{
          background: `radial-gradient(240px circle at var(--spot-x) var(--spot-y), rgba(${color}, 0.35), transparent 70%)`,
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "1px",
        }}
      />
      {children}
    </Tag>
  );
}
