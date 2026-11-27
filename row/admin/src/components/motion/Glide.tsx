"use client";

import { useEffect, useRef } from "react";

/**
 * The pill that slides from the old tab or menu item to the new one. Put it first inside a `relative` container;
 * it follows the child marked `data-state="active"` (Radix tabs) or `aria-current="page"` (links). When the whole
 * container mounts with the page, the pill is simply placed, without a slide.
 */
export default function Glide({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const pill = ref.current;
    const box = pill?.parentElement;
    if (!pill || !box) return;
    let placed = false;

    const place = () => {
      const item = box.querySelector<HTMLElement>('[data-state="active"], [aria-current="page"]');
      if (!item || !item.offsetWidth) {
        pill.style.opacity = "0";
        placed = false;
        return;
      }
      pill.style.transition = placed
        ? "transform var(--t-glide) var(--ease-out), width var(--t-glide) var(--ease-out), height var(--t-glide) var(--ease-out)"
        : "none";
      pill.style.opacity = "1";
      pill.style.width = `${item.offsetWidth}px`;
      pill.style.height = `${item.offsetHeight}px`;
      pill.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
      placed = true;
    };

    place();
    const changes = new MutationObserver(place);
    changes.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "aria-current"] });
    const size = new ResizeObserver(place);
    size.observe(box);
    return () => {
      changes.disconnect();
      size.disconnect();
    };
  }, []);

  return <span ref={ref} data-glide aria-hidden="true" className={`pointer-events-none absolute left-0 top-0 opacity-0 ${className}`} />;
}
