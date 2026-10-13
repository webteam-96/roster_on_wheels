"use client";

/**
 * District Admin Dashboard › Payments: the district's own Stripe / PayPal
 * account(s). Shown when the instance sets payments.connect (ROW).
 */

import { useAuth } from "@/contexts/AuthContext";
import PaymentAccountsPanel from "@/components/payments/PaymentAccountsPanel";

export default function DistrictPaymentAccountsPage() {
  const { selectedDistrictId } = useAuth();
  return <PaymentAccountsPanel ownerType="district" ownerId={selectedDistrictId ?? null} />;
}
