"use client";

// Club Admin Dashboard › Donations › Receipt letter: the editable donor receipt template.
import ReceiptLetterEditor from "@/components/donations/ReceiptLetterEditor";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubReceiptLetterPage() {
  const { selectedClubId: scopeId } = useAuth();
  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return <ReceiptLetterEditor scope="clubs" scopeId={scopeId} basePath="/club-admin-dashboard/donations" />;
}
