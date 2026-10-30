"use client";

/**
 * NavigationLoader — a full-screen overlay spinner shown on every in-app navigation.
 *
 * How it works (App Router has no built-in router events):
 *  - A capture-phase document click listener detects clicks on internal <a>/<Link>
 *    anchors that will actually navigate (same-origin, different path/query, plain
 *    left-click). It shows the overlay immediately so the click feels responsive.
 *  - When the route (pathname or query string) changes, the navigation is done and the
 *    overlay is hidden.
 *  - Also listens for a custom `nav-loader:show` event so programmatic router.push()
 *    call-sites can trigger it, and a safety timeout guarantees the overlay can never
 *    get stuck if a click resolves to no real navigation.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";

export default function NavigationLoader() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafety = () => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  };

  // Route (path or query) changed → navigation finished → hide.
  useEffect(() => {
    setVisible(false);
    clearSafety();
  }, [pathname, searchParams]);

  useEffect(() => {
    const show = () => {
      setVisible(true);
      clearSafety();
      // Safety net: never let the overlay linger if navigation didn't actually happen.
      timeoutRef.current = setTimeout(() => setVisible(false), 12000);
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
      clearSafety();
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <RotaryLoader size="lg" label="Loading…" />
    </div>
  );
}
