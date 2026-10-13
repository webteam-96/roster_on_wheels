"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/contexts/BrandContext";
import { IntlProvider } from "@/i18n/IntlProvider";
import LoginAnnouncementPopup from "@/components/LoginAnnouncementPopup";
import ConsentGate from "@/components/privacy/ConsentGate";

// Order matters: translation reads the brand (languages, product name) and sits
// outside AuthProvider so the sign-in pages are translated too.
export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <BrandProvider>
      <IntlProvider>
        <AuthProvider>
          {children}
          <LoginAnnouncementPopup />
          <ConsentGate />
        </AuthProvider>
      </IntlProvider>
    </BrandProvider>
  );
}
