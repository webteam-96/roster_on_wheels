import { getCurrencySymbol } from "@/lib/currency";
import { appLocale } from "@/lib/appFormat";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Read-only preview of the member's submitted offline payment, shown inside
// the Approve / Reject dialog so admin sees what they're approving.
export function PendingDetailsPanel({ details, currency }: { details: any; currency?: string }) {
  if (!details) return null;
  const Row = ({ label, value }: { label: string; value: any }) => {
    if (value === null || value === undefined || value === "") return null;
    return (
      <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
        <div className="text-muted-foreground">{label}</div>
        <div className="font-medium break-words">{value}</div>
      </div>
    );
  };
  const dateStr = details.paymentDate
    ? new Date(details.paymentDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const amountStr = details.amount != null
    ? `${getCurrencySymbol(currency)}${Number(details.amount).toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`
    : null;
  const attachUrl = details.attachment
    ? (String(details.attachment).startsWith("/") ? `${API_BASE_URL}${details.attachment}` : `${API_BASE_URL}/${details.attachment}`)
    : null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-1.5">
      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">Member's submitted details</p>
      <Row label="Member" value={details.memberName} />
      <Row label="Fee Type" value={details.feeTypeLabel} />
      <Row label="Amount" value={amountStr} />
      <Row label="Date" value={dateStr} />
      <Row label="Payment Mode" value={details.transactionType} />
      <Row label="Transaction ID" value={details.transactionId} />
      <Row label="Given To" value={details.givenTo} />
      <Row label="Member Remark" value={details.remark} />
      {attachUrl && (
        <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
          <div className="text-muted-foreground">Attachment</div>
          <a href={attachUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all font-medium">View attachment</a>
        </div>
      )}
    </div>
  );
}

export interface DuesDetail {
  id: number;
  modeOfPayment?: number;   // 1 = Online, 2 = Offline only, 3 = Both
  purpose?: string;
  districtNumber?: string;
  clubName?: string;
  rotaryYear?: string;
  isFees1?: boolean;
  isFees2?: boolean;
  isFees3?: boolean;
  fees1Text?: string;
  fees2Text?: string;
  fees3Text?: string;
  // Super Admin settings (user 2026-11-09). Missing (old API) = true / "INR".
  notifyEmail?: boolean;
  notifyWhatsApp?: boolean;
  currency?: string;
}

export interface VendorSplit {
  vendorId: string;
  vendorName: string;
  amount: number;
  isDefault: boolean;
}

export interface DuesMember {
  id: number;
  memberName?: string;
  categoryType?: string;
  isNewMember?: boolean;
  hasPendingApproval?: boolean;
  fees1Amount?: number;
  fees1Paid?: number;
  fees1Balance?: number;
  fees2Amount?: number;
  fees2Paid?: number;
  fees2Balance?: number;
  fees3Amount?: number;
  fees3Paid?: number;
  fees3Balance?: number;
  offlineFees1?: number;
  offlineFees2?: number;
  offlineFees3?: number;
  pendingPaymentId?: number;
  fkMemberProfileId?: number;
  // pk_id of the latest Approved (Paid) OFFLINE payment per fee type, if any.
  // Backend GetMembers query exposes these so admin can re-open the offline
  // dialog to correct an already-recorded offline payment without affecting
  // status.
  annualPaidOfflineId?: number;
  semi1PaidOfflineId?: number;
  semi2PaidOfflineId?: number;
  annualVendors?: VendorSplit[];
  semi1Vendors?: VendorSplit[];
  semi2Vendors?: VendorSplit[];
}
