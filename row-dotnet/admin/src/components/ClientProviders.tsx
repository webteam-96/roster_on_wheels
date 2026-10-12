"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import LoginAnnouncementPopup from "@/components/LoginAnnouncementPopup";

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <LoginAnnouncementPopup />
    </AuthProvider>
  );
}
