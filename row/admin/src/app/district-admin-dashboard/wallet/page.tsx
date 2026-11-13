"use client";

/**
 * District Admin Dashboard › Wallet tab
 * --------------------------------------------------------------------------
 * Self-service credit top-up (Razorpay). District admins buy email
 * notification credits for the district pool (fk_club_id = 0). Scope +
 * districtId come from the selected district in AuthContext; the charge +
 * credit are computed and applied server-side.
 */

import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { districtYearRights, canEditYear } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import WalletTopup from "@/components/wallet/WalletTopup";

export default function DistrictWalletPage() {
  // Reachable by URL even with the sidebar item hidden, so re-check here with
  // the SAME rule the sidebar uses: the year selected in the dashboard picker.
  const searchParams = useSearchParams();
  const { currentYearId } = useRotaryYears();
  const selectedYearId = searchParams?.get("yearId")
    ? Number(searchParams.get("yearId")) : currentYearId;
  const { selectedDistrictId, user, isSuperAdmin } = useAuth();

  if (!selectedDistrictId) {
    return <div className="p-6 text-sm text-gray-500">Select a district to manage its wallet.</div>;
  }

  if (!canEditYear(districtYearRights(user?.scopedRoles, selectedDistrictId), selectedYearId, isSuperAdmin)) {
    return (
      <div className="p-6 text-sm text-slate-500">
        You are not an admin for the selected Rotary year.
      </div>
    );
  }

  return (
    <div className="p-6">
      <WalletTopup scope="district" districtId={selectedDistrictId} />
    </div>
  );
}
