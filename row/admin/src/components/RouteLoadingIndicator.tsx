"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";

export default function RouteLoadingIndicator() {
  const [loading, setLoading] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleRouteChangeStart = useCallback(() => {
    setLoading(true);
  }, []);

  useEffect(() => {
    setLoading(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    // Intercept all link clicks and programmatic navigation
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (
        anchor &&
        anchor.href &&
        anchor.href.startsWith(window.location.origin) &&
        !anchor.href.includes("#") &&
        !anchor.hasAttribute("download") &&
        anchor.target !== "_blank"
      ) {
        const url = new URL(anchor.href);
        if (url.pathname !== pathname) {
          handleRouteChangeStart();
        }
      }
    };

    // Intercept pushState/replaceState for programmatic navigation
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
      handleRouteChangeStart();
      return originalPushState(...args);
    };

    history.replaceState = function (...args) {
      handleRouteChangeStart();
      return originalReplaceState(...args);
    };

    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, [pathname, handleRouteChangeStart]);

  if (!loading) return null;

  return (
    <>
      {/* Top loading bar */}
      <div className="fixed top-0 left-0 right-0 z-[100] h-1 bg-primary/20">
        <div className="h-full bg-primary animate-loading-bar" />
      </div>
      {/* Full screen overlay with Rotary logo spinner */}
      <div className="fixed inset-0 z-[99] flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/brand/row-mark.png"
            alt="Loading"
            width={64}
            height={64}
            className="animate-pulse"
            unoptimized
          />
          <p className="text-sm text-muted-foreground font-medium">Loading...</p>
        </div>
      </div>
    </>
  );
}
