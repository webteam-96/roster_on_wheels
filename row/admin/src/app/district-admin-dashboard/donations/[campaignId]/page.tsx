"use client";

// District Admin Dashboard › Donations › one campaign: progress, analytics, donors, receipts, QR code.
import { useParams } from "next/navigation";
import CampaignDetail from "@/components/donations/CampaignDetail";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictDonationCampaignPage() {
  const { selectedDistrictId: scopeId } = useAuth();
  const campaignId = Number(useParams().campaignId);
  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return <CampaignDetail scope="districts" scopeId={scopeId} campaignId={campaignId} basePath="/district-admin-dashboard/donations" />;
}
