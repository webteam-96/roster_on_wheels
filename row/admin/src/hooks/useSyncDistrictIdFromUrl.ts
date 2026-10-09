"use client";

/**
 * useSyncDistrictIdFromUrl — keep AuthContext.selectedDistrictId in sync with
 * the `[id]` segment of the current V2 page URL.
 *
 * Mirror of useSyncClubIdFromUrl (Wave 9F), adapted for District Admin V2
 * pages whose URL pattern is `/districts/[id]/...`.
 *
 * Background:
 *   V2 pages take `districtId` from `useParams().id` (the URL is the source of
 *   truth for which district the page is showing). The District Admin
 *   dashboard reads `selectedDistrictId` from AuthContext. These two values
 *   can drift apart when:
 *     - a user opens a bookmark for /districts/{X}/membership-goal/v2/edit
 *       while their current `selectedDistrictId` is Y
 *     - a multi-district admin switches dashboards in the topbar, then
 *       navigates back to a V2 page they had open
 *
 *   This hook closes the gap: every DA-side V2 page calls it once, and if the
 *   URL's districtId is a valid number AND differs from the AuthContext value,
 *   it pushes the URL value into AuthContext via `selectScope`. The effect is
 *   a no-op once the two agree, so it never loops.
 *
 *   The URL is the SOURCE OF TRUTH while the user is on a V2 page. After the
 *   user navigates back to the dashboard, the value sticks so the dashboard
 *   sees the same district.
 *
 * Usage:
 *   import { useSyncDistrictIdFromUrl } from "@/hooks/useSyncDistrictIdFromUrl";
 *
 *   export default function FooV2Page() {
 *     useSyncDistrictIdFromUrl(); // single line, no return value needed
 *     // ...existing JSX
 *   }
 */

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();

  useEffect(() => {
    if (
      Number.isFinite(urlDistrictId) &&
      urlDistrictId > 0 &&
      urlDistrictId !== selectedDistrictId
    ) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}
