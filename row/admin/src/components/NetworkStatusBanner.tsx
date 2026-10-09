"use client";

import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/**
 * Global "network down" indicator (web only).
 *
 * Listens to the browser's online/offline events (device-level connectivity) and
 * shows a fixed banner while offline, plus a brief "Back online" confirmation when
 * connectivity returns. This is the coarse, instant half of the network handling;
 * the axios interceptor in services/api.ts covers the "server unreachable / request
 * timed out" case (which navigator.onLine can't see) with a toast.
 *
 * Rendered once, near the root (layout.tsx). Renders nothing while online.
 */
export default function NetworkStatusBanner() {
  const [online, setOnline] = useState(true);
  const [showBackOnline, setShowBackOnline] = useState(false);

  useEffect(() => {
    // Sync with the real state on mount (default true above avoids an offline flash during SSR/hydration).
    setOnline(navigator.onLine);

    const goOffline = () => {
      setOnline(false);
      setShowBackOnline(false);
    };
    const goOnline = () => {
      setOnline(true);
      setShowBackOnline(true);
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Auto-hide the "Back online" confirmation after a few seconds.
  useEffect(() => {
    if (!showBackOnline) return;
    const t = setTimeout(() => setShowBackOnline(false), 3000);
    return () => clearTimeout(t);
  }, [showBackOnline]);

  if (online && !showBackOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 inset-x-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white shadow-md ${
        online ? "bg-emerald-600" : "bg-rose-600"
      }`}
    >
      {online ? (
        <>
          <Wifi className="h-4 w-4" /> Back online
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" /> You are offline — check your internet connection.
        </>
      )}
    </div>
  );
}
