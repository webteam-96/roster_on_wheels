"use client";

// Club Admin Dashboard › Donations › one campaign: progress, analytics, donors, receipts, QR code.
import { useParams } from "next/navigation";
import CampaignDetail from "@/components/donations/CampaignDetail";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubDonationCampaignPage() {
  const { selectedClubId: scopeId } = useAuth();
  const campaignId = Number(useParams().campaignId);
  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return <CampaignDetail scope="clubs" scopeId={scopeId} campaignId={campaignId} basePath="/club-admin-dashboard/donations" />;
}
