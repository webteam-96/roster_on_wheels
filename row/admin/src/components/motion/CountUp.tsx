"use client";

import { useLayoutEffect, useRef } from "react";
import { countUpFrame } from "./countUpFrame";

const MS = 700;

/** A formatted number that counts up when it appears or changes. The last frame is the exact value; reduced motion,
 *  and values that are not one number, show it straight away. */
export default function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const text = ref.current?.firstChild;
    if (!text || countUpFrame(value, 0) === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    text.nodeValue = countUpFrame(value, 0); // before the first paint, so the full value never flashes
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / MS));
      text.nodeValue = countUpFrame(value, 1 - Math.pow(1 - p, 4));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      text.nodeValue = value;
    };
  }, [value]);

  return <span ref={ref}>{value}</span>;
}
