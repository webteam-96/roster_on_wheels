"use client";

import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import WebsiteExtrasEditor from "@/components/WebsiteExtrasEditor";

// Club website extras: social feeds, Google Analytics, search engines and page QR codes.
export default function ClubWebsiteExtrasPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ProtectedRoute>
      <ClubAdminShell pageTitle="Website extras" pageSubtitle="Social feeds, analytics, search engines and QR codes"
        activeNavHref="/club-admin-dashboard/my-club-website">
        <WebsiteExtrasEditor scope="clubs" ownerId={Number(id)} fallbackBack="/club-admin-dashboard/my-club-website" />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
