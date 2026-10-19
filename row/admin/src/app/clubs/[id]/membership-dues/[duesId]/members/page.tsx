"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { getMembershipDuesMembers, getMembershipDuesDetail, recordMembershipDuesOffline, approveMembershipDuesPayment, getMembershipDuesOfflineDetails, updateMembershipDuesOffline, deleteMembershipDuesPayment, sendMembershipDuesReceipt, sendMembershipDuesReminder, bulkMembershipDuesReminderEmail } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Mail, FileText, Globe, Banknote, Send,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { appLocale, currencySymbol } from "@/lib/appFormat";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Read-only preview of the member's submitted offline payment — shown inside
// the Approve / Reject dialogs so admin sees the data the member filled in
// from /pay/dues/{id} before deciding. Hidden when no pending details exist
// (e.g. legacy data without a row reference).
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


export default function ClubMembershipDuesMembersPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const duesId = Number(params.duesId);

  const [members, setMembers] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Offline dialog — same state as SuperAdmin
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
  // When set, save → PUT update endpoint instead of POST. Also tracks if the
  // row is already Paid/Approved so we can offer "Send updated receipt".
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

  // Approve dialog — optional remark, mirrors reject layout
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approvePaymentId, setApprovePaymentId] = useState(0);
  const [approveRemark, setApproveRemark] = useState("");

  // Reject dialog — same as SuperAdmin
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectPaymentId, setRejectPaymentId] = useState(0);
  const [rejectReason, setRejectReason] = useState("");

  // Snapshot of the member's submitted offline details — shown inside both
  // dialogs so admin sees WHAT they're approving/rejecting before deciding.
  // Pulled directly from the members row (it already has PendingTransactionType,
  // PendingAmount, etc.); no extra fetch needed.
  const [pendingDetails, setPendingDetails] = useState<any>(null);

  // Bulk email remark dialog — same as SuperAdmin
  const [bulkRemarkDialogOpen, setBulkRemarkDialogOpen] = useState(false);
  const [bulkRemark, setBulkRemark] = useState("");

  // Individual email remark dialog — same as SuperAdmin
  const [emailRemarkDialogOpen, setEmailRemarkDialogOpen] = useState(false);
  const [emailRemarkMemberFeeId, setEmailRemarkMemberFeeId] = useState(0);
  const [emailRemark, setEmailRemark] = useState("");

  // ── Fetch ──
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [membersData, detailData] = await Promise.all([
        getMembershipDuesMembers(duesId, { search: search || undefined, filter: filter || undefined }),
        getMembershipDuesDetail(duesId),
      ]);
      setMembers(Array.isArray(membersData) ? membersData : membersData.members || membersData.Members || []);
      setDetail(detailData);
      setCurrentPage(1);
    } catch { setErrorMessage("Failed to load members"); }
    finally { setLoading(false); }
  }, [duesId, search, filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fee type helpers — same as SuperAdmin ──
  const enabledFeeTypes: { type: number; label: string }[] = [];
  if (detail?.isFees1) enabledFeeTypes.push({ type: 1, label: detail.fees1Text || "Annual" });
  if (detail?.isFees2) enabledFeeTypes.push({ type: 2, label: detail.fees2Text || "Semi 1" });
  if (detail?.isFees3) enabledFeeTypes.push({ type: 3, label: detail.fees3Text || "Semi 2" });

  // Smart fee filter for the Offline Entry dropdown.
  //   Paid fee types STAY in the dropdown so admin can pick and view the
  //   saved details (offline → editable update; online → read-only panel).
  //   Annual is hidden when any Semi is paid (mixing whole + half is invalid).
  //   Semi1 / Semi2 are hidden when Annual is paid (same reason).
  //   Nothing paid → all enabled fee types.
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

  const getEditFeeAmount = (m: any, ft: number) => ft === 1 ? (m.annualAmount ?? 0) : ft === 2 ? (m.semi1Amount ?? 0) : (m.semi2Amount ?? 0);
  const getEditFeePaid = (m: any, ft: number) => ft === 1 ? (m.annualPaid ?? 0) : ft === 2 ? (m.semi1Paid ?? 0) : (m.semi2Paid ?? 0);

  // Displayed amount is the MEMBER'S OWN fee (per-member row in
  // membership_dues_member_fees), NOT the campaign default — each member can
  // carry a different due (category-based, new-member, custom), and the listing
  // must reflect that member-wise amount rather than one flat figure for all.
  const getDisplayFeeAmount = (m: any, ft: number) =>
    Math.round(getEditFeeAmount(m, ft));

  const isNotAllocated = (m: any): boolean => enabledFeeTypes.every(ft => getEditFeeAmount(m, ft.type) === 0);

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Paid": return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Paid</Badge>;
      case "Pending": return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pending</Badge>;
      case "Unpaid": return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Unpaid</Badge>;
      case "N/A": return <span className="text-muted-foreground">N/A</span>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Small Online/Offline indicator shown under the Paid badge. Uses the
  // payment-mode column from the members payload — "Payment Gateway" means
  // online, anything else is an offline mode (Cash/Cheque/NEFT/...).
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

  const getRowColor = (m: any) => {
    if (m.hasPendingApproval) return "bg-yellow-100";
    if (m.isNewMember) return "bg-green-200";
    return "";
  };

  const getUnpaidFeeTypes = (m: any) => enabledFeeTypes.filter(ft => {
    const s = getEditFeeStatus(m, ft.type);
    return s === "Unpaid" || s === "Pending";
  });
  const hasAnyPaidFee = (m: any) => enabledFeeTypes.some(ft => getEditFeeStatus(m, ft.type) === "Paid");

  // ── Offline — SAME as SuperAdmin ──
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

  // Single "Offline Entry" entry point. Pass a member row to pre-select that
  // member; pass null (from the top-level "+ Add Offline Entry" button) to
  // open the dialog with the member dropdown blank so admin can pick anyone.
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

  // Called when admin picks a fee type inside the offline dialog. Looks at the
  // member row for an existing pending / paid-offline payment for that fee
  // type. If found, fetches the full payment detail (for paid-offline) or uses
  // the row's pendingX fields (for pending) and switches the dialog into UPDATE
  // mode. If the fee type is paid ONLINE (gateway), blocks editing.
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
    // also resets the editable form fields so a stale Save can't fire.
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

    // Unpaid / no existing offline payment — reset to a blank NEW entry.
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

  // Open the Update Offline dialog for an already-Paid offline payment. Fetches
  // the existing payment details and pre-fills the form. Status stays as-is
  // when admin saves; if the payment is Approved, a "Send updated receipt"
  // checkbox is offered.
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
      const isApproved = String(det.offlineStatus || "").toLowerCase() === "approved";
      setOfflineUpdateIsApproved(isApproved);
      setOfflineSendReceiptOnUpdate(false);
      setOfflineSendEmail(false);
      setOfflineDialogOpen(true);
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to load payment details.");
    }
  };

  const handleOfflineSave = async () => {
    if (!offlineMember || !offlineFeeType || !offlineDate) {
      setErrorMessage("Fee Type and Date are required."); return;
    }
    if ((offlinePaymentMode === "Cash" || offlinePaymentMode === "Cheque") && !offlineGivenTo.trim()) {
      setErrorMessage("'Given To' is required for Cash and Cheque payments."); return;
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
        // Update mode — PUT to update-offline endpoint. Status is preserved
        // unless the row was Pending (server auto-approves on save).
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
    } finally { setOfflineSaving(false); }
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

  // ── Approve — opens the dialog so admin can OPTIONALLY add a remark. ──
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
  const handleApprove = (paymentId: number) => {
    // Deep-link path (?action=approve&paymentId=…). We don't have the full row
    // here, so fall back to fetching from the loaded members list by pending
    // payment id; the dialog renders whatever we found (or nothing).
    setApprovePaymentId(paymentId);
    setPendingDetails(extractPendingDetails(findMemberByPendingPaymentId(paymentId)));
    setApproveRemark("");
    setApproveDialogOpen(true);
  };

  const findMemberByPendingPaymentId = (pid: number) =>
    members.find((m: any) => Number(m.pendingPaymentId ?? m.PendingPaymentId) === Number(pid));

  // Pull the offline-payment details the member submitted from the row. Keys
  // come from MembershipDuesService.GetMembersAsync (Pending* columns).
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

  const handleApproveSubmit = async () => {
    try {
      const res: any = await approveMembershipDuesPayment(approvePaymentId, {
        isApproved: true,
        approvalRemark: approveRemark.trim() || undefined,
      });
      // Backend returns 200 { alreadyHandled: true, message } when the payment
      // was already approved/rejected — surface that as a notice, not an error.
      setSuccessMessage(res?.message || "Payment approved!");
      setApproveDialogOpen(false);
      setApproveRemark("");
      fetchData();
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to approve."); }
  };

  // ── Reject — REMARK IS MANDATORY ──
  const handleRejectSubmit = async () => {
    if (!rejectReason.trim()) {
      setErrorMessage("Rejection reason is required.");
      return;
    }
    try {
      const res: any = await approveMembershipDuesPayment(rejectPaymentId, { isApproved: false, rejectionReason: rejectReason.trim() });
      setSuccessMessage(res?.message || "Payment rejected.");
      setRejectDialogOpen(false);
      setRejectReason("");
      fetchData();
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to reject."); }
  };

  // ── Auto-action from email deep link (?action=approve|reject&paymentId=…) ──
  // Runs once after the page hydrates. Approves directly, or opens the reject
  // dialog with the paymentId pre-filled. Clears the URL so a refresh doesn't
  // re-trigger the action.
  const autoActionRan = useRef(false);
  useEffect(() => {
    if (autoActionRan.current) return;
    const action = searchParams.get("action");
    const pidStr = searchParams.get("paymentId");
    if (!action || !pidStr) return;
    const pid = Number(pidStr);
    if (!pid) return;
    autoActionRan.current = true;
    // strip the action params from the URL so a manual refresh is idempotent
    const cleanUrl = `/clubs/${clubId}/membership-dues/${duesId}/members`;
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

  // ── Reminder — SAME as SuperAdmin ──
  const handleEmailReminder = async (memberFeeId: number, feeType: number) => {
    try {
      await sendMembershipDuesReminder(duesId, memberFeeId, { feeType, remark: emailRemark || undefined });
      setSuccessMessage("Email reminder sent!");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to send reminder."); }
  };


  // ── Receipt — SAME as SuperAdmin ──
  const handleReceipt = async (memberFeeId: number) => {
    try {
      await sendMembershipDuesReceipt(memberFeeId);
      setSuccessMessage("Receipt sent!");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to send receipt."); }
  };

  // ── Bulk — SAME as SuperAdmin ──
  const handleBulkEmailReminder = async () => {
    try {
      await bulkMembershipDuesReminderEmail(duesId, { remark: bulkRemark || undefined });
      setSuccessMessage("Bulk email reminders sent!");
      setBulkRemarkDialogOpen(false);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
  };


  // ── Pagination ──
  const totalPages = Math.ceil(members.length / pageSize);
  const paged = members.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (!isSuperAdmin && !isAdmin) {
    return <ProtectedRoute><div className="flex justify-center py-20"><h3>Access Denied</h3></div></ProtectedRoute>;
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />


        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/membership-dues`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {detail?.purpose || "Club Dues"} - Members
            </h2>
            <p className="text-muted-foreground text-base">
              {detail?.rotaryYear || ""} {detail?.clubName ? `| ${detail.clubName}` : ""}
            </p>
          </div>
        </div>

        {/* Bulk Actions — same as SuperAdmin */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { setBulkRemark(""); setBulkRemarkDialogOpen(true); }}>
            <Mail className="h-4 w-4 mr-1" />Bulk Email
          </Button>
        </div>

        {/* Search + Filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by name..." className="w-64" />
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">All Members</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="pending">Pending Approval</option>
          </select>
          <span className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 inline-block" /> Pending Approval</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> New Member</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
        ) : (
          <>
            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground w-[50px]">Sr.</TableHead>
                    <TableHead className="text-primary-foreground">Name</TableHead>
                    <TableHead className="text-primary-foreground">Category</TableHead>
                    {enabledFeeTypes.map(ft => (
                      <TableHead key={ft.type} className="text-primary-foreground text-center">{ft.label}</TableHead>
                    ))}
                    <TableHead className="text-primary-foreground text-center">Offline Entry</TableHead>
                    <TableHead className="text-primary-foreground text-center">Reminder</TableHead>
                    <TableHead className="text-primary-foreground text-center">Receipt</TableHead>
                    <TableHead className="text-primary-foreground text-center">Approve/Reject</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.length === 0 ? (
                    <TableRow><TableCell colSpan={20} className="text-center text-muted-foreground py-8">No members found</TableCell></TableRow>
                  ) : paged.map((m, idx) => {
                    const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                    const isNew = isNotAllocated(m);
                    const isPending = m.hasPendingApproval || m.HasPendingApproval;
                    return (
                      <TableRow key={m.memberFeeId || idx} className={`border-b ${getRowColor(m)}`}>
                        <TableCell className="text-center">{globalIdx}</TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {m.memberName || "-"}
                          {m.isNewMember && <Badge variant="secondary" className="ml-2 text-xs">New</Badge>}
                          {isPending && <Badge variant="outline" className="ml-2 text-xs border-yellow-500 text-yellow-700">Pending</Badge>}
                        </TableCell>
                        <TableCell>{m.categoryType || "-"}</TableCell>

                        {/* Fee Amount + Status merged into one column per fee type */}
                        {enabledFeeTypes.map(ft => {
                          const status = getEditFeeStatus(m, ft.type);
                          return (
                            <TableCell key={ft.type} className="text-center">
                              {status === "N/A" ? (
                                <span className="text-muted-foreground">N/A</span>
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <span>{currencySymbol()}{getDisplayFeeAmount(m, ft.type).toFixed(0)}</span>
                                  {getStatusBadge(status)}
                                  {status === "Paid" && getPaymentChannelIcon(m, ft.type)}
                                </div>
                              )}
                            </TableCell>
                          );
                        })}

                        {/* Offline Entry — one button per row; dialog auto-pre-fills from
                            pending/paid-offline based on the fee type the admin picks. */}
                        <TableCell className="text-center">
                          {!isNew && (
                            <button className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                              onClick={() => openOfflineEntry(m)}>
                              Offline Entry
                            </button>
                          )}
                        </TableCell>

                        <TableCell>
                          {!isNew && getUnpaidFeeTypes(m).length > 0 && (
                            <div className="flex gap-2">
                              <button className="text-orange-600 hover:text-orange-800" title="Send Email Reminder" onClick={() => { setEmailRemarkMemberFeeId(m.memberFeeId); setEmailRemark(""); setEmailRemarkDialogOpen(true); }}>
                                <Mail className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </TableCell>

                        {/* Receipt — same as SuperAdmin */}
                        <TableCell>
                          {!isNew && hasAnyPaidFee(m) && (
                            <button className="text-xs text-purple-600 hover:underline whitespace-nowrap" onClick={() => handleReceipt(m.memberFeeId)}>Send</button>
                          )}
                        </TableCell>

                        {/* Approve/Reject — same as SuperAdmin: Approve direct, Reject dialog */}
                        <TableCell>
                          {!isNew && isPending && (
                            <div className="flex gap-1">
                              <button className="text-xs text-green-700 hover:underline" onClick={() => openApprovePopup(m)}>Approve</button>
                              <button className="text-xs text-red-600 hover:underline" onClick={() => openRejectPopup(m)}>Reject</button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</Button>
                <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
                <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
              </div>
            )}
          </>
        )}

        {/* Offline Payment Dialog — record / update */}
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
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium text-yellow-800">Pending Payment Details:</p>
                {(offlineMember.pendingTransactionType || offlineMember.PendingTransactionType) && (
                  <p className="text-sm"><strong>Mode:</strong> {offlineMember.pendingTransactionType || offlineMember.PendingTransactionType}</p>
                )}
                {(offlineMember.pendingAmount || offlineMember.PendingAmount) && (
                  <p className="text-sm"><strong>Amount:</strong> {currencySymbol()}{offlineMember.pendingAmount || offlineMember.PendingAmount}</p>
                )}
                {(offlineMember.pendingTransactionId || offlineMember.PendingTransactionId) && (
                  <p className="text-sm"><strong>Transaction ID:</strong> {offlineMember.pendingTransactionId || offlineMember.PendingTransactionId}</p>
                )}
                {(offlineMember.pendingGivenTo || offlineMember.PendingGivenTo) && (
                  <p className="text-sm"><strong>Given To:</strong> {offlineMember.pendingGivenTo || offlineMember.PendingGivenTo}</p>
                )}
                {(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate) && (
                  <p className="text-sm"><strong>Date:</strong> {new Date(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate).toLocaleDateString(appLocale())}</p>
                )}
                {(offlineMember.pendingRemark || offlineMember.PendingRemark) && (
                  <p className="text-sm"><strong>Remark:</strong> {offlineMember.pendingRemark || offlineMember.PendingRemark}</p>
                )}
                {(offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                  <a href={`${API_BASE_URL}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                    target="_blank" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" /> View Attachment
                  </a>
                )}
              </div>
            )}
            <div className="space-y-3">
              {offlineMember && (
                <div className="text-sm text-muted-foreground">
                  <strong>Member:</strong> {offlineMember.memberName}
                </div>
              )}
              <div>
                <Label>Fee Type <span className="text-destructive">*</span></Label>
                <Select value={offlineFeeType} onValueChange={handleOfflineFeeTypeChange}>
                  <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                  <SelectContent>
                    {getAvailableFeeTypes(offlineMember).map(ft => (
                      <SelectItem key={ft.type} value={String(ft.type)}>{ft.label}</SelectItem>
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
                // Gateway-paid fee type → read-only summary. No editable fields,
                // no Save button. Admin can still pick a different fee type from
                // the dropdown above to switch back to editing.
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
                      {["NEFT/IMPS/RTGS", "Cash", "Cheque"].map(mode => (
                        <label key={mode} className="flex items-center gap-1.5 text-sm">
                          <input type="radio" name="offlineMode" value={mode} checked={offlinePaymentMode === mode} onChange={e => setOfflinePaymentMode(e.target.value)} className="accent-primary" />
                          {mode}
                        </label>
                      ))}
                    </div>
                  </div>
                  {offlinePaymentMode === "NEFT/IMPS/RTGS" && (
                    <div><Label>Transaction ID</Label><Input value={offlineTxnId} onChange={e => setOfflineTxnId(e.target.value)} placeholder="Enter transaction ID" /></div>
                  )}
                  {(offlinePaymentMode === "Cash" || offlinePaymentMode === "Cheque") && (
                    <div><Label>Given To <span className="text-destructive">*</span></Label><Input value={offlineGivenTo} onChange={e => setOfflineGivenTo(e.target.value)} placeholder="Enter name" /></div>
                  )}
                  <div><Label>Date <span className="text-destructive">*</span></Label><DateField value={offlineDate} onChange={setOfflineDate} /></div>
                  <div><Label>Remark</Label><Input value={offlineRemark} onChange={e => setOfflineRemark(e.target.value)} placeholder="Optional remark" /></div>
                  <div>
                    <Label>Attachment</Label>
                    <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={e => setOfflineAttachment(e.target.files?.[0] || null)} />
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX</p>
                    {offlineMember && (offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                      <a href={`${API_BASE_URL}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                        target="_blank" className="text-xs text-blue-600 hover:underline mt-1 inline-block">View existing attachment</a>
                    )}
                  </div>
                  {offlineUpdatePaymentId > 0 && offlineExistingAttachment && (
                    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs">
                      Existing attachment: <a href={`${API_BASE_URL}${offlineExistingAttachment}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">view</a> (uploading a new one replaces it)
                    </div>
                  )}
                  {/* Approval remark — only when updating a Pending row (auto-approve on save) */}
                  {offlineUpdatePaymentId > 0 && !offlineUpdateIsApproved && (
                    <div>
                      <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input value={offlineApprovalRemark} onChange={e => setOfflineApprovalRemark(e.target.value)} placeholder="Optional: appears on receipt email" />
                    </div>
                  )}
                  {/* Send Email Receipt — only for new entries (not for updates) */}
                  {offlineUpdatePaymentId === 0 && (
                    <div className="flex items-center gap-2">
                      <Checkbox checked={offlineSendEmail} onCheckedChange={c => setOfflineSendEmail(!!c)} id="offlineSendEmail" />
                      <Label htmlFor="offlineSendEmail">Send Email Receipt</Label>
                    </div>
                  )}
                  {/* Send updated receipt — only when updating an already-Approved row */}
                  {offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && (
                    <div className="flex items-center gap-2">
                      <Checkbox checked={offlineSendReceiptOnUpdate} onCheckedChange={c => setOfflineSendReceiptOnUpdate(!!c)} id="offlineSendReceiptOnUpdate" />
                      <Label htmlFor="offlineSendReceiptOnUpdate">Send updated receipt to member</Label>
                    </div>
                  )}
                  <Button onClick={handleOfflineSave} disabled={offlineSaving} className="w-full">
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

        {/* Approve Dialog — shows what the member submitted + optional remark */}
        <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Approve Payment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <PendingDetailsPanel details={pendingDetails} />
              <div>
                <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Textarea
                  value={approveRemark}
                  onChange={e => setApproveRemark(e.target.value)}
                  placeholder="Optional remark: will appear on the receipt email if provided"
                />
              </div>
              <Button onClick={handleApproveSubmit} className="w-full bg-green-600 hover:bg-green-700">Approve Payment</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Reject Dialog — shows what the member submitted + required reason */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Reject Payment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <PendingDetailsPanel details={pendingDetails} />
              <div>
                <Label>Rejection Reason <span className="text-red-600">*</span></Label>
                <Textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Enter reason for rejection (required)"
                  required
                />
              </div>
              <Button variant="destructive" onClick={handleRejectSubmit} disabled={!rejectReason.trim()} className="w-full">Reject Payment</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk Email Remark Dialog — EXACT COPY from SuperAdmin */}
        <Dialog open={bulkRemarkDialogOpen} onOpenChange={setBulkRemarkDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Send Bulk Email Reminders</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Remark (optional)</Label><Input value={bulkRemark} onChange={e => setBulkRemark(e.target.value)} placeholder="Optional remark" /></div>
              <Button onClick={handleBulkEmailReminder} className="w-full">Send Reminders</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Individual Email Reminder Remark Dialog — EXACT COPY from SuperAdmin */}
        <Dialog open={emailRemarkDialogOpen} onOpenChange={setEmailRemarkDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Send Email Reminder</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Remark (optional)</Label><Input value={emailRemark} onChange={e => setEmailRemark(e.target.value)} placeholder="Add a remark to the reminder email" /></div>
              <Button onClick={async () => {
                await handleEmailReminder(emailRemarkMemberFeeId, 0);
                setEmailRemarkDialogOpen(false);
                setEmailRemark("");
              }} className="w-full">Send Reminder</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}

function isPendingMember(m: any): boolean {
  return !!(m.hasPendingApproval || m.HasPendingApproval);
}
