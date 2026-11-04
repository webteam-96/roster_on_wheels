import type { Metadata } from "next";
import { activeThemeKey, THEME_KEYS } from "@/themes/registry";
import "./globals.css";
import CookieConsent from "@/components/CookieConsent";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { fetchJson } from "@/lib/api";
import { currentTenant } from "@/lib/pageShell";
import { getSiteLanguage, languageAlternates, siteOrigin, sitePath, siteText } from "@/lib/siteLanguage";

// Tenant-aware metadata + theme attribute. currentTenant and getSiteLanguage are
// cached per request, so the layout, the metadata and the page share one lookup.
// Pages without their own metadata (the home page among them) get the site's search title and description in the
// visitor's language, and every page gets hreflang links to its other languages.

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  const lang = tenant ? await getSiteLanguage(tenant.clubId) : null;
  const seo = siteText(lang, "site");
  const title = tenant ? `${tenant.clubName} – Rotary Club` : "Rotary Club Website";
  const description = seo?.seoDescription || (tenant ? `Official website of ${tenant.clubName}` : "Official Rotary Club website");
  return {
    metadataBase: siteOrigin(),
    title: { default: seo?.seoTitle || title, template: `%s · ${tenant?.clubName ?? "Rotary Club"}` },
    description,
    alternates: { languages: languageAlternates(lang, sitePath()) },
    openGraph: { title: seo?.seoTitle || title, description: tenant ? description : undefined, type: "website" },
    robots: { index: true, follow: true },
  };
}

const CIVIC_MODE_SCRIPT =
  "try{var m=localStorage.getItem('civicMode');if(m==='dark'||m==='light')document.documentElement.setAttribute('data-civic-mode',m)}catch(e){}";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const tenant = await currentTenant();
  const lang = tenant ? await getSiteLanguage(tenant.clubId) : null;
  const themeKey = activeThemeKey(tenant?.themeKey);
  const brand = await fetchJson<{ domains?: { adminOrigin?: string }; legal?: { privacyUrl?: string } }>("/api/public/brand");
  const p = brand?.legal?.privacyUrl ?? "";
  const privacyUrl = /^https?:\/\//.test(p) ? p : p && brand?.domains?.adminOrigin ? brand.domains.adminOrigin.replace(/\/+$/, "") + p : null;
  return (
    // civic-bold keys its light/dark styles off data-civic-mode; the visitor's saved mode is applied before first
    // paint (as the RIZones site did), so the attribute may differ from the server's: suppressHydrationWarning.
    <html
      lang={lang?.language ?? "en"}
      data-theme={themeKey}
      data-civic-mode={themeKey === "civic-bold" ? "light" : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* Chrome's per-phone "dark themes for sites" repaints light themes half-dark; opt out (civic dark mode excepted). */}
        <meta name="color-scheme" content="only light" />
        <style dangerouslySetInnerHTML={{ __html: 'html[data-civic-mode="dark"]{color-scheme:only dark}' }} />
        {themeKey === "civic-bold" && (
          <script dangerouslySetInnerHTML={{ __html: CIVIC_MODE_SCRIPT }} />
        )}
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <LanguageSwitch lang={lang} />
        {children}
        <CookieConsent privacyUrl={privacyUrl} />
        {/* Review-only theme picker; never on a public site unless THEME_SWITCHER=1 is set on the server. */}
        {process.env.THEME_SWITCHER === "1" && <ThemeSwitcher active={themeKey} keys={THEME_KEYS} />}
      </body>
    </html>
  );
}
