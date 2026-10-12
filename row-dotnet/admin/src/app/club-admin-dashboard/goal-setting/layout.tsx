"use client";

import { useAuth } from "@/contexts/AuthContext";

// Goal Setting is LIVE for club admins (2026-09-16). It used to show a "Coming Soon" page to everyone
// except SuperAdmin while the module was being built; that gate is removed, so every club admin now
// gets the real module. The layout is kept so auth still resolves before the page renders — and so the
// gate can be restored in one line if the rollout ever needs pausing.
export default function GoalSettingGuardLayout({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

  if (loading) return null;
  return <>{children}</>;
}
