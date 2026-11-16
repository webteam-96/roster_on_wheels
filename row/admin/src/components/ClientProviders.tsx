"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/contexts/BrandContext";
import { IconContext } from "@phosphor-icons/react";
import Link from "next/link";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { fellowshipTheme } from "@/astryx/fellowshipTheme";
import { IntlProvider } from "@/i18n/IntlProvider";
import LiveTranslate from "@/i18n/LiveTranslate";
import LoginAnnouncementPopup from "@/components/LoginAnnouncementPopup";
import ConsentGate from "@/components/privacy/ConsentGate";

// Order matters: translation reads the brand (languages, product name) and sits
// outside AuthProvider so the sign-in pages are translated too.
// Astryx components (src/components/ui) take the ROW Fellowship theme; Astryx links navigate with next/link.
// Icon defaults: Lucide's 24px box, and Phosphor's bold weight (closest to the website's 2.6 line icons).
const ICON_DEFAULTS = { size: 24, weight: "bold" as const };

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    // mode="light": the admin is light-only. The default "system" strips data-theme from <html>, and an OS in dark mode then paints inputs dark.
    <Theme theme={fellowshipTheme} mode="light">
    <LinkProvider component={Link}>
    <IconContext.Provider value={ICON_DEFAULTS}>
    <BrandProvider>
      <IntlProvider>
        <LiveTranslate />
        <AuthProvider>
          {children}
          <LoginAnnouncementPopup />
          <ConsentGate />
        </AuthProvider>
      </IntlProvider>
    </BrandProvider>
    </IconContext.Provider>
    </LinkProvider>
    </Theme>
  );
}
