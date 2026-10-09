"use client";

/**
 * Club Admin Dashboard › Payments: the club's own Stripe / PayPal account(s).
 * Shown when the instance sets payments.connect (ROW).
 */

import { useAuth } from "@/contexts/AuthContext";
import PaymentAccountsPanel from "@/components/payments/PaymentAccountsPanel";

export default function ClubPaymentAccountsPage() {
  const { selectedClubId } = useAuth();
  return <PaymentAccountsPanel ownerType="club" ownerId={selectedClubId ?? null} />;
}
