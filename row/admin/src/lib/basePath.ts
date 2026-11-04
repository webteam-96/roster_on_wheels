/**
 * The admin can be served under a sub-path (e.g. "/admin" on the test host, IIS application "admin").
 * Next.js prefixes <Link>, router.push/replace and redirect() itself; everything else that builds a URL
 * from a root path must go through withBase(): window.location / window.open, fetch to the admin's own
 * route handlers, plain <a href>, <img>/<Image> src for files in /public, and copy-to-clipboard links.
 *
 * Set at build time with NEXT_PUBLIC_BASE_PATH (next.config.mjs reads the same variable); empty = root.
 */
export const BASE_PATH: string = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

/** Prefix a root-relative path ("/x") with the base path. Absolute URLs, "//host" and already-prefixed paths pass through. */
export function withBase(path: string): string {
  if (!BASE_PATH || !path || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) return path;
  return `${BASE_PATH}${path}`;
}

/** Absolute URL of an admin page, for links people copy or that leave the app (payment return URLs). */
export function adminUrl(path: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${withBase(path)}`;
}

/** The inverse: a browser path (window.location.pathname, anchor.pathname, which include the base path) as Next sees it. */
export function stripBase(path: string): string {
  if (!BASE_PATH || !path) return path;
  if (path === BASE_PATH) return "/";
  return path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : path;
}
