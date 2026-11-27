

export interface Registration { tempId: number; id?: number; registrationName: string; amount: number; }
export interface VendorSplit { fkRegistrationTempId: number; fkRegistrationId?: number; fkKycId: number; vendorId?: string; vendorName?: string; splitAmount: number; }
export interface Designation { id?: number; designationName: string; }
export interface KycItem { id: number; vendorId: string; name: string; status: string; isActive: boolean; }
export interface DistrictItem { id: number; districtNumber: string; }
export interface ClubItem { id: number; clubName: string; }

// Vendor splits are Cashfree's model, off on ROW: a club's money will go to its own Stripe account.
export const SPLITS_ON = false;
export const SPLIT_STEP = 3;

export const STEP_LABELS = [
  "Basic Info",
  "Form Fields",
  "Registration Types",
  "Vendor Splits",
  "Email Templates",
];
