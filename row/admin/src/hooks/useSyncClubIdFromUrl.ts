"use client";

/**
 * useSyncClubIdFromUrl — keep AuthContext.selectedClubId in sync with the
 * `[id]` segment of the current V2 page URL.
 *
 * Background (Wave 9F):
 *   V2 pages take `clubId` from `useParams().id` (the URL is the source of
 *   truth for which club the page is showing). The Club Admin dashboard reads
 *   `selectedClubId` from AuthContext. These two values can drift apart when:
 *     - a user opens a bookmark for /clubs/{X}/board-of-directors/v2 while
 *       their current `selectedClubId` is Y
 *     - a multi-club admin switches dashboards in the topbar, then navigates
 *       back to a V2 page they had open
 *
 *   This hook closes the gap: every V2 page calls it once, and if the URL's
 *   clubId is a valid number AND differs from the AuthContext value, it
 *   pushes the URL value into AuthContext via `selectScope`. The effect is
 *   a no-op once the two agree, so it never loops.
 *
 *   The URL is the SOURCE OF TRUTH while the user is on a V2 page. After
 *   the user navigates back to the dashboard the value sticks, so the
 *   dashboard sees the same club.
 *
 * Usage:
 *   import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
 *
 *   export default function FooV2Page() {
 *     useSyncClubIdFromUrl();   // single line, no return value needed
 *     // ...existing JSX
 *   }
 */

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export function useSyncClubIdFromUrl(enabled: boolean = true): void {
  const params = useParams();
  const rawId = params?.id;
  const urlClubId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedClubId, selectScope } = useAuth();

  useEffect(() => {
    if (
      enabled &&
      Number.isFinite(urlClubId) &&
      urlClubId > 0 &&
      urlClubId !== selectedClubId
    ) {
      selectScope({ clubId: urlClubId });
    }
  }, [enabled, urlClubId, selectedClubId, selectScope]);
}
