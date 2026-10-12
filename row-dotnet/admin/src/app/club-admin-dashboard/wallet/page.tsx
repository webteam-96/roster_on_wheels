"use client";

/**
 * Club Admin Dashboard › Wallet tab
 * --------------------------------------------------------------------------
 * Self-service credit top-up (Razorpay). Club admins buy WhatsApp / Email
 * notification credits for their own club. Scope + clubId come from the
 * selected club in AuthContext; the actual charge + credit are computed and
 * applied server-side (see RotaryApi WalletController / WalletService).
 */

import { useAuth } from "@/contexts/AuthContext";
import WalletTopup from "@/components/wallet/WalletTopup";

export default function ClubWalletPage() {
  const { selectedClubId } = useAuth();

  if (!selectedClubId) {
    return <div className="p-6 text-sm text-gray-500">Select a club to manage its wallet.</div>;
  }

  return (
    <div className="p-6">
      <WalletTopup scope="club" clubId={selectedClubId} />
    </div>
  );
}
