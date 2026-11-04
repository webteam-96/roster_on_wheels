import { NextRequest, NextResponse } from "next/server";
import { LANG_TAG, splitLanguagePrefix } from "@/lib/siteLanguagePath";

// We can't call the API from middleware (Edge runtime + no Node fetch quirks),
// so the middleware just forwards the host into a request header that the
// (Node-runtime) server components / route handlers read via headers().
// Tenant resolution itself happens in src/lib/tenant.ts on the Node side.
//
// Theme preview: ?preview-theme=<key> shows this visitor a theme without changing the club's setting, and a
// session cookie keeps it while they click around; ?preview-theme=off clears it. Only known theme keys are
// honoured (resolveThemeKey), so the value can never inject anything.
const PREVIEW = "preview-theme";

// Visitor language (multilingual websites): a first path segment shaped like a language tag picks it, so /fr/about
// shows /about in French and the site-lang cookie keeps French while the visitor clicks on. The API decides whether
// the site offers that language.
// shortcut: unprefixed URLs follow the cookie, so a CDN in front of the sites must vary on Cookie; prefix every
// internal link with the language if pages ever get cached.
const LANG = "site-lang";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-tenant-host", host);

  const asked = req.nextUrl.searchParams.get(PREVIEW);
  const preview = asked === "off" ? "" : (asked ?? req.cookies.get(PREVIEW)?.value ?? "");
  if (/^[a-z-]{2,30}$/.test(preview)) requestHeaders.set("x-preview-theme", preview);

  const { lang: prefix, path } = splitLanguagePrefix(req.nextUrl.pathname);
  const lang = prefix ?? req.cookies.get(LANG)?.value ?? "";
  requestHeaders.delete("x-site-lang"); // only the middleware sets these two
  if (LANG_TAG.test(lang)) requestHeaders.set("x-site-lang", lang);
  requestHeaders.set("x-site-path", path);

  let res: NextResponse;
  if (prefix) {
    const url = req.nextUrl.clone();
    url.pathname = path;
    res = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    res.cookies.set(LANG, prefix, { sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  } else {
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (asked === "off") res.cookies.delete(PREVIEW);
  else if (asked && /^[a-z-]{2,30}$/.test(asked)) res.cookies.set(PREVIEW, asked, { sameSite: "lax", httpOnly: true });
  return res;
}

export const config = {
  // Skip static assets and Next.js internals — only run on actual page/API requests.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf)).*)"],
};
