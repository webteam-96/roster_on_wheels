"use client";

/**
 * NavigationLoader: a thin bar at the top of the window while the next page loads. The page in front stays on screen
 * and softens (globals.css `html[data-navigating]`); it used to be covered by a full-screen loader on every click.
 *
 * How it works (App Router has no built-in router events):
 *  - A capture-phase document click listener detects clicks on internal <a>/<Link> anchors that will actually
 *    navigate (same-origin, different path/query, plain left-click). The bar starts after a short pause, so a page
 *    that is already loaded changes without any flicker.
 *  - When the route (pathname or query string) changes, the bar completes and fades.
 *  - Also listens for a custom `nav-loader:show` event so programmatic router.push() call-sites can trigger it, and
 *    a safety timeout guarantees the bar can never get stuck if a click resolves to no real navigation.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Phase = "idle" | "loading" | "done";

const START_DELAY_MS = 90;
const FADE_MS = 400;

export default function NavigationLoader() {
  const [phase, setPhase] = useState<Phase>("idle");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const startRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (startRef.current) clearTimeout(startRef.current);
    if (safetyRef.current) clearTimeout(safetyRef.current);
    startRef.current = safetyRef.current = null;
  };

  // Route (path or query) changed: navigation finished.
  useEffect(() => {
    clearTimers();
    setPhase((p) => (p === "loading" ? "done" : p));
  }, [pathname, searchParams]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-navigating", phase === "loading");
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    const show = () => {
      clearTimers();
      startRef.current = setTimeout(() => setPhase("loading"), START_DELAY_MS);
      // Safety net: never let the bar linger if navigation didn't actually happen.
      safetyRef.current = setTimeout(() => setPhase("idle"), 12000);
    };

    const onClick = (e: MouseEvent) => {
      // Ignore modified clicks (open-in-new-tab), non-primary buttons, prevented clicks.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      // New tab / download / non-navigational schemes.
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      let url: URL;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return; // external site

      // Same path + query → not a real navigation (won't fire a route change).
      const current = window.location.pathname + window.location.search;
      const next = url.pathname + url.search;
      if (next === current) return;

      show();
    };

    const onCustomShow = () => show();

    document.addEventListener("click", onClick, true); // capture phase
    window.addEventListener("nav-loader:show", onCustomShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("nav-loader:show", onCustomShow);
      clearTimers();
      document.documentElement.removeAttribute("data-navigating");
    };
  }, []);

  if (phase === "idle") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]" role="status" aria-busy={phase === "loading"}>
      <span className="sr-only">Loading</span>
      <div className="row-nav-bar h-full bg-marigold" data-done={phase === "done" ? "" : undefined} />
    </div>
  );
}
