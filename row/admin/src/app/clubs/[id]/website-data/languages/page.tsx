"use client";

import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import WebsiteLanguagesEditor from "@/components/WebsiteLanguagesEditor";

// Club website languages (flag website_languages; FeatureGate hides this page while the flag is off).
export default function ClubWebsiteLanguagesPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ProtectedRoute>
      <ClubAdminShell pageTitle="Website languages" pageSubtitle="Your public website in more than one language"
        activeNavHref="/club-admin-dashboard/my-club-website">
        <WebsiteLanguagesEditor scope="clubs" ownerId={Number(id)} fallbackBack="/club-admin-dashboard/my-club-website" />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
