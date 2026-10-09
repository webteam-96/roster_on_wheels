"use client";

/**
 * NavigationProgress
 * --------------------------------------------------------------------------
 * Thin animated progress bar pinned to the top of the viewport that appears
 * during Next.js client-side route transitions and disappears when the new
 * route has rendered.
 *
 * Designed for the Club Admin dashboard tabs where data is prefetched into
 * cache — the bar gives a hint that something is happening on each tab click
 * without obscuring the page with a full-screen overlay.
 *
 * Mechanism: intercept link clicks to flip loading on; flip off whenever the
 * pathname / searchParams actually change.
 *
 * NOTE: We deliberately do NOT monkey-patch history.pushState/replaceState.
 * The Next.js 14 App Router calls history.replaceState internally for scroll
 * restoration / RSC streaming URL sync without an actual route change, which
 * would set loading=true forever (no path change → no reset). Anchor-click
 * interception covers tab navigation; a safety timeout covers anything else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Safety net: if pathname/searchParams haven't changed after this long, hide.
const SAFETY_TIMEOUT_MS = 4000;

export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    setLoading(true);
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(() => {
      setLoading(false);
      safetyTimerRef.current = null;
    }, SAFETY_TIMEOUT_MS);
  }, [clearSafetyTimer]);

  // Bar disappears once the route has actually changed.
  useEffect(() => {
    setLoading(false);
    clearSafetyTimer();
  }, [pathname, searchParams, clearSafetyTimer]);

  // Cleanup safety timer on unmount.
  useEffect(() => {
    return () => clearSafetyTimer();
  }, [clearSafetyTimer]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Respect modifier-keys / aux clicks — those don't trigger an SPA nav.
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor || !anchor.href) return;
      if (!anchor.href.startsWith(window.location.origin)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href);
      // Same URL (incl. hash-only / query-only no-ops) → no route change.
      if (url.pathname === pathname && url.search === window.location.search) {
        return;
      }
      start();
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, [pathname, start]);

  if (!loading) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-[3px] bg-primary/15"
      aria-hidden="true"
    >
      <div className="animate-loading-bar h-full bg-primary" />
    </div>
  );
}
