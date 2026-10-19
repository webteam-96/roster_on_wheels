"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "@/components/icons";

/**
 * LIGHTBOX ZOOM — full-screen dark-glass viewer. Pair each thumbnail with a
 * framer-motion `layoutId` of `${layoutIdPrefix}-${i}` (Filmstrip does this
 * for you) and the image expands from its frame as a shared element.
 * Escape / backdrop close, prev-next (buttons + arrow keys), focus trapped,
 * body scroll locked while open.
 */
export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
  layoutIdPrefix = "lightbox",
}: {
  images: { src: string; caption?: string }[];
  /** Open image index, or null when closed. */
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  layoutIdPrefix?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const open = index !== null;
  // Reduced motion: no shared-element zoom (layoutId dropped) and instant
  // backdrop — the viewer simply appears/disappears.
  const reduce = useReducedMotion();

  // Scroll lock + focus management + keyboard while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open]);

  const step = (dir: 1 | -1) => {
    if (index === null || images.length < 2) return;
    onIndexChange((index + dir + images.length) % images.length);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "Tab") {
      // Focus trap: cycle within the dialog's controls.
      const focusables = dialog.current?.querySelectorAll<HTMLElement>("button");
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const img = index !== null ? images[index] : null;

  return (
    <AnimatePresence>
      {open && img && (
        <motion.div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label={img.caption || "Image viewer"}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.25 }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-midnight/85 p-4 backdrop-blur-xl focus:outline-none sm:p-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close image viewer"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-cream ring-1 ring-cream/25 transition-colors hover:bg-cream/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <X className="h-5 w-5" />
          </button>

          {images.length > 1 && (
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous image"
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-midnight/60 text-cream ring-1 ring-cream/25 transition-colors hover:bg-cream/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:left-6"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <motion.figure
            key={index}
            layoutId={reduce ? undefined : `${layoutIdPrefix}-${index}`}
            transition={
              reduce ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }
            }
            className="pointer-events-none flex max-h-full max-w-full flex-col items-center"
          >
            {/* Sources vary by API host — plain img keeps unknown domains working. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.src}
              alt={img.caption ?? ""}
              className="max-h-[78svh] max-w-full rounded-xl object-contain shadow-lift"
            />
            {img.caption && (
              <figcaption className="mt-4 max-w-xl text-center text-[14px] leading-relaxed text-cream/75">
                {img.caption}
              </figcaption>
            )}
          </motion.figure>

          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-midnight/60 text-cream ring-1 ring-cream/25 transition-colors hover:bg-cream/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:right-6"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <p className="figure absolute bottom-4 text-[12px] text-cream/60">
                {(index ?? 0) + 1} / {images.length}
              </p>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
