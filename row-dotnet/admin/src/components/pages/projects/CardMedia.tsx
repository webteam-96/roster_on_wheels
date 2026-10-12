"use client";

import { useState } from "react";

/**
 * Project image that degrades cleanly when the file is missing. Photo rows can
 * reference files that were never written to the server, and a broken img would
 * otherwise leave a blank strip (or the alt text) where the picture should be.
 *
 * On error the whole block is removed so the layout reflows — unless keepFrame
 * is set, which keeps the sized wrapper (for heroes whose title panel overlays
 * it) and drops only the image.
 *
 * Fit is decided from the loaded image: every frame here is a LANDSCAPE box
 * (16:9 cards, a 16:6 hero), so a landscape photo keeps the intended edge-to-edge
 * `object-cover` crop, while a portrait or square upload — now allowed by the
 * crop dialog — switches to `object-contain` so it is shown whole instead of
 * having its top and bottom sliced off.
 */
export function CardMedia({
  src,
  className,
  alt = "",
  keepFrame = false,
  eager = false,
}: {
  src: string;
  className?: string;
  alt?: string;
  keepFrame?: boolean;
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const [tall, setTall] = useState(false);
  // Anything not clearly wider than it is tall (portrait, square, near-square)
  // loses too much to a landscape-box crop, so it is contained instead.
  const measure = (el: HTMLImageElement) => {
    if (el.naturalWidth > 0 && el.naturalWidth / el.naturalHeight < 1.1) setTall(true);
  };
  // The error can fire before hydration (server-rendered img, eager load), so
  // onError alone can miss it — the mount ref re-checks the settled state.
  const checkRef = (el: HTMLImageElement | null) => {
    if (!el || !el.complete) return;
    if (el.naturalWidth === 0) setBroken(true);
    else measure(el);
  };
  if (broken && !keepFrame) return null;
  return (
    <div className={className}>
      {!broken && (
        /* Sources vary by API host — plain img keeps unknown domains working. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          ref={checkRef}
          src={src}
          alt={alt}
          loading={eager ? undefined : "lazy"}
          className={`h-full w-full ${tall ? "bg-paper-200 object-contain" : "object-cover"}`}
          onLoad={(e) => measure(e.currentTarget)}
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}
