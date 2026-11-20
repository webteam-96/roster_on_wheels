// Help centre links: articles live on the ROW website (row/website, /help/<slug>). In production the website is the
// host root and the admin is under /admin, so a root-relative link works; NEXT_PUBLIC_SITE_URL points elsewhere (dev).
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

export function helpArticleUrl(slug: string, site: string = SITE): string {
  return `${site}/help/${encodeURIComponent(slug)}`;
}

/** The admin route as the API expects it: lowercase, no query, no trailing slash. */
export function helpContextPath(pathname: string): string {
  const p = pathname.split(/[?#]/)[0].toLowerCase().replace(/\/+$/, "");
  return p || "/";
}
