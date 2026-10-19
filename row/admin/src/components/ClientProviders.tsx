"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/contexts/BrandContext";
import { IconContext } from "@phosphor-icons/react";
import { IntlProvider } from "@/i18n/IntlProvider";
import LiveTranslate from "@/i18n/LiveTranslate";
import LoginAnnouncementPopup from "@/components/LoginAnnouncementPopup";
import ConsentGate from "@/components/privacy/ConsentGate";

// Order matters: translation reads the brand (languages, product name) and sits
// outside AuthProvider so the sign-in pages are translated too.
// Icon defaults: Lucide's 24px box, and Phosphor's bold weight (closest to the website's 2.6 line icons).
const ICON_DEFAULTS = { size: 24, weight: "bold" as const };

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
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
  );
}
