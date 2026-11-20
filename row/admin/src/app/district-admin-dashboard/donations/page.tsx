"use client";

// District Admin Dashboard › Donations: the district's fundraising campaigns (components/donations).
import DonationCampaigns from "@/components/donations/DonationCampaigns";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictDonationsPage() {
  const { selectedDistrictId: scopeId } = useAuth();
  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return <DonationCampaigns scope="districts" scopeId={scopeId} basePath="/district-admin-dashboard/donations" />;
}
