"use client";

/**
 * Club Dues v2 — Members listing (Club Admin).
 *
 * Same data semantics as v1: identical API calls, identical fee-type
 * resolution, identical offline-payment dialog, identical reject /
 * approve / receipt / reminder flows, identical bulk-email
 * handlers.
 *
 * Only the presentation differs (ClubAdminShell chrome, KPI tiles, dense
 * slate table). All shadcn/ui dialogs are preserved verbatim from v1
 * because they carry intricate state.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Mail, FileText, Users, CheckCircle2,
  AlertCircle, Clock, Search, X, Globe, Banknote,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { getMembershipDuesMembers, getMembershipDuesDetail, recordMembershipDuesOffline, approveMembershipDuesPayment, getMembershipDuesOfflineDetails, updateMembershipDuesOffline, deleteMembershipDuesPayment, sendMembershipDuesReceipt, sendMembershipDuesReminder, bulkMembershipDuesReminderEmail } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import Pagination from "@/components/Pagination";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";


function statusChip(status: string): React.ReactElement {
  switch (status) {
    case "Paid":
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          Paid
        </span>
      );
    case "Pending":
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          Pending
        </span>
      );
    case "Unpaid":
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
          Unpaid
        </span>
      );
    case "N/A":
      return <span className="text-xs text-slate-400">N/A</span>;
    default:
      return (
        <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
          {status}
        </span>
      );
  }
}

function isPendingMember(m: { hasPendingApproval?: boolean; HasPendingApproval?: boolean }): boolean {
  return !!(m.hasPendingApproval || m.HasPendingApproval);
}

// Read-only preview of the member's submitted offline payment, shown inside
// the Approve / Reject dialogs.
function PendingDetailsPanel({ details }: { details: any }) {
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
    ? `${currencySymbol()}${Number(details.amount).toLocaleString(appLocale(), { maximumFractionDigits: 2 })}`
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

export default function ClubMembershipDuesV2MembersPage() {
  useSyncClubIdFromUrl();
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const duesId = Number(params.duesId);
  const returnTo = searchParams.get("returnTo") || `/clubs/${clubId}/membership-dues/v2`;

  const [members, setMembers] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Offline dialog state (same as v1)
  const [offlineDialogOpen, setOfflineDialogOpen] = useState(false);
  const [offlineMember, setOfflineMember] = useState<any>(null);
  const [offlineFeeType, setOfflineFeeType] = useState("");
  const [offlinePaymentMode, setOfflinePaymentMode] = useState("Cash");
  const [offlineTxnId, setOfflineTxnId] = useState("");
  const [offlineGivenTo, setOfflineGivenTo] = useState("");
  const [offlineRemark, setOfflineRemark] = useState("");
  const [offlineDate, setOfflineDate] = useState("");
  const [offlineAttachment, setOfflineAttachment] = useState<File | null>(null);
  const [offlineSendEmail, setOfflineSendEmail] = useState(false);
  const [offlineSaving, setOfflineSaving] = useState(false);
  const [removingPayment, setRemovingPayment] = useState(false);
  const [offlineUpdatePaymentId, setOfflineUpdatePaymentId] = useState(0);
  const [offlineUpdateIsApproved, setOfflineUpdateIsApproved] = useState(false);
  const [offlineSendReceiptOnUpdate, setOfflineSendReceiptOnUpdate] = useState(false);
  const [offlineExistingAttachment, setOfflineExistingAttachment] = useState<string | null>(null);
  // Optional approver remark — surfaced only when admin is saving an update on
  // a Pending row (the save auto-approves the payment server-side).
  const [offlineApprovalRemark, setOfflineApprovalRemark] = useState("");
  // Read-only snapshot of an online (gateway) payment. When the admin picks a
  // fee type that was paid via Payment Gateway, we show this info instead of
  // an editable form — gateway payments can't be edited offline.
  const [offlineOnlineView, setOfflineOnlineView] = useState<{
    mode: string; txnId: string; amount: number; date: string | null;
  } | null>(null);

  // Reject dialog state (same as v1)
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approvePaymentId, setApprovePaymentId] = useState(0);
  const [approveRemark, setApproveRemark] = useState("");

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectPaymentId, setRejectPaymentId] = useState(0);
  const [rejectReason, setRejectReason] = useState("");

  // Snapshot of the member's submitted offline details — shown inside the
  // approve/reject dialogs so admin sees what they're approving.
  const [pendingDetails, setPendingDetails] = useState<any>(null);
  const findMemberByPendingPaymentId = (pid: number) =>
    members.find((m: any) => Number(m.pendingPaymentId ?? m.PendingPaymentId) === Number(pid));
  const extractPendingDetails = (m: any) => {
    if (!m) return null;
    const ft = m.pendingFeeType ?? m.PendingFeeType;
    const feeTypeLabel = ft === 1
      ? (detail?.fees1Text || "Annual")
      : ft === 2 ? (detail?.fees2Text || "Semi 1")
      : ft === 3 ? (detail?.fees3Text || "Semi 2")
      : "–";
    return {
      memberName: m.memberName ?? m.MemberName,
      feeTypeLabel,
      amount: m.pendingAmount ?? m.PendingAmount,
      transactionType: m.pendingTransactionType ?? m.PendingTransactionType,
      transactionId: m.pendingTransactionId ?? m.PendingTransactionId,
      givenTo: m.pendingGivenTo ?? m.PendingGivenTo,
      paymentDate: m.pendingPaymentDate ?? m.PendingPaymentDate,
      remark: m.pendingRemark ?? m.PendingRemark,
      attachment: m.pendingAttachment ?? m.PendingAttachment,
    };
  };
  const openApprovePopup = (m: any) => {
    setApprovePaymentId(m.pendingPaymentId ?? m.PendingPaymentId ?? m.memberFeeId);
    setPendingDetails(extractPendingDetails(m));
    setApproveRemark("");
    setApproveDialogOpen(true);
  };
  const openRejectPopup = (m: any) => {
    setRejectPaymentId(m.pendingPaymentId ?? m.PendingPaymentId ?? m.memberFeeId);
    setPendingDetails(extractPendingDetails(m));
    setRejectReason("");
    setRejectDialogOpen(true);
  };

  // Individual email remark dialog state (same as v1)
  const [emailRemarkDialogOpen, setEmailRemarkDialogOpen] = useState(false);
  const [emailRemarkMemberFeeId, setEmailRemarkMemberFeeId] = useState(0);
  const [emailRemark, setEmailRemark] = useState("");

  // Debounce search input → committed search (400ms)
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  // ── Fetch ──
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [membersData, detailData] = await Promise.all([
        getMembershipDuesMembers(duesId, {
          search: search || undefined,
          filter: filter || undefined,
        }),
        getMembershipDuesDetail(duesId),
      ]);
      setMembers(
        Array.isArray(membersData)
          ? membersData
          : membersData.members || membersData.Members || []
      );
      setDetail(detailData);
      setCurrentPage(1);
    } catch {
      setErrorMessage("Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [duesId, search, filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fee type helpers — same as v1 ──
  const enabledFeeTypes: { type: number; label: string }[] = [];
  if (detail?.isFees1) enabledFeeTypes.push({ type: 1, label: detail.fees1Text || "Annual" });
  if (detail?.isFees2) enabledFeeTypes.push({ type: 2, label: detail.fees2Text || "Semi 1" });
  if (detail?.isFees3) enabledFeeTypes.push({ type: 3, label: detail.fees3Text || "Semi 2" });

  // Smart fee filter — paid types stay so admin can pick & view details.
  // Annual hidden when Semi paid; Semi hidden when Annual paid (incompatible).
  const getAvailableFeeTypes = (m: any) => {
    if (!m) return enabledFeeTypes;
    const annualPaid = (m.annualPaid ?? 0) > 0;
    const semi1Paid  = (m.semi1Paid  ?? 0) > 0;
    const semi2Paid  = (m.semi2Paid  ?? 0) > 0;
    return enabledFeeTypes.filter(ft => {
      if (ft.type === 1 && (semi1Paid || semi2Paid)) return false;
      if (annualPaid && (ft.type === 2 || ft.type === 3)) return false;
      return true;
    });
  };

  // Small Online/Offline icon shown below the Paid badge on the listing.
  const getPaymentChannelIcon = (m: any, ft: number) => {
    const mode = ft === 1 ? (m.annualPaymentMode ?? m.AnnualPaymentMode)
      : ft === 2 ? (m.semi1PaymentMode ?? m.Semi1PaymentMode)
      : ft === 3 ? (m.semi2PaymentMode ?? m.Semi2PaymentMode)
      : null;
    const date = ft === 1 ? (m.annualPaymentDate ?? m.AnnualPaymentDate)
      : ft === 2 ? (m.semi1PaymentDate ?? m.Semi1PaymentDate)
      : ft === 3 ? (m.semi2PaymentDate ?? m.Semi2PaymentDate)
      : null;
    if (!mode) return null;
    const dateStr = date ? new Date(date).toLocaleDateString(appLocale()) : "";
    if (mode === "Payment Gateway") {
      return (
        <span title={`Online${dateStr ? " · " + dateStr : ""}`}
              className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-blue-600">
          <Globe className="h-3 w-3" />Online
        </span>
      );
    }
    return (
      <span title={`Offline · ${mode}${dateStr ? " · " + dateStr : ""}`}
            className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-slate-600">
        <Banknote className="h-3 w-3" />Offline
      </span>
    );
  };

  // annualAmount/semi1Amount/semi2Amount are the ONE true (base) amount — what
  // the club nets regardless of payment channel (the online surcharge exists
  // specifically to cover the gateway fee on top of this), so this matches the
  // dashboard's Total Amount tile with no further deduction needed.
  const getEditFeeAmount = (m: any, ft: number) =>
    ft === 1 ? (m.annualAmount ?? 0) : ft === 2 ? (m.semi1Amount ?? 0) : (m.semi2Amount ?? 0);

  // Displayed amount is the MEMBER'S OWN fee (the per-member row in
  // membership_dues_member_fees), NOT the campaign default — each member can
  // carry a different due (category-based, new-member, custom), and the listing
  // must reflect that member-wise amount rather than one flat figure for all.
  const getDisplayFeeAmount = (m: any, ft: number) =>
    Math.round(getEditFeeAmount(m, ft));
  const getEditFeePaid = (m: any, ft: number) =>
    ft === 1 ? (m.annualPaid ?? 0) : ft === 2 ? (m.semi1Paid ?? 0) : (m.semi2Paid ?? 0);

  const isNotAllocated = (m: any): boolean =>
    enabledFeeTypes.every((ft) => getEditFeeAmount(m, ft.type) === 0);

  const getEditFeeStatus = (m: any, ft: number): string => {
    if (isNotAllocated(m)) return "N/A";
    // Annual paid → Semi1/Semi2 = N/A
    if ((ft === 2 || ft === 3) && getEditFeePaid(m, 1) > 0) return "N/A";
    // Semi1 paid → Annual = N/A
    if (ft === 1 && getEditFeePaid(m, 2) > 0) return "N/A";
    // Semi2 paid → Annual = N/A
    if (ft === 1 && getEditFeePaid(m, 3) > 0) return "N/A";
    if (getEditFeePaid(m, ft) > 0) return "Paid";
    const status = ft === 1 ? m.annualStatus : ft === 2 ? m.semi1Status : m.semi2Status;
    if (status === "PendingApproval" || status === "Pending") return "Pending";
    if (m.hasPendingApproval && m.pendingFeeType === ft) return "Pending";
    return "Unpaid";
  };

  // Whole-row tint: pending-approval = light yellow, new-member = light green.
  // Hover gets a slightly darker shade of the same colour so the status doesn't
  // get washed away by a generic blue hover when the user mouses over the row.
  const getRowBgClass = (m: any) => {
    if (m.hasPendingApproval) return "bg-amber-100 hover:bg-amber-200";
    if (m.isNewMember) return "bg-emerald-100 hover:bg-emerald-200";
    return "hover:bg-blue-50/40";
  };

  const getUnpaidFeeTypes = (m: any) =>
    enabledFeeTypes.filter((ft) => {
      const s = getEditFeeStatus(m, ft.type);
      return s === "Unpaid" || s === "Pending";
    });
  const hasAnyPaidFee = (m: any) =>
    enabledFeeTypes.some((ft) => getEditFeeStatus(m, ft.type) === "Paid");

  // ── Offline — same as v1 ──
  const resetOfflineDialog = () => {
    setOfflineDialogOpen(false);
    setOfflineMember(null);
    setOfflineFeeType("");
    setOfflinePaymentMode("Cash");
    setOfflineTxnId("");
    setOfflineGivenTo("");
    setOfflineRemark("");
    setOfflineDate("");
    setOfflineAttachment(null);
    setOfflineSendEmail(false);
    setOfflineUpdatePaymentId(0);
    setOfflineUpdateIsApproved(false);
    setOfflineSendReceiptOnUpdate(false);
    setOfflineExistingAttachment(null);
    setOfflineApprovalRemark("");
    setOfflineOnlineView(null);
  };

  const openOfflineEntry = (m: any | null) => {
    setOfflineMember(m);
    setOfflineFeeType("");
    setOfflinePaymentMode("Cash");
    setOfflineTxnId("");
    setOfflineGivenTo("");
    setOfflineRemark("");
    setOfflineDate("");
    setOfflineAttachment(null);
    setOfflineExistingAttachment(null);
    setOfflineSendEmail(false);
    setOfflineSendReceiptOnUpdate(false);
    setOfflineUpdatePaymentId(0);
    setOfflineUpdateIsApproved(false);
    setOfflineApprovalRemark("");
    setOfflineOnlineView(null);
    setOfflineDialogOpen(true);
  };

  const handleOfflineFeeTypeChange = async (newFeeType: string) => {
    setOfflineFeeType(newFeeType);
    // Always clear the online view on a fresh fee-type change — the next
    // branch decides whether to repopulate it.
    setOfflineOnlineView(null);
    if (!offlineMember || !newFeeType) {
      setOfflineUpdatePaymentId(0);
      setOfflineUpdateIsApproved(false);
      setOfflineExistingAttachment(null);
      return;
    }
    const m = offlineMember;
    const ft = Number(newFeeType);
    const pendingFt = Number(m.pendingFeeType ?? m.PendingFeeType ?? 0);
    const paidOfflineIdForFt = ft === 1 ? (m.annualPaidOfflineId ?? m.AnnualPaidOfflineId)
      : ft === 2 ? (m.semi1PaidOfflineId ?? m.Semi1PaidOfflineId)
      : ft === 3 ? (m.semi2PaidOfflineId ?? m.Semi2PaidOfflineId)
      : 0;
    const paymentModeForFt = ft === 1 ? (m.annualPaymentMode ?? m.AnnualPaymentMode)
      : ft === 2 ? (m.semi1PaymentMode ?? m.Semi1PaymentMode)
      : ft === 3 ? (m.semi2PaymentMode ?? m.Semi2PaymentMode)
      : null;
    const onlineTxnIdForFt = ft === 1 ? (m.annualOnlineTransactionId ?? m.AnnualOnlineTransactionId)
      : ft === 2 ? (m.semi1OnlineTransactionId ?? m.Semi1OnlineTransactionId)
      : ft === 3 ? (m.semi2OnlineTransactionId ?? m.Semi2OnlineTransactionId)
      : null;
    const paidAmountForFt = ft === 1 ? Number(m.annualPaid ?? 0)
      : ft === 2 ? Number(m.semi1Paid ?? 0)
      : ft === 3 ? Number(m.semi2Paid ?? 0)
      : 0;
    const paidDateForFt = ft === 1 ? (m.annualPaymentDate ?? m.AnnualPaymentDate)
      : ft === 2 ? (m.semi1PaymentDate ?? m.Semi1PaymentDate)
      : ft === 3 ? (m.semi2PaymentDate ?? m.Semi2PaymentDate)
      : null;

    // Gateway-paid → show a read-only summary instead of letting admin edit;
    // also resets editable form fields so a stale Save can't fire.
    if (paymentModeForFt === "Payment Gateway") {
      setOfflineOnlineView({
        mode: "Payment Gateway",
        txnId: String(onlineTxnIdForFt ?? ""),
        amount: paidAmountForFt,
        date: paidDateForFt ? new Date(paidDateForFt).toISOString() : null,
      });
      setOfflinePaymentMode("Cash");
      setOfflineTxnId("");
      setOfflineGivenTo("");
      setOfflineRemark("");
      setOfflineDate("");
      setOfflineAttachment(null);
      setOfflineExistingAttachment(null);
      setOfflineUpdatePaymentId(0);
      setOfflineUpdateIsApproved(false);
      return;
    }

    if (pendingFt === ft) {
      setOfflinePaymentMode(m.pendingTransactionType ?? m.PendingTransactionType ?? "Cash");
      setOfflineTxnId(m.pendingTransactionId ?? m.PendingTransactionId ?? "");
      setOfflineGivenTo(m.pendingGivenTo ?? m.PendingGivenTo ?? "");
      setOfflineDate(
        m.pendingPaymentDate ?? m.PendingPaymentDate
          ? new Date(m.pendingPaymentDate || m.PendingPaymentDate).toISOString().split("T")[0]
          : ""
      );
      setOfflineRemark(m.pendingRemark ?? m.PendingRemark ?? "");
      setOfflineExistingAttachment(m.pendingAttachment ?? m.PendingAttachment ?? null);
      setOfflineAttachment(null);
      setOfflineUpdatePaymentId(Number(m.pendingPaymentId ?? m.PendingPaymentId ?? 0));
      setOfflineUpdateIsApproved(false);
      return;
    }

    if (paidOfflineIdForFt && Number(paidOfflineIdForFt) > 0) {
      try {
        const det = await getMembershipDuesOfflineDetails(Number(paidOfflineIdForFt));
        setOfflinePaymentMode(det.transactionType || "Cash");
        setOfflineTxnId(det.transactionId || "");
        setOfflineGivenTo(det.givenTo || "");
        setOfflineRemark(det.remark || "");
        setOfflineDate(det.paymentDate ? new Date(det.paymentDate).toISOString().split("T")[0] : "");
        setOfflineAttachment(null);
        setOfflineExistingAttachment(det.attachment || null);
        setOfflineUpdatePaymentId(Number(paidOfflineIdForFt));
        setOfflineUpdateIsApproved(String(det.offlineStatus || "").toLowerCase() === "approved");
      } catch (e: any) {
        setErrorMessage(e?.response?.data?.message || "Failed to load existing offline payment.");
      }
      return;
    }

    setOfflinePaymentMode("Cash");
    setOfflineTxnId("");
    setOfflineGivenTo("");
    setOfflineRemark("");
    setOfflineDate("");
    setOfflineAttachment(null);
    setOfflineExistingAttachment(null);
    setOfflineUpdatePaymentId(0);
    setOfflineUpdateIsApproved(false);
  };

  const openUpdatePaidOffline = async (m: any, paidOfflineId: number) => {
    try {
      const det = await getMembershipDuesOfflineDetails(paidOfflineId);
      setOfflineMember(m);
      setOfflineFeeType(String(det.feeType ?? ""));
      setOfflinePaymentMode(det.transactionType || "Cash");
      setOfflineTxnId(det.transactionId || "");
      setOfflineGivenTo(det.givenTo || "");
      setOfflineRemark(det.remark || "");
      setOfflineDate(det.paymentDate ? new Date(det.paymentDate).toISOString().split("T")[0] : "");
      setOfflineAttachment(null);
      setOfflineExistingAttachment(det.attachment || null);
      setOfflineUpdatePaymentId(paidOfflineId);
      setOfflineUpdateIsApproved(String(det.offlineStatus || "").toLowerCase() === "approved");
      setOfflineSendReceiptOnUpdate(false);
      setOfflineSendEmail(false);
      setOfflineDialogOpen(true);
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to load payment details.");
    }
  };

  const handleOfflineSave = async () => {
    if (!offlineMember || !offlineFeeType || !offlineDate) {
      setErrorMessage("Fee Type and Date are required.");
      return;
    }
    if (
      (offlinePaymentMode === "Cash" || offlinePaymentMode === "Cheque") &&
      !offlineGivenTo.trim()
    ) {
      setErrorMessage("'Given To' is required for Cash and Cheque payments.");
      return;
    }
    setOfflineSaving(true);
    try {
      const fd = new FormData();
      fd.append("feeType", offlineFeeType);
      fd.append("fkMemberProfileId", String(offlineMember.memberId));
      fd.append("transactionType", offlinePaymentMode);
      fd.append("transactionId", offlineTxnId);
      fd.append("givenTo", offlineGivenTo);
      fd.append("paymentDate", offlineDate);
      fd.append("remark", offlineRemark);
      if (offlineAttachment) fd.append("attachment", offlineAttachment);

      if (offlineUpdatePaymentId > 0) {
        // Update mode — PUT. Status is preserved unless the row was Pending
        // (server auto-approves on save).
        fd.append("sendReceiptOnUpdate", String(offlineSendReceiptOnUpdate));
        if (!offlineUpdateIsApproved && offlineApprovalRemark.trim()) {
          fd.append("approvalRemark", offlineApprovalRemark.trim());
        }
        await updateMembershipDuesOffline(offlineUpdatePaymentId, fd);
        setSuccessMessage(offlineUpdateIsApproved
          ? "Offline payment updated."
          : "Offline payment updated and approved. Receipt emailed to member.");
      } else {
        fd.append("sendReceiptEmail", String(offlineSendEmail));
        await recordMembershipDuesOffline(duesId, offlineMember.memberFeeId, fd);
        setSuccessMessage("Offline payment recorded!");
      }
      resetOfflineDialog();
      fetchData();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to save offline payment.");
    } finally {
      setOfflineSaving(false);
    }
  };

  // SuperAdmin-only — undoes a mistakenly-recorded offline payment (e.g. entered
  // against the wrong member). Server also enforces the role check.
  const handleRemovePayment = async () => {
    if (!offlineUpdatePaymentId) return;
    if (!window.confirm("Remove this payment entry? The member will go back to Unpaid for this fee type.")) return;
    setRemovingPayment(true);
    try {
      await deleteMembershipDuesPayment(offlineUpdatePaymentId);
      setSuccessMessage("Payment removed.");
      resetOfflineDialog();
      fetchData();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to remove payment.");
    } finally {
      setRemovingPayment(false);
    }
  };

  // ── Approve — opens dialog so admin can add an OPTIONAL remark. ──
  const handleApprove = (paymentId: number) => {
    setApprovePaymentId(paymentId);
    setPendingDetails(extractPendingDetails(findMemberByPendingPaymentId(paymentId)));
    setApproveRemark("");
    setApproveDialogOpen(true);
  };

  const handleApproveSubmit = async () => {
    try {
      const res: any = await approveMembershipDuesPayment(approvePaymentId, {
        isApproved: true,
        approvalRemark: approveRemark.trim() || undefined,
      });
      setSuccessMessage(res?.message || "Payment approved!");
      setApproveDialogOpen(false);
      setApproveRemark("");
      fetchData();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to approve.");
    }
  };

  // ── Reject — REMARK IS MANDATORY ──
  const handleRejectSubmit = async () => {
    if (!rejectReason.trim()) {
      setErrorMessage("Rejection reason is required.");
      return;
    }
    try {
      const res: any = await approveMembershipDuesPayment(rejectPaymentId, {
        isApproved: false,
        rejectionReason: rejectReason.trim(),
      });
      setSuccessMessage(res?.message || "Payment rejected.");
      setRejectDialogOpen(false);
      setRejectReason("");
      fetchData();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to reject.");
    }
  };

  // ── Auto-action from email deep link (?action=approve|reject&paymentId=…) ──
  const autoActionRan = useRef(false);
  useEffect(() => {
    if (autoActionRan.current) return;
    const action = searchParams.get("action");
    const pidStr = searchParams.get("paymentId");
    if (!action || !pidStr) return;
    const pid = Number(pidStr);
    if (!pid) return;
    autoActionRan.current = true;
    const cleanUrl = `/clubs/${clubId}/membership-dues/v2/${duesId}/members`;
    router.replace(cleanUrl);
    if (action === "approve") {
      handleApprove(pid);
    } else if (action === "reject") {
      setRejectPaymentId(pid);
      setPendingDetails(extractPendingDetails(findMemberByPendingPaymentId(pid)));
      setRejectReason("");
      setRejectDialogOpen(true);
    }
  }, [searchParams, clubId, duesId, router]);

  // ── Reminder — same as v1 ──
  const handleEmailReminder = async (memberFeeId: number, feeType: number) => {
    try {
      await sendMembershipDuesReminder(duesId, memberFeeId, {
        feeType,
        remark: emailRemark || undefined,
      });
      setSuccessMessage("Email reminder sent!");
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to send reminder.");
    }
  };


  // ── Receipt — same as v1, with per-row loading state ──
  // Tracks which memberFeeId is currently sending so we can show a Rotary
  // loader on that row's button instead of letting the user think the click
  // did nothing (Brevo dispatch can take a few seconds).
  const [receiptSendingId, setReceiptSendingId] = useState<number | null>(null);

  const handleReceipt = async (memberFeeId: number) => {
    if (receiptSendingId !== null) return; // prevent double-fire
    setReceiptSendingId(memberFeeId);
    try {
      await sendMembershipDuesReceipt(memberFeeId);
      setSuccessMessage("Receipt sent!");
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to send receipt.");
    } finally {
      setReceiptSendingId(null);
    }
  };

  // ── Bulk reminders — confirm-then-send (no remark UI; user requested simple OK/Cancel) ──
  const [bulkEmailConfirmOpen, setBulkEmailConfirmOpen] = useState(false);

  const handleBulkEmailReminder = async () => {
    try {
      await bulkMembershipDuesReminderEmail(duesId, {});
      setSuccessMessage("Bulk email reminders sent!");
      setBulkEmailConfirmOpen(false);
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed.");
    }
  };


  // ── KPI aggregates (across all members for visible filter set) ──
  const totalMembers = members.length;
  const totalPaid = members.filter((m) => hasAnyPaidFee(m)).length;
  const totalPending = members.filter((m) => isPendingMember(m)).length;
  const totalUnpaid = members.filter(
    (m) => !isNotAllocated(m) && !hasAnyPaidFee(m) && !isPendingMember(m)
  ).length;

  // ── Pagination ──
  const totalPages = Math.ceil(members.length / pageSize);
  const paged = members.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Members – Dues"
          pageSubtitle="View and manage member payments"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="text-lg font-semibold text-slate-700">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  const pageTitle = detail?.purpose ? `${detail.purpose} – Members` : "Members – Dues";
  const pageSubtitle = [detail?.rotaryYear, detail?.clubName].filter(Boolean).join(" · ");

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle || "View and manage member payments"}
        activeNavHref="/club-admin-dashboard/membership-dues"
      >
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Link
                href={returnTo}
                className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Back"
              >
                <ArrowLeft size={15} />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-slate-800">
                  {detail?.purpose || "Club Dues"} – Members
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">{pageSubtitle || "–"}</p>
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Members"   value={fmtInt(totalMembers)}   subtitle="In listing"          icon={Users}         color="blue" />
            <KpiCard title="Paid"            value={fmtInt(totalPaid)}      subtitle="Any fee settled"     icon={CheckCircle2}  color="green" />
            <KpiCard title="Pending Approval" value={fmtInt(totalPending)}  subtitle="Awaiting approval"   icon={Clock}         color="gold" />
            <KpiCard title="Unpaid"          value={fmtInt(totalUnpaid)}    subtitle="No payment yet"      icon={AlertCircle}   color="red" />
          </div>

          {/* Toolbar */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Member Payments</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage offline entries, reminders &amp; receipts · {members.length} member
                  {members.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                >
                  <option value="">All Members</option>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="pending">Pending Approval</option>
                </select>
                <div className="relative w-full sm:w-auto">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-7 pr-7 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-56 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => setSearchInput("")}
                      aria-label="Clear search"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setBulkEmailConfirmOpen(true)}
                  title="Click here to send Email reminders to all unpaid members"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                >
                  <Mail size={13} /> Click here to send Email reminders to all unpaid members
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="px-5 py-2 border-b border-slate-100 flex gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> Pending Approval
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> New Member
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RotaryLoader size="md" label="Loading members…" />
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr>
                      <th className="px-3 py-2.5 text-left w-10">Sr</th>
                      <th className="px-3 py-2.5 text-left">Name</th>
                      <th className="px-3 py-2.5 text-left">Category</th>
                      {enabledFeeTypes.map((ft) => (
                        <th key={`f-${ft.type}`} className="px-3 py-2.5 text-center">
                          {ft.label}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-center">Offline Entry</th>
                      <th className="px-3 py-2.5 text-center">Reminder</th>
                      <th className="px-3 py-2.5 text-center">Receipt</th>
                      <th className="px-3 py-2.5 text-center">Approve / Reject</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paged.length === 0 ? (
                      <tr>
                        <td colSpan={20} className="px-4 py-10 text-center text-slate-400">
                          No members found.
                        </td>
                      </tr>
                    ) : paged.map((m, idx) => {
                      const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                      const isNew = isNotAllocated(m);
                      const isPending = isPendingMember(m);
                      return (
                        <tr key={m.memberFeeId || idx} className={getRowBgClass(m)}>
                          <td className="px-3 py-2 text-slate-500">{globalIdx}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{m.memberName || "–"}</span>
                              {m.isNewMember && (
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                  New
                                </span>
                              )}
                              {isPending && (
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                  Pending
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-600">{m.categoryType || "–"}</td>

                          {/* Fee Amount (the ONE true base amount,
                              comma-formatted — sum matches the dashboard's
                              Total Amount tile) + Status merged into one
                              column per fee type. */}
                          {enabledFeeTypes.map((ft) => {
                            const st = getEditFeeStatus(m, ft.type);
                            return (
                              <td key={`f-${ft.type}`} className="px-3 py-2 text-center">
                                {st === "N/A" ? (
                                  <span className="text-slate-400">N/A</span>
                                ) : (
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-slate-700">{currencySymbol()}{getDisplayFeeAmount(m, ft.type).toLocaleString(appLocale())}</span>
                                    {statusChip(st)}
                                    {st === "Paid" && getPaymentChannelIcon(m, ft.type)}
                                  </div>
                                )}
                              </td>
                            );
                          })}

                          {/* Offline Entry — single button, smart fee-type pre-fill */}
                          <td className="px-3 py-2 text-center">
                            {!isNew && (
                              <button
                                type="button"
                                className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
                                onClick={() => openOfflineEntry(m)}
                              >
                                Offline Entry
                              </button>
                            )}
                          </td>

                          {/* Reminder */}
                          <td className="px-3 py-2 text-center">
                            {!isNew && getUnpaidFeeTypes(m).length > 0 && (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-full text-amber-600 hover:bg-amber-50"
                                  title="Send Email Reminder"
                                  onClick={() => {
                                    if (window.confirm(`Send email reminder to ${m.memberName || "this member"}?`)) {
                                      handleEmailReminder(m.memberFeeId, 0);
                                    }
                                  }}
                                >
                                  <Mail size={14} />
                                </button>
                              </div>
                            )}
                          </td>

                          {/* Receipt */}
                          <td className="px-3 py-2 text-center">
                            {!isNew && hasAnyPaidFee(m) && (
                              receiptSendingId === m.memberFeeId ? (
                                <RotaryLoader size="sm" label="Sending…" />
                              ) : (
                                <button
                                  type="button"
                                  disabled={receiptSendingId !== null}
                                  className="text-xs font-medium text-purple-600 hover:text-purple-800 hover:underline whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                  onClick={() => {
                                    if (window.confirm(`Send receipt to ${m.memberName || "this member"}?`)) {
                                      handleReceipt(m.memberFeeId);
                                    }
                                  }}
                                >
                                  Send
                                </button>
                              )
                            )}
                          </td>

                          {/* Approve / Reject */}
                          <td className="px-3 py-2 text-center">
                            {!isNew && isPending && (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                                  onClick={() => openApprovePopup(m)}
                                >
                                  Approve
                                </button>
                                <span className="text-slate-300">|</span>
                                <button
                                  type="button"
                                  className="text-xs font-medium text-rose-600 hover:text-rose-800 hover:underline"
                                  onClick={() => openRejectPopup(m)}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
              {members.length} member{members.length === 1 ? "" : "s"}
            </div>
          </div>

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <Pagination page={currentPage} totalPages={totalPages} totalCount={members.length} pageSize={pageSize} onPageChange={setCurrentPage} />
          )}

          {/* Offline Payment Dialog — EXACT logic from v1 */}
          <Dialog open={offlineDialogOpen} onOpenChange={setOfflineDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {offlineUpdatePaymentId > 0
                    ? (offlineUpdateIsApproved ? "Update Paid Offline Payment" : "Review & Approve Offline Payment")
                    : "Record Offline Payment"}
                </DialogTitle>
              </DialogHeader>
              {offlineMember && isPendingMember(offlineMember) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-medium text-amber-800">Pending Payment Details:</p>
                  {(offlineMember.pendingTransactionType || offlineMember.PendingTransactionType) && (
                    <p className="text-sm">
                      <strong>Mode:</strong>{" "}
                      {offlineMember.pendingTransactionType || offlineMember.PendingTransactionType}
                    </p>
                  )}
                  {(offlineMember.pendingAmount || offlineMember.PendingAmount) && (
                    <p className="text-sm">
                      <strong>Amount:</strong> {currencySymbol()}
                      {offlineMember.pendingAmount || offlineMember.PendingAmount}
                    </p>
                  )}
                  {(offlineMember.pendingTransactionId || offlineMember.PendingTransactionId) && (
                    <p className="text-sm">
                      <strong>Transaction ID:</strong>{" "}
                      {offlineMember.pendingTransactionId || offlineMember.PendingTransactionId}
                    </p>
                  )}
                  {(offlineMember.pendingGivenTo || offlineMember.PendingGivenTo) && (
                    <p className="text-sm">
                      <strong>Given To:</strong>{" "}
                      {offlineMember.pendingGivenTo || offlineMember.PendingGivenTo}
                    </p>
                  )}
                  {(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate) && (
                    <p className="text-sm">
                      <strong>Date:</strong>{" "}
                      {new Date(
                        offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate
                      ).toLocaleDateString(appLocale())}
                    </p>
                  )}
                  {(offlineMember.pendingRemark || offlineMember.PendingRemark) && (
                    <p className="text-sm">
                      <strong>Remark:</strong>{" "}
                      {offlineMember.pendingRemark || offlineMember.PendingRemark}
                    </p>
                  )}
                  {(offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                    <a
                      href={`${API_BASE_URL}${
                        offlineMember.pendingAttachment || offlineMember.PendingAttachment
                      }`}
                      target="_blank"
                      className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                      <FileText className="h-3 w-3" /> View Attachment
                    </a>
                  )}
                </div>
              )}
              <div className="space-y-3">
                {offlineMember && (
                  <div className="text-sm text-slate-600">
                    <strong>Member:</strong> {offlineMember.memberName}
                  </div>
                )}
                <div>
                  <Label>
                    Fee Type <span className="text-destructive">*</span>
                  </Label>
                  <Select value={offlineFeeType} onValueChange={handleOfflineFeeTypeChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select fee type" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableFeeTypes(offlineMember).map((ft) => (
                        <SelectItem key={ft.type} value={String(ft.type)}>
                          {ft.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {offlineUpdatePaymentId > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      {offlineUpdateIsApproved
                        ? "Editing a paid offline payment: status stays Approved."
                        : "Saving will approve this payment and email the receipt to the member. If CP/Secretary later clicks Approve/Reject from their email, they'll see “already approved”."}
                    </p>
                  )}
                </div>
                {offlineOnlineView ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-1.5">
                    <p className="text-sm font-medium text-emerald-800">Paid via Payment Gateway (online)</p>
                    <p className="text-sm"><strong>Mode:</strong> {offlineOnlineView.mode}</p>
                    {offlineOnlineView.txnId && (
                      <p className="text-sm"><strong>Transaction ID:</strong> {offlineOnlineView.txnId}</p>
                    )}
                    {offlineOnlineView.amount > 0 && (
                      <p className="text-sm"><strong>Amount:</strong> {currencySymbol()}{offlineOnlineView.amount.toLocaleString(appLocale())}</p>
                    )}
                    {offlineOnlineView.date && (
                      <p className="text-sm"><strong>Date:</strong> {new Date(offlineOnlineView.date).toLocaleDateString(appLocale())}</p>
                    )}
                    <p className="text-sm"><strong>Status:</strong> Paid (Online)</p>
                    <p className="text-xs text-emerald-700 mt-1">Gateway payments can't be edited offline: viewing only.</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <Label>Payment Mode</Label>
                      <div className="flex gap-3 mt-1">
                        {["NEFT/IMPS/RTGS", "Cash", "Cheque"].map((mode) => (
                          <label key={mode} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="radio"
                              name="offlineMode"
                              value={mode}
                              checked={offlinePaymentMode === mode}
                              onChange={(e) => setOfflinePaymentMode(e.target.value)}
                              className="accent-primary"
                            />
                            {mode}
                          </label>
                        ))}
                      </div>
                    </div>
                    {offlinePaymentMode === "NEFT/IMPS/RTGS" && (
                      <div>
                        <Label>Transaction ID</Label>
                        <Input
                          value={offlineTxnId}
                          onChange={(e) => setOfflineTxnId(e.target.value)}
                          placeholder="Enter transaction ID"
                        />
                      </div>
                    )}
                    {(offlinePaymentMode === "Cash" || offlinePaymentMode === "Cheque") && (
                      <div>
                        <Label>
                          Given To <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          value={offlineGivenTo}
                          onChange={(e) => setOfflineGivenTo(e.target.value)}
                          placeholder="Enter name"
                        />
                      </div>
                    )}
                    <div>
                      <Label>
                        Date <span className="text-destructive">*</span>
                      </Label>
                      <DateField value={offlineDate} onChange={setOfflineDate} />
                    </div>
                    <div>
                      <Label>Remark</Label>
                      <Input
                        value={offlineRemark}
                        onChange={(e) => setOfflineRemark(e.target.value)}
                        placeholder="Optional remark"
                      />
                    </div>
                    <div>
                      <Label>Attachment</Label>
                      <Input
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                        onChange={(e) => setOfflineAttachment(e.target.files?.[0] || null)}
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX
                      </p>
                      {offlineMember &&
                        (offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                          <a
                            href={`${API_BASE_URL}${
                              offlineMember.pendingAttachment || offlineMember.PendingAttachment
                            }`}
                            target="_blank"
                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                          >
                            View existing attachment
                          </a>
                        )}
                    </div>
                    {offlineUpdatePaymentId > 0 && offlineExistingAttachment && (
                      <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs">
                        Existing attachment:{" "}
                        <a href={`${API_BASE_URL}${offlineExistingAttachment}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">view</a>{" "}
                        (uploading a new one replaces it)
                      </div>
                    )}
                    {offlineUpdatePaymentId > 0 && !offlineUpdateIsApproved && (
                      <div>
                        <Label>
                          Approval Remark <span className="text-muted-foreground text-xs">(optional)</span>
                        </Label>
                        <Input
                          value={offlineApprovalRemark}
                          onChange={(e) => setOfflineApprovalRemark(e.target.value)}
                          placeholder="Optional: appears on receipt email"
                        />
                      </div>
                    )}
                    {offlineUpdatePaymentId === 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          checked={offlineSendEmail}
                          onCheckedChange={(c) => setOfflineSendEmail(!!c)}
                          id="offlineSendEmail"
                        />
                        <Label htmlFor="offlineSendEmail">Send Email Receipt</Label>
                      </div>
                    )}
                    {offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          checked={offlineSendReceiptOnUpdate}
                          onCheckedChange={(c) => setOfflineSendReceiptOnUpdate(!!c)}
                          id="offlineSendReceiptOnUpdate"
                        />
                        <Label htmlFor="offlineSendReceiptOnUpdate">Send updated receipt to member</Label>
                      </div>
                    )}
                    <Button
                      onClick={handleOfflineSave}
                      disabled={offlineSaving}
                      className="w-full"
                    >
                      {offlineSaving ? <span className="mr-1"><RotaryLoader size="sm" /></span> : null}
                      {offlineUpdatePaymentId > 0
                        ? (offlineUpdateIsApproved ? "Save Changes" : "Save & Approve")
                        : "Save"}
                    </Button>
                    {isSuperAdmin && offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && (
                      <Button
                        variant="outline"
                        onClick={handleRemovePayment}
                        disabled={removingPayment}
                        className="w-full text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                      >
                        {removingPayment ? <span className="mr-1"><RotaryLoader size="sm" /></span> : null}
                        Remove Payment (SuperAdmin)
                      </Button>
                    )}
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* Approve Dialog — shows submitted details + optional remark */}
          <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Approve Payment</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <PendingDetailsPanel details={pendingDetails} />
                <div>
                  <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Textarea
                    value={approveRemark}
                    onChange={(e) => setApproveRemark(e.target.value)}
                    placeholder="Optional remark: will appear on the receipt email if provided"
                  />
                </div>
                <Button onClick={handleApproveSubmit} className="w-full bg-green-600 hover:bg-green-700">
                  Approve Payment
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Reject Dialog — shows submitted details + required reason */}
          <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Reject Payment</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <PendingDetailsPanel details={pendingDetails} />
                <div>
                  <Label>Rejection Reason <span className="text-red-600">*</span></Label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter reason for rejection (required)"
                    required
                  />
                </div>
                <Button variant="destructive" onClick={handleRejectSubmit} disabled={!rejectReason.trim()} className="w-full">
                  Reject Payment
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Bulk Email confirm — simple OK/Cancel (user requested no remark) */}
          <Dialog open={bulkEmailConfirmOpen} onOpenChange={setBulkEmailConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Bulk Email Reminders</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-700">Do you want to send Mail to all unpaid members?</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setBulkEmailConfirmOpen(false)}>Cancel</Button>
                  <Button onClick={handleBulkEmailReminder}>Send</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>


          {/* Individual Email Reminder Remark Dialog — EXACT logic from v1 */}
          <Dialog open={emailRemarkDialogOpen} onOpenChange={setEmailRemarkDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Email Reminder</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Remark (optional)</Label>
                  <Input
                    value={emailRemark}
                    onChange={(e) => setEmailRemark(e.target.value)}
                    placeholder="Add a remark to the reminder email"
                  />
                </div>
                <Button
                  onClick={async () => {
                    await handleEmailReminder(emailRemarkMemberFeeId, 0);
                    setEmailRemarkDialogOpen(false);
                    setEmailRemark("");
                  }}
                  className="w-full"
                >
                  Send Reminder
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <SuccessAlert
            open={!!successMessage}
            title="Success"
            description={successMessage || ""}
            onOk={() => setSuccessMessage(null)}
          />
          <ErrorAlert
            open={!!errorMessage}
            title="Error"
            description={errorMessage || ""}
            onOk={() => setErrorMessage(null)}
          />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
