"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getFeatures, type PlatformFeature } from "@/services/api";
import DashboardTabSkeleton from "@/components/dashboard/DashboardSkeleton";

// Platform module switches (api/Services/FeatureGate.cs). A skipped module, or a flagged one that is off, has every
// link to it hidden and its pages send the user to the role home ("/admin"). The API refuses its calls too.

export function offPatterns(features: PlatformFeature[]): RegExp[] {
  return features.filter((f) => f.kind === "skipped" || !f.enabled).flatMap((f) => f.adminPaths.map((p) => new RegExp(p, "i")));
}

export function isBlocked(path: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(path));
}

/** Signed-in pages wait for the switches, so a page of an off module never mounts and calls its API first. The page
 *  shown before sign-in (the login form and its temporary-password dialog) stays up while they load. */
export function holdPage(authLoading: boolean, signedIn: boolean, switchesLoaded: boolean, path: string, signInPath: string | null): boolean {
  return authLoading || (signedIn && !switchesLoaded && path !== signInPath);
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
  const { isAuthenticated, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [features, setFeatures] = useState<PlatformFeature[] | null>(null);
  const signInPath = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) signInPath.current = pathname;
  }, [loading, isAuthenticated, pathname]);

  useEffect(() => {
    if (!isAuthenticated) return;
    // On failure keep what is known; with nothing known pages show (fail open: the API still refuses off modules).
    const load = () => getFeatures().then(setFeatures).catch(() => setFeatures((f) => f ?? []));
    load();
    // Settings > Features announces a change so the menus update without a reload
    window.addEventListener("row:features-changed", load);
    return () => window.removeEventListener("row:features-changed", load);
  }, [isAuthenticated]);

  const patterns = useMemo(() => offPatterns(features ?? []), [features]);
  const blocked = isBlocked(pathname, patterns);
  const waiting = holdPage(loading, isAuthenticated, features !== null, pathname, signInPath.current);

  // A typed or bookmarked URL to an off module goes home instead of loading a page whose API calls would fail.
  // "/admin" is the role home; "/" is the public site, which sends a signed-in user to the login page.
  useEffect(() => {
    if (blocked) router.replace("/admin");
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
      {blocked || waiting ? <DashboardTabSkeleton /> : children}
    </FeaturesContext.Provider>
  );
}
