import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { getMembershipDuesMembers, getMembershipDuesDetail, allocateMembershipDuesFees, updateMembershipDuesMemberFee, recordMembershipDuesOffline, approveMembershipDuesPayment, getMembershipDuesOfflineDetails, updateMembershipDuesOffline, sendMembershipDuesReceipt, sendMembershipDuesReminder, bulkMembershipDuesReminderEmail, revertMembershipDuesPayment } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrencySymbol } from "@/lib/currency";
import { Info, Globe, Banknote } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { appLocale } from "@/lib/appFormat";
import { DuesDetail, VendorSplit, DuesMember } from "./duesMembersShared";

export function useDuesMembers() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const duesId = Number(params.duesId);

  const [duesDetail, setDuesDetail] = useState<DuesDetail | null>(null);
  // Offline only = collected by hand, nothing split (user 2026-11-13): no vendor "Accounts" columns / vendor boxes.
  const offlineOnly = duesDetail?.modeOfPayment === 2;
  const [members, setMembers] = useState<DuesMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [allocating, setAllocating] = useState(false);

  // Remark dialog for bulk email / individual reminder
  const [remarkDialogOpen, setRemarkDialogOpen] = useState(false);
  const [remarkSending, setRemarkSending] = useState(false);
  const [remarkText, setRemarkText] = useState("");
  const [remarkTarget, setRemarkTarget] = useState<{
    type: "bulk-email" | "reminder-email";
    memberFeeId?: number;
    feeType?: number;
  } | null>(null);


  // Offline payment dialog
  const [offlineDialogOpen, setOfflineDialogOpen] = useState(false);
  const [offlineSaving, setOfflineSaving] = useState(false);
  const [offlineMember, setOfflineMember] = useState<DuesMember | null>(null);
  const [offlineFeeType, setOfflineFeeType] = useState("");
  const [offlineTransactionType, setOfflineTransactionType] = useState("");
  const [offlineTransactionId, setOfflineTransactionId] = useState("");
  const [offlineGivenTo, setOfflineGivenTo] = useState("");
  const [offlineBankName, setOfflineBankName] = useState("");
  const [offlineChequeNo, setOfflineChequeNo] = useState("");
  const [offlineRemark, setOfflineRemark] = useState("");
  const [offlineDate, setOfflineDate] = useState("");
  const [offlineAttachment, setOfflineAttachment] = useState<File | null>(null);
  const [offlineSendReceipt, setOfflineSendReceipt] = useState(false);
  const [offlineUpdatePaymentId, setOfflineUpdatePaymentId] = useState(0);
  const [offlineUpdateIsApproved, setOfflineUpdateIsApproved] = useState(false);
  const [offlineSendReceiptOnUpdate, setOfflineSendReceiptOnUpdate] = useState(false);
  const [offlineExistingAttachment, setOfflineExistingAttachment] = useState<string | null>(null);
  // Optional approver remark — surfaced only when admin is saving an update on
  // a Pending row (the save auto-approves the payment server-side).
  const [offlineApprovalRemark, setOfflineApprovalRemark] = useState("");
  // Read-only snapshot of an online (gateway) payment. Shown when admin picks
  // a fee type that was paid via Payment Gateway — admin can SEE but not EDIT.
  const [offlineOnlineView, setOfflineOnlineView] = useState<{
    mode: string; txnId: string; amount: number; date: string | null;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit member fee dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMember, setEditMember] = useState<DuesMember | null>(null);
  const [editCategoryType, setEditCategoryType] = useState("");
  const [editFees1Amount, setEditFees1Amount] = useState("");
  const [editOfflineFees1, setEditOfflineFees1] = useState("");
  const [editFees2Amount, setEditFees2Amount] = useState("");
  const [editOfflineFees2, setEditOfflineFees2] = useState("");
  const [editFees3Amount, setEditFees3Amount] = useState("");
  const [editOfflineFees3, setEditOfflineFees3] = useState("");
  const [editVendorAmounts, setEditVendorAmounts] = useState<Record<string, Record<string, string>>>({});

  // Approve/Reject dialog
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveSaving, setApproveSaving] = useState(false);
  const [approvePaymentId, setApprovePaymentId] = useState<number | null>(null);
  const [approveAction, setApproveAction] = useState<"approve" | "reject">("approve");
  const [rejectReason, setRejectReason] = useState("");
  const [approveRemark, setApproveRemark] = useState("");

  // Revert-to-Unpaid dialog (SuperAdmin only). Status correction, NOT a refund.
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [revertSaving, setRevertSaving] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  const [revertTarget, setRevertTarget] = useState<{
    memberFeeId: number;
    memberName: string;
    feeType: number;
    feeLabel: string;
    amount: number;
  } | null>(null);

  // Per-row busy tracking — key like `"wa-{memberId}-{feeType}"` or `"receipt-{paymentId}"`.
  // When non-null we show a spinner in that row's actions column and disable the
  // dropdown trigger so admins don't double-click while the request is in flight.
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Fee type labels
  const fees1Label = duesDetail?.fees1Text || "Annual";
  const fees2Label = duesDetail?.fees2Text || "Semi1";
  const fees3Label = duesDetail?.fees3Text || "Semi2";

  // Fetch dues detail + auto-allocate new club members
  useEffect(() => {
    (async () => {
      try {
        setDetailLoading(true);
        const detail = await getMembershipDuesDetail(duesId);
        setDuesDetail(detail);
        // Auto-allocate any new club members with default fees
        try { await allocateMembershipDuesFees(duesId); } catch { /* no new members */ }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load dues details.");
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [duesId]);

  // Fetch members
  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      const filter = activeTab === "all" ? undefined : activeTab;
      const data = await getMembershipDuesMembers(duesId, {
        search: search || undefined,
        filter,
      });
      setMembers(Array.isArray(data) ? data : data.members || data.Members || []);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [duesId, search, activeTab]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Sort members: pending approval (yellow) first, then new members (green), then rest
  const sortedMembers = [...members].sort((a, b) => {
    if (a.hasPendingApproval && !b.hasPendingApproval) return -1;
    if (!a.hasPendingApproval && b.hasPendingApproval) return 1;
    if (a.isNewMember && !b.isNewMember) return -1;
    if (!a.isNewMember && b.isNewMember) return 1;
    return 0;
  });

  // Helpers
  const isFullyPaid = (m: DuesMember) => {
    const b1 = duesDetail?.isFees1 ? (m.fees1Balance ?? 0) : 0;
    const b2 = duesDetail?.isFees2 ? (m.fees2Balance ?? 0) : 0;
    const b3 = duesDetail?.isFees3 ? (m.fees3Balance ?? 0) : 0;
    return b1 === 0 && b2 === 0 && b3 === 0;
  };

  const hasUnpaidBalance = (m: DuesMember) => {
    const b1 = duesDetail?.isFees1 ? (m.fees1Balance ?? 0) : 0;
    const b2 = duesDetail?.isFees2 ? (m.fees2Balance ?? 0) : 0;
    const b3 = duesDetail?.isFees3 ? (m.fees3Balance ?? 0) : 0;
    return b1 > 0 || b2 > 0 || b3 > 0;
  };

  const balanceClass = (balance: number | undefined) => {
    if (balance === undefined || balance === null) return "";
    return balance > 0 ? "text-red-600 font-semibold" : "text-green-600 font-semibold";
  };

  const cur = getCurrencySymbol(duesDetail?.currency);
  const emailOn = duesDetail?.notifyEmail ?? true;

  const formatCurrency = (val: number | undefined) => {
    if (val === undefined || val === null) return "-";
    return `${cur}${val.toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const rowBgClass = (m: DuesMember) => {
    if (m.hasPendingApproval) return "bg-yellow-100";
    if (m.isNewMember) return "bg-green-200";
    return "";
  };

  const formatVendorSplits = (vendors?: VendorSplit[]) => {
    if (!vendors || vendors.length === 0) return "-";
    return vendors.map(v => {
      const name = v.vendorName || (v.vendorId?.length > 10 ? v.vendorId.substring(0, 10) + "..." : v.vendorId);
      return `${name}: ${cur}${v.amount}`;
    }).join(", ");
  };

  const renderVendorCell = (vendors?: VendorSplit[]) => {
    if (!vendors || vendors.length === 0) return <span className="text-muted-foreground">-</span>;
    const displayText = vendors.map(v => {
      const name = v.vendorName || (v.vendorId?.length > 10 ? v.vendorId.substring(0, 10) + "..." : v.vendorId);
      return `${name}: ${cur}${v.amount}`;
    }).join(", ");

    if (vendors.length <= 2 && displayText.length <= 30) {
      return <span className="text-xs whitespace-nowrap">{displayText}</span>;
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs cursor-help underline decoration-dotted whitespace-nowrap">
              {vendors.length} vendor{vendors.length > 1 ? "s" : ""} <Info className="h-3 w-3 inline" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1 text-xs">
              {vendors.map((v, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span>{v.vendorName || v.vendorId}{v.isDefault ? " (Default)" : ""}</span>
                  <span className="font-medium">{`${cur}${v.amount}`}</span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // Allocate to new members
  const handleAllocate = async () => {
    setAllocating(true);
    try {
      const result = await allocateMembershipDuesFees(duesId);
      setSuccessMessage(result?.message || "Fees allocated to new members successfully.");
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to allocate fees.");
    } finally {
      setAllocating(false);
    }
  };

  // Bulk Email Reminder
  const openBulkEmailDialog = () => {
    setRemarkTarget({ type: "bulk-email" });
    setRemarkText("");
    setRemarkDialogOpen(true);
  };


  // Individual reminder email
  const openReminderEmailDialog = (memberFeeId: number, feeType: number) => {
    setRemarkTarget({ type: "reminder-email", memberFeeId, feeType });
    setRemarkText("");
    setRemarkDialogOpen(true);
  };


  // Send remark dialog
  const handleSendWithRemark = async () => {
    if (!remarkTarget) return;
    setRemarkSending(true);
    try {
      const remark = remarkText.trim() || undefined;
      if (remarkTarget.type === "bulk-email") {
        bulkMembershipDuesReminderEmail(duesId, { remark }).catch(() => {});
        setSuccessMessage("Sending bulk email reminders in background...");
      } else if (remarkTarget.type === "reminder-email" && remarkTarget.memberFeeId && remarkTarget.feeType !== undefined) {
        sendMembershipDuesReminder(duesId, remarkTarget.memberFeeId, {
          feeType: remarkTarget.feeType!,
          remark,
        }).catch(() => {});
        setSuccessMessage("Sending reminder email in background...");
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to send email.");
    } finally {
      setRemarkSending(false);
      setRemarkDialogOpen(false);
      setRemarkTarget(null);
    }
  };

  // Send receipt — awaited with per-row busy state so dropdown shows spinner.
  const handleSendReceipt = async (paymentId: number) => {
    const key = `receipt-${paymentId}`;
    setBusyAction(key);
    try {
      await sendMembershipDuesReceipt(paymentId);
      setSuccessMessage("Receipt email sent.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to send receipt.");
    } finally {
      setBusyAction(null);
    }
  };

  // Open offline payment dialog — pass null to open with no member preselected
  // (top-level "+ Add Offline Entry" button).
  const openOfflineDialog = (member: DuesMember | null) => {
    setOfflineMember(member);
    setOfflineFeeType("");
    setOfflineTransactionType("");
    setOfflineTransactionId("");
    setOfflineGivenTo("");
    setOfflineBankName("");
    setOfflineChequeNo("");
    setOfflineRemark("");
    setOfflineDate("");
    setOfflineAttachment(null);
    setOfflineSendReceipt(false);
    setOfflineUpdatePaymentId(0);
    setOfflineUpdateIsApproved(false);
    setOfflineSendReceiptOnUpdate(false);
    setOfflineExistingAttachment(null);
    setOfflineApprovalRemark("");
    setOfflineOnlineView(null);
    setOfflineDialogOpen(true);
  };

  // When admin picks a fee type inside the Offline Entry dialog, look up
  // whether that fee type already has a pending / paid-offline / paid-online
  // payment for this member and adapt the dialog accordingly. Gateway-paid
  // shows a read-only summary; pending/paid-offline pre-fill the editable form;
  // unpaid leaves a blank form.
  const handleOfflineFeeTypeChange = async (newFeeType: string) => {
    setOfflineFeeType(newFeeType);
    // Reset online view at the start; the gateway branch repopulates it.
    setOfflineOnlineView(null);
    if (!offlineMember || !newFeeType) {
      setOfflineUpdatePaymentId(0);
      setOfflineUpdateIsApproved(false);
      setOfflineExistingAttachment(null);
      return;
    }
    const m = offlineMember as any;
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

    if (paymentModeForFt === "Payment Gateway") {
      setOfflineOnlineView({
        mode: "Payment Gateway",
        txnId: String(onlineTxnIdForFt ?? ""),
        amount: paidAmountForFt,
        date: paidDateForFt ? new Date(paidDateForFt).toISOString() : null,
      });
      setOfflineTransactionType("");
      setOfflineTransactionId("");
      setOfflineGivenTo("");
      setOfflineBankName("");
      setOfflineChequeNo("");
      setOfflineRemark("");
      setOfflineDate("");
      setOfflineAttachment(null);
      setOfflineExistingAttachment(null);
      setOfflineUpdatePaymentId(0);
      setOfflineUpdateIsApproved(false);
      return;
    }

    if (pendingFt === ft) {
      setOfflineTransactionType(m.pendingTransactionType ?? m.PendingTransactionType ?? "");
      setOfflineTransactionId(m.pendingTransactionId ?? m.PendingTransactionId ?? "");
      setOfflineGivenTo(m.pendingGivenTo ?? m.PendingGivenTo ?? "");
      setOfflineBankName("");
      setOfflineChequeNo("");
      setOfflineRemark(m.pendingRemark ?? m.PendingRemark ?? "");
      setOfflineDate(
        m.pendingPaymentDate ?? m.PendingPaymentDate
          ? new Date(m.pendingPaymentDate || m.PendingPaymentDate).toISOString().split("T")[0]
          : ""
      );
      setOfflineAttachment(null);
      setOfflineExistingAttachment(m.pendingAttachment ?? m.PendingAttachment ?? null);
      setOfflineUpdatePaymentId(Number(m.pendingPaymentId ?? m.PendingPaymentId ?? 0));
      setOfflineUpdateIsApproved(false);
      return;
    }

    if (paidOfflineIdForFt && Number(paidOfflineIdForFt) > 0) {
      try {
        const det = await getMembershipDuesOfflineDetails(Number(paidOfflineIdForFt));
        setOfflineTransactionType(det.transactionType || "");
        setOfflineTransactionId(det.transactionId || "");
        setOfflineGivenTo(det.givenTo || "");
        setOfflineBankName(det.bankName || "");
        setOfflineChequeNo(det.chequeNumber || "");
        setOfflineRemark(det.remark || "");
        setOfflineDate(det.paymentDate ? new Date(det.paymentDate).toISOString().split("T")[0] : "");
        setOfflineAttachment(null);
        setOfflineExistingAttachment(det.attachment || null);
        setOfflineUpdatePaymentId(Number(paidOfflineIdForFt));
        setOfflineUpdateIsApproved(String(det.offlineStatus || "").toLowerCase() === "approved");
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load existing offline payment.");
      }
      return;
    }

    // Unpaid / fresh — reset to blank NEW entry.
    setOfflineTransactionType("");
    setOfflineTransactionId("");
    setOfflineGivenTo("");
    setOfflineBankName("");
    setOfflineChequeNo("");
    setOfflineRemark("");
    setOfflineDate("");
    setOfflineAttachment(null);
    setOfflineExistingAttachment(null);
    setOfflineUpdatePaymentId(0);
    setOfflineUpdateIsApproved(false);
  };

  const openUpdatePaidOfflineDialog = async (member: DuesMember, paidOfflineId: number) => {
    try {
      const det = await getMembershipDuesOfflineDetails(paidOfflineId);
      setOfflineMember(member);
      setOfflineFeeType(String(det.feeType ?? ""));
      setOfflineTransactionType(det.transactionType || "");
      setOfflineTransactionId(det.transactionId || "");
      setOfflineGivenTo(det.givenTo || "");
      setOfflineBankName(det.bankName || "");
      setOfflineChequeNo(det.chequeNumber || "");
      setOfflineRemark(det.remark || "");
      setOfflineDate(det.paymentDate ? new Date(det.paymentDate).toISOString().split("T")[0] : "");
      setOfflineAttachment(null);
      setOfflineExistingAttachment(det.attachment || null);
      setOfflineUpdatePaymentId(paidOfflineId);
      setOfflineUpdateIsApproved(String(det.offlineStatus || "").toLowerCase() === "approved");
      setOfflineSendReceipt(false);
      setOfflineSendReceiptOnUpdate(false);
      setOfflineDialogOpen(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load payment details.");
    }
  };

  const handleOfflineSave = async () => {
    if (!offlineMember || !offlineFeeType) {
      setErrorMessage("Please select a fee type.");
      return;
    }
    setOfflineSaving(true);
    try {
      const formData = new FormData();
      formData.append("feeType", offlineFeeType);
      formData.append("transactionType", offlineTransactionType);
      formData.append("transactionId", offlineTransactionId);
      formData.append("givenTo", offlineGivenTo);
      formData.append("bankName", offlineBankName);
      formData.append("chequeNo", offlineChequeNo);
      formData.append("remark", offlineRemark);
      formData.append("date", offlineDate);
      if (offlineAttachment) {
        formData.append("attachment", offlineAttachment);
      }
      if (offlineUpdatePaymentId > 0) {
        // Update mode — PUT. Status preserved unless row was Pending
        // (server auto-approves on save).
        formData.append("sendReceiptOnUpdate", String(offlineSendReceiptOnUpdate));
        if (!offlineUpdateIsApproved && offlineApprovalRemark.trim()) {
          formData.append("approvalRemark", offlineApprovalRemark.trim());
        }
        await updateMembershipDuesOffline(offlineUpdatePaymentId, formData);
        setSuccessMessage(offlineUpdateIsApproved
          ? "Offline payment updated."
          : "Offline payment updated and approved. Receipt emailed to member.");
      } else {
        formData.append("sendReceipt", String(offlineSendReceipt));
        await recordMembershipDuesOffline(duesId, offlineMember.id, formData);
        setSuccessMessage("Offline payment recorded successfully.");
      }
      setOfflineDialogOpen(false);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save offline payment.");
    } finally {
      setOfflineSaving(false);
    }
  };

  // Open edit member fee dialog
  const openEditDialog = (member: DuesMember) => {
    setEditMember(member);
    setEditCategoryType(member.categoryType || "");
    setEditFees1Amount(String(member.fees1Amount ?? ""));
    setEditOfflineFees1(String(member.offlineFees1 ?? ""));
    setEditFees2Amount(String(member.fees2Amount ?? ""));
    setEditOfflineFees2(String(member.offlineFees2 ?? ""));
    setEditFees3Amount(String(member.fees3Amount ?? ""));
    setEditOfflineFees3(String(member.offlineFees3 ?? ""));

    // Initialize vendor amounts for editing
    const vendorAmts: Record<string, Record<string, string>> = {};
    const initVendors = (key: string, vendors?: VendorSplit[]) => {
      if (!vendors) return;
      vendorAmts[key] = {};
      vendors.forEach(v => {
        vendorAmts[key][v.vendorId] = String(v.amount ?? "");
      });
    };
    initVendors("annual", member.annualVendors);
    initVendors("semi1", member.semi1Vendors);
    initVendors("semi2", member.semi2Vendors);
    setEditVendorAmounts(vendorAmts);

    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editMember) return;
    setEditSaving(true);
    try {
      const data: any = { categoryType: editCategoryType };
      if (duesDetail?.isFees1) {
        data.fees1Amount = parseFloat(editFees1Amount) || 0;
        data.offlineFees1 = parseFloat(editOfflineFees1) || 0;
      }
      if (duesDetail?.isFees2) {
        data.fees2Amount = parseFloat(editFees2Amount) || 0;
        data.offlineFees2 = parseFloat(editOfflineFees2) || 0;
      }
      if (duesDetail?.isFees3) {
        data.fees3Amount = parseFloat(editFees3Amount) || 0;
        data.offlineFees3 = parseFloat(editOfflineFees3) || 0;
      }
      // Include vendor amounts (non-default only; default is auto-calculated server-side)
      const buildVendorData = (key: string, vendors?: VendorSplit[]) => {
        if (!vendors || !editVendorAmounts[key]) return undefined;
        return vendors
          .filter(v => !v.isDefault)
          .map(v => ({
            vendorId: v.vendorId,
            amount: parseFloat(editVendorAmounts[key]?.[v.vendorId] || "0") || 0,
          }));
      };
      data.annualVendorAmounts = buildVendorData("annual", editMember.annualVendors);
      data.semi1VendorAmounts = buildVendorData("semi1", editMember.semi1Vendors);
      data.semi2VendorAmounts = buildVendorData("semi2", editMember.semi2Vendors);
      await updateMembershipDuesMemberFee(duesId, editMember.id, data);
      setSuccessMessage("Member fee updated successfully.");
      setEditDialogOpen(false);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update member fee.");
    } finally {
      setEditSaving(false);
    }
  };

  // Approve / Reject
  const openApproveDialog = (paymentId: number, action: "approve" | "reject", m?: any) => {
    setApprovePaymentId(paymentId);
    setApproveAction(action);
    setRejectReason("");
    setApproveRemark("");
    setPendingDetails(extractPendingDetails(m));
    setApproveDialogOpen(true);
  };

  const [pendingDetails, setPendingDetails] = useState<any>(null);
  const extractPendingDetails = (m: any) => {
    if (!m) return null;
    const ft = m.pendingFeeType ?? m.PendingFeeType;
    const feeTypeLabel = ft === 1
      ? (duesDetail?.fees1Text || "Annual")
      : ft === 2 ? (duesDetail?.fees2Text || "Semi 1")
      : ft === 3 ? (duesDetail?.fees3Text || "Semi 2")
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

  const handleApproveReject = async () => {
    if (!approvePaymentId) return;
    if (approveAction === "reject" && !rejectReason.trim()) {
      setErrorMessage("Rejection reason is required.");
      return;
    }
    setApproveSaving(true);
    try {
      const res: any = await approveMembershipDuesPayment(approvePaymentId, {
        isApproved: approveAction === "approve",
        rejectionReason: approveAction === "reject" ? rejectReason.trim() : undefined,
        approvalRemark: approveAction === "approve" ? (approveRemark.trim() || undefined) : undefined,
      });
      setSuccessMessage(res?.message || (approveAction === "approve" ? "Payment approved." : "Payment rejected."));
      setApproveDialogOpen(false);
      fetchMembers();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || `Failed to ${approveAction} payment.`);
    } finally {
      setApproveSaving(false);
    }
  };

  // ── Revert Paid → Unpaid (SuperAdmin) ──────────────────────────
  // The /members payload identifies a row by `memberFeeId`
  // (membership_dues_member_fees.pk_id); older code on this page reads `id`,
  // so accept either.
  const memberFeeIdOf = (m: any): number => Number(m?.memberFeeId ?? m?.MemberFeeId ?? m?.id ?? 0);

  // Fee types this row currently has recorded as Paid, read from the fields the
  // API really returns (annualPaid / semi1Paid / semi2Paid + *PaymentMode).
  // Gateway-paid fee types are flagged: the server refuses to revert those
  // (real money already settled), so they render disabled.
  const getPaidFeeTypes = (m: any): { value: number; label: string; amount: number; isOnline: boolean }[] => {
    if (!m) return [];
    const rows: { value: number; label: string; amount: number; isOnline: boolean }[] = [];
    const add = (value: number, enabled: boolean, label: string, paid: any, mode: any) => {
      if (!enabled) return;
      const amount = Number(paid ?? 0);
      if (!(amount > 0)) return;
      rows.push({ value, label, amount, isOnline: String(mode ?? "") === "Payment Gateway" });
    };
    add(1, !!duesDetail?.isFees1, fees1Label, m.annualPaid ?? m.AnnualPaid, m.annualPaymentMode ?? m.AnnualPaymentMode);
    add(2, !!duesDetail?.isFees2, fees2Label, m.semi1Paid ?? m.Semi1Paid, m.semi1PaymentMode ?? m.Semi1PaymentMode);
    add(3, !!duesDetail?.isFees3, fees3Label, m.semi2Paid ?? m.Semi2Paid, m.semi2PaymentMode ?? m.Semi2PaymentMode);
    return rows;
  };

  const openRevertDialog = (m: any, ft: { value: number; label: string; amount: number }) => {
    setRevertTarget({
      memberFeeId: memberFeeIdOf(m),
      memberName: m.memberName ?? m.MemberName ?? "this member",
      feeType: ft.value,
      feeLabel: ft.label,
      amount: ft.amount,
    });
    setRevertReason("");
    setRevertDialogOpen(true);
  };

  // Marks the fee Unpaid again. No money is refunded and no gateway call is
  // made — the server only un-records the payment (keeping the row for audit).
  const handleRevertPayment = async () => {
    if (!revertTarget || !revertReason.trim()) return;
    setRevertSaving(true);
    try {
      const res: any = await revertMembershipDuesPayment(duesId, revertTarget.memberFeeId, {
        feeType: revertTarget.feeType,
        reason: revertReason.trim(),
      });
      setSuccessMessage(res?.message || "Payment reverted: member is now marked Unpaid. No money was refunded.");
      setRevertDialogOpen(false);
      setRevertTarget(null);
      fetchMembers();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || e?.response?.data || "Failed to revert payment.");
    } finally {
      setRevertSaving(false);
    }
  };

  // Get available fee types for a member (for reminder dropdown)
  const getUnpaidFeeTypes = (m: DuesMember): { value: number; label: string }[] => {
    const types: { value: number; label: string }[] = [];
    if (duesDetail?.isFees1 && (m.fees1Balance ?? 0) > 0) types.push({ value: 1, label: fees1Label });
    if (duesDetail?.isFees2 && (m.fees2Balance ?? 0) > 0) types.push({ value: 2, label: fees2Label });
    if (duesDetail?.isFees3 && (m.fees3Balance ?? 0) > 0) types.push({ value: 3, label: fees3Label });
    return types;
  };

  // Get enabled fee types for offline payment
  const getEnabledFeeTypes = (): { value: string; label: string }[] => {
    const types: { value: string; label: string }[] = [];
    if (duesDetail?.isFees1) types.push({ value: "1", label: fees1Label });
    if (duesDetail?.isFees2) types.push({ value: "2", label: fees2Label });
    if (duesDetail?.isFees3) types.push({ value: "3", label: fees3Label });
    return types;
  };

  // Smart filter — paid types stay so admin can pick & view details.
  // Annual hidden when Semi paid; Semi hidden when Annual paid (incompatible).
  const getAvailableFeeTypes = (m: any): { value: string; label: string }[] => {
    const all = getEnabledFeeTypes();
    if (!m) return all;
    const annualPaid = (m.annualPaid ?? 0) > 0;
    const semi1Paid  = (m.semi1Paid  ?? 0) > 0;
    const semi2Paid  = (m.semi2Paid  ?? 0) > 0;
    return all.filter(ft => {
      if (ft.value === "1" && (semi1Paid || semi2Paid)) return false;
      if (annualPaid && (ft.value === "2" || ft.value === "3")) return false;
      return true;
    });
  };

  // Small Online/Offline channel indicator below the Paid badge.
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
  return { isSuperAdmin, isAdmin, duesDetail, offlineOnly, members, loading, detailLoading, search, setSearch, activeTab, setActiveTab, successMessage, setSuccessMessage, errorMessage, setErrorMessage, allocating, remarkDialogOpen, setRemarkDialogOpen, remarkSending, remarkText, setRemarkText, remarkTarget, offlineDialogOpen, setOfflineDialogOpen, offlineSaving, offlineMember, offlineFeeType, offlineTransactionType, setOfflineTransactionType, offlineTransactionId, setOfflineTransactionId, offlineGivenTo, setOfflineGivenTo, offlineBankName, setOfflineBankName, offlineChequeNo, setOfflineChequeNo, offlineRemark, setOfflineRemark, offlineDate, setOfflineDate, offlineAttachment, setOfflineAttachment, offlineSendReceipt, setOfflineSendReceipt, offlineUpdatePaymentId, offlineUpdateIsApproved, offlineSendReceiptOnUpdate, setOfflineSendReceiptOnUpdate, offlineExistingAttachment, offlineApprovalRemark, setOfflineApprovalRemark, offlineOnlineView, fileInputRef, editDialogOpen, setEditDialogOpen, editSaving, editMember, editCategoryType, setEditCategoryType, editFees1Amount, setEditFees1Amount, editOfflineFees1, setEditOfflineFees1, editFees2Amount, setEditFees2Amount, editOfflineFees2, setEditOfflineFees2, editFees3Amount, setEditFees3Amount, editOfflineFees3, setEditOfflineFees3, editVendorAmounts, setEditVendorAmounts, approveDialogOpen, setApproveDialogOpen, approveSaving, approveAction, rejectReason, setRejectReason, approveRemark, setApproveRemark, revertDialogOpen, setRevertDialogOpen, revertSaving, revertReason, setRevertReason, revertTarget, setRevertTarget, busyAction, fees1Label, fees2Label, fees3Label, sortedMembers, isFullyPaid, hasUnpaidBalance, balanceClass, cur, emailOn, formatCurrency, rowBgClass, renderVendorCell, handleAllocate, openBulkEmailDialog, openReminderEmailDialog, handleSendWithRemark, handleSendReceipt, openOfflineDialog, handleOfflineFeeTypeChange, handleOfflineSave, openEditDialog, handleEditSave, openApproveDialog, pendingDetails, handleApproveReject, getPaidFeeTypes, openRevertDialog, handleRevertPayment, getUnpaidFeeTypes, getAvailableFeeTypes, getPaymentChannelIcon };
}

// Values the page computed after its early returns; same statements, same order.
export function deriveDuesMembers(h: ReturnType<typeof useDuesMembers>) {
  const { members, isFullyPaid, hasUnpaidBalance, duesDetail } = h;

  // Count for tabs
  const allCount = members.length;
  const paidCount = members.filter(m => isFullyPaid(m)).length;
  const unpaidCount = members.filter(m => hasUnpaidBalance(m)).length;
  const pendingCount = members.filter(m => m.hasPendingApproval).length;

  // Column count for empty row colspan
  let colCount = 3; // Sr.No, Name, Category Type
  if (duesDetail?.isFees1) colCount += 3;
  if (duesDetail?.isFees2) colCount += 3;
  if (duesDetail?.isFees3) colCount += 3;
  colCount += 1; // Actions
  return { allCount, paidCount, unpaidCount, pendingCount, colCount };
}

export type DuesMembersCtx = ReturnType<typeof useDuesMembers> & ReturnType<typeof deriveDuesMembers>;
