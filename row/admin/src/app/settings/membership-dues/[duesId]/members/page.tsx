"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import { getMembershipDuesMembers, getMembershipDuesDetail, allocateMembershipDuesFees, updateMembershipDuesMemberFee, recordMembershipDuesOffline, approveMembershipDuesPayment, getMembershipDuesOfflineDetails, updateMembershipDuesOffline, sendMembershipDuesReceipt, sendMembershipDuesReminder, bulkMembershipDuesReminderEmail, revertMembershipDuesPayment } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Mail, MoreHorizontal, Receipt, CreditCard,
  Pencil, Send, UserPlus, Check, X, Upload, Lock, Info, Globe, Banknote,
  Undo2, AlertTriangle,
} from "@/components/icons";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Read-only preview of the member's submitted offline payment, shown inside
// the Approve / Reject dialog so admin sees what they're approving.
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

interface DuesDetail {
  id: number;
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
}

interface VendorSplit {
  vendorId: string;
  vendorName: string;
  amount: number;
  isDefault: boolean;
}

interface DuesMember {
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

export default function MembershipDuesMembersPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const duesId = Number(params.duesId);

  const [duesDetail, setDuesDetail] = useState<DuesDetail | null>(null);
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

  const formatCurrency = (val: number | undefined) => {
    if (val === undefined || val === null) return "-";
    return `\u20B9${val.toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      return `${name}: \u20B9${v.amount}`;
    }).join(", ");
  };

  const renderVendorCell = (vendors?: VendorSplit[]) => {
    if (!vendors || vendors.length === 0) return <span className="text-muted-foreground">-</span>;
    const displayText = vendors.map(v => {
      const name = v.vendorName || (v.vendorId?.length > 10 ? v.vendorId.substring(0, 10) + "..." : v.vendorId);
      return `${name}: \u20B9${v.amount}`;
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
                  <span className="font-medium">{`\u20B9${v.amount}`}</span>
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

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
        </div>
      </ProtectedRoute>
    );
  }

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

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />


        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" asChild className="mt-1">
            <Link href="/settings/membership-dues"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Club Dues - Members</h2>
            {detailLoading ? (
              <div className="flex items-center gap-2 mt-1"><RotaryLoader size="sm" /><span className="text-sm text-muted-foreground">Loading details...</span></div>
            ) : duesDetail ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                <span><strong>Purpose:</strong> {duesDetail.purpose || "-"}</span>
                <span><strong>District:</strong> {duesDetail.districtNumber || "-"}</span>
                <span><strong>Club:</strong> {duesDetail.clubName || "-"}</span>
                <span><strong>Rotary Year:</strong> {duesDetail.rotaryYear || "-"}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleAllocate} disabled={allocating} size="sm">
            <UserPlus className="h-4 w-4 mr-1" />
            {allocating ? "Allocating..." : "Allocate to New Members"}
          </Button>
          <Button variant="outline" size="sm" onClick={openBulkEmailDialog}>
            <Mail className="h-4 w-4 mr-1" />Bulk Email Reminder
          </Button>
        </div>

        {/* Search */}
        <SearchBox value={search} onChange={setSearch} placeholder="Search by name..." />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All ({allCount})</TabsTrigger>
            <TabsTrigger value="paid">Paid ({paidCount})</TabsTrigger>
            <TabsTrigger value="unpaid">Unpaid ({unpaidCount})</TabsTrigger>
            <TabsTrigger value="pending">Pending Approval ({pendingCount})</TabsTrigger>
          </TabsList>

          {["all", "paid", "unpaid", "pending"].map(tab => (
            <TabsContent key={tab} value={tab}>
              {loading ? (
                <div className="flex justify-center py-10"><ListPageSkeleton /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">Sr.No</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category Type</TableHead>
                        {duesDetail?.isFees1 && (
                          <>
                            <TableHead className="text-right">{fees1Label} Amount</TableHead>
                            <TableHead className="text-center">{fees1Label} Accounts</TableHead>
                            <TableHead className="text-right">{fees1Label} Balance</TableHead>
                          </>
                        )}
                        {duesDetail?.isFees2 && (
                          <>
                            <TableHead className="text-right">{fees2Label} Amount</TableHead>
                            <TableHead className="text-center">{fees2Label} Accounts</TableHead>
                            <TableHead className="text-right">{fees2Label} Balance</TableHead>
                          </>
                        )}
                        {duesDetail?.isFees3 && (
                          <>
                            <TableHead className="text-right">{fees3Label} Amount</TableHead>
                            <TableHead className="text-center">{fees3Label} Accounts</TableHead>
                            <TableHead className="text-right">{fees3Label} Balance</TableHead>
                          </>
                        )}
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedMembers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                            No members found
                          </TableCell>
                        </TableRow>
                      ) : sortedMembers.map((m, index) => (
                        <TableRow key={m.id} className={rowBgClass(m)}>
                          <TableCell className="text-center">{index + 1}</TableCell>
                          <TableCell className="font-medium whitespace-nowrap">
                            {m.memberName || "-"}
                            {m.isNewMember && <Badge variant="secondary" className="ml-2 text-xs">New</Badge>}
                            {m.hasPendingApproval && <Badge variant="outline" className="ml-2 text-xs border-yellow-500 text-yellow-700">Pending</Badge>}
                          </TableCell>
                          <TableCell>{m.categoryType || "-"}</TableCell>
                          {duesDetail?.isFees1 && (
                            <>
                              <TableCell className="text-right">{formatCurrency(m.fees1Amount)}</TableCell>
                              <TableCell className="text-center">{renderVendorCell(m.annualVendors)}</TableCell>
                              <TableCell className={`text-right ${balanceClass(m.fees1Balance)}`}>
                                <div className="flex flex-col items-end">
                                  <span>{formatCurrency(m.fees1Balance)}</span>
                                  {(m.fees1Balance ?? 0) === 0 && (((m as any).annualPaid ?? 0) > 0) && getPaymentChannelIcon(m, 1)}
                                </div>
                              </TableCell>
                            </>
                          )}
                          {duesDetail?.isFees2 && (
                            <>
                              <TableCell className="text-right">{formatCurrency(m.fees2Amount)}</TableCell>
                              <TableCell className="text-center">{renderVendorCell(m.semi1Vendors)}</TableCell>
                              <TableCell className={`text-right ${balanceClass(m.fees2Balance)}`}>
                                <div className="flex flex-col items-end">
                                  <span>{formatCurrency(m.fees2Balance)}</span>
                                  {(m.fees2Balance ?? 0) === 0 && (((m as any).semi1Paid ?? 0) > 0) && getPaymentChannelIcon(m, 2)}
                                </div>
                              </TableCell>
                            </>
                          )}
                          {duesDetail?.isFees3 && (
                            <>
                              <TableCell className="text-right">{formatCurrency(m.fees3Amount)}</TableCell>
                              <TableCell className="text-center">{renderVendorCell(m.semi2Vendors)}</TableCell>
                              <TableCell className={`text-right ${balanceClass(m.fees3Balance)}`}>
                                <div className="flex flex-col items-end">
                                  <span>{formatCurrency(m.fees3Balance)}</span>
                                  {(m.fees3Balance ?? 0) === 0 && (((m as any).semi2Paid ?? 0) > 0) && getPaymentChannelIcon(m, 3)}
                                </div>
                              </TableCell>
                            </>
                          )}
                          <TableCell>
                            {/* Per-row busy check: when any action for this row is in flight,
                                show the spinner inline (the dropdown trigger gets replaced).
                                Match keys defined in handleSendReceipt. */}
                            {(() => {
                              const rowBusy =
                                busyAction != null && (
                                  busyAction.startsWith(`wa-${m.id}-`) ||
                                  busyAction === `receipt-${m.pendingPaymentId || m.id}`
                                );
                              if (rowBusy) {
                                return (
                                  <div className="flex items-center justify-center w-10 h-10">
                                    <RotaryLoader size="sm" />
                                  </div>
                                );
                              }
                              return (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" disabled={busyAction !== null}>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => openEditDialog(m)}>
                                      <Pencil className="h-4 w-4 mr-2" />Edit Fee
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openOfflineDialog(m)}>
                                      <CreditCard className="h-4 w-4 mr-2" />Offline Entry
                                    </DropdownMenuItem>
                                    {/* Reminder sub-items: one per unpaid fee type */}
                                    {getUnpaidFeeTypes(m).map(ft => (
                                      <DropdownMenuItem
                                        key={`email-${ft.value}`}
                                        onClick={() => {
                                          if (window.confirm(`Send email reminder to ${m.memberName || "this member"}?`)) {
                                            openReminderEmailDialog(m.id, ft.value);
                                          }
                                        }}
                                      >
                                        <Mail className="h-4 w-4 mr-2" />Email Reminder ({ft.label})
                                      </DropdownMenuItem>
                                    ))}
                                    {isFullyPaid(m) && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          if (window.confirm(`Send receipt to ${m.memberName || "this member"}?`)) {
                                            handleSendReceipt(m.pendingPaymentId || m.id);
                                          }
                                        }}
                                      >
                                        <Receipt className="h-4 w-4 mr-2" />Send Receipt
                                      </DropdownMenuItem>
                                    )}
                                    {m.hasPendingApproval && m.pendingPaymentId && (
                                      <>
                                        <DropdownMenuItem onClick={() => openApproveDialog(m.pendingPaymentId!, "approve", m)} className="text-green-600">
                                          <Check className="h-4 w-4 mr-2" />Approve
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => openApproveDialog(m.pendingPaymentId!, "reject", m)} className="text-red-600">
                                          <X className="h-4 w-4 mr-2" />Reject
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                    {/* SuperAdmin-only status correction — one entry per fee
                                        type that is currently Paid. Hidden while an offline
                                        payment is awaiting approval (that has Reject). */}
                                    {isSuperAdmin && !m.hasPendingApproval && getPaidFeeTypes(m).map(ft => (
                                      <DropdownMenuItem
                                        key={`revert-${ft.value}`}
                                        disabled={ft.isOnline}
                                        onClick={() => { if (!ft.isOnline) openRevertDialog(m, ft); }}
                                        className={ft.isOnline ? "" : "text-orange-600"}
                                      >
                                        <Undo2 className="h-4 w-4 mr-2" />
                                        {ft.isOnline
                                          ? `Revert ${ft.label} (online. Not allowed)`
                                          : `Revert ${ft.label} to Unpaid`}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Remark Dialog (for bulk email / individual reminder) */}
        <Dialog open={remarkDialogOpen} onOpenChange={setRemarkDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {remarkTarget?.type === "bulk-email" ? "Bulk Email Reminder" : "Send Reminder Email"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Add Remark (optional)</Label>
                <Textarea
                  value={remarkText}
                  onChange={e => setRemarkText(e.target.value)}
                  rows={3}
                  placeholder="Add any additional remark to include in the email..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemarkDialogOpen(false)} disabled={remarkSending}>Cancel</Button>
              <Button onClick={handleSendWithRemark} disabled={remarkSending}>
                {remarkSending ? <RotaryLoader size="sm" className="mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                {remarkSending ? "Sending..." : "Send"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Offline Payment Dialog */}
        <Dialog open={offlineDialogOpen} onOpenChange={setOfflineDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {offlineUpdatePaymentId > 0
                  ? (offlineUpdateIsApproved ? "Update Paid Offline Payment" : "Review & Approve Offline Payment")
                  : "Record Offline Payment"}
              </DialogTitle>
            </DialogHeader>
            {offlineMember && (
              <div className="text-sm text-muted-foreground mb-2">
                <strong>Member:</strong> {offlineMember.memberName}
              </div>
            )}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <Label>Fee Type *</Label>
                <Select value={offlineFeeType} onValueChange={handleOfflineFeeTypeChange}>
                  <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                  <SelectContent>
                    {getAvailableFeeTypes(offlineMember).map(ft => (
                      <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
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
                    <Label>Transaction Type</Label>
                    <Select value={offlineTransactionType} onValueChange={setOfflineTransactionType}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Cheque">Cheque</SelectItem>
                        <SelectItem value="NEFT">NEFT</SelectItem>
                        <SelectItem value="UPI">UPI</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Transaction ID</Label>
                    <Input value={offlineTransactionId} onChange={e => setOfflineTransactionId(e.target.value)} placeholder="Transaction ID" />
                  </div>
                  <div>
                    <Label>Given To</Label>
                    <Input value={offlineGivenTo} onChange={e => setOfflineGivenTo(e.target.value)} placeholder="Given to" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Bank Name</Label>
                      <Input value={offlineBankName} onChange={e => setOfflineBankName(e.target.value)} placeholder="Bank name" />
                    </div>
                    <div>
                      <Label>Cheque No</Label>
                      <Input value={offlineChequeNo} onChange={e => setOfflineChequeNo(e.target.value)} placeholder="Cheque number" />
                    </div>
                  </div>
                  <div>
                    <Label>Date</Label>
                    <DateField value={offlineDate} onChange={setOfflineDate} />
                  </div>
                  <div>
                    <Label>Remark</Label>
                    <Textarea value={offlineRemark} onChange={e => setOfflineRemark(e.target.value)} rows={2} placeholder="Remark" />
                  </div>
                  <div>
                    <Label>Attachment</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                        className="hidden"
                        onChange={e => setOfflineAttachment(e.target.files?.[0] || null)}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-1" />Choose File
                      </Button>
                      <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {offlineAttachment ? offlineAttachment.name : "No file selected"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX</p>
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
                      <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input
                        value={offlineApprovalRemark}
                        onChange={e => setOfflineApprovalRemark(e.target.value)}
                        placeholder="Optional: appears on receipt email"
                      />
                    </div>
                  )}
                  {offlineUpdatePaymentId === 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        id="sendReceiptCheckbox"
                        checked={offlineSendReceipt}
                        onCheckedChange={(c) => setOfflineSendReceipt(!!c)}
                      />
                      <Label htmlFor="sendReceiptCheckbox" className="cursor-pointer">Send receipt email</Label>
                    </div>
                  )}
                  {offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        id="sendReceiptOnUpdateCheckbox"
                        checked={offlineSendReceiptOnUpdate}
                        onCheckedChange={(c) => setOfflineSendReceiptOnUpdate(!!c)}
                      />
                      <Label htmlFor="sendReceiptOnUpdateCheckbox" className="cursor-pointer">Send updated receipt to member</Label>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOfflineDialogOpen(false)} disabled={offlineSaving}>
                {offlineOnlineView ? "Close" : "Cancel"}
              </Button>
              {!offlineOnlineView && (
                <Button onClick={handleOfflineSave} disabled={offlineSaving}>
                  {offlineSaving ? <RotaryLoader size="sm" className="mr-2" /> : null}
                  {offlineSaving
                    ? "Saving..."
                    : (offlineUpdatePaymentId > 0
                        ? (offlineUpdateIsApproved ? "Save Changes" : "Save & Approve")
                        : "Save Payment")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Member Fee Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Member Fee</DialogTitle>
            </DialogHeader>
            {editMember && (
              <div className="text-sm text-muted-foreground mb-2">
                <strong>Member:</strong> {editMember.memberName}
              </div>
            )}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <Label>Category Type</Label>
                <Input value={editCategoryType} onChange={e => setEditCategoryType(e.target.value)} placeholder="Category type" />
              </div>
              {duesDetail?.isFees1 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{fees1Label} Amount</Label>
                      <Input type="number" value={editFees1Amount} onChange={e => setEditFees1Amount(e.target.value)} />
                    </div>
                    <div>
                      <Label>Offline {fees1Label}</Label>
                      <Input type="number" value={editOfflineFees1} onChange={e => setEditOfflineFees1(e.target.value)} />
                    </div>
                  </div>
                  {editMember?.annualVendors && editMember.annualVendors.length > 0 && (
                    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground">{fees1Label} Vendor Accounts</Label>
                      {editMember.annualVendors.map(v => (
                        <div key={v.vendorId} className="flex flex-wrap items-center gap-2">
                          <span className="text-xs w-32 truncate" title={v.vendorName || v.vendorId}>
                            {v.vendorName || v.vendorId}
                            {v.isDefault && <Lock className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                          </span>
                          <Input
                            type="number"
                            value={editVendorAmounts["annual"]?.[v.vendorId] ?? String(v.amount)}
                            onChange={e => {
                              if (v.isDefault) return;
                              setEditVendorAmounts(prev => ({
                                ...prev,
                                annual: { ...prev.annual, [v.vendorId]: e.target.value },
                              }));
                            }}
                            disabled={v.isDefault}
                            className={`h-8 text-xs ${v.isDefault ? "bg-gray-100 text-muted-foreground cursor-not-allowed" : ""}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {duesDetail?.isFees2 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{fees2Label} Amount</Label>
                      <Input type="number" value={editFees2Amount} onChange={e => setEditFees2Amount(e.target.value)} />
                    </div>
                    <div>
                      <Label>Offline {fees2Label}</Label>
                      <Input type="number" value={editOfflineFees2} onChange={e => setEditOfflineFees2(e.target.value)} />
                    </div>
                  </div>
                  {editMember?.semi1Vendors && editMember.semi1Vendors.length > 0 && (
                    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground">{fees2Label} Vendor Accounts</Label>
                      {editMember.semi1Vendors.map(v => (
                        <div key={v.vendorId} className="flex flex-wrap items-center gap-2">
                          <span className="text-xs w-32 truncate" title={v.vendorName || v.vendorId}>
                            {v.vendorName || v.vendorId}
                            {v.isDefault && <Lock className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                          </span>
                          <Input
                            type="number"
                            value={editVendorAmounts["semi1"]?.[v.vendorId] ?? String(v.amount)}
                            onChange={e => {
                              if (v.isDefault) return;
                              setEditVendorAmounts(prev => ({
                                ...prev,
                                semi1: { ...prev.semi1, [v.vendorId]: e.target.value },
                              }));
                            }}
                            disabled={v.isDefault}
                            className={`h-8 text-xs ${v.isDefault ? "bg-gray-100 text-muted-foreground cursor-not-allowed" : ""}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {duesDetail?.isFees3 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{fees3Label} Amount</Label>
                      <Input type="number" value={editFees3Amount} onChange={e => setEditFees3Amount(e.target.value)} />
                    </div>
                    <div>
                      <Label>Offline {fees3Label}</Label>
                      <Input type="number" value={editOfflineFees3} onChange={e => setEditOfflineFees3(e.target.value)} />
                    </div>
                  </div>
                  {editMember?.semi2Vendors && editMember.semi2Vendors.length > 0 && (
                    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground">{fees3Label} Vendor Accounts</Label>
                      {editMember.semi2Vendors.map(v => (
                        <div key={v.vendorId} className="flex flex-wrap items-center gap-2">
                          <span className="text-xs w-32 truncate" title={v.vendorName || v.vendorId}>
                            {v.vendorName || v.vendorId}
                            {v.isDefault && <Lock className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                          </span>
                          <Input
                            type="number"
                            value={editVendorAmounts["semi2"]?.[v.vendorId] ?? String(v.amount)}
                            onChange={e => {
                              if (v.isDefault) return;
                              setEditVendorAmounts(prev => ({
                                ...prev,
                                semi2: { ...prev.semi2, [v.vendorId]: e.target.value },
                              }));
                            }}
                            disabled={v.isDefault}
                            className={`h-8 text-xs ${v.isDefault ? "bg-gray-100 text-muted-foreground cursor-not-allowed" : ""}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={editSaving}>Cancel</Button>
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? <RotaryLoader size="sm" className="mr-2" /> : null}
                {editSaving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve/Reject Dialog */}
        <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{approveAction === "approve" ? "Approve Payment" : "Reject Payment"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <PendingDetailsPanel details={pendingDetails} />
              {approveAction === "approve" ? (
                <>
                  <p className="text-sm text-muted-foreground">Are you sure you want to approve this payment?</p>
                  <div>
                    <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Textarea
                      value={approveRemark}
                      onChange={e => setApproveRemark(e.target.value)}
                      rows={3}
                      placeholder="Optional remark: will appear on the receipt email if provided"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <Label>Rejection Reason <span className="text-red-600">*</span></Label>
                  <Textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={3}
                    placeholder="Enter reason for rejection (required)"
                    required
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveDialogOpen(false)} disabled={approveSaving}>Cancel</Button>
              {approveAction === "approve" ? (
                <Button onClick={handleApproveReject} disabled={approveSaving} className="bg-green-600 hover:bg-green-700">
                  {approveSaving ? <RotaryLoader size="sm" className="mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  {approveSaving ? "Approving..." : "Approve"}
                </Button>
              ) : (
                <Button onClick={handleApproveReject} disabled={approveSaving || !rejectReason.trim()} variant="destructive">
                  {approveSaving ? <RotaryLoader size="sm" className="mr-2" /> : <X className="h-4 w-4 mr-2" />}
                  {approveSaving ? "Rejecting..." : "Reject"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revert to Unpaid Dialog (SuperAdmin) — status correction, NOT a refund */}
        <Dialog open={revertDialogOpen} onOpenChange={(open) => { setRevertDialogOpen(open); if (!open) setRevertTarget(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Revert Payment to Unpaid</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" />This does NOT refund any money.
                </p>
                <p className="mt-1">
                  No bank or payment-gateway transaction is reversed. It only corrects the
                  recorded status, so this member is shown as <strong>Unpaid</strong> again and
                  can be billed/paid afresh. The original payment entry is kept for audit.
                </p>
              </div>
              {revertTarget && (
                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <div className="text-muted-foreground">Member</div>
                    <div className="font-medium break-words">{revertTarget.memberName}</div>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <div className="text-muted-foreground">Fee Type</div>
                    <div className="font-medium">{revertTarget.feeLabel}</div>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <div className="text-muted-foreground">Amount Recorded</div>
                    <div className="font-medium">{formatCurrency(revertTarget.amount)}</div>
                  </div>
                </div>
              )}
              <div>
                <Label>Reason <span className="text-red-600">*</span></Label>
                <Textarea
                  value={revertReason}
                  onChange={e => setRevertReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Why is this payment being reverted? e.g. approved against the wrong member (required)"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Recorded against the payment entry and in the audit log. Max 500 characters.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevertDialogOpen(false)} disabled={revertSaving}>Cancel</Button>
              <Button
                onClick={handleRevertPayment}
                disabled={revertSaving || !revertReason.trim()}
                variant="destructive"
              >
                {revertSaving ? <RotaryLoader size="sm" className="mr-2" /> : <Undo2 className="h-4 w-4 mr-2" />}
                {revertSaving ? "Reverting..." : "Mark as Unpaid"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
