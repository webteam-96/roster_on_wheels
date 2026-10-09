"use client";

/**
 * District Admin Dashboard › Wallet tab
 * --------------------------------------------------------------------------
 * Self-service credit top-up (Razorpay). District admins buy WhatsApp / Email
 * notification credits for the district pool (fk_club_id = 0). Scope +
 * districtId come from the selected district in AuthContext; the charge +
 * credit are computed and applied server-side.
 */

import { useAuth } from "@/contexts/AuthContext";
import WalletTopup from "@/components/wallet/WalletTopup";

export default function DistrictWalletPage() {
  const { selectedDistrictId } = useAuth();

  if (!selectedDistrictId) {
    return <div className="p-6 text-sm text-gray-500">Select a district to manage its wallet.</div>;
  }

  return (
    <div className="p-6">
      <WalletTopup scope="district" districtId={selectedDistrictId} />
    </div>
  );
}
