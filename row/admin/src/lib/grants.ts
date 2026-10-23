import type { GrantLine, GrantStatus } from "@/types/grants";

// Labels and small helpers for the grants pages (api/Services/GrantService.cs holds the rules).

export const STATUS_LABEL: Record<GrantStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  information_requested: "Information requested",
  information_provided: "Information provided",
  adjustment_requested: "Adjustment requested",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  report_submitted: "Report submitted",
  closed: "Closed",
  cancelled: "Cancelled",
};

// The district's review order, used for the status counts on the dashboard.
export const REVIEW_ORDER: GrantStatus[] = [
  "submitted", "information_requested", "information_provided", "adjustment_requested", "approved",
  "paid", "report_submitted", "closed", "rejected", "cancelled",
];

export const ARCHIVED: GrantStatus[] = ["rejected", "closed", "cancelled"];

// Neutral by default; amber where someone has to act, green when money is committed, red for a refusal.
export const STATUS_TONE: Record<GrantStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-amber-100 text-amber-800",
  information_requested: "bg-amber-100 text-amber-800",
  information_provided: "bg-amber-100 text-amber-800",
  adjustment_requested: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  paid: "bg-emerald-100 text-emerald-800",
  report_submitted: "bg-amber-100 text-amber-800",
  closed: "bg-slate-200 text-slate-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-slate-200 text-slate-600",
};

export const ACTION_LABEL: Record<string, string> = {
  submit: "Submit application",
  provide_information: "Send the information",
  resubmit: "Resubmit application",
  submit_report: "Submit final report",
  cancel: "Cancel application",
  request_information: "Request information",
  request_adjustment: "Request adjustment",
  approve: "Approve",
  reject: "Reject",
  return_report: "Return the report",
  close: "Close grant",
};

export const EVENT_LABEL: Record<string, string> = {
  submit: "Submitted the application",
  provide_information: "Sent the information",
  resubmit: "Resubmitted the application",
  submit_report: "Submitted the final report",
  cancel: "Cancelled the application",
  request_information: "Requested information",
  request_adjustment: "Requested an adjustment",
  approve: "Approved the grant",
  reject: "Rejected the application",
  return_report: "Returned the report",
  close: "Closed the grant",
  comment: "Commented",
  payment: "Recorded a payment",
};

export const PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

/** Budget totals in cents, so 0.1 + 0.2 stays 0.30. Partners carry no money of their own here. */
export function budgetTotals(lines: Pick<GrantLine, "kind" | "amount">[]) {
  const cents = (kind: GrantLine["kind"]) =>
    lines.filter((l) => l.kind === kind).reduce((sum, l) => sum + Math.round((Number(l.amount) || 0) * 100), 0);
  const income = cents("income");
  const expense = cents("expense");
  return { income: income / 100, expense: expense / 100, gap: (expense - income) / 100 };
}

/** ISO date-time from the API to the yyyy-mm-dd a date input wants ("" when empty). */
export const dayInput = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

/** Empty input to null, so the API receives null instead of "". */
export const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
