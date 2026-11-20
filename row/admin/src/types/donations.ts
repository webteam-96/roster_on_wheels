// Donation campaigns (api/Controllers/DonationsController.cs). Money values come as numbers in the campaign currency.
export type DonationScope = "clubs" | "districts";

export interface DonationCampaign {
  id: number;
  scopeType: "club" | "district";
  scopeId: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  goalAmount: number;
  currency: string;
  tiers: number[];
  allowCustom: boolean;
  minAmount: number;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  isOpen: boolean;
  progress: { raised: number; donors: number; percent: number };
  givingUrl: string | null;
}

export interface SaveDonationCampaign {
  title: string;
  description: string | null;
  imageUrl: string | null;
  goalAmount: number;
  tiers: number[];
  allowCustom: boolean;
  minAmount: number;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
}

export interface DonationItem {
  id: number;
  donorName: string;
  donorEmail: string;
  message: string | null;
  isAnonymous: boolean;
  hideAmount: boolean;
  amount: number;
  currency: string;
  status: "pending" | "paid" | string;
  merchantOrderId: string;
  createdDate: string;
  paidDate: string | null;
}

export interface DonationReport {
  campaign: DonationCampaign;
  total: number;
  count: number;
  average: number;
  pending: number;
  daily: { date: string; amount: number; count: number }[];
  topDonors: { name: string; total: number; gifts: number }[];
  donations: DonationItem[];
}

export interface DonationReceiptTemplate {
  legalName: string | null;
  taxStatement: string | null;
  body: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
}

export interface PublicDonationCampaign {
  campaign: DonationCampaign;
  organisation: string;
  recentDonors: { name: string; amount: number | null; message: string | null; date: string | null }[];
}

export interface DonationOrder {
  status: string;
  amount: number;
  currency: string;
  donorName: string;
  paidDate: string | null;
  merchantOrderId: string;
}
