import dynamic from "next/dynamic";

// ReactQuill — client-only so SSR doesn't trip on `document`. Same setup the
// club-side membership-dues v2 edit page uses, so SuperAdmin and Club Admin
// share the same editing capabilities.
export const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
export interface KycItem {
  id: number;
  vendorId: string;
  name: string;
  status: string;
  isActive: boolean;
  // Bank info shown under the vendor row so admin can tell which account.
  accountHolder?: string;
  accountNumber?: string;
  ifsc?: string;
}
export interface DistrictItem { id: number; districtNumber: string; country?: string | null; zoneName?: string | null; defaultCurrency?: string | null; }
// Zone 0 (test / own districts e.g. 5656) has no Rotary.org-synced clubs but is always offered (user 2026-11-16).
export const isZone0 = (zoneName?: string | null) => (zoneName || "").trim().toLowerCase() === "zone 0";
export interface ClubItem { id: number; clubName: string; }
export interface VendorSplit {
  fkFeeType: number; // 1=Annual, 2=Semi1, 3=Semi2
  fkKycId: number;
  vendorId?: string;
  vendorName?: string;
  splitAmount: number;
  isSelf?: boolean;
  isDefault?: boolean;
  accountLabel?: string;
}

/**
 * The locked, auto-computed DEFAULT settlement account.
 * It doesn't consume the fee — it RECEIVES whatever the other vendors don't take.
 */
export const DEFAULT_SETTLEMENT_VENDOR_ID = (process.env.NEXT_PUBLIC_DEFAULT_SETTLEMENT_VENDOR_ID ?? "").toLowerCase();

/**
 * Vendor accounts that must NOT be counted against a member's fee when computing
 * the Balance (Balance = fee − sum of vendor splits). Stored lowercase; compare
 * case-insensitively because the ids in the DB differ in casing
 * (the vendor ids come from NEXT_PUBLIC_DEFAULT_SETTLEMENT_VENDOR_ID / NEXT_PUBLIC_PLUG_VENDOR_ID).
 *
 *  1. DEFAULT_SETTLEMENT_VENDOR_ID — see above; it collects the balance.
 *  2. The plug vendor (NEXT_PUBLIC_PLUG_VENDOR_ID) — a tiny "plug" account whose only job is to absorb the
 *     rounding shortfall left in the under-funded default account, so it isn't a
 *     real cost against the fee either. Real example (dues 102, Thane Hills, fee
 *     35,000): A/C1 default = 1,053.07 (locked), A/C2 17,000, A/C3 17,000,
 *     A/C4 1,000, A/C5 saraswat = 10.93. Counting saraswat gives a balance of
 *     35,000 − 35,010.93 = −10.93; excluding BOTH gives 35,000 − 35,000 = 0,
 *     which is the correct answer.
 *
 * IMPORTANT: this exclusion is BALANCE MATH ONLY. The saraswat column stays
 * visible and editable everywhere; only the default account keeps its lock.
 */
export const BALANCE_EXCLUDED_VENDOR_IDS = [DEFAULT_SETTLEMENT_VENDOR_ID, (process.env.NEXT_PUBLIC_PLUG_VENDOR_ID ?? "").toLowerCase()].filter(Boolean);

/** Is this vendor id the locked default settlement account? (case-insensitive) */
export const isDefaultSettlementVendorId = (vendorId?: string | null) =>
  (vendorId ?? "").toLowerCase() === DEFAULT_SETTLEMENT_VENDOR_ID;

/** Is this vendor id excluded from the Balance calculation? (case-insensitive) */
export const isBalanceExcludedVendorId = (vendorId?: string | null) =>
  BALANCE_EXCLUDED_VENDOR_IDS.includes((vendorId ?? "").toLowerCase());

/**
 * FALLBACK platform/gateway rate for the locked DEFAULT settlement account.
 *
 * The real source of truth is the campaign's own `membership_dues.DefaultPercentage`
 * (DECIMAL(5,2) DEFAULT 2.95 — see DatabaseInitializer.cs), which this page already
 * round-trips through the `defaultPercentage` state: loaded from the detail API on
 * edit and posted back in buildFormData. This constant is used ONLY when that column
 * is missing/zero, so the rate is never silently 0. It mirrors the same 2.95 default
 * that `system_settings.ClubDuesPlatformFeePercent` holds on the Club Dues side.
 */
export const DEFAULT_ACCOUNT_RATE_PERCENT = 2.95;

/**
 * The DEFAULT settlement account's split for ONE member + ONE fee type.
 *
 *     total   = base + (surcharge% x base)   // the ONLINE amount the member actually pays
 *     default = total x ratePercent          // the platform/gateway cut of that total
 *
 * e.g. base 18,000 with a 3.04% surcharge -> total 18,547.20 -> default 547.14;
 *      base 11,000 with the same surcharge -> total 11,334.40 -> default 334.36.
 *
 * The default account's input is computed and locked, never typed — so this must be
 * re-run on EVERY change to the member's fee amount, or it keeps the figure derived
 * from the previous amount. Recomputing it can never move a Balance: the default
 * account is in BALANCE_EXCLUDED_VENDOR_IDS and is skipped by every balance total.
 */
export const computeDefaultAccountAmount = (
  base: number,
  surchargePercent: number,
  ratePercent: number,
) => {
  const b = Number(base) || 0;
  const surge = Number(surchargePercent) || 0;
  const rate = Number(ratePercent) || 0;
  const total = b + (b * surge) / 100;
  return Number(((total * rate) / 100).toFixed(2));
};

// Rotary years fetched from API

// Vendor splits are Cashfree's model, off on ROW: a club's money will go to its own Stripe account.
export const SPLITS_ON = false;
export const SPLIT_STEP = 2;

export const STEP_LABELS = [
  "Basic Info & Payment",
  "Fee Types & Amounts",
  "Vendor Splits",
  "Member List",
  "Images & Email",
];

export const ADMIN_STEP_LABELS = [
  "Basic Info",
  "Images & Email",
];
