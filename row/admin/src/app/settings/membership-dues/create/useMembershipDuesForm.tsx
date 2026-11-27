import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createMembershipDues, updateMembershipDues, getMembershipDuesDetail, getClubMembers, getDistricts, getClubs, getCashfreeKycList, getRotaryYears, getMembershipDuesMembers, getMembershipDuesList, updateMembershipDuesMemberFee, allocateMembershipDuesFees } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrencySymbol, duesDefaultsForDistrict } from "@/lib/currency";
import { getDuesDraft, saveDuesDraft, deleteDuesDraft, newDuesDraftId } from "@/lib/duesDraft";
import { defaultCurrency } from "@/lib/appFormat";
import { KycItem, DistrictItem, isZone0, ClubItem, VendorSplit, isDefaultSettlementVendorId, isBalanceExcludedVendorId, DEFAULT_ACCOUNT_RATE_PERCENT, SPLITS_ON, STEP_LABELS, ADMIN_STEP_LABELS } from "./membershipDuesShared";
import type { deriveMembershipDuesForm } from "./membershipDuesDerived";

export function useMembershipDuesForm() {
  const { isSuperAdmin, isAdmin, user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const editId = searchParams.get("editId");
  const isEdit = !!editId;
  // Browser draft (new dues only): ?draft=<id> continues a saved draft; otherwise a new id is made.
  const draftParam = searchParams.get("draft");
  const draftIdRef = useRef<string>(draftParam || newDuesDraftId());
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const draftDistrictRef = useRef<string | null>(null); // restored district: keep its saved channels/currency

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
  // Offline only = money is collected by hand, nothing is split (user 2026-11-13): no Vendor Splits step, no vendor /
  // balance columns, no vendors saved. Online / Both keep the split and it stays mandatory.
  const isOfflineOnly = modeOfPayment === "2";
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
  // Vendor splits use the surcharge only when online payment is possible: Offline-only
  // dues split the BASE amount (user 2026-11-09) - offline members never pay the surcharge.
  const splitSurchargePercent = modeOfPayment === "2" ? 0 : (Number(onlineSurchargePercent) || 0);

  // Section 5: Vendor Splits
  const [amountType, setAmountType] = useState(SPLITS_ON ? "" : "1"); // 1=Amount, 2=Percentage
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

  // Section 9 (Super Admin only, RIZones 2026-11-09, ROW form): whether this dues emails members, and the
  // currency its amounts show in. ROW has no WhatsApp. savedNotify = what the server has now, so the
  // reminder/receipt buttons below match what it will actually allow.
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [currency, setCurrency] = useState<string>(defaultCurrency());
  // New dues: pre-fill from the district's default currency.
  useEffect(() => {
    if (isEdit || !selectedDistrictId || draftDistrictRef.current === selectedDistrictId) return;
    const d = duesDefaultsForDistrict(allDistricts.find((x) => String(x.id) === selectedDistrictId)?.defaultCurrency);
    setNotifyEmail(d.notifyEmail); setCurrency(d.currency);
  }, [isEdit, selectedDistrictId, allDistricts]);
  const [savedNotify, setSavedNotify] = useState({ email: true });
  const cur = getCurrencySymbol(currency);
  const curSuffix = "";

  // Edit mode: track original values for freeze/lock rules
  const [originalFees, setOriginalFees] = useState({ isFees1: false, isFees2: false, isFees3: false });
  const [originalMode, setOriginalMode] = useState("");

  // Rotary Years from DB
  const [rotaryYears, setRotaryYears] = useState<string[]>([]);
  const isAdminEdit = isAdmin && !isSuperAdmin && isEdit;
  const activeStepLabels = isAdminEdit ? ADMIN_STEP_LABELS : STEP_LABELS;
  // Offline only: the Vendor Splits step (index 2 of the full wizard) is skipped and not shown.
  const skipsVendorStep = !isAdminEdit && (!SPLITS_ON || isOfflineOnly);
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

  // -- Browser draft: what is kept on every Next, and put back when the draft is continued --
  const draftSnapshot = () => ({
    selectedDistrictId, selectedClubId, rotaryYear, purpose, description,
    modeOfPayment, sendBankDetails, bankName, accountNumber, ifscCode,
    feeType1Enabled, feeType1Label, feeType2Enabled, feeType2Label, feeType3Enabled, feeType3Label,
    defaultCategoryType, feeType1Amount, feeType2Amount, feeType3Amount, onlineSurchargePercent,
    amountType, defaultPercentage, vendorSplits,
    memberFeeOverrides, memberVendorOverrides, memberCategoryOverrides,
    emailCc, emailSubject, emailBody, emailReminderSubject, emailReminderBody, googleSheetEmail,
    notifyEmail, currency,
  });
  const saveDraft = (step: number) => {
    if (isEdit || !user?.memberId) return;
    const club = districtClubs.find((c) => String(c.id) === selectedClubId)?.clubName;
    const dist = allDistricts.find((d) => String(d.id) === selectedDistrictId)?.districtNumber;
    const title = [club || (dist ? `District ${dist}` : "New Club Dues"), rotaryYear, purpose].filter(Boolean).join(" · ");
    saveDuesDraft({ id: draftIdRef.current, kind: "club", memberId: user.memberId, step, title, data: draftSnapshot() });
    setDraftSavedAt(new Date().toISOString());
    if (draftParam !== draftIdRef.current) router.replace(`/settings/membership-dues/create?draft=${draftIdRef.current}`, { scroll: false });
  };
  const restoredRef = useRef(false);
  useEffect(() => {
    if (isEdit || restoredRef.current || !draftParam || !user?.memberId) return;
    restoredRef.current = true;
    const dr = getDuesDraft(draftParam, user.memberId);
    if (!dr) return;
    const d = dr.data || {};
    draftDistrictRef.current = d.selectedDistrictId || null;
    if (d.selectedDistrictId != null) setSelectedDistrictId(d.selectedDistrictId);
    if (d.selectedClubId != null) setSelectedClubId(d.selectedClubId);
    if (d.rotaryYear) setRotaryYear(d.rotaryYear);
    if (d.purpose != null) setPurpose(d.purpose);
    if (d.description != null) setDescription(d.description);
    if (d.modeOfPayment) setModeOfPayment(d.modeOfPayment);
    if (d.sendBankDetails != null) setSendBankDetails(d.sendBankDetails);
    if (d.bankName != null) setBankName(d.bankName);
    if (d.accountNumber != null) setAccountNumber(d.accountNumber);
    if (d.ifscCode != null) setIfscCode(d.ifscCode);
    if (d.feeType1Enabled != null) setFeeType1Enabled(d.feeType1Enabled);
    if (d.feeType1Label != null) setFeeType1Label(d.feeType1Label);
    if (d.feeType2Enabled != null) setFeeType2Enabled(d.feeType2Enabled);
    if (d.feeType2Label != null) setFeeType2Label(d.feeType2Label);
    if (d.feeType3Enabled != null) setFeeType3Enabled(d.feeType3Enabled);
    if (d.feeType3Label != null) setFeeType3Label(d.feeType3Label);
    if (d.defaultCategoryType != null) setDefaultCategoryType(d.defaultCategoryType);
    if (d.feeType1Amount != null) setFeeType1Amount(d.feeType1Amount);
    if (d.feeType2Amount != null) setFeeType2Amount(d.feeType2Amount);
    if (d.feeType3Amount != null) setFeeType3Amount(d.feeType3Amount);
    if (d.onlineSurchargePercent != null) setOnlineSurchargePercent(d.onlineSurchargePercent);
    if (d.amountType != null) setAmountType(d.amountType);
    if (d.defaultPercentage != null) setDefaultPercentage(d.defaultPercentage);
    if (Array.isArray(d.vendorSplits)) setVendorSplits(d.vendorSplits);
    if (d.memberFeeOverrides) setMemberFeeOverrides(d.memberFeeOverrides);
    if (d.memberVendorOverrides) setMemberVendorOverrides(d.memberVendorOverrides);
    if (d.memberCategoryOverrides) setMemberCategoryOverrides(d.memberCategoryOverrides);
    if (d.emailCc != null) setEmailCc(d.emailCc);
    if (d.emailSubject != null) setEmailSubject(d.emailSubject);
    if (d.emailBody != null) setEmailBody(d.emailBody);
    if (d.emailReminderSubject != null) setEmailReminderSubject(d.emailReminderSubject);
    if (d.emailReminderBody != null) setEmailReminderBody(d.emailReminderBody);
    if (d.googleSheetEmail != null) setGoogleSheetEmail(d.googleSheetEmail);
    if (d.notifyEmail != null) setNotifyEmail(d.notifyEmail);
    if (typeof d.currency === "string" && d.currency) setCurrency(d.currency);
    setCurrentStep(Number(dr.step) || 0);
    setDraftSavedAt(dr.savedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, draftParam, user?.memberId]);

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
        // New dues: only districts that have Rotary.org-synced clubs, plus Zone 0 (user 2026-11-16).
        // Edit keeps the full list so an existing dues always shows its own district.
        const [result, synced] = await Promise.all([
          getDistricts(1, 1000),
          isEdit ? Promise.resolve(null) : getDistricts(1, 1000, undefined, undefined, undefined, undefined, undefined, true),
        ]);
        const syncedIds = new Set((synced?.items ?? []).map((d: any) => d.id));
        const items = result.items
          .filter((d: any) => isEdit || syncedIds.has(d.id) || isZone0(d.zoneName))
          .map((d: any) => ({ id: d.id, districtNumber: d.districtNumber, zoneName: d.zoneName, defaultCurrency: d.defaultCurrency }));
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
          if (current) setRotaryYear((prev) => prev || current.yearLabel); // keep a restored draft's year
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
        // New dues: only Rotary.org-synced clubs, every club in a Zone 0 district (user 2026-11-16);
        // edit keeps every club so the saved one shows.
        const zone0 = isZone0(allDistricts.find((d) => String(d.id) === selectedDistrictId)?.zoneName);
        const items = result.items
          .filter((c: any) => isEdit || zone0 || c.isSyncedFromRotaryOrg)
          .map((c: any) => ({ id: c.id, clubName: c.clubName }));
        items.sort((a: ClubItem, b: ClubItem) =>
          (a.clubName || "").localeCompare(b.clubName || "", undefined, { sensitivity: "base" })
        );
        setDistrictClubs(items);
      } catch { setDistrictClubs([]); }
    })();
    // allDistricts: a restored draft can pick its district before the district list (zone) has loaded
  }, [selectedDistrictId, allDistricts]);

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
        setNotifyEmail(detail.notifyEmail ?? true);
        setCurrency(detail.currency || defaultCurrency());
        setSavedNotify({ email: detail.notifyEmail ?? true });
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
          if (!ifscCode.trim()) return "Bank code is required when sending bank details in receipt.";
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
        if (!SPLITS_ON || isOfflineOnly) return null;   // splits off, or offline only: no split
        if (!amountType) return "Please select an Amount Type.";
        for (const ft of enabledFeeTypes) {
          const assigned = vendorSplits.filter(s => s.fkFeeType === ft.type).reduce((sum, s) => sum + s.splitAmount, 0);
          const feeAmount = ft.type === 1 ? Number(feeType1Amount || 0) : ft.type === 2 ? Number(feeType2Amount || 0) : Number(feeType3Amount || 0);
          const onlineTotal = feeAmount * (1 + splitSurchargePercent / 100);
          const total = amountType === "1" ? onlineTotal : 100;
          if (Math.abs(assigned - total) > 0.01) {
            return `${ft.label}: Vendor split ${amountType === "1" ? `${cur}${assigned.toFixed(2)}` : `${assigned.toFixed(2)}%`} does not match ${amountType === "1" ? `${cur}${total.toFixed(2)}` : `${total.toFixed(2)}%`}. Please adjust vendor amounts.`;
          }
        }
        return null;
      }
      case 3: // Member List - validate balances
      {
        if (!SPLITS_ON || isOfflineOnly) return null;   // no vendor split, so no balance to match
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
    // Offline only skips the Vendor Splits step, so no Amount Type is picked; the API needs a number
    // (blank failed with "AmountType: The value '' is invalid"). 1 = Amount, same default the API uses.
    fd.append("amountType", amountType || "1");
    fd.append("defaultPercentage", defaultPercentage || "0");
    fd.append("vendorsJson", JSON.stringify((isOfflineOnly ? [] : vendorSplits).map(s => ({
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
    // Server ignores these unless the caller is Super Admin; only send them from SA.
    if (isSuperAdmin) {
      fd.append("NotifyEmail", String(notifyEmail));
      fd.append("Currency", currency);
    }
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
    if (err) { setErrorMessage(err); document.querySelector("main")?.scrollTo(0, 0); return; }

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

    if (currentStep < totalSteps - 1) {
      const next = skipsVendorStep && currentStep === 1 ? 3 : currentStep + 1;
      setCurrentStep(next);
      saveDraft(next);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(skipsVendorStep && currentStep === 3 ? 1 : currentStep - 1);
  };

  // Submit (final save from step 5)
  const handleSubmit = async () => {
    saveDraft(currentStep); // keep everything typed even if the final save fails
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
        deleteDuesDraft(draftIdRef.current);
        setSuccessMessage("Club Dues created successfully!");
        setTimeout(() => router.push(redirectUrl), 1500);
      }
    } catch (err: any) {
      // The API can answer with a plain string, { message }, or a .NET validation object
      // ({ title, errors: { field: [msg] } }). Always turn it into text - rendering the object crashed the page.
      const d = err?.response?.data;
      const fieldErrors = d && typeof d === "object" && d.errors && typeof d.errors === "object"
        ? Object.entries(d.errors).map(([k, v]) => `${k.replace(/^\$\.?/, "")}: ${Array.isArray(v) ? v.join(" ") : String(v)}`).join("\n")
        : "";
      setErrorMessage(
        (typeof d === "string" && d) || d?.message || (fieldErrors ? `${d?.title || "Some fields are not valid."}\n${fieldErrors}` : "") || d?.title || "Failed to save Club Dues.",
      );
    } finally { setSaving(false); }
  };

  // Vendor split handlers
  const addedVendorIds = isOfflineOnly ? [] : Array.from(new Set(vendorSplits.map(s => s.fkKycId)));
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
<p><strong>Amount received</strong> : ${cur}****${curSuffix}</p>
<p><strong>Date and time</strong> : ****</p>
<p><strong>Method of payment</strong> : ****</p>
<p><strong>Transaction ID</strong> : ****</p>`;

  const defaultReminderHtml = `<p>Dear *****,</p>
<p><strong>District Number</strong> : ****</p>
<p><strong>Club Name</strong> : **** **** **** ****</p>
<p><strong>Purpose of the payment</strong> : ****</p>
<p><strong>Outstanding amount</strong> : ${cur}****${curSuffix}</p>
<p><strong>Status</strong> : ****</p>
<p><strong>Click on the link</strong> : ****</p>`;

  const getReceiptPreviewHtml = () => {
    return defaultReceiptHtml + (emailBody ? `<br/><p>${emailBody}</p>` : "");
  };

  const getReminderPreviewHtml = () => {
    return defaultReminderHtml + (emailReminderBody ? `<br/><p>${emailReminderBody}</p>` : "");
  };

  // Per-member fee override helpers (state declared at top)
  const getMemberFee = (memberId: number, feeType: number) => {
    const key = `${memberId}_${feeType}`;
    if (memberFeeOverrides[key] !== undefined) return memberFeeOverrides[key];
    return feeType === 1 ? Number(feeType1Amount || 0) : feeType === 2 ? Number(feeType2Amount || 0) : Number(feeType3Amount || 0);
  };

  // Per-member vendor override helpers (state declared at top)
  const getMemberVendor = (memberId: number, feeType: number, kycId: number) => {
    const key = `${memberId}_${feeType}_${kycId}`;
    if (memberVendorOverrides[key] !== undefined) return memberVendorOverrides[key];
    const split = vendorSplits.find(s => s.fkFeeType === feeType && s.fkKycId === kycId);
    return split?.splitAmount || 0;
  };

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

  const getEditVendors = (m: any, ft: number): any[] => isOfflineOnly ? []
    : ft === 1 ? (m.annualVendors ?? []) : ft === 2 ? (m.semi1Vendors ?? []) : (m.semi2Vendors ?? []);

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
  return { isSuperAdmin, isAdmin, editId, isEdit, draftSavedAt, currentStep, loading, saving, successMessage, setSuccessMessage, errorMessage, setErrorMessage, allDistricts, districtClubs, selectedDistrictId, setSelectedDistrictId, selectedClubId, setSelectedClubId, rotaryYear, setRotaryYear, purpose, setPurpose, description, setDescription, quillModules, modeOfPayment, setModeOfPayment, isOfflineOnly, sendBankDetails, setSendBankDetails, bankName, setBankName, accountNumber, setAccountNumber, ifscCode, setIfscCode, feeType1Enabled, setFeeType1Enabled, feeType1Label, setFeeType1Label, feeType2Enabled, setFeeType2Enabled, feeType2Label, setFeeType2Label, feeType3Enabled, setFeeType3Enabled, feeType3Label, setFeeType3Label, defaultCategoryType, setDefaultCategoryType, feeType1Amount, setFeeType1Amount, feeType2Amount, setFeeType2Amount, feeType3Amount, setFeeType3Amount, onlineSurchargePercent, setOnlineSurchargePercent, splitSurchargePercent, amountType, setAmountType, kycVendors, vendorSplits, setVendorSplits, splitVendorId, setSplitVendorId, splitAmounts, setSplitAmounts, splitVendorOpen, setSplitVendorOpen, splitIsSelf, setSplitIsSelf, logoFile, setLogoFile, bgImageFile, setBgImageFile, existingLogoUrl, existingBgUrl, emailCc, setEmailCc, emailSubject, setEmailSubject, emailBody, setEmailBody, emailReminderSubject, setEmailReminderSubject, emailReminderBody, setEmailReminderBody, emailLogoFile, setEmailLogoFile, existingEmailLogoUrl, previewReceipt, setPreviewReceipt, previewReminder, setPreviewReminder, googleSheetEmail, setGoogleSheetEmail, notifyEmail, setNotifyEmail, currency, setCurrency, savedNotify, cur, curSuffix, originalFees, originalMode, rotaryYears, isAdminEdit, activeStepLabels, skipsVendorStep, totalSteps, clubMembers, clubMembersLoading, newMemberPage, setNewMemberPage, PAGE_SIZE, editMembers, editMembersLoading, editMembersFetched, editMemberPage, setEditMemberPage, editMemberSearch, setEditMemberSearch, editMemberChanges, setEditMemberChanges, setSavingEditMembers, offlineDialogOpen, setOfflineDialogOpen, offlineMember, setOfflineMember, offlineFeeType, setOfflineFeeType, offlinePaymentMode, setOfflinePaymentMode, offlineTxnId, setOfflineTxnId, offlineGivenTo, setOfflineGivenTo, offlineDate, setOfflineDate, offlineRemark, setOfflineRemark, offlineAttachment, setOfflineAttachment, offlineSendEmail, setOfflineSendEmail, offlineSaving, setOfflineSaving, rejectDialogOpen, setRejectDialogOpen, rejectPaymentId, setRejectPaymentId, rejectReason, setRejectReason, bulkRemarkDialogOpen, setBulkRemarkDialogOpen, bulkRemark, setBulkRemark, emailRemarkDialogOpen, setEmailRemarkDialogOpen, emailRemarkMemberFeeId, setEmailRemarkMemberFeeId, emailRemark, setEmailRemark, setMemberFeeOverrides, setMemberVendorOverrides, memberCategoryOverrides, setMemberCategoryOverrides, enabledFeeTypes, validateFeeTypeCombination, handleNext, handleBack, handleSubmit, addedVendorIds, getAccountLabel, defaultAccountRatePercent, handleAddVendorSplit, handleDeleteVendorGroup, getReceiptPreviewHtml, getReminderPreviewHtml, getMemberFee, getMemberVendor, getVendorTotalForBalance, refreshEditMembers, getEditFeeAmount, getEditFeePaid, getEditFeeStatus, getEditVendors, isDefaultEditVendor, isBalanceExcludedEditVendor, validateEditMemberBalances };
}

export type MembershipDuesFormCtx = ReturnType<typeof useMembershipDuesForm> & ReturnType<typeof deriveMembershipDuesForm>;
