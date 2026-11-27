import { getCurrencySymbol } from "@/lib/currency";
import { appLocale } from "@/lib/appFormat";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";


export function statusChip(status: string): React.ReactElement {
  switch (status) {
    case "Paid":
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
          Paid
        </span>
      );
    case "Pending":
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
          Pending
        </span>
      );
    case "Unpaid":
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
          Unpaid
        </span>
      );
    case "N/A":
      return <span className="text-xs text-slate-400">N/A</span>;
    default:
      return (
        <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
          {status}
        </span>
      );
  }
}

export function isPendingMember(m: { hasPendingApproval?: boolean; HasPendingApproval?: boolean }): boolean {
  return !!(m.hasPendingApproval || m.HasPendingApproval);
}

// Read-only preview of the member's submitted offline payment, shown inside
// the Approve / Reject dialogs.
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
