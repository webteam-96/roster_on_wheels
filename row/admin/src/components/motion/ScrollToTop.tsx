"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Force scroll to top on route change. Framer Motion's AnimatePresence in
 * PageTransition suppresses Next's built-in scroll-to-top, stranding you at the
 * previous page's scroll depth (e.g. the footer). Respects in-page hash links.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
