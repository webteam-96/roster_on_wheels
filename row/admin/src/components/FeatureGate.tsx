"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getFeatures, type PlatformFeature } from "@/services/api";

// Platform module switches (api/Services/FeatureGate.cs). A skipped module, or a flagged one that is off, has its
// pages replaced by a notice and every link to it hidden. The API refuses its calls too, so this is only the view.

export function offPatterns(features: PlatformFeature[]): RegExp[] {
  return features.filter((f) => f.kind === "skipped" || !f.enabled).flatMap((f) => f.adminPaths.map((p) => new RegExp(p, "i")));
}

export function isBlocked(path: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(path));
}

const FeaturesContext = createContext<PlatformFeature[] | null>(null);

/** True when the module is usable; also true while the switches are still loading, so nothing flickers away. */
export function useFeatureOn(key: string): boolean {
  const f = useContext(FeaturesContext)?.find((x) => x.key === key);
  return !f || (f.kind === "flagged" && f.enabled);
}

/** For menus that navigate with buttons: true when the admin path belongs to an off module. */
export function useIsPathOff(): (path: string) => boolean {
  const features = useContext(FeaturesContext);
  const patterns = useMemo(() => offPatterns(features ?? []), [features]);
  return (path) => isBlocked(path, patterns);
}

export default function FeatureGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();
  const [features, setFeatures] = useState<PlatformFeature[] | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const load = () => getFeatures().then(setFeatures).catch(() => setFeatures(null));
    load();
    // Settings > Features announces a change so the menus update without a reload
    window.addEventListener("row:features-changed", load);
    return () => window.removeEventListener("row:features-changed", load);
  }, [isAuthenticated]);

  const patterns = useMemo(() => offPatterns(features ?? []), [features]);

  // Links are spread over many menus, tab bars and cards: hide them all from one place.
  // shortcut: buttons that navigate with router.push are not hidden, the page notice below catches them.
  useEffect(() => {
    const hide = () =>
      document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
        const off = a.origin === window.location.origin && isBlocked(a.pathname, patterns);
        if (off) {
          a.style.display = "none";
          a.dataset.featureOff = "1";
        } else if (a.dataset.featureOff) {
          a.style.display = "";
          delete a.dataset.featureOff;
        }
      });
    hide();
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(hide);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [patterns]);

  return (
    <FeaturesContext.Provider value={features}>
      {isBlocked(pathname, patterns) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h3 className="text-lg font-semibold">Not available</h3>
          <p className="text-muted-foreground mt-2">This module is not part of ROW, or it is switched off.</p>
        </div>
      ) : (
        children
      )}
    </FeaturesContext.Provider>
  );
}
