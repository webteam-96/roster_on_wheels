// Help centre reads from the ROW API (api/public/help). Server-side only: ROW_API_URL is the API origin as this
// server reaches it (e.g. https://test.rosteronwheels.com in production, http://127.0.0.1:5000 locally).
const API = (process.env.ROW_API_URL || "http://localhost:5000").replace(/\/+$/, "");

// The eight ROW languages (same list as the admin and the app). Articles are machine-translated by the API.
export const HELP_LANGUAGES = [
  { code: "en", label: "English" }, { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" }, { code: "ja", label: "日本語" }, { code: "ko", label: "한국어" },
  { code: "pt", label: "Português" }, { code: "es", label: "Español" },
] as const;

export function helpLang(value: string | string[] | undefined): string {
  const v = (Array.isArray(value) ? value[0] : value ?? "").toLowerCase();
  return HELP_LANGUAGES.some((l) => l.code === v) ? v : "en";
}

export type HelpIndex = {
  categories: { slug: string; name: string; description: string | null; articles: number }[];
  articles: { slug: string; title: string; summary: string | null; category: string; categorySlug: string }[];
};
export type HelpArticle = {
  slug: string; title: string; summary: string | null; body: string; updatedAt: string;
  category: { slug: string; name: string }; related: { slug: string; title: string }[];
};

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(API + path, { next: { revalidate: 60 }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Help API ${res.status}`);
  return res.json() as Promise<T>;
}

export function helpIndex(lang: string, q?: string, category?: string): Promise<HelpIndex | null> {
  const p = new URLSearchParams({ lang });
  if (q) p.set("q", q.slice(0, 200));
  if (category) p.set("category", category);
  return get<HelpIndex>(`/api/public/help?${p}`);
}

export function helpArticle(slug: string, lang: string): Promise<HelpArticle | null> {
  return get<HelpArticle>(`/api/public/help/articles/${encodeURIComponent(slug)}?lang=${lang}`);
}

export async function sendHelpFeedback(slug: string, helpful: boolean): Promise<boolean> {
  const res = await fetch(`${API}/api/public/help/articles/${encodeURIComponent(slug)}/feedback`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ helpful }),
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}
