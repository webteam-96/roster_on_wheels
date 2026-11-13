"use client";

/**
 * Club Admin Dashboard › Wallet tab
 * --------------------------------------------------------------------------
 * Self-service credit top-up (Razorpay). Club admins buy email
 * notification credits for their own club. Scope + clubId come from the
 * selected club in AuthContext; the actual charge + credit are computed and
 * applied server-side (see RotaryApi WalletController / WalletService).
 */

import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams } from "next/navigation";
import { clubYearRights, canEditYear } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import WalletTopup from "@/components/wallet/WalletTopup";

export default function ClubWalletPage() {
  // Reachable by URL even with the sidebar item hidden, so re-check here with
  // the SAME rule the sidebar uses: the year selected in the dashboard picker.
  const searchParams = useSearchParams();
  const { currentYearId } = useRotaryYears();
  const selectedYearId = searchParams?.get("yearId")
    ? Number(searchParams.get("yearId")) : currentYearId;
  const { selectedClubId, user, isSuperAdmin } = useAuth();

  if (!selectedClubId) {
    return <div className="p-6 text-sm text-gray-500">Select a club to manage its wallet.</div>;
  }

  if (!canEditYear(clubYearRights(user?.scopedRoles, selectedClubId), selectedYearId, isSuperAdmin)) {
    return (
      <div className="p-6 text-sm text-slate-500">
        You are not an admin for the selected Rotary year.
      </div>
    );
  }

  return (
    <div className="p-6">
      <WalletTopup scope="club" clubId={selectedClubId} />
    </div>
  );
}
