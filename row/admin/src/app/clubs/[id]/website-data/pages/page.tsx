"use client";

// Club website: Pages and Layout (website builder). Tile "pages" on the Website Data screen.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import WebsiteBuilder from "@/components/website-builder/WebsiteBuilder";
import { getClub } from "@/services/api";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

export default function ClubWebsitePagesPage() {
  useSyncClubIdFromUrl();
  const clubId = Number(useParams().id);
  const [clubName, setClubName] = useState<string | undefined>();

  useEffect(() => {
    getClub(clubId).then((c) => setClubName(c.clubName)).catch(() => setClubName(undefined));
  }, [clubId]);

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        <WebsiteBuilder scope="clubs" ownerId={clubId} ownerName={clubName} back={`/clubs/${clubId}/website-data`} />
      </div>
    </ProtectedRoute>
  );
}
