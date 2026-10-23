"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getFeatures, type PlatformFeature } from "@/services/api";

// Platform module switches (api/Services/FeatureGate.cs). A skipped module, or a flagged one that is off, has every
// link to it hidden and its pages send the user to the role home ("/"). The API refuses its calls too.

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

/** True only once the switches have loaded and the module is on: gate a flagged module's API calls with this,
 *  so nothing calls an off module while the switches are still loading. */
export function useFeatureLoadedOn(key: string): boolean {
  const f = useContext(FeaturesContext)?.find((x) => x.key === key);
  return !!f && f.kind === "flagged" && f.enabled;
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
  const router = useRouter();
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
  const blocked = isBlocked(pathname, patterns);

  // A typed or bookmarked URL to an off module goes home instead of loading a page whose API calls would fail.
  useEffect(() => {
    if (blocked) router.replace("/");
  }, [blocked, router]);

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
      {blocked ? null : children}
    </FeaturesContext.Provider>
  );
}
