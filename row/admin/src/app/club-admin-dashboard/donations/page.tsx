"use client";

// Club Admin Dashboard › Donations: the club's fundraising campaigns (components/donations).
import DonationCampaigns from "@/components/donations/DonationCampaigns";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubDonationsPage() {
  const { selectedClubId: scopeId } = useAuth();
  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return <DonationCampaigns scope="clubs" scopeId={scopeId} basePath="/club-admin-dashboard/donations" />;
}
