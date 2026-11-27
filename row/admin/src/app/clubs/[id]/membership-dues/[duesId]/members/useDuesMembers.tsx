import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { getMembershipDuesMembers, getMembershipDuesDetail, recordMembershipDuesOffline, approveMembershipDuesPayment, getMembershipDuesOfflineDetails, updateMembershipDuesOffline, deleteMembershipDuesPayment, sendMembershipDuesReceipt, sendMembershipDuesReminder, bulkMembershipDuesReminderEmail } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrencySymbol } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { Globe, Banknote } from "@/components/icons";
import { appLocale } from "@/lib/appFormat";

export function useDuesMembers() {
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

  // Super Admin settings (user 2026-11-09): currency sign + send channels. Old API = "INR" / on.
  const cur = getCurrencySymbol(detail?.currency);
  const emailOn = detail?.notifyEmail ?? true;

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
      case "Paid": return <Badge className="bg-green-100 text-green-700">Paid</Badge>;
      case "Pending": return <Badge className="bg-yellow-100 text-yellow-700">Pending</Badge>;
      case "Unpaid": return <Badge className="bg-red-100 text-red-700">Unpaid</Badge>;
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
  return { isSuperAdmin, isAdmin, clubId, members, detail, loading, search, setSearch, filter, setFilter, successMessage, setSuccessMessage, errorMessage, setErrorMessage, currentPage, setCurrentPage, pageSize, offlineDialogOpen, setOfflineDialogOpen, offlineMember, offlineFeeType, offlinePaymentMode, setOfflinePaymentMode, offlineTxnId, setOfflineTxnId, offlineGivenTo, setOfflineGivenTo, offlineRemark, setOfflineRemark, offlineDate, setOfflineDate, setOfflineAttachment, offlineSendEmail, setOfflineSendEmail, offlineSaving, removingPayment, offlineUpdatePaymentId, offlineUpdateIsApproved, offlineSendReceiptOnUpdate, setOfflineSendReceiptOnUpdate, offlineExistingAttachment, offlineApprovalRemark, setOfflineApprovalRemark, offlineOnlineView, approveDialogOpen, setApproveDialogOpen, approveRemark, setApproveRemark, rejectDialogOpen, setRejectDialogOpen, rejectReason, setRejectReason, pendingDetails, bulkRemarkDialogOpen, setBulkRemarkDialogOpen, bulkRemark, setBulkRemark, emailRemarkDialogOpen, setEmailRemarkDialogOpen, emailRemarkMemberFeeId, setEmailRemarkMemberFeeId, emailRemark, setEmailRemark, cur, emailOn, enabledFeeTypes, getAvailableFeeTypes, getDisplayFeeAmount, isNotAllocated, getEditFeeStatus, getStatusBadge, getPaymentChannelIcon, getRowColor, getUnpaidFeeTypes, hasAnyPaidFee, openOfflineEntry, handleOfflineFeeTypeChange, handleOfflineSave, handleRemovePayment, openApprovePopup, openRejectPopup, handleApproveSubmit, handleRejectSubmit, handleEmailReminder, handleReceipt, handleBulkEmailReminder, totalPages, paged };
}

export type DuesMembersCtx = ReturnType<typeof useDuesMembers>;
