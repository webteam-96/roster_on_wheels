"use client";

// Offline credit entry now lives in Settings › Wallet (Offline). This old link keeps working
// by opening Wallet with Offline selected; the screen itself is CreditManagementPanel.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";

export default function CreditManagementPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings/wallet?view=offline"); }, [router]);
  return <RotaryLoader />;
}
