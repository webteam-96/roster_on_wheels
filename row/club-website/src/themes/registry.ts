// Theme registry: each club website theme's shell (Layout), home page and the inner pages it designs itself.
// A page a theme does not design is the shared page (themes/shared) inside the theme's shell.
// The components themselves are chosen in site/ThemeViews.jsx (client code, so each theme is its own chunk).
// Ported from the RIZones club site (App.jsx LAYOUTS/HomeSwitch/Swap and themes/registry.js).

import { headers } from "next/headers";

export const THEME_KEYS = [
  "classic-blue",
  "warm-modern",
  "civic-bold",
  "verdigris-ledger",
  "gold",
  "cinematic",
  "split-story",
  "liquid-motion",
  "horizontal-journey",
  "photo-collage",
  "sunrise",
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export const PAGE_KEYS = [
  "About", "Projects", "ProjectDetail", "Directory", "Directors", "PastPresidents", "Newsletters", "Gallery",
  "Events", "EventDetail", "Calendar", "Dignitary", "SisterClubs", "YouthPartners",
  // ROW only (no RIZones page): meetings and speakers.
  "Meetings",
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];



const DEFAULT_THEME: ThemeKey = "classic-blue";

/** A club's stored theme key -> a built theme; anything else falls back to classic-blue. */
export function resolveThemeKey(raw: string | undefined | null): ThemeKey {
  const k = (raw ?? "").toLowerCase();
  return (THEME_KEYS as readonly string[]).includes(k) ? (k as ThemeKey) : DEFAULT_THEME;
}

/** The theme for this request: a valid ?preview-theme (see middleware) wins over the club's own setting. */
export function activeThemeKey(clubTheme: string | undefined | null): ThemeKey {
  const preview = headers().get("x-preview-theme");
  const built = (k: string) => (THEME_KEYS as readonly string[]).includes(k);
  return preview && built(preview) ? (preview as ThemeKey) : resolveThemeKey(clubTheme);
}

