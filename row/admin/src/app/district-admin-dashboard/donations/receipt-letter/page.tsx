"use client";

// District Admin Dashboard › Donations › Receipt letter: the editable donor receipt template.
import ReceiptLetterEditor from "@/components/donations/ReceiptLetterEditor";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictReceiptLetterPage() {
  const { selectedDistrictId: scopeId } = useAuth();
  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return <ReceiptLetterEditor scope="districts" scopeId={scopeId} basePath="/district-admin-dashboard/donations" />;
}
