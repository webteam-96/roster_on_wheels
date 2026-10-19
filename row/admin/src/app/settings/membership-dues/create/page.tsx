"use client";

import React, { useState, useEffect, Suspense, useRef } from "react";
import DateField from "@/components/DateField";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";
import { useSearchParams, useRouter } from "next/navigation";

// ReactQuill — client-only so SSR doesn't trip on `document`. Same setup the
// club-side membership-dues v2 edit page uses, so SuperAdmin and Club Admin
// share the same editing capabilities.
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import { createMembershipDues, updateMembershipDues, getMembershipDuesDetail, getClubMembers, getDistricts, getClubs, getCashfreeKycList, getRotaryYears, getMembershipDuesMembers, recordMembershipDuesOffline, approveMembershipDuesPayment, sendMembershipDuesReceipt, sendMembershipDuesReminder, bulkMembershipDuesReminderEmail, getMembershipDuesList, updateMembershipDuesMemberFee, allocateMembershipDuesFees } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, ArrowRight, Plus, Trash2, Save, Loader2, Check, ChevronsUpDown, Eye, Lock, Mail, FileText, CheckCircle, XCircle, ChevronLeft, ChevronRight, Search as SearchIcon, Upload, RefreshCw } from "@/components/icons";
import { Badge } from "@/components/ui/badge";

import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale, currencySymbol } from "@/lib/appFormat";
interface KycItem {
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
interface DistrictItem { id: number; districtNumber: string; }
interface ClubItem { id: number; clubName: string; }
interface VendorSplit {
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
const DEFAULT_SETTLEMENT_VENDOR_ID = (process.env.NEXT_PUBLIC_DEFAULT_SETTLEMENT_VENDOR_ID ?? "").toLowerCase();

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
const BALANCE_EXCLUDED_VENDOR_IDS = [DEFAULT_SETTLEMENT_VENDOR_ID, (process.env.NEXT_PUBLIC_PLUG_VENDOR_ID ?? "").toLowerCase()].filter(Boolean);

/** Is this vendor id the locked default settlement account? (case-insensitive) */
const isDefaultSettlementVendorId = (vendorId?: string | null) =>
  (vendorId ?? "").toLowerCase() === DEFAULT_SETTLEMENT_VENDOR_ID;

/** Is this vendor id excluded from the Balance calculation? (case-insensitive) */
const isBalanceExcludedVendorId = (vendorId?: string | null) =>
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
const DEFAULT_ACCOUNT_RATE_PERCENT = 2.95;

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
const computeDefaultAccountAmount = (
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

const STEP_LABELS = [
  "Basic Info & Payment",
  "Fee Types & Amounts",
  "Vendor Splits",
  "Member List",
  "Images & Email",
];

const ADMIN_STEP_LABELS = [
  "Basic Info",
  "Images & Email",
];

export default function CreateEditMembershipDuesPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <CreateEditMembershipDuesPage />
    </Suspense>
  );
}

function CreateEditMembershipDuesPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const editId = searchParams.get("editId");
  const isEdit = !!editId;

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Section 1: Basic Info
  const [allDistricts, setAllDistricts] = useState<DistrictItem[]>([]);
  const [districtClubs, setDistrictClubs] = useState<ClubItem[]>([]);
  const [selectedDistrictId, setSelectedDistrictId] = useState("");
  const [selectedClubId, setSelectedClubId] = useState("");
  const [rotaryYear, setRotaryYear] = useState("");
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  // ReactQuill toolbar — bold/italic/underline + heading + size + color + lists + align + link.
  const quillModules = useRef({
    toolbar: {
      container: [
        ["bold", "italic", "underline"],
        [{ header: [1, 2, 3, false] }],
        [{ size: [] }],
        [{ color: [] }, { background: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ align: [] }],
        ["link"],
        ["clean"],
      ],
    },
  }).current;

  // Section 2: Payment Settings
  const [modeOfPayment, setModeOfPayment] = useState("3"); // 1=Online, 2=Offline, 3=Both
  const [sendBankDetails, setSendBankDetails] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");

  // Section 3: Fee Types
  const [feeType1Enabled, setFeeType1Enabled] = useState(true);
  const [feeType1Label, setFeeType1Label] = useState("Annual");
  const [feeType2Enabled, setFeeType2Enabled] = useState(false);
  const [feeType2Label, setFeeType2Label] = useState("Semi Annual 1");
  const [feeType3Enabled, setFeeType3Enabled] = useState(false);
  const [feeType3Label, setFeeType3Label] = useState("Semi Annual 2");

  // Section 4: Default Amounts — ONE true amount per fee type (also charged
  // offline); the online (payable) amount is always derived from it via
  // onlineSurchargePercent, mirroring club-dues/create/page.tsx.
  const [defaultCategoryType, setDefaultCategoryType] = useState("Standard");
  const [feeType1Amount, setFeeType1Amount] = useState("");
  const [feeType2Amount, setFeeType2Amount] = useState("");
  const [feeType3Amount, setFeeType3Amount] = useState("");
  const [onlineSurchargePercent, setOnlineSurchargePercent] = useState("2.95");

  // Section 5: Vendor Splits
  const [amountType, setAmountType] = useState(""); // 1=Amount, 2=Percentage
  const [defaultPercentage, setDefaultPercentage] = useState("2.95");
  const [kycVendors, setKycVendors] = useState<KycItem[]>([]);
  const [vendorSplits, setVendorSplits] = useState<VendorSplit[]>([]);
  const [splitVendorId, setSplitVendorId] = useState<number>(0);
  const [splitAmounts, setSplitAmounts] = useState<Record<number, number>>({}); // feeType -> amount
  const [splitVendorOpen, setSplitVendorOpen] = useState(false);
  const [splitIsSelf, setSplitIsSelf] = useState(false);

  // Section 6: Images
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [existingLogoUrl, setExistingLogoUrl] = useState("");
  const [existingBgUrl, setExistingBgUrl] = useState("");

  // Section 7: Email Templates
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("Payment received successfully!");
  const [emailBody, setEmailBody] = useState("");
  const [emailReminderSubject, setEmailReminderSubject] = useState("Payment Reminder");
  const [emailReminderBody, setEmailReminderBody] = useState("");
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);
  const [existingEmailLogoUrl, setExistingEmailLogoUrl] = useState("");
  const [previewReceipt, setPreviewReceipt] = useState(false);
  const [previewReminder, setPreviewReminder] = useState(false);

  // Section 8: Google Sheet Email
  const [googleSheetEmail, setGoogleSheetEmail] = useState("support@example.org");

  // Edit mode: track original values for freeze/lock rules
  const [originalFees, setOriginalFees] = useState({ isFees1: false, isFees2: false, isFees3: false });
  const [originalMode, setOriginalMode] = useState("");

  // Rotary Years from DB
  const [rotaryYears, setRotaryYears] = useState<string[]>([]);
  const isAdminEdit = isAdmin && !isSuperAdmin && isEdit;
  const activeStepLabels = isAdminEdit ? ADMIN_STEP_LABELS : STEP_LABELS;
  const totalSteps = activeStepLabels.length;

  // Step 4: Club Members Preview
  const [clubMembers, setClubMembers] = useState<any[]>([]);
  const [clubMembersLoading, setClubMembersLoading] = useState(false);

  // Pagination for new mode
  const [newMemberPage, setNewMemberPage] = useState(1);
  const PAGE_SIZE = 20;

  // Edit mode members
  const [editMembers, setEditMembers] = useState<any[]>([]);
  const [editMembersLoading, setEditMembersLoading] = useState(false);
  const [editMembersFetched, setEditMembersFetched] = useState(false);
  const [editMemberPage, setEditMemberPage] = useState(1);
  const [editMemberSearch, setEditMemberSearch] = useState("");
  const [editMemberChanges, setEditMemberChanges] = useState<Record<string, any>>({});
  const [savingEditMembers, setSavingEditMembers] = useState(false);

  // Offline payment dialog
  const [offlineDialogOpen, setOfflineDialogOpen] = useState(false);
  const [offlineMember, setOfflineMember] = useState<any>(null);
  const [offlineFeeType, setOfflineFeeType] = useState("");
  const [offlinePaymentMode, setOfflinePaymentMode] = useState("Cash");
  const [offlineTxnId, setOfflineTxnId] = useState("");
  const [offlineGivenTo, setOfflineGivenTo] = useState("");
  const [offlineDate, setOfflineDate] = useState("");
  const [offlineRemark, setOfflineRemark] = useState("");
  const [offlineAttachment, setOfflineAttachment] = useState<File | null>(null);
  const [offlineSendEmail, setOfflineSendEmail] = useState(false);
  const [offlineSaving, setOfflineSaving] = useState(false);

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectPaymentId, setRejectPaymentId] = useState<number>(0);
  const [rejectReason, setRejectReason] = useState("");

  // Bulk reminder
  const [bulkRemarkDialogOpen, setBulkRemarkDialogOpen] = useState(false);
  const [bulkRemark, setBulkRemark] = useState("");

  // Individual email reminder remark dialog
  const [emailRemarkDialogOpen, setEmailRemarkDialogOpen] = useState(false);
  const [emailRemarkMemberFeeId, setEmailRemarkMemberFeeId] = useState<number>(0);
  const [emailRemark, setEmailRemark] = useState("");

  // Per-member fee/vendor override state (for Step 4 new mode)
  const [memberFeeOverrides, setMemberFeeOverrides] = useState<Record<string, number>>({});
  const [memberVendorOverrides, setMemberVendorOverrides] = useState<Record<string, number>>({});
  const [memberCategoryOverrides, setMemberCategoryOverrides] = useState<Record<string, string>>({});

  // Get enabled fee types for iteration
  const enabledFeeTypes = [
    ...(feeType1Enabled ? [{ type: 1, label: feeType1Label }] : []),
    ...(feeType2Enabled ? [{ type: 2, label: feeType2Label }] : []),
    ...(feeType3Enabled ? [{ type: 3, label: feeType3Label }] : []),
  ];

  // Fetch all districts on mount — sorted ascending by district number (numeric).
  useEffect(() => {
    (async () => {
      try {
        const result = await getDistricts(1, 1000);
        const items = result.items.map((d: any) => ({ id: d.id, districtNumber: d.districtNumber }));
        items.sort((a: DistrictItem, b: DistrictItem) =>
          (a.districtNumber || "").localeCompare(b.districtNumber || "", undefined, { numeric: true, sensitivity: "base" })
        );
        setAllDistricts(items);
      } catch {}
    })();
    (async () => {
      try {
        const years = await getRotaryYears();
        setRotaryYears(years.map((y: any) => y.yearLabel));
        if (!isEdit) {
          const current = years.find((y: any) => y.isCurrent);
          if (current) setRotaryYear(current.yearLabel);
        }
      } catch {}
    })();
  }, []);

  // Fetch clubs when district selected — sorted ascending by club name.
  useEffect(() => {
    if (!selectedDistrictId) { setDistrictClubs([]); return; }
    (async () => {
      try {
        const result = await getClubs(1, 1000, undefined, Number(selectedDistrictId));
        const items = result.items.map((c: any) => ({ id: c.id, clubName: c.clubName }));
        items.sort((a: ClubItem, b: ClubItem) =>
          (a.clubName || "").localeCompare(b.clubName || "", undefined, { sensitivity: "base" })
        );
        setDistrictClubs(items);
      } catch { setDistrictClubs([]); }
    })();
  }, [selectedDistrictId]);

  // Fetch KYC vendors on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await getCashfreeKycList();
        setKycVendors(data.filter((k: any) => k.isActive).map((k: any) => ({
          id: k.id,
          vendorId: k.vendorId,
          name: k.name,
          status: k.status,
          isActive: k.isActive,
          accountHolder: k.accountHolder ?? "",
          accountNumber: k.accountNumber ?? "",
          ifsc: k.ifsc ?? "",
        })));
      } catch (e) { console.error("Failed to load KYC vendors:", e); }
    })();
  }, []);

  // Load existing data for edit
  useEffect(() => {
    if (!isEdit || !editId) return;
    (async () => {
      try {
        const detail = await getMembershipDuesDetail(Number(editId));
        if (detail.fkDistrictId || detail.fkDistrictMasterId) setSelectedDistrictId(String(detail.fkDistrictId || detail.fkDistrictMasterId));
        if (detail.fkClubId) setSelectedClubId(String(detail.fkClubId));
        setRotaryYear(detail.rotaryYear || "");
        setPurpose(detail.purpose || "");
        setDescription(detail.purposeDescription || detail.description || "");

        setModeOfPayment(String(detail.modeOfPayment || 3));
        setSendBankDetails(detail.isShowBankInReceipt ?? detail.sendBankDetails ?? false);
        setBankName(detail.offlineBankName || detail.bankName || "");
        setAccountNumber(detail.offlineAccountNumber || detail.accountNumber || "");
        setIfscCode(detail.offlineIfscCode || detail.ifscCode || "");

        setFeeType1Enabled(detail.isFees1 ?? detail.feeType1Enabled ?? true);
        setFeeType1Label(detail.fees1Text || detail.feeType1Label || "Annual");
        setFeeType2Enabled(detail.isFees2 ?? detail.feeType2Enabled ?? false);
        setFeeType2Label(detail.fees2Text || detail.feeType2Label || "Semi Annual 1");
        setFeeType3Enabled(detail.isFees3 ?? detail.feeType3Enabled ?? false);
        setFeeType3Label(detail.fees3Text || detail.feeType3Label || "Semi Annual 2");

        setDefaultCategoryType(detail.defaultCategoryType || "Standard");
        setFeeType1Amount(detail.defaultAnnualAmount != null ? String(detail.defaultAnnualAmount) : "");
        setFeeType2Amount(detail.defaultSemi1Amount != null ? String(detail.defaultSemi1Amount) : "");
        setFeeType3Amount(detail.defaultSemi2Amount != null ? String(detail.defaultSemi2Amount) : "");
        setOnlineSurchargePercent(detail.onlineSurchargePercent != null ? String(detail.onlineSurchargePercent) : "2.95");

        setAmountType(String(detail.amountType || ""));
        setDefaultPercentage(detail.defaultPercentage != null ? String(detail.defaultPercentage) : "2.95");

        // Load vendor splits — backend returns vendors as array with AnnualAmount/Semi1Amount/Semi2Amount per vendor
        const rawVendors = detail.vendors || detail.vendorSplits || [];
        const splits: VendorSplit[] = [];
        rawVendors.forEach((v: any) => {
          const kycId = v.fkKycId || v.id;
          const vid = v.vendorId || "";
          const vname = v.vendorName || "";
          const isDef = v.isDefault || false;
          const isSelf = v.isSelf || false;
          if (v.annualAmount > 0 || (detail.isFees1 ?? true)) splits.push({ fkFeeType: 1, fkKycId: kycId, vendorId: vid, vendorName: vname, splitAmount: v.annualAmount || 0, isSelf, isDefault: isDef });
          if (v.semi1Amount > 0 || (detail.isFees2 ?? false)) splits.push({ fkFeeType: 2, fkKycId: kycId, vendorId: vid, vendorName: vname, splitAmount: v.semi1Amount || 0, isSelf, isDefault: isDef });
          if (v.semi2Amount > 0 || (detail.isFees3 ?? false)) splits.push({ fkFeeType: 3, fkKycId: kycId, vendorId: vid, vendorName: vname, splitAmount: v.semi2Amount || 0, isSelf, isDefault: isDef });
        });
        setVendorSplits(splits);

        // Save original values for edit freeze/lock rules
        setOriginalFees({ isFees1: !!(detail.isFees1 ?? detail.feeType1Enabled), isFees2: !!(detail.isFees2 ?? detail.feeType2Enabled), isFees3: !!(detail.isFees3 ?? detail.feeType3Enabled) });
        setOriginalMode(String(detail.modeOfPayment || 3));

        // Images — stored values are relative paths (e.g. /Documents/...).
        // The Next.js host can't serve those, so prefix with the API origin
        // before assigning to <img src>. Full URLs (http/https) pass through.
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
        const toAbsolute = (p: string) => {
          if (!p) return "";
          if (/^https?:\/\//i.test(p)) return p;
          return apiBase + (p.startsWith("/") ? "" : "/") + p;
        };
        setExistingLogoUrl(toAbsolute(detail.purposeLogo || detail.purposeLogoUrl || detail.logoUrl || ""));
        setExistingBgUrl(toAbsolute(detail.backgroundImage || detail.bgImageUrl || ""));
        setExistingEmailLogoUrl(toAbsolute(detail.emailHeaderLogo || detail.emailLogoUrl || ""));

        // Email
        setEmailCc(detail.emailCC || detail.emailCc || "");
        setEmailSubject(detail.emailSubject || "Payment received successfully!");
        setEmailBody(detail.emailBody || "");
        setEmailReminderSubject(detail.emailReminderSubject || "Payment Reminder");
        setEmailReminderBody(detail.emailReminderBody || "");
        setGoogleSheetEmail(detail.googleSheetEmail || "support@example.org");
      } catch { setErrorMessage("Failed to load Club Dues details."); }
      finally { setLoading(false); }
    })();
  }, [isEdit, editId]);

  // Fetch club members when entering Step 4 (always refresh to pick up newly added members)
  useEffect(() => {
    if (currentStep === 3 && selectedClubId) {
      (async () => {
        setClubMembersLoading(true);
        try {
          const data = await getClubMembers(Number(selectedClubId), 1, 1000);
          setClubMembers(Array.isArray(data) ? data : data.items || []);
        } catch { }
        finally { setClubMembersLoading(false); }
      })();
    }
  }, [currentStep, selectedClubId]);

  useEffect(() => {
    if (currentStep === 3 && isEdit && editId) {
      (async () => {
        try {
          // Auto-allocate new club members with default fees before loading
          await allocateMembershipDuesFees(Number(editId));
        } catch { /* ignore if no new members */ }
        refreshEditMembers();
      })();
    }
  }, [currentStep, isEdit, editId]);

  // Fetch member fee data as soon as Step 2 (Fee Types & Amounts) is reached
  // too — the Default Amounts section there needs to know per-member amounts
  // to decide whether it's safe to unlock a default-amount field for editing
  // (see allMembersSameAmount below). Step 4 refreshes this again anyway.
  useEffect(() => {
    if (currentStep === 1 && isEdit && editId && editMembers.length === 0) {
      refreshEditMembers();
    }
  }, [currentStep, isEdit, editId]);

  // Validate fee type combination
  const validateFeeTypeCombination = (): string | null => {
    const a = feeType1Enabled;
    const s1 = feeType2Enabled;
    const s2 = feeType3Enabled;

    if (!a && !s1 && !s2) return "Please enable at least one fee type.";

    // Invalid combos: Annual+Semi1 only, Annual+Semi2 only
    if (a && s1 && !s2) return "Invalid combination: Annual + Semi Annual 1. You must also enable Semi Annual 2.";
    if (a && !s1 && s2) return "Invalid combination: Annual + Semi Annual 2. You must also enable Semi Annual 1.";

    return null;
  };

  // Full validation
  const validate = (): string | null => {
    // Basic Info
    if (!selectedDistrictId) return "Please select a district.";
    if (!selectedClubId) return "Please select a club.";
    if (!rotaryYear) return "Please select a rotary year.";
    if (!purpose.trim()) return "Purpose is required.";

    // Fee Types
    const feeErr = validateFeeTypeCombination();
    if (feeErr) return feeErr;

    // Default Amounts
    if (feeType1Enabled && !feeType1Amount) return `Default ${feeType1Label} Amount is required.`;
    if (feeType2Enabled && !feeType2Amount) return `Default ${feeType2Label} Amount is required.`;
    if (feeType3Enabled && !feeType3Amount) return `Default ${feeType3Label} Amount is required.`;

    return null;
  };

  // Step validation
  const validateStep = (stepIdx: number): string | null => {
    // Admin edit: only validate purpose on step 0, no validation on step 1 (images)
    if (isAdminEdit) {
      if (stepIdx === 0 && !purpose.trim()) return "Purpose is required.";
      return null;
    }
    switch (stepIdx) {
      case 0: // Basic Info + Payment Settings
        if (!selectedDistrictId) return "Please select a district.";
        if (!selectedClubId) return "Please select a club.";
        if (!rotaryYear) return "Please select a rotary year.";
        if ((modeOfPayment === "2" || modeOfPayment === "3") && sendBankDetails) {
          if (!bankName.trim()) return "Bank Name is required when sending bank details in receipt.";
          if (!accountNumber.trim()) return "Account Number is required when sending bank details in receipt.";
          if (!ifscCode.trim()) return "IFSC Code is required when sending bank details in receipt.";
        }
        return null;
      case 1: // Fee Types + Default Amounts
      {
        const feeErr = validateFeeTypeCombination();
        if (feeErr) return feeErr;
        if (feeType1Enabled && !feeType1Amount) return `Default ${feeType1Label} Amount is required.`;
        if (feeType2Enabled && !feeType2Amount) return `Default ${feeType2Label} Amount is required.`;
        if (feeType3Enabled && !feeType3Amount) return `Default ${feeType3Label} Amount is required.`;
        return null;
      }
      case 2: // Vendor Splits — validated against the ONLINE (surcharge-inflated) total
      {
        if (!amountType) return "Please select an Amount Type.";
        for (const ft of enabledFeeTypes) {
          const assigned = vendorSplits.filter(s => s.fkFeeType === ft.type).reduce((sum, s) => sum + s.splitAmount, 0);
          const feeAmount = ft.type === 1 ? Number(feeType1Amount || 0) : ft.type === 2 ? Number(feeType2Amount || 0) : Number(feeType3Amount || 0);
          const onlineTotal = feeAmount * (1 + Number(onlineSurchargePercent || 0) / 100);
          const total = amountType === "1" ? onlineTotal : 100;
          if (Math.abs(assigned - total) > 0.01) {
            return `${ft.label}: Vendor split ${amountType === "1" ? `${currencySymbol()}${assigned.toFixed(2)}` : `${assigned.toFixed(2)}%`} does not match ${amountType === "1" ? `${currencySymbol()}${total.toFixed(2)}` : `${total.toFixed(2)}%`}. Please adjust vendor amounts.`;
          }
        }
        return null;
      }
      case 3: // Member List - validate balances
      {
        if (isEdit) {
          const balErr = validateEditMemberBalances();
          if (balErr) return balErr;
        } else {
          // New mode: check each member's balance
          const mismatchSrNos: number[] = [];
          clubMembers.forEach((m, idx) => {
            const mId = m.id || m.pk_member_master_profile_id || idx;
            enabledFeeTypes.forEach(ft => {
              const feeAmt = getMemberFee(mId, ft.type);
              const vendorTotal = getVendorTotalForBalance(mId, ft.type);
              const balance = amountType === "1" ? feeAmt - vendorTotal : 100 - vendorTotal;
              if (Math.abs(balance) > 0.01 && !mismatchSrNos.includes(idx + 1)) {
                mismatchSrNos.push(idx + 1);
              }
            });
          });
          if (mismatchSrNos.length > 0) {
            return `Sr.No ${mismatchSrNos.join(", ")}: Fee amount does not match vendor total. Please adjust before proceeding.`;
          }
        }
        return null;
      }
      case 4: // Images + Email - optional
        return null;
      default:
        return null;
    }
  };

  // Build FormData for saving
  const buildFormData = (): FormData => {
    const fd = new FormData();
    fd.append("fkDistrictId", selectedDistrictId);
    fd.append("fkClubId", selectedClubId);
    fd.append("rotaryYear", rotaryYear);
    fd.append("purpose", purpose);
    fd.append("purposeDescription", description);
    fd.append("modeOfPayment", modeOfPayment);
    fd.append("isShowBankInReceipt", String(sendBankDetails));
    fd.append("offlineBankName", bankName);
    fd.append("offlineAccountNumber", accountNumber);
    fd.append("offlineIfscCode", ifscCode);
    fd.append("isFees1", String(feeType1Enabled));
    fd.append("fees1Text", feeType1Label);
    fd.append("isFees2", String(feeType2Enabled));
    fd.append("fees2Text", feeType2Label);
    fd.append("isFees3", String(feeType3Enabled));
    fd.append("fees3Text", feeType3Label);
    fd.append("defaultCategoryType", defaultCategoryType);
    fd.append("defaultAnnualAmount", feeType1Amount || "0");
    fd.append("defaultSemi1Amount", feeType2Amount || "0");
    fd.append("defaultSemi2Amount", feeType3Amount || "0");
    fd.append("onlineSurchargePercent", onlineSurchargePercent || "0");
    fd.append("amountType", amountType);
    fd.append("defaultPercentage", defaultPercentage || "0");
    fd.append("vendorsJson", JSON.stringify(vendorSplits.map(s => ({
      fkFeeType: s.fkFeeType,
      fkKycId: s.fkKycId,
      vendorId: s.vendorId,
      vendorName: s.vendorName,
      splitAmount: s.splitAmount,
      isSelf: s.isSelf || false,
      // Was omitted entirely, so the backend's TryGetProperty("isDefault") always
      // failed and every row persisted IsDefault=0. Derive it from the vendor id —
      // the same test step 3 uses to render the Default badge/lock.
      isDefault: Boolean(s.isDefault) || isDefaultSettlementVendorId(s.vendorId),
    }))));
    if (logoFile) fd.append("logo", logoFile);
    if (bgImageFile) fd.append("bgImage", bgImageFile);
    if (emailLogoFile) fd.append("emailLogo", emailLogoFile);
    fd.append("emailCC", emailCc);
    fd.append("emailSubject", emailSubject);
    fd.append("emailBody", emailBody);
    fd.append("emailReminderSubject", emailReminderSubject);
    fd.append("emailReminderBody", emailReminderBody);
    fd.append("googleSheetEmail", googleSheetEmail);
    // Per-member overrides (category, fees, vendor costs)
    const overrides: any[] = [];
    clubMembers.forEach(m => {
      const mId = m.id || m.pk_member_master_profile_id;
      const catKey = `${mId}_category`;
      const hasCatOverride = memberCategoryOverrides[catKey] !== undefined;
      const hasFeeOverride = enabledFeeTypes.some(ft => memberFeeOverrides[`${mId}_${ft.type}`] !== undefined);
      const hasVendorOverride = enabledFeeTypes.some(ft => addedVendorIds.some(kycId => memberVendorOverrides[`${mId}_${ft.type}_${kycId}`] !== undefined));
      if (hasCatOverride || hasFeeOverride || hasVendorOverride) {
        const entry: any = { memberId: mId };
        if (hasCatOverride) entry.categoryType = memberCategoryOverrides[catKey];
        enabledFeeTypes.forEach(ft => {
          const feeKey = `${mId}_${ft.type}`;
          if (memberFeeOverrides[feeKey] !== undefined) {
            if (ft.type === 1) entry.annualAmount = memberFeeOverrides[feeKey];
            if (ft.type === 2) entry.semi1Amount = memberFeeOverrides[feeKey];
            if (ft.type === 3) entry.semi2Amount = memberFeeOverrides[feeKey];
          }
          const vendorOverrides: any[] = [];
          addedVendorIds.forEach(kycId => {
            const vKey = `${mId}_${ft.type}_${kycId}`;
            if (memberVendorOverrides[vKey] !== undefined) {
              vendorOverrides.push({ fkKycId: kycId, feeType: ft.type, amount: memberVendorOverrides[vKey] });
            }
          });
          if (vendorOverrides.length > 0) {
            if (!entry.vendorOverrides) entry.vendorOverrides = [];
            entry.vendorOverrides.push(...vendorOverrides);
          }
        });
        overrides.push(entry);
      }
    });
    if (overrides.length > 0) fd.append("memberOverridesJson", JSON.stringify(overrides));
    return fd;
  };

  const handleNext = async () => {
    const err = validateStep(currentStep);
    if (err) { setErrorMessage(err); window.scrollTo(0, 0); return; }

    // Step 1: Check duplicate club+year (only for new, not edit)
    if (currentStep === 0 && !isEdit) {
      try {
        const existing = await getMembershipDuesList({ clubId: Number(selectedClubId), year: rotaryYear });
        if (Array.isArray(existing) && existing.length > 0) {
          setErrorMessage("Club Dues already exist for this club and year.");
          return;
        }
      } catch { /* ignore check error, backend will catch */ }
    }

    // Step 4 (edit mode): Save member changes to DB before moving to Step 5
    if (currentStep === 3 && isEdit && Object.keys(editMemberChanges).length > 0) {
      setSaving(true);
      try {
        const memberUpdates: Record<number, any> = {};
        for (const [key, value] of Object.entries(editMemberChanges)) {
          const parts = key.split("_");
          const memberFeeId = Number(parts[0]);
          if (!memberUpdates[memberFeeId]) memberUpdates[memberFeeId] = {};

          if (parts[1] === "cat") {
            memberUpdates[memberFeeId].categoryType = value;
          } else if (parts[1] === "fee") {
            const ft = Number(parts[2]);
            if (ft === 1) memberUpdates[memberFeeId].annualAmount = Number(value);
            if (ft === 2) memberUpdates[memberFeeId].semi1Amount = Number(value);
            if (ft === 3) memberUpdates[memberFeeId].semi2Amount = Number(value);
          } else if (parts[1] === "v") {
            const ft = Number(parts[2]);
            const vIdx = Number(parts[3]);
            const member = editMembers.find(m => m.memberFeeId === memberFeeId);
            if (member) {
              const vendors = getEditVendors(member, ft);
              if (vendors[vIdx]) {
                if (!memberUpdates[memberFeeId].vendorOverrides) memberUpdates[memberFeeId].vendorOverrides = [];
                memberUpdates[memberFeeId].vendorOverrides.push({
                  vendorId: vendors[vIdx].vendorId || vendors[vIdx].VendorId,
                  feeType: ft,
                  amount: Number(value)
                });
              }
            }
          }
        }

        for (const [mfId, changes] of Object.entries(memberUpdates)) {
          // Convert vendorOverrides array to VendorsJson string for backend
          if (changes.vendorOverrides && changes.vendorOverrides.length > 0) {
            changes.vendorsJson = JSON.stringify(changes.vendorOverrides);
            delete changes.vendorOverrides;
          }
          await updateMembershipDuesMemberFee(Number(editId), Number(mfId), changes);
        }
        setEditMemberChanges({});
      } catch (e: any) {
        setErrorMessage("Failed to save member changes: " + (e?.response?.data?.message || e?.message || ""));
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStep < totalSteps - 1) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  // Submit (final save from step 5)
  const handleSubmit = async () => {
    setSaving(true);
    try {
      const fd = buildFormData();
      const redirectUrl = isAdminEdit && selectedClubId ? `/clubs/${selectedClubId}/membership-dues` : "/settings/membership-dues";
      if (isEdit && editId) {
        await updateMembershipDues(Number(editId), fd);
        setSuccessMessage("Club Dues updated successfully!");
        setTimeout(() => router.push(redirectUrl), 1500);
      } else {
        const result = await createMembershipDues(fd);
        setSuccessMessage("Club Dues created successfully!");
        setTimeout(() => router.push(redirectUrl), 1500);
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save Club Dues.");
    } finally { setSaving(false); }
  };

  // Vendor split handlers
  const addedVendorIds = Array.from(new Set(vendorSplits.map(s => s.fkKycId)));
  const getAccountLabel = (kycId: number) => `A/C${addedVendorIds.indexOf(kycId) + 1}`;

  // Platform/gateway rate applied to the DEFAULT settlement account. Read from the
  // campaign's stored membership_dues.DefaultPercentage (already in state, loaded on
  // edit / posted on save); only falls back to the constant when it is absent or 0.
  const defaultAccountRatePercent =
    Number(defaultPercentage) > 0 ? Number(defaultPercentage) : DEFAULT_ACCOUNT_RATE_PERCENT;

  const handleAddVendorSplit = () => {
    if (!splitVendorId) return;
    const vendor = kycVendors.find(k => k.id === splitVendorId);
    if (!vendor) return;

    // Validate amounts for each enabled fee type — 0 is allowed (the vendor is simply excluded
    // from that fee type's order at payment time; only negative values are rejected).
    for (const ft of enabledFeeTypes) {
      const amt = splitAmounts[ft.type] || 0;
      if (amt < 0) {
        setErrorMessage(`${amountType === "1" ? "Amount" : "Percentage"} for "${ft.label}" cannot be negative.`);
        return;
      }
    }

    const newSplits = enabledFeeTypes.map(ft => ({
      fkFeeType: ft.type,
      fkKycId: vendor.id,
      vendorId: vendor.vendorId,
      vendorName: vendor.name,
      splitAmount: splitAmounts[ft.type] || 0,
      isSelf: splitIsSelf,
    }));
    setVendorSplits(prev => [...prev, ...newSplits]);
    setSplitVendorId(0);
    setSplitAmounts({});
    setSplitIsSelf(false);
  };

  const handleDeleteVendorGroup = (kycId: number) => {
    setVendorSplits(prev => prev.filter(s => s.fkKycId !== kycId));
  };

  // Email preview
  const defaultReceiptHtml = `<p>Dear *****,</p>
<p><strong>District Number</strong> : ****</p>
<p><strong>Club Name</strong> : **** **** **** ****</p>
<p><strong>Purpose of the payment</strong> : ****</p>
<p><strong>Amount received</strong> : ****/-</p>
<p><strong>Date and time</strong> : ****</p>
<p><strong>Method of payment</strong> : ****</p>
<p><strong>Transaction ID</strong> : ****</p>`;

  const defaultReminderHtml = `<p>Dear *****,</p>
<p><strong>District Number</strong> : ****</p>
<p><strong>Club Name</strong> : **** **** **** ****</p>
<p><strong>Purpose of the payment</strong> : ****</p>
<p><strong>Outstanding amount</strong> : ****/-</p>
<p><strong>Status</strong> : ****</p>
<p><strong>Click on the link</strong> : ****</p>`;

  const getReceiptPreviewHtml = () => {
    return defaultReceiptHtml + (emailBody ? `<br/><p>${emailBody}</p>` : "");
  };

  const getReminderPreviewHtml = () => {
    return defaultReminderHtml + (emailReminderBody ? `<br/><p>${emailReminderBody}</p>` : "");
  };

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  // Admin can only edit, not create new
  if (isAdmin && !isSuperAdmin && !isEdit) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3><p className="text-muted-foreground">Only SuperAdmin can create new Club Dues.</p></div></ProtectedRoute>);
  }

  if (loading) {
    return (<ProtectedRoute><div className="flex justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>);
  }

  const isLastStep = currentStep === totalSteps - 1;

  // Computes the default vendor's split per fee type from the CURRENT base
  // amount + online surcharge %. Shared by the auto-add (on amount-type
  // change) and the manual Refresh button — the auto-add can go stale if the
  // vendor was added before the Default Amount / Surcharge % fields were
  // filled in, since it only runs once at that moment.
  const computeDefaultVendorSplits = (forAmountType: string): VendorSplit[] => {
    const defaultVendor = kycVendors.find(k => isDefaultSettlementVendorId(k.vendorId));
    if (!defaultVendor) return [];
    const defaultPer = Number(onlineSurchargePercent) || 0;
    return enabledFeeTypes.map(ft => {
      let amount = defaultPer;
      if (forAmountType === "1") {
        const feeAmount = ft.type === 1 ? Number(feeType1Amount) || 0
                         : ft.type === 2 ? Number(feeType2Amount) || 0
                         : Number(feeType3Amount) || 0;
        amount = Number((feeAmount * defaultPer / 100).toFixed(2));
      }
      return {
        fkFeeType: ft.type,
        fkKycId: defaultVendor.id,
        vendorId: defaultVendor.vendorId,
        vendorName: defaultVendor.name,
        splitAmount: amount,
        isSelf: false,
      };
    });
  };

  const handleRefreshDefaultVendor = () => {
    const defaultVendor = kycVendors.find(k => isDefaultSettlementVendorId(k.vendorId));
    if (!defaultVendor) return;
    const filtered = vendorSplits.filter(s => s.fkKycId !== defaultVendor.id);
    setVendorSplits([...filtered, ...computeDefaultVendorSplits(amountType)]);
  };

  // Auto-add default vendor when amount type is selected
  const handleAutoAddDefaultVendor = (newAmountType: string) => {
    if (isEdit) return; // Don't auto-add on edit mode — vendors already loaded from DB
    const defaultVendor = kycVendors.find(k => isDefaultSettlementVendorId(k.vendorId));
    if (!defaultVendor) return;

    // Remove existing default vendor splits
    const filtered = vendorSplits.filter(s => s.fkKycId !== defaultVendor.id);
    const newSplits = computeDefaultVendorSplits(newAmountType);

    setVendorSplits([...filtered, ...newSplits]);
  };

  // ---- Edit mode freeze/lock helpers ----
  const shouldDisableMode = (val: string) => {
    if (!isEdit) return false;
    if (originalMode === "3") return val !== "3"; // Both: can't change
    if (originalMode === "1") return val === "2"; // Online: can't go to Offline
    if (originalMode === "2") return val === "1"; // Offline: can't go to Online
    return false;
  };

  const isNewFeeType = (ft: number) => isEdit && (
    (ft === 1 && !originalFees.isFees1) ||
    (ft === 2 && !originalFees.isFees2) ||
    (ft === 3 && !originalFees.isFees3)
  );

  const isOriginalFeeType = (ft: number) => isEdit && (
    (ft === 1 && originalFees.isFees1) ||
    (ft === 2 && originalFees.isFees2) ||
    (ft === 3 && originalFees.isFees3)
  );

  // ---- RENDER STEPS ----

  const renderStep1BasicInfoPayment = () => (
    <Card>
      <CardHeader><CardTitle>{isAdminEdit ? "Basic Information" : "Basic Information & Payment Settings"}</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>District *</Label>
            <Select value={selectedDistrictId} onValueChange={v => { setSelectedDistrictId(v); setSelectedClubId(""); }} disabled={isEdit || isAdminEdit}>
              <SelectTrigger className={(isEdit || isAdminEdit) ? "bg-gray-100 opacity-60" : ""}><SelectValue placeholder="Choose district" /></SelectTrigger>
              <SelectContent>
                {allDistricts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Club *</Label>
            <Select value={selectedClubId} onValueChange={setSelectedClubId} disabled={!selectedDistrictId || isEdit || isAdminEdit}>
              <SelectTrigger className={(isEdit || isAdminEdit) ? "bg-gray-100 opacity-60" : ""}><SelectValue placeholder="Choose club" /></SelectTrigger>
              <SelectContent>
                {districtClubs.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Rotary Year *</Label>
            <Select value={rotaryYear} onValueChange={setRotaryYear} disabled={isEdit || isAdminEdit}>
              <SelectTrigger className={(isEdit || isAdminEdit) ? "bg-gray-100 opacity-60" : ""}><SelectValue placeholder="Choose year" /></SelectTrigger>
              <SelectContent>
                {rotaryYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Purpose *</Label>
            <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Title / Purpose of the dues" />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <ReactQuill
            theme="snow"
            value={description}
            onChange={setDescription}
            modules={quillModules}
            placeholder="Description (optional): supports bold / italic / sizes / colors / lists / links"
          />
        </div>

        {/* Payment Settings - hidden for Admin edit */}
        {!isAdminEdit && (
          <>
            <hr className="my-2" />
            <h3 className="font-semibold text-base">Payment Settings</h3>
            <div>
              <Label>Mode of Payment</Label>
              <div className="flex items-center gap-6 mt-2">
                <label className={`flex items-center gap-2 ${shouldDisableMode("1") ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
                  <input type="radio" name="modeOfPayment" value="1" checked={modeOfPayment === "1"} onChange={e => setModeOfPayment(e.target.value)} className="accent-primary" disabled={shouldDisableMode("1")} />
                  <span>Online</span>
                </label>
                <label className={`flex items-center gap-2 ${shouldDisableMode("2") ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
                  <input type="radio" name="modeOfPayment" value="2" checked={modeOfPayment === "2"} onChange={e => setModeOfPayment(e.target.value)} className="accent-primary" disabled={shouldDisableMode("2")} />
                  <span>Offline</span>
                </label>
                <label className={`flex items-center gap-2 ${shouldDisableMode("3") ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
                  <input type="radio" name="modeOfPayment" value="3" checked={modeOfPayment === "3"} onChange={e => setModeOfPayment(e.target.value)} className="accent-primary" disabled={shouldDisableMode("3")} />
                  <span>Both</span>
                </label>
              </div>
            </div>
            {(modeOfPayment === "2" || modeOfPayment === "3") && (
              <>
                <div className="flex items-center gap-3">
                  <Checkbox checked={sendBankDetails} onCheckedChange={(c) => setSendBankDetails(!!c)} id="sendBankDetails" />
                  <Label htmlFor="sendBankDetails">Do you want to send Bank details in Receipt?</Label>
                </div>
                {sendBankDetails && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/30">
                    <div>
                      <Label>Bank Name <span className="text-destructive">*</span></Label>
                      <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name" />
                    </div>
                    <div>
                      <Label>Account Number <span className="text-destructive">*</span></Label>
                      <Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Account number" />
                    </div>
                    <div>
                      <Label>IFSC Code <span className="text-destructive">*</span></Label>
                      <Input value={ifscCode} onChange={e => setIfscCode(e.target.value)} placeholder="IFSC code" />
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  const renderStep2FeeTypesAmounts = () => (
    <Card>
      <CardHeader><CardTitle>Fee Types & Default Amounts</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {/* Fee Types */}
        <div>
          <h3 className="font-semibold text-base mb-2">Fee Types</h3>
          <p className="text-sm text-muted-foreground mb-3">Select which fee types to enable and customize their labels. Valid combinations: Annual only, Semi1 only, Semi2 only, Semi1+Semi2, or Annual+Semi1+Semi2.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`flex items-center gap-3 p-3 border rounded-lg ${isEdit && originalFees.isFees1 ? "bg-gray-50" : ""}`}>
              <Checkbox checked={feeType1Enabled} onCheckedChange={(c) => setFeeType1Enabled(!!c)} id="feeType1" disabled={isEdit && originalFees.isFees1} />
              <div className="flex-1">
                <Label htmlFor="feeType1" className="text-sm font-medium">Fee Type 1</Label>
                <Input value={feeType1Label} onChange={e => setFeeType1Label(e.target.value)} placeholder="Label" className="mt-1" />
              </div>
            </div>
            <div className={`flex items-center gap-3 p-3 border rounded-lg ${isEdit && originalFees.isFees2 ? "bg-gray-50" : ""}`}>
              <Checkbox checked={feeType2Enabled} onCheckedChange={(c) => setFeeType2Enabled(!!c)} id="feeType2" disabled={isEdit && originalFees.isFees2} />
              <div className="flex-1">
                <Label htmlFor="feeType2" className="text-sm font-medium">Fee Type 2</Label>
                <Input value={feeType2Label} onChange={e => setFeeType2Label(e.target.value)} placeholder="Label" className="mt-1" />
              </div>
            </div>
            <div className={`flex items-center gap-3 p-3 border rounded-lg ${isEdit && originalFees.isFees3 ? "bg-gray-50" : ""}`}>
              <Checkbox checked={feeType3Enabled} onCheckedChange={(c) => setFeeType3Enabled(!!c)} id="feeType3" disabled={isEdit && originalFees.isFees3} />
              <div className="flex-1">
                <Label htmlFor="feeType3" className="text-sm font-medium">Fee Type 3</Label>
                <Input value={feeType3Label} onChange={e => setFeeType3Label(e.target.value)} placeholder="Label" className="mt-1" />
              </div>
            </div>
          </div>
          {validateFeeTypeCombination() && (
            <p className="text-sm text-red-600 font-medium mt-2">{validateFeeTypeCombination()}</p>
          )}
        </div>

        {/* Default Amounts */}
        <hr className="my-2" />
        <h3 className="font-semibold text-base mb-2">Default Amounts</h3>
        <div className="w-full md:w-1/2">
          <Label>Default Category Type</Label>
          <Input value={defaultCategoryType} onChange={e => setDefaultCategoryType(e.target.value)} placeholder="e.g. Standard" disabled={isEdit} className={isEdit ? "bg-gray-100 opacity-60" : ""} />
        </div>
        {(modeOfPayment === "1" || modeOfPayment === "3") && (
          <div className="space-y-2 max-w-xs">
            <Label>Online Surcharge (%)</Label>
            <Input type="number" step="0.01" min="0" value={onlineSurchargePercent} onChange={e => setOnlineSurchargePercent(e.target.value)} placeholder="e.g. 2.95" />
            <p className="text-xs text-muted-foreground">Added on top of the amount for <b>online</b> payments only (e.g. to cover the gateway fee). Offline pays the base amount. Editable anytime.</p>
          </div>
        )}
        {enabledFeeTypes.length > 0 && (
          <div className="space-y-3">
            {enabledFeeTypes.map(ft => {
              const amountVal = ft.type === 1 ? feeType1Amount : ft.type === 2 ? feeType2Amount : feeType3Amount;
              const setAmount = ft.type === 1 ? setFeeType1Amount : ft.type === 2 ? setFeeType2Amount : setFeeType3Amount;
              // Default Amount is always editable. When every still-unpaid member
              // currently shares the same amount, editing here cascades the new
              // value to all of them on save (see backend CascadeDefaultIfUniform).
              // When members have diverged, the backend leaves their individual
              // amounts untouched — editing here only updates the default used for
              // members added later; go to Step 4 (Member List) to change existing
              // members individually.
              const diverged = isOriginalFeeType(ft.type) && !allMembersSameAmount(ft.type);
              return (
                <div key={ft.type} className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 border rounded-lg bg-muted/30">
                  <div>
                    <Label>Default {ft.label} Amount *</Label>
                    <Input type="number" step="0.01" value={amountVal} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" />
                  </div>
                  {diverged && (
                    <p className="md:col-span-2 text-xs text-muted-foreground -mt-2">
                      Members currently have different {ft.label} amounts, so changing this won't retroactively update them: edit individual members in Step 4 (Member List) for that. This will only set the default for members added later.
                    </p>
                  )}
                  {isOriginalFeeType(ft.type) && !diverged && (
                    <p className="md:col-span-2 text-xs text-muted-foreground -mt-2">
                      All members currently share this amount: changing it here will update it for everyone who hasn't paid yet.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderStep3VendorSplits = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle>Vendor Splits{amountType ? ` (${amountType === "1" ? "Amount" : "Percentage %"})` : ""}</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Amount Type:</Label>
            <Select value={amountType} onValueChange={(val) => {
              setAmountType(val);
              handleAutoAddDefaultVendor(val);
            }} disabled={isEdit}>
              <SelectTrigger className={`w-44 ${isEdit ? "opacity-60" : ""}`}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Amount (Fixed)</SelectItem>
                <SelectItem value="2">Percentage (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {amountType && (<>
        {/* Summary table with A/C columns */}
        {enabledFeeTypes.length > 0 && addedVendorIds.length > 0 && (
          <div className="border rounded-lg p-3 bg-muted/30">
            <h4 className="font-medium mb-2">Split Summary</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fee Type</TableHead>
                    <TableHead>Total ({"\u20B9"})</TableHead>
                    {addedVendorIds.map(kycId => {
                      const vendor = kycVendors.find(k => k.id === kycId);
                      const vendorName = vendor?.name || vendorSplits.find(s => s.fkKycId === kycId)?.vendorName || "";
                      const vendorIdStr = vendor?.vendorId || vendorSplits.find(s => s.fkKycId === kycId)?.vendorId || "";
                      return (
                        <TooltipProvider key={kycId}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <TableHead className="cursor-help">{getAccountLabel(kycId)}</TableHead>
                            </TooltipTrigger>
                            <TooltipContent><p>{vendorName} ({vendorIdStr})</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                    <TableHead>Assigned</TableHead>
                    <TableHead>Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enabledFeeTypes.map(ft => {
                    const feeAmount = ft.type === 1 ? Number(feeType1Amount || 0) : ft.type === 2 ? Number(feeType2Amount || 0) : Number(feeType3Amount || 0);
                    // Vendor splits sum to the ONLINE (surcharge-inflated) total \u2014 the
                    // default vendor's own auto-added split already carries the surcharge
                    // share, so it's fully visible/adjustable here, not a hidden add-on
                    // at payment time.
                    const onlineTotal = feeAmount * (1 + Number(onlineSurchargePercent || 0) / 100);
                    const assigned = vendorSplits.filter(s => s.fkFeeType === ft.type).reduce((sum, s) => sum + s.splitAmount, 0);
                    const matchTotal = amountType === "1" ? onlineTotal : 100;
                    const balance = Number((matchTotal - assigned).toFixed(2));
                    return (
                      <TableRow key={ft.type}>
                        <TableCell className="font-medium">{ft.label}</TableCell>
                        <TableCell>
                          {"\u20B9"}{onlineTotal.toFixed(2)}
                          <span className="block text-[10px] text-muted-foreground">Base: {"\u20B9"}{feeAmount.toFixed(2)}</span>
                        </TableCell>
                        {addedVendorIds.map(kycId => {
                          const split = vendorSplits.find(s => s.fkFeeType === ft.type && s.fkKycId === kycId);
                          return (
                            <TableCell key={kycId}>
                              {split ? (amountType === "1" ? `\u20B9${split.splitAmount.toFixed(2)}` : `${split.splitAmount.toFixed(2)}%`) : "-"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-green-600 font-medium">
                          {amountType === "1" ? `\u20B9${assigned.toFixed(2)}` : `${assigned.toFixed(2)}%`}
                        </TableCell>
                        <TableCell className={`font-medium ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                          {amountType === "1" ? `\u20B9${balance.toFixed(2)}` : `${balance.toFixed(2)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Add new vendor split */}
        <div className="border rounded-lg p-4 space-y-4">
          <h4 className="font-medium">Add Vendor</h4>
          <div>
            <Label>Select KYC Vendor</Label>
            <Popover open={splitVendorOpen} onOpenChange={setSplitVendorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {splitVendorId ? (kycVendors.find(k => k.id === splitVendorId)?.name || "") + " (" + (kycVendors.find(k => k.id === splitVendorId)?.vendorId || "") + ")" : "Search vendor..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search by name or vendor ID..." />
                  <CommandList>
                    <CommandEmpty>No vendor found.</CommandEmpty>
                    <CommandGroup>
                      {kycVendors.filter(k => !addedVendorIds.includes(k.id)).map(k => (
                        <CommandItem key={k.id} value={`${k.name} ${k.vendorId} ${k.accountHolder ?? ""} ${k.accountNumber ?? ""} ${k.ifsc ?? ""}`} onSelect={() => { setSplitVendorId(k.id); setSplitVendorOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${splitVendorId === k.id ? "opacity-100" : "opacity-0"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{k.name}</div>
                            <div className="text-xs text-muted-foreground">{k.vendorId}</div>
                            {/* Bank account info — helps admin pick the right account when one
                                vendor name has multiple KYC entries. */}
                            {(k.accountHolder || k.accountNumber || k.ifsc) && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                                {k.accountHolder && <span>{k.accountHolder}</span>}
                                {k.accountHolder && (k.accountNumber || k.ifsc) && <span> · </span>}
                                {k.accountNumber && <span>A/C {k.accountNumber}</span>}
                                {k.accountNumber && k.ifsc && <span> · </span>}
                                {k.ifsc && <span>IFSC {k.ifsc}</span>}
                              </div>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {splitVendorId > 0 && enabledFeeTypes.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Enter 0 for a fee type to exclude this vendor from that fee type&apos;s order. It will still be included for any fee type where the amount is above 0.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fee Type</TableHead>
                    <TableHead>{amountType === "1" ? "Split Amount" : "Split Percentage (%)"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enabledFeeTypes.map(ft => (
                    <TableRow key={ft.type}>
                      <TableCell className="font-medium">{ft.label}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step={amountType === "1" ? "0.01" : "0.01"}
                          value={splitAmounts[ft.type] || ""}
                          onChange={e => setSplitAmounts(prev => ({ ...prev, [ft.type]: Number(e.target.value) }))}
                          placeholder={amountType === "1" ? "Enter amount" : "Enter %"}
                          className="w-40"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox checked={splitIsSelf} onCheckedChange={(c) => setSplitIsSelf(!!c)} id="splitIsSelf" />
                  <Label htmlFor="splitIsSelf" className="text-sm">Is Self?</Label>
                </div>
                <Button onClick={handleAddVendorSplit}><Plus className="h-4 w-4 mr-2" />Add Vendor Split</Button>
              </div>
            </>
          )}
        </div>

        {/* Added vendors list */}
        {addedVendorIds.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium">Added Vendors</h4>
            {addedVendorIds.map(kycId => {
              const vendor = kycVendors.find(k => k.id === kycId);
              const vendorSplitsForKyc = vendorSplits.filter(s => s.fkKycId === kycId);
              const isDefaultVendor = isDefaultSettlementVendorId(vendor?.vendorId || vendorSplitsForKyc[0]?.vendorId);
              const isSelf = vendorSplitsForKyc[0]?.isSelf || false;
              const acLabel = getAccountLabel(kycId);
              return (
                <div key={kycId} className={`border rounded-lg p-3 ${isDefaultVendor ? "bg-muted/50 border-muted-foreground/30" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isDefaultVendor && <Lock className="h-4 w-4 text-muted-foreground" />}
                        <Badge variant="outline" className="font-mono text-xs">{acLabel}</Badge>
                        <span className="font-medium">{vendor?.name || vendorSplitsForKyc[0]?.vendorName}</span>
                        <span className="text-sm text-muted-foreground">({vendor?.vendorId || vendorSplitsForKyc[0]?.vendorId})</span>
                        {isDefaultVendor && <Badge variant="secondary">Default</Badge>}
                        {isSelf && <Badge variant="outline" className="border-blue-500 text-blue-600">Self</Badge>}
                      </div>
                      {/* Bank account info — same small line as in the selector
                          so admin can confirm the right account at a glance. */}
                      {vendor && (vendor.accountHolder || vendor.accountNumber || vendor.ifsc) && (
                        <div className="text-[11px] text-muted-foreground mt-1 leading-tight">
                          {vendor.accountHolder && <span>{vendor.accountHolder}</span>}
                          {vendor.accountHolder && (vendor.accountNumber || vendor.ifsc) && <span> · </span>}
                          {vendor.accountNumber && <span>A/C {vendor.accountNumber}</span>}
                          {vendor.accountNumber && vendor.ifsc && <span> · </span>}
                          {vendor.ifsc && <span>IFSC {vendor.ifsc}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {isDefaultVendor && (
                        <Button
                          variant="ghost" size="icon"
                          title="Recalculate from the current Default Amount + Online Surcharge % (its split can go stale if you added it before those were filled in)"
                          onClick={handleRefreshDefaultVendor}
                        >
                          <RefreshCw className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteVendorGroup(kycId)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {vendorSplitsForKyc.map((split, idx) => {
                      const ft = enabledFeeTypes.find(f => f.type === split.fkFeeType);
                      return (
                        <div key={idx} className={`text-sm px-3 py-1.5 rounded flex items-center gap-2 ${isDefaultVendor ? "bg-muted/70" : "bg-muted"}`}>
                          <span className="text-muted-foreground whitespace-nowrap">{ft?.label || `Fee Type ${split.fkFeeType}`}:</span>
                          {isDefaultVendor ? (
                            <span className="font-medium">{amountType === "1" ? `${currencySymbol()}${split.splitAmount.toFixed(2)}` : `${split.splitAmount}%`}</span>
                          ) : (
                            <Input
                              type="number" step="0.01" className="w-24 h-7 text-xs"
                              value={split.splitAmount || ""}
                              onChange={e => {
                                const newVal = Number(e.target.value);
                                setVendorSplits(prev => prev.map(s =>
                                  s.fkKycId === kycId && s.fkFeeType === split.fkFeeType ? { ...s, splitAmount: newVal } : s
                                ));
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>)}
      </CardContent>
    </Card>
  );

  // Per-member fee override helpers (state declared at top)
  const getMemberFee = (memberId: number, feeType: number) => {
    const key = `${memberId}_${feeType}`;
    if (memberFeeOverrides[key] !== undefined) return memberFeeOverrides[key];
    return feeType === 1 ? Number(feeType1Amount || 0) : feeType === 2 ? Number(feeType2Amount || 0) : Number(feeType3Amount || 0);
  };
  const setMemberFee = (memberId: number, feeType: number, val: number) => {
    setMemberFeeOverrides(prev => ({ ...prev, [`${memberId}_${feeType}`]: val }));

    // The locked DEFAULT account is DERIVED from this member's own fee amount, so it
    // has to follow the edit — otherwise it keeps showing the figure computed for the
    // previous amount (a row dropped 18,000 -> 11,000 kept the 18,000 default of
    // 547.20). Per fee type, so Annual / Semi 1 / Semi 2 each track their own base.
    // Only the default account is touched; the hand-edited vendors are left alone,
    // and no Balance moves because the default account is balance-excluded.
    //
    // Percentage mode (amountType "2") is skipped: its vendor columns hold percentages,
    // not rupees, so the rupee formula does not apply there.
    if (amountType === "2") return;
    const defaultKycIds = addedVendorIds.filter(kycId => isDefaultKyc(kycId));
    if (defaultKycIds.length === 0) return;
    const defaultAmount = computeDefaultAccountAmount(
      val, Number(onlineSurchargePercent), defaultAccountRatePercent,
    );
    setMemberVendorOverrides(prev => {
      const next = { ...prev };
      defaultKycIds.forEach(kycId => { next[`${memberId}_${feeType}_${kycId}`] = defaultAmount; });
      return next;
    });
  };

  // Per-member vendor override helpers (state declared at top)
  const getMemberVendor = (memberId: number, feeType: number, kycId: number) => {
    const key = `${memberId}_${feeType}_${kycId}`;
    if (memberVendorOverrides[key] !== undefined) return memberVendorOverrides[key];
    const split = vendorSplits.find(s => s.fkFeeType === feeType && s.fkKycId === kycId);
    return split?.splitAmount || 0;
  };
  const setMemberVendor = (memberId: number, feeType: number, kycId: number, val: number) => {
    setMemberVendorOverrides(prev => ({ ...prev, [`${memberId}_${feeType}_${kycId}`]: val }));
  };

  /** The locked, auto-computed default settlement account. */
  const isDefaultKyc = (kycId: number) =>
    isDefaultSettlementVendorId(kycVendors.find(k => k.id === kycId)?.vendorId);

  /** Is this added vendor excluded from the Balance? (default account or saraswat plug) */
  const isBalanceExcludedKyc = (kycId: number) =>
    isBalanceExcludedVendorId(kycVendors.find(k => k.id === kycId)?.vendorId);

  /**
   * Vendor total for one member + fee type, EXCLUDING the balance-excluded accounts
   * (see BALANCE_EXCLUDED_VENDOR_IDS at the top of this file).
   *
   * The default account is not a cost taken out of the fee — it's the account that
   * RECEIVES whatever the other vendors don't take. Counting it against the fee made
   * every row show a balance of exactly minus the default amount (e.g. fee 38,000 −
   * (38,000 + 1,155.20) = −1,155.20), and tripped the "does not match vendor total"
   * guard on Next. The saraswat account is excluded for the same reason: it only holds
   * the rounding remainder the default account is short by. Balance = fee − real
   * vendors = what the default (+ its saraswat plug) collects.
   */
  const getVendorTotalForBalance = (memberId: number, feeType: number) => {
    let total = 0;
    addedVendorIds.forEach(kycId => {
      if (!isBalanceExcludedKyc(kycId)) total += getMemberVendor(memberId, feeType, kycId);
    });
    return total;
  };

  // ---- Edit Mode Helpers ----
  const refreshEditMembers = async () => {
    if (!editId) return;
    setEditMembersLoading(true);
    try {
      const data = await getMembershipDuesMembers(Number(editId));
      setEditMembers(data.members || data.Members || []);
    } catch { }
    finally { setEditMembersLoading(false); setEditMembersFetched(true); }
  };

  const getEditFeeAmount = (m: any, ft: number) => ft === 1 ? (m.annualAmount ?? 0) : ft === 2 ? (m.semi1Amount ?? 0) : (m.semi2Amount ?? 0);
  const getEditFeePaid = (m: any, ft: number) => ft === 1 ? (m.annualPaid ?? 0) : ft === 2 ? (m.semi1Paid ?? 0) : (m.semi2Paid ?? 0);
  const getEditFeeBalance = (m: any, ft: number) => ft === 1 ? (m.annualBalance ?? m.annualAmount ?? 0) : ft === 2 ? (m.semi1Balance ?? m.semi1Amount ?? 0) : (m.semi2Balance ?? m.semi2Amount ?? 0);

  // Whether the default amount for a fee type is safe to edit: true only when
  // every member who hasn't already paid that fee type currently has the same
  // amount (matches the same rule the backend enforces before cascading a
  // changed default onto existing members — see UpdateAsync's
  // CascadeDefaultIfUniform). Members who already paid are excluded since
  // their fee is closed history and doesn't count as a "divergence". While
  // member data hasn't loaded yet, default to false (locked) rather than
  // risk a flash of "editable" that isn't actually backed by data.
  const allMembersSameAmount = (ft: number): boolean => {
    if (!editMembersFetched || editMembersLoading) return false;
    const unpaid = editMembers.filter(m => getEditFeePaid(m, ft) <= 0);
    if (unpaid.length === 0) return true;
    const first = Number(getEditFeeAmount(unpaid[0], ft));
    return unpaid.every(m => Number(getEditFeeAmount(m, ft)) === first);
  };

  const getEditFeeStatus = (m: any, ft: number): string => {
    // If Annual is paid, Semi1 and Semi2 are N/A
    if ((ft === 2 || ft === 3) && getEditFeePaid(m, 1) > 0) return "N/A";
    // If Semi1 is paid, Annual is N/A (can't pay annual after semi1)
    if (ft === 1 && getEditFeePaid(m, 2) > 0) return "N/A";
    const paid = getEditFeePaid(m, ft);
    if (paid > 0) return "Paid";
    const status = ft === 1 ? m.annualStatus : ft === 2 ? m.semi1Status : m.semi2Status;
    if (status === "PendingApproval" || status === "Pending") return "Pending";
    return "Unpaid";
  };

  const getEditPaymentInfo = (m: any, ft: number): string => {
    const mode = ft === 1 ? m.annualPaymentMode : ft === 2 ? m.semi1PaymentMode : m.semi2PaymentMode;
    const date = ft === 1 ? m.annualPaymentDate : ft === 2 ? m.semi1PaymentDate : m.semi2PaymentDate;
    if (!mode) return "\u2014";
    if (date) {
      const d = new Date(date);
      return `${mode} | ${d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })} ${d.toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit" })}`;
    }
    return mode;
  };

  const getEditVendors = (m: any, ft: number): any[] => ft === 1 ? (m.annualVendors ?? []) : ft === 2 ? (m.semi1Vendors ?? []) : (m.semi2Vendors ?? []);

  /**
   * Is this edit-mode vendor row the locked default settlement account?
   *
   * Older dues rows were saved with IsDefault=0, so the stored flag alone is not
   * trustworthy — fall back to the vendor id, which is what step 3 matches on.
   */
  const isDefaultEditVendor = (v: any) =>
    Boolean(v?.isDefault || v?.IsDefault) ||
    isDefaultSettlementVendorId(v?.vendorId ?? v?.VendorId);

  /**
   * Is this edit-mode vendor row excluded from the Balance calculation?
   * The default account plus the saraswat rounding plug — see
   * BALANCE_EXCLUDED_VENDOR_IDS at the top of this file. Use this for MATH only;
   * use isDefaultEditVendor for the lock, so saraswat stays editable.
   */
  const isBalanceExcludedEditVendor = (v: any) =>
    isDefaultEditVendor(v) || isBalanceExcludedVendorId(v?.vendorId ?? v?.VendorId);

  /**
   * Edit-mode counterpart of setMemberFee: records the member's new fee amount AND
   * re-derives the locked DEFAULT account's split for that same fee type, writing both
   * into `editMemberChanges`.
   *
   * Using the same override map is what makes the recomputed figure persist: the
   * `${memberFeeId}_v_${feeType}_${index}` key is picked up by the `parts[1] === "v"`
   * branch in handleNext / handleSaveEditMemberChanges and posted as a vendorOverride.
   * The index matches the render's `vendors.map((v, i) => ...)` because both read the
   * same getEditVendors(m, feeType) array.
   *
   * Balances are untouched — isBalanceExcludedEditVendor skips the default account in
   * both the table's total and validateEditMemberBalances.
   */
  const setEditMemberFee = (m: { memberFeeId: number }, feeType: number, raw: string) => {
    const key = `${m.memberFeeId}_fee_${feeType}`;
    // Percentage mode keeps percentages in the vendor columns — the rupee formula
    // does not apply, so only the fee itself is recorded there.
    const recomputeDefault = amountType !== "2";
    const defaultAmount = computeDefaultAccountAmount(
      Number(raw), Number(onlineSurchargePercent), defaultAccountRatePercent,
    );
    const vendors = getEditVendors(m, feeType);
    setEditMemberChanges(prev => {
      const next = { ...prev, [key]: raw };
      if (recomputeDefault) {
        vendors.forEach((v, i) => {
          if (isDefaultEditVendor(v)) next[`${m.memberFeeId}_v_${feeType}_${i}`] = defaultAmount;
        });
      }
      return next;
    });
  };

  const getUnpaidFeeTypes = (m: any): {type: number, label: string}[] => {
    return enabledFeeTypes.filter(ft => getEditFeeStatus(m, ft.type) === "Unpaid");
  };

  const hasAnyPaidFee = (m: any): boolean => {
    return enabledFeeTypes.some(ft => getEditFeeStatus(m, ft.type) === "Paid");
  };

  const resetOfflineDialog = () => {
    setOfflineDialogOpen(false);
    setOfflineMember(null);
    setOfflineFeeType("");
    setOfflinePaymentMode("Cash");
    setOfflineTxnId("");
    setOfflineGivenTo("");
    setOfflineDate("");
    setOfflineRemark("");
    setOfflineAttachment(null);
    setOfflineSendEmail(false);
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
      fd.append("sendReceiptEmail", String(offlineSendEmail));
      if (offlineAttachment) fd.append("attachment", offlineAttachment);
      await recordMembershipDuesOffline(Number(editId), offlineMember.memberFeeId, fd);
      setSuccessMessage("Offline payment recorded!");
      resetOfflineDialog();
      refreshEditMembers();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to record offline payment.");
    } finally { setOfflineSaving(false); }
  };

  const handleApprove = async (paymentId: number) => {
    try {
      await approveMembershipDuesPayment(paymentId, { isApproved: true });
      setSuccessMessage("Payment approved!");
      refreshEditMembers();
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to approve."); }
  };

  const handleRejectSubmit = async () => {
    try {
      await approveMembershipDuesPayment(rejectPaymentId, { isApproved: false, rejectionReason: rejectReason });
      setSuccessMessage("Payment rejected.");
      setRejectDialogOpen(false);
      setRejectReason("");
      refreshEditMembers();
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to reject."); }
  };

  const handleEmailReminder = async (memberFeeId: number, feeType: number) => {
    try {
      await sendMembershipDuesReminder(Number(editId), memberFeeId, { feeType, remark: emailRemark || undefined });
      setSuccessMessage("Email reminder sent!");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to send reminder."); }
  };


  const handleReceipt = async (memberFeeId: number) => {
    try {
      await sendMembershipDuesReceipt(memberFeeId);
      setSuccessMessage("Receipt sent!");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to send receipt."); }
  };

  // Validate balance for all edit mode members, returns error message with Sr.No or null
  const validateEditMemberBalances = (): string | null => {
    const mismatchSrNos: number[] = [];
    const sorted = [...editMembers].sort((a, b) => {
      const aS = a.hasPendingApproval ? 0 : a.isNewMember ? 1 : 2;
      const bS = b.hasPendingApproval ? 0 : b.isNewMember ? 1 : 2;
      return aS - bS;
    });
    sorted.forEach((m, idx) => {
      const srNo = idx + 1;
      enabledFeeTypes.forEach(ft => {
        const status = getEditFeeStatus(m, ft.type);
        // Skip every status the member table freezes (same set as `frozen` in the
        // edit table): Paid / Pending approval / N/A. Those amounts are settled
        // history and can't be edited here, so blocking Next/Save on a mismatch
        // there gives the admin nothing to fix. Amounts are left untouched.
        if (status === "Paid" || status === "Pending" || status === "N/A") return;
        const feeAmt = editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`] !== undefined
          ? Number(editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`])
          : getEditFeeAmount(m, ft.type);
        const vendors = getEditVendors(m, ft.type);
        // Default account + saraswat plug excluded — they receive/absorb the balance,
        // they don't consume the fee.
        let vendorTotal = 0;
        vendors.forEach((v: any, i: number) => {
          if (isBalanceExcludedEditVendor(v)) return;
          const vKey = `${m.memberFeeId}_v_${ft.type}_${i}`;
          vendorTotal += editMemberChanges[vKey] !== undefined ? Number(editMemberChanges[vKey]) : (v.amount ?? v.Amount ?? 0);
        });
        if (Math.abs(feeAmt - vendorTotal) > 0.01 && !mismatchSrNos.includes(srNo)) {
          mismatchSrNos.push(srNo);
        }
      });
    });
    if (mismatchSrNos.length > 0) {
      return `Sr.No ${mismatchSrNos.join(", ")}: Fee amount does not match vendor total. Please adjust before saving.`;
    }
    return null;
  };

  const handleSaveEditMemberChanges = async () => {
    // Validate balances first
    const balanceErr = validateEditMemberBalances();
    if (balanceErr) { setErrorMessage(balanceErr); window.scrollTo(0, 0); return; }

    setSavingEditMembers(true);
    try {
      // Group changes by memberFeeId
      const memberUpdates: Record<number, any> = {};
      let changeCount = 0;
      for (const [key, value] of Object.entries(editMemberChanges)) {
        const parts = key.split("_");
        const memberFeeId = Number(parts[0]);
        if (!memberUpdates[memberFeeId]) memberUpdates[memberFeeId] = {};

        if (parts[1] === "cat") {
          memberUpdates[memberFeeId].categoryType = value;
        } else if (parts[1] === "fee") {
          const ft = Number(parts[2]);
          if (ft === 1) memberUpdates[memberFeeId].annualAmount = Number(value);
          if (ft === 2) memberUpdates[memberFeeId].semi1Amount = Number(value);
          if (ft === 3) memberUpdates[memberFeeId].semi2Amount = Number(value);
        } else if (parts[1] === "v") {
          // Vendor override: feeType and vendorIdx
          const ft = Number(parts[2]);
          const vIdx = Number(parts[3]);
          // Find the member to get vendor kycId
          const member = editMembers.find(m => m.memberFeeId === memberFeeId);
          if (member) {
            const vendors = getEditVendors(member, ft);
            if (vendors[vIdx]) {
              if (!memberUpdates[memberFeeId].vendorOverrides) memberUpdates[memberFeeId].vendorOverrides = [];
              memberUpdates[memberFeeId].vendorOverrides.push({
                vendorId: vendors[vIdx].vendorId || vendors[vIdx].VendorId,
                feeType: ft,
                amount: Number(value)
              });
            }
          }
        }
      }

      for (const [mfId, changes] of Object.entries(memberUpdates)) {
        changeCount++;
        await updateMembershipDuesMemberFee(Number(editId), Number(mfId), changes);
      }

      if (changeCount === 0) {
        setErrorMessage("No changes detected to save.");
        setSavingEditMembers(false);
        return;
      }

      setEditMemberChanges({});
      setSuccessMessage("Member changes saved successfully!");
      await refreshEditMembers();
    } catch (e: any) {
      setErrorMessage("Failed to save: " + (e?.response?.data?.message || e?.message || ""));
    } finally {
      setSavingEditMembers(false);
    }
  };

  const handleBulkEmailReminder = async () => {
    try {
      await bulkMembershipDuesReminderEmail(Number(editId), { remark: bulkRemark || undefined });
      setSuccessMessage("Bulk email reminders sent!");
      setBulkRemarkDialogOpen(false);
      setBulkRemark("");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
  };


  // ---- Dual-mode Step 4 ----
  const renderStep4MemberList = () => {
    if (isEdit) return renderStep4EditMode();
    return renderStep4NewMode();
  };

  const renderStep4NewMode = () => {
    const totalNewPages = Math.ceil(clubMembers.length / PAGE_SIZE);
    const pagedNewMembers = clubMembers.slice((newMemberPage - 1) * PAGE_SIZE, newMemberPage * PAGE_SIZE);

    return (
    <Card>
      <CardHeader>
        <CardTitle>Member List Preview</CardTitle>
        <p className="text-sm text-muted-foreground">Preview of fees allocated to all club members. You can edit individual fees and vendor costs before saving.</p>
      </CardHeader>
      <CardContent>
        {clubMembersLoading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
        ) : clubMembers.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">No members found for this club.</div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground sticky left-0 z-30 bg-primary w-16 min-w-[64px]">Sr.No</TableHead>
                  <TableHead className="text-primary-foreground sticky left-[64px] z-30 bg-primary w-48 min-w-[192px]">Name</TableHead>
                  <TableHead className="text-primary-foreground sticky left-[256px] z-30 bg-primary w-32 min-w-[128px] border-r border-slate-300">Category</TableHead>
                  {enabledFeeTypes.map(ft => (
                    <React.Fragment key={ft.type}>
                      <TableHead className="text-primary-foreground">{ft.label}</TableHead>
                      {addedVendorIds.map(kycId => (
                        <TableHead key={kycId} className="text-primary-foreground" title={kycVendors.find(k => k.id === kycId)?.name || ""}>{getAccountLabel(kycId)}</TableHead>
                      ))}
                      <TableHead className="text-primary-foreground">Balance</TableHead>
                      <TableHead className="text-primary-foreground">Status</TableHead>
                      <TableHead className="text-primary-foreground">Payment Info</TableHead>
                    </React.Fragment>
                  ))}
                  <TableHead className="text-primary-foreground">Approve/Reject</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedNewMembers.map((member, idx) => {
                  const mId = member.id || member.pk_member_master_profile_id || idx;
                  const globalIdx = (newMemberPage - 1) * PAGE_SIZE + idx + 1;
                  return (
                    <TableRow key={mId} className="bg-white">
                      <TableCell className="sticky left-0 z-10 bg-slate-100 w-16 min-w-[64px]">{globalIdx}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap sticky left-[64px] z-10 bg-slate-100 w-48 min-w-[192px]">{member.memberName || member.name || member.MemberName}</TableCell>
                      <TableCell className="sticky left-[256px] z-10 bg-slate-100 w-32 min-w-[128px] border-r border-slate-300">
                        <Input className="w-24 h-8 text-xs"
                          value={memberCategoryOverrides[`${mId}_category`] ?? defaultCategoryType}
                          onChange={e => setMemberCategoryOverrides(prev => ({ ...prev, [`${mId}_category`]: e.target.value }))}
                        />
                      </TableCell>
                      {enabledFeeTypes.map(ft => {
                        const feeAmt = getMemberFee(mId, ft.type);
                        const vendorTotal = getVendorTotalForBalance(mId, ft.type);
                        const balance = amountType === "1" ? feeAmt - vendorTotal : 100 - vendorTotal;
                        return (
                          <React.Fragment key={ft.type}>
                            {/* Editable Fee Amount */}
                            <TableCell>
                              <Input
                                type="number" step="0.01" className="w-24 h-8 text-xs"
                                value={feeAmt || ""}
                                onChange={e => setMemberFee(mId, ft.type, Number(e.target.value))}
                              />
                            </TableCell>
                            {/* Editable Vendor Amounts */}
                            {addedVendorIds.map(kycId => {
                              // Lock is DEFAULT-only: the saraswat plug is excluded from the
                              // balance but stays editable.
                              const isDefault = isDefaultKyc(kycId);
                              const vAmt = getMemberVendor(mId, ft.type, kycId);
                              return (
                                <TableCell key={kycId}>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number" step="0.01"
                                      className={`w-20 h-8 text-xs ${isDefault ? "bg-gray-100" : ""}`}
                                      value={vAmt || ""}
                                      disabled={isDefault}
                                      onChange={e => setMemberVendor(mId, ft.type, kycId, Number(e.target.value))}
                                    />
                                    {isDefault && <Lock className="h-3 w-3 text-muted-foreground" />}
                                  </div>
                                </TableCell>
                              );
                            })}
                            {/* Balance */}
                            <TableCell className={Math.abs(balance) > 0.01 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                              {amountType === "1" ? `\u20B9${balance.toFixed(2)}` : `${balance.toFixed(2)}%`}
                            </TableCell>
                            {/* Status */}
                            <TableCell>
                              <Badge variant="destructive" className="text-xs">Unpaid</Badge>
                            </TableCell>
                            {/* Payment Info */}
                            <TableCell className="text-xs text-muted-foreground">{"\u2014"}</TableCell>
                          </React.Fragment>
                        );
                      })}
                      {/* Approve/Reject */}
                      <TableCell className="text-xs text-muted-foreground">{"\u2014"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between p-3 border-t">
              <span className="text-sm text-muted-foreground">Page {newMemberPage} of {totalNewPages} ({clubMembers.length} members)</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={newMemberPage <= 1} onClick={() => setNewMemberPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={newMemberPage >= totalNewPages} onClick={() => setNewMemberPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    );
  };

  const renderStep4EditMode = () => {
    const sorted = [...editMembers].sort((a, b) => {
      const aS = a.hasPendingApproval ? 0 : a.isNewMember ? 1 : 2;
      const bS = b.hasPendingApproval ? 0 : b.isNewMember ? 1 : 2;
      return aS - bS;
    });
    const searched = editMemberSearch
      ? sorted.filter(m => (m.memberName || "").toLowerCase().includes(editMemberSearch.toLowerCase()))
      : sorted;
    const totalPages = Math.ceil(searched.length / PAGE_SIZE);
    const paged = searched.slice((editMemberPage - 1) * PAGE_SIZE, editMemberPage * PAGE_SIZE);

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Member List</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search member..." value={editMemberSearch} onChange={e => { setEditMemberSearch(e.target.value); setEditMemberPage(1); }} className="pl-9 w-48 h-9" />
              </div>
              <Button size="sm" variant="outline" onClick={() => setBulkRemarkDialogOpen(true)}><Mail className="h-4 w-4 mr-1" />Bulk Email</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {editMembersLoading ? (
            <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
          ) : paged.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No members found.</div>
          ) : (
            <>
              <div className="overflow-x-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="text-primary-foreground sticky left-0 z-30 bg-primary w-16 min-w-[64px]">Sr.No</TableHead>
                      <TableHead className="text-primary-foreground sticky left-[64px] z-30 bg-primary w-48 min-w-[192px]">Name</TableHead>
                      <TableHead className="text-primary-foreground sticky left-[256px] z-30 bg-primary w-32 min-w-[128px] border-r border-slate-300">Category</TableHead>
                      {enabledFeeTypes.map(ft => (
                        <React.Fragment key={ft.type}>
                          <TableHead className="text-primary-foreground">{ft.label}</TableHead>
                          {(getEditVendors(paged[0] || {}, ft.type)).map((v: any, i: number) => (
                            <TableHead key={i} className="text-primary-foreground" title={v.vendorName || v.VendorName || ""}>{v.accountLabel || `A/C${i+1}`}</TableHead>
                          ))}
                          <TableHead className="text-primary-foreground">Balance</TableHead>
                          <TableHead className="text-primary-foreground">Status</TableHead>
                          <TableHead className="text-primary-foreground">Payment</TableHead>
                        </React.Fragment>
                      ))}
                      <TableHead className="text-primary-foreground">Offline</TableHead>
                      <TableHead className="text-primary-foreground">Reminder</TableHead>
                      <TableHead className="text-primary-foreground">Receipt</TableHead>
                      <TableHead className="text-primary-foreground">Approve/Reject</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((m, idx) => {
                      const isNew = m.isNewMember;
                      const isPending = m.hasPendingApproval;
                      // Default to bg-white so sticky cells (bg-inherit) cover scrolling content underneath
                      const rowClass = isPending ? "bg-yellow-100" : isNew ? "bg-green-200" : "bg-white";
                      const globalIdx = (editMemberPage - 1) * PAGE_SIZE + idx + 1;
                      return (
                        <TableRow key={m.memberFeeId || idx} className={rowClass}>
                          <TableCell className="sticky left-0 z-10 w-16 min-w-[64px] bg-slate-100">{globalIdx}</TableCell>
                          <TableCell className="font-medium whitespace-nowrap sticky left-[64px] z-10 w-48 min-w-[192px] bg-slate-100">{m.memberName}</TableCell>
                          <TableCell className="sticky left-[256px] z-10 w-32 min-w-[128px] border-r border-slate-300 bg-slate-100">
                            <Input className="w-24 h-8 text-xs"
                              value={editMemberChanges[`${m.memberFeeId}_cat`] ?? m.categoryType ?? ""}
                              onChange={e => setEditMemberChanges(prev => ({ ...prev, [`${m.memberFeeId}_cat`]: e.target.value }))}
                            />
                          </TableCell>
                          {enabledFeeTypes.map(ft => {
                            const feeAmt = editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`] !== undefined
                              ? Number(editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`])
                              : getEditFeeAmount(m, ft.type);
                            const status = getEditFeeStatus(m, ft.type);
                            const payInfo = getEditPaymentInfo(m, ft.type);
                            const vendors = getEditVendors(m, ft.type);
                            const frozen = status === "Paid" || status === "Pending" || status === "N/A";
                            // Recalculate balance with overrides. The default account and the
                            // saraswat rounding plug are excluded — they receive/absorb the
                            // balance rather than consuming the fee.
                            let vendorTotal = 0;
                            vendors.forEach((v: any, i: number) => {
                              if (isBalanceExcludedEditVendor(v)) return;
                              const vKey = `${m.memberFeeId}_v_${ft.type}_${i}`;
                              vendorTotal += editMemberChanges[vKey] !== undefined ? Number(editMemberChanges[vKey]) : (v.amount ?? v.Amount ?? 0);
                            });
                            const balance = feeAmt - vendorTotal;
                            return (
                              <React.Fragment key={ft.type}>
                                <TableCell className={frozen ? "bg-gray-100" : ""}>
                                  {frozen ? (
                                    <span className="text-sm font-medium text-green-600">{currencySymbol()}{feeAmt.toFixed(2)}</span>
                                  ) : (
                                    <Input type="number" step="0.01" className="w-24 h-8 text-xs"
                                      value={editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`] ?? (feeAmt || "")}
                                      onChange={e => setEditMemberFee(m, ft.type, e.target.value)}
                                    />
                                  )}
                                </TableCell>
                                {vendors.map((v: any, i: number) => {
                                  const isDefVendor = isDefaultEditVendor(v);
                                  const vKey = `${m.memberFeeId}_v_${ft.type}_${i}`;
                                  const vAmt = editMemberChanges[vKey] !== undefined ? Number(editMemberChanges[vKey]) : (v.amount ?? v.Amount ?? 0);
                                  return (
                                    <TableCell key={i} className={`text-xs ${frozen ? "bg-gray-100" : ""}`}>
                                      {frozen || isDefVendor ? (
                                        <div className="flex items-center gap-0.5">
                                          <span>{currencySymbol()}{vAmt.toFixed(2)}</span>
                                          {isDefVendor && <Lock className="h-3 w-3 text-muted-foreground" />}
                                        </div>
                                      ) : (
                                        <Input type="number" step="0.01" className="w-20 h-8 text-xs"
                                          value={editMemberChanges[vKey] ?? (vAmt || "")}
                                          onChange={e => setEditMemberChanges(prev => ({ ...prev, [vKey]: e.target.value }))}
                                        />
                                      )}
                                    </TableCell>
                                  );
                                })}
                                {/* Frozen rows (Paid / Pending / N/A) are shown neutrally: their
                                    mismatch is deliberately not validated, so the alarming red
                                    would be misleading. Unpaid rows keep red/green as before. */}
                                <TableCell className={`font-medium ${frozen ? "text-muted-foreground bg-gray-100" : Math.abs(balance) > 0.01 ? "text-red-600" : "text-green-600"}`}>
                                  {currencySymbol()}{balance.toFixed(2)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={status === "Paid" ? "default" : status === "Pending" ? "secondary" : status === "N/A" ? "outline" : "destructive"}
                                    className={`text-xs ${status === "Paid" ? "bg-green-600" : status === "Pending" ? "bg-yellow-500" : status === "N/A" ? "bg-gray-400 text-white" : "bg-red-600"}`}>
                                    {status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{payInfo}</TableCell>
                              </React.Fragment>
                            );
                          })}
                          {/* Offline */}
                          <TableCell>
                            {!isNew && getUnpaidFeeTypes(m).length > 0 && (
                              <button className="text-xs text-blue-600 hover:underline whitespace-nowrap" onClick={() => {
                                setOfflineMember(m);
                                // Pre-fill with pending payment details if exists
                                if (m.hasPendingApproval || m.HasPendingApproval) {
                                  setOfflineFeeType(String(m.pendingFeeType ?? m.PendingFeeType ?? ""));
                                  setOfflinePaymentMode(m.pendingTransactionType ?? m.PendingTransactionType ?? "Cash");
                                  setOfflineTxnId(m.pendingTransactionId ?? m.PendingTransactionId ?? "");
                                  setOfflineGivenTo(m.pendingGivenTo ?? m.PendingGivenTo ?? "");
                                  setOfflineDate(m.pendingPaymentDate ?? m.PendingPaymentDate ? new Date(m.pendingPaymentDate || m.PendingPaymentDate).toISOString().split("T")[0] : "");
                                  setOfflineRemark(m.pendingRemark ?? m.PendingRemark ?? "");
                                }
                                setOfflineDialogOpen(true);
                              }}>
                                {(m.hasPendingApproval || m.HasPendingApproval) ? "View Offline" : "Update Offline"}
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
                          {/* Receipt — email only */}
                          <TableCell>
                            {!isNew && hasAnyPaidFee(m) && (
                              <button className="text-xs text-purple-600 hover:underline whitespace-nowrap" onClick={() => handleReceipt(m.memberFeeId)}>Send</button>
                            )}
                          </TableCell>
                          {/* Approve/Reject */}
                          <TableCell>
                            {!isNew && isPending && (
                              <div className="flex gap-1">
                                <button className="text-xs text-green-700 hover:underline" onClick={() => handleApprove(m.pendingPaymentId ?? m.PendingPaymentId ?? m.memberFeeId)}>Approve</button>
                                <button className="text-xs text-red-600 hover:underline" onClick={() => { setRejectPaymentId(m.pendingPaymentId ?? m.PendingPaymentId ?? m.memberFeeId); setRejectDialogOpen(true); }}>Reject</button>
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
              <div className="flex items-center justify-between p-3 border-t">
                <span className="text-sm text-muted-foreground">Page {editMemberPage} of {totalPages} ({searched.length} members)</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={editMemberPage <= 1} onClick={() => setEditMemberPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={editMemberPage >= totalPages} onClick={() => setEditMemberPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </>
          )}

          {/* Offline Payment Dialog */}
          <Dialog open={offlineDialogOpen} onOpenChange={v => { if (!v) resetOfflineDialog(); }}>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{(offlineMember?.hasPendingApproval || offlineMember?.HasPendingApproval) ? "View Offline Payment" : "Record Offline Payment"}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 bg-muted/30 p-4 rounded-lg">
                  <h4 className="font-semibold">Member Info</h4>
                  <p className="text-sm"><strong>Name:</strong> {offlineMember?.memberName}</p>
                  <p className="text-sm"><strong>Category:</strong> {offlineMember?.categoryType}</p>
                  {(offlineMember?.hasPendingApproval || offlineMember?.HasPendingApproval) && (
                    <>
                      <hr className="my-2" />
                      <h4 className="font-semibold text-yellow-700">Pending Submission Details</h4>
                      {(offlineMember?.pendingFeeType || offlineMember?.PendingFeeType) && (
                        <p className="text-sm"><strong>Fee Type:</strong> {
                          (offlineMember.pendingFeeType ?? offlineMember.PendingFeeType) === 1 ? (enabledFeeTypes.find(f => f.type === 1)?.label || "Annual") :
                          (offlineMember.pendingFeeType ?? offlineMember.PendingFeeType) === 2 ? (enabledFeeTypes.find(f => f.type === 2)?.label || "Semi Annual 1") :
                          (enabledFeeTypes.find(f => f.type === 3)?.label || "Semi Annual 2")
                        }</p>
                      )}
                      {(offlineMember?.pendingAmount ?? offlineMember?.PendingAmount) != null && (
                        <p className="text-sm"><strong>Amount:</strong> {currencySymbol()}{Number(offlineMember.pendingAmount ?? offlineMember.PendingAmount).toFixed(2)}</p>
                      )}
                      {(offlineMember?.pendingTransactionType || offlineMember?.PendingTransactionType) && (
                        <p className="text-sm"><strong>Payment Mode:</strong> {offlineMember.pendingTransactionType || offlineMember.PendingTransactionType}</p>
                      )}
                      {(offlineMember?.pendingTransactionId || offlineMember?.PendingTransactionId) && (
                        <p className="text-sm"><strong>Transaction ID:</strong> {offlineMember.pendingTransactionId || offlineMember.PendingTransactionId}</p>
                      )}
                      {(offlineMember?.pendingGivenTo || offlineMember?.PendingGivenTo) && (
                        <p className="text-sm"><strong>Given To:</strong> {offlineMember.pendingGivenTo || offlineMember.PendingGivenTo}</p>
                      )}
                      {(offlineMember?.pendingPaymentDate || offlineMember?.PendingPaymentDate) && (
                        <p className="text-sm"><strong>Date:</strong> {new Date(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate).toLocaleDateString(appLocale())}</p>
                      )}
                      {(offlineMember?.pendingRemark || offlineMember?.PendingRemark) && (
                        <p className="text-sm"><strong>Remark:</strong> {offlineMember.pendingRemark || offlineMember.PendingRemark}</p>
                      )}
                      {(offlineMember?.pendingAttachment || offlineMember?.PendingAttachment) && (
                        <a href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                          target="_blank" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                          <FileText className="h-3 w-3" /> View Attachment
                        </a>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <Label>Fee Type <span className="text-destructive">*</span></Label>
                    <Select value={offlineFeeType} onValueChange={setOfflineFeeType}>
                      <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                      <SelectContent>
                        {offlineMember && getUnpaidFeeTypes(offlineMember).map(ft => (
                          <SelectItem key={ft.type} value={String(ft.type)}>{ft.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                    <Input type="file" accept="image/*,.pdf"
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        if (f && !(f.type.startsWith("image/") || f.type === "application/pdf")) {
                          alert("Only image files or PDF are allowed.");
                          e.target.value = "";
                          setOfflineAttachment(null);
                          return;
                        }
                        setOfflineAttachment(f);
                      }} />
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX</p>
                    {offlineMember && (offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                      <a href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                        target="_blank" className="text-xs text-blue-600 hover:underline mt-1 inline-block">View existing attachment</a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={offlineSendEmail} onCheckedChange={c => setOfflineSendEmail(!!c)} id="offlineSendEmail" />
                    <Label htmlFor="offlineSendEmail">Send Email Receipt</Label>
                  </div>
                  <Button onClick={handleOfflineSave} disabled={offlineSaving} className="w-full">
                    {offlineSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Save
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Reject Dialog */}
          <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Reject Payment</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Rejection Reason</Label><Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Enter reason for rejection" /></div>
                <Button variant="destructive" onClick={handleRejectSubmit} className="w-full">Reject Payment</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Bulk Email Remark Dialog */}
          <Dialog open={bulkRemarkDialogOpen} onOpenChange={setBulkRemarkDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Send Bulk Email Reminders</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Remark (optional)</Label><Input value={bulkRemark} onChange={e => setBulkRemark(e.target.value)} placeholder="Optional remark" /></div>
                <Button onClick={handleBulkEmailReminder} className="w-full">Send Reminders</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Individual Email Reminder Remark Dialog */}
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
        </CardContent>
      </Card>
    );
  };

  const renderStep5ImagesEmail = () => (
    <Card>
      <CardHeader><CardTitle>Images & Email Templates</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {/* Images */}
        <h3 className="font-semibold text-base">Images</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Banner / Logo (PurposeLogo)</Label>
            <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setLogoFile(e.target.files?.[0] || null)} />
            <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
            {existingLogoUrl && !logoFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Current:</p>
                <img src={existingLogoUrl} alt="Current logo" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
            {logoFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">New (preview):</p>
                <img src={URL.createObjectURL(logoFile)} alt="New logo" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
          </div>
          <div>
            <Label>Background Image</Label>
            <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setBgImageFile(e.target.files?.[0] || null)} />
            <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
            {existingBgUrl && !bgImageFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Current:</p>
                <img src={existingBgUrl} alt="Current background" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
            {bgImageFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">New (preview):</p>
                <img src={URL.createObjectURL(bgImageFile)} alt="New background" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
          </div>
        </div>

        {/* Email Templates */}
        <hr className="my-2" />
        <h3 className="font-semibold text-base">Email Templates</h3>
        <div>
          <Label>Email Header Logo</Label>
          <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setEmailLogoFile(e.target.files?.[0] || null)} />
          <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
          {existingEmailLogoUrl && !emailLogoFile && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1">Current:</p>
              <img src={existingEmailLogoUrl} alt="Current email logo" className="max-h-20 max-w-full rounded border bg-muted/30 object-contain" />
            </div>
          )}
          {emailLogoFile && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1">New (preview):</p>
              <img src={URL.createObjectURL(emailLogoFile)} alt="New email logo" className="max-h-20 max-w-full rounded border bg-muted/30 object-contain" />
            </div>
          )}
        </div>
        <div>
          <Label>Email CC</Label>
          <Input value={emailCc} onChange={e => setEmailCc(e.target.value)} placeholder="cc@example.com" />
        </div>

        {/* Receipt Email */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Payment Receipt Email</h3>
          <div>
            <Label>Subject</Label>
            <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
          </div>
          <div className="bg-muted/50 rounded p-3 text-sm">
            <p className="text-muted-foreground mb-1">Default template (auto-included):</p>
            <p>Dear *****,</p>
            <p>District Number : ****</p>
            <p>Club Name : **** **** **** ****</p>
            <p>Purpose of the payment : ****</p>
            <p>Amount received : ****/-</p>
            <p>Date and time : ****</p>
            <p>Method of payment : ****</p>
            <p>Transaction ID : ****</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <ReactQuill
              theme="snow"
              value={emailBody}
              onChange={setEmailBody}
              modules={quillModules}
              placeholder="Add any extra content after the default template: supports bold / italic / sizes / colors / lists / links"
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewReceipt(true)}>
              <Eye className="h-4 w-4 mr-1" />Preview Receipt
            </Button>
          </div>
        </div>

        {/* Reminder Email */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Payment Reminder Email</h3>
          <div>
            <Label>Subject</Label>
            <Input value={emailReminderSubject} onChange={e => setEmailReminderSubject(e.target.value)} />
          </div>
          <div className="bg-muted/50 rounded p-3 text-sm">
            <p className="text-muted-foreground mb-1">Default template (auto-included):</p>
            <p>Dear *****,</p>
            <p>District Number : ****</p>
            <p>Club Name : **** **** **** ****</p>
            <p>Purpose of the payment : ****</p>
            <p>Outstanding amount : ****/-</p>
            <p>Status : ****</p>
            <p>Click on the link : ****</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <ReactQuill
              theme="snow"
              value={emailReminderBody}
              onChange={setEmailReminderBody}
              modules={quillModules}
              placeholder="Add any extra content after the default template: supports bold / italic / sizes / colors / lists / links"
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewReminder(true)}>
              <Eye className="h-4 w-4 mr-1" />Preview Reminder
            </Button>
          </div>
        </div>

        {/* Preview Dialogs */}
        <Dialog open={previewReceipt} onOpenChange={setPreviewReceipt}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Receipt Email Preview</DialogTitle></DialogHeader>
            <div className="border rounded p-4 space-y-2">
              <p className="text-sm text-muted-foreground"><strong>Subject:</strong> {emailSubject}</p>
              <hr />
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: getReceiptPreviewHtml() }} />
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={previewReminder} onOpenChange={setPreviewReminder}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Reminder Email Preview</DialogTitle></DialogHeader>
            <div className="border rounded p-4 space-y-2">
              <p className="text-sm text-muted-foreground"><strong>Subject:</strong> {emailReminderSubject}</p>
              <hr />
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: getReminderPreviewHtml() }} />
            </div>
          </DialogContent>
        </Dialog>

        {/* Google Sheet Email */}
        <hr className="my-2" />
        <h3 className="font-semibold text-base">Google Sheet Integration</h3>
        <div>
          <Label>Google Sheet Email</Label>
          <Input value={googleSheetEmail} onChange={e => setGoogleSheetEmail(e.target.value)} placeholder="Enter email to share Google Sheet access" />
          <p className="text-xs text-muted-foreground mt-1">A Google Sheet will be auto-created for this Club Dues. Enter an email to share editor access.</p>
        </div>
      </CardContent>
    </Card>
  );

  const renderCurrentStep = () => {
    if (isAdminEdit) {
      // Admin edit: Step 0 = Basic Info (read-only except title/description), Step 1 = Images & Email
      switch (currentStep) {
        case 0: return renderStep1BasicInfoPayment();
        case 1: return renderStep5ImagesEmail();
        default: return null;
      }
    }
    switch (currentStep) {
      case 0: return renderStep1BasicInfoPayment();
      case 1: return renderStep2FeeTypesAmounts();
      case 2: return renderStep3VendorSplits();
      case 3: return renderStep4MemberList();
      case 4: return renderStep5ImagesEmail();
      default: return null;
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={isAdminEdit && selectedClubId ? `/clubs/${selectedClubId}/membership-dues` : "/settings/membership-dues"}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {isEdit ? "Edit Club Dues" : "Create Club Dues"}
            </h2>
            <p className="text-muted-foreground text-base">Step {currentStep + 1} of {totalSteps}</p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {activeStepLabels.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i < currentStep ? "bg-green-600 text-white" :
                i === currentStep ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm hidden md:inline ${i === currentStep ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < activeStepLabels.length - 1 && <div className="w-8 h-[2px] bg-muted" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        {renderCurrentStep()}

        {/* Navigation Buttons */}
        <div className="flex justify-between pb-8">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
          <div className="flex gap-2">
            {isLastStep ? (
              <Button onClick={handleSubmit} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving ? <RotaryLoader size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Club Dues" : "Create Club Dues")}
              </Button>
            ) : (
              <Button onClick={handleNext} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {saving ? "Saving..." : "Next"}
                {!saving && <ArrowRight className="h-4 w-4 ml-2" />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
