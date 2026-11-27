import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createFullEventPaymentLink, updateFullEventPaymentLink, getEventPaymentLinkDetail, getDistricts, getClubs, getCashfreeKycList, getEventFoodPreferences, getSubGroups, getDistrictSubGroups, getSubGroupAvailableYears } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { currencySymbol } from "@/lib/appFormat";
import { Registration, VendorSplit, Designation, KycItem, DistrictItem, ClubItem, SPLITS_ON, SPLIT_STEP, STEP_LABELS } from "./paymentLinkShared";

export function usePaymentLinkForm() {
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

  // Basic info
  const [formType, setFormType] = useState("1");
  const [amountType, setAmountType] = useState("1");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [recipientType, setRecipientType] = useState("1");
  const [isHideCharges, setIsHideCharges] = useState(false);

  // Districts & Clubs
  const [allDistricts, setAllDistricts] = useState<DistrictItem[]>([]);
  const [districtClubs, setDistrictClubs] = useState<ClubItem[]>([]);
  const [isMultipleDistricts, setIsMultipleDistricts] = useState(false);
  const [selectedDistrictIds, setSelectedDistrictIds] = useState<number[]>([]);
  const [selectedDistrictId, setSelectedDistrictId] = useState("");
  const [selectedClubId, setSelectedClubId] = useState("");

  // Subgroup selection
  const [rotaryYears, setRotaryYears] = useState<{ id: number; yearLabel: string }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [subGroups, setSubGroups] = useState<{ id: number; groupName: string }[]>([]);
  const [selectedSubGroupIds, setSelectedSubGroupIds] = useState<number[]>([]);

  // KYC vendors for splits
  const [kycVendors, setKycVendors] = useState<KycItem[]>([]);

  // Food preferences master
  const [allFoodPreferences, setAllFoodPreferences] = useState<{ id: number; foodType: string }[]>([]);

  // Form fields
  const [isForm, setIsForm] = useState(false);
  const [isTshirtSize, setIsTshirtSize] = useState(false);
  const [isFood, setIsFood] = useState(false);
  const [foodPreferenceIds, setFoodPreferenceIds] = useState("");
  const [isPartner, setIsPartner] = useState(false);
  const [isPartnerName, setIsPartnerName] = useState(false);
  const [isPartnerMobile, setIsPartnerMobile] = useState(false);
  const [isPartnerEmail, setIsPartnerEmail] = useState(false);
  const [isPartnerGender, setIsPartnerGender] = useState(false);
  const [isRemark1, setIsRemark1] = useState(false);
  const [remark1Title, setRemark1Title] = useState("");
  const [isRemark2, setIsRemark2] = useState(false);
  const [remark2Title, setRemark2Title] = useState("");
  const [isRemark3, setIsRemark3] = useState(false);
  const [remark3Title, setRemark3Title] = useState("");
  const [isDesignation, setIsDesignation] = useState(false);
  const [designationLabel, setDesignationLabel] = useState("");
  const [isPersonal, setIsPersonal] = useState(false);
  const [isPersonalName, setIsPersonalName] = useState(false);
  const [isPersonalMobile, setIsPersonalMobile] = useState(false);
  const [isPersonalEmail, setIsPersonalEmail] = useState(false);
  const [isPersonalDistrict, setIsPersonalDistrict] = useState(false);
  const [isPersonalClub, setIsPersonalClub] = useState(false);

  // Email
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("Payment received successfully!");
  const [emailBody, setEmailBody] = useState("");
  const [emailReminderSubject, setEmailReminderSubject] = useState("Payment Reminder");
  const [emailReminderBody, setEmailReminderBody] = useState("");
  const [previewReceipt, setPreviewReceipt] = useState(false);
  const [previewReminder, setPreviewReminder] = useState(false);
  const [googleSheetEmail, setGoogleSheetEmail] = useState("support@example.org");

  // Files
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);

  // Registrations (local state, no DB until submit)
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [nextTempId, setNextTempId] = useState(1);
  const [regName, setRegName] = useState("");
  const [regAmount, setRegAmount] = useState("");
  const [editingRegTempId, setEditingRegTempId] = useState<number | null>(null);

  // Vendor Splits (local state)
  const [vendorSplits, setVendorSplits] = useState<VendorSplit[]>([]);
  const [splitVendorId, setSplitVendorId] = useState<number>(0);
  const [splitAmounts, setSplitAmounts] = useState<Record<number, number>>({}); // tempId -> amount
  const [splitVendorOpen, setSplitVendorOpen] = useState(false);

  // Designations (local state)
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [desigName, setDesigName] = useState("");
  const [editingDesigIdx, setEditingDesigIdx] = useState<number | null>(null);

  // Compute visible steps (skip Designations if isDesignation is off)
  const totalSteps = STEP_LABELS.length;

  // Fetch all districts on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await getDistricts(1, 1000);
        setAllDistricts(result.items.map((d: any) => ({ id: d.id, districtNumber: d.districtNumber })).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      } catch {}
    })();
  }, []);

  // Fetch clubs when single district selected
  useEffect(() => {
    if (!selectedDistrictId) { setDistrictClubs([]); return; }
    (async () => {
      try {
        const result = await getClubs(1, 1000, undefined, Number(selectedDistrictId));
        setDistrictClubs(result.items.map((c: any) => ({ id: c.id, clubName: c.clubName })));
      } catch { setDistrictClubs([]); }
    })();
  }, [selectedDistrictId]);

  // Fetch KYC vendors on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await getCashfreeKycList();
        setKycVendors(data.filter((k: any) => k.isActive).map((k: any) => ({ id: k.id, vendorId: k.vendorId, name: k.name, status: k.status, isActive: k.isActive })));
      } catch (e) { console.error("Failed to load KYC vendors:", e); }
    })();
    (async () => {
      try {
        const data = await getEventFoodPreferences();
        setAllFoodPreferences(data.map((f: any) => ({ id: f.id, foodType: f.foodType })));
      } catch {}
    })();
  }, []);

  // Fetch available years when recipientType=subgroup and scope changes
  useEffect(() => {
    if (recipientType !== "2") { setRotaryYears([]); return; }
    (async () => {
      try {
        let cId: number | undefined;
        let dId: number | undefined;
        if (isMultipleDistricts) {
          dId = selectedDistrictIds.length > 0 ? selectedDistrictIds[0] : undefined;
        } else if (selectedClubId) {
          cId = Number(selectedClubId);
        } else if (selectedDistrictId) {
          dId = Number(selectedDistrictId);
        }
        const years = await getSubGroupAvailableYears(cId, dId);
        setRotaryYears(years.map((y: any) => ({ id: y.id, yearLabel: y.yearLabel })));
      } catch { setRotaryYears([]); }
    })();
  }, [recipientType, isMultipleDistricts, selectedDistrictIds, selectedDistrictId, selectedClubId]);

  // Fetch subgroups when year + scope changes
  useEffect(() => {
    if (recipientType !== "2" || !selectedYearId) { setSubGroups([]); return; }
    (async () => {
      try {
        if (isMultipleDistricts) {
          // Fetch subgroups for all selected districts
          const allSubs: { id: number; groupName: string }[] = [];
          for (const distId of selectedDistrictIds) {
            const subs = await getDistrictSubGroups(distId, Number(selectedYearId));
            allSubs.push(...subs.map((s: any) => ({ id: s.id, groupName: s.groupName })));
          }
          setSubGroups(allSubs);
        } else if (selectedClubId) {
          // Fetch subgroups for selected club
          const subs = await getSubGroups(Number(selectedClubId), Number(selectedYearId));
          setSubGroups(subs.map((s: any) => ({ id: s.id, groupName: s.groupName })));
        } else if (selectedDistrictId) {
          // Fetch subgroups for selected district
          const subs = await getDistrictSubGroups(Number(selectedDistrictId), Number(selectedYearId));
          setSubGroups(subs.map((s: any) => ({ id: s.id, groupName: s.groupName })));
        } else {
          setSubGroups([]);
        }
      } catch { setSubGroups([]); }
    })();
  }, [recipientType, selectedYearId, isMultipleDistricts, selectedDistrictIds, selectedDistrictId, selectedClubId]);

  // Load existing data for edit
  useEffect(() => {
    if (!isEdit || !editId) return;
    (async () => {
      try {
        const detail = await getEventPaymentLinkDetail(Number(editId));
        setFormType(String(detail.formType));
        setAmountType(String(detail.amountType));
        setTitle(detail.title || "");
        setDescription(detail.description || "");
        setIsMultipleDistricts(detail.isForAllDistricts);
        if (detail.isForAllDistricts && detail.districtIdsList) {
          setSelectedDistrictIds(detail.districtIdsList.split(",").map(Number).filter(Boolean));
        } else {
          if (detail.fkDistrictMasterId) setSelectedDistrictId(String(detail.fkDistrictMasterId));
          if (detail.fkClubId) setSelectedClubId(String(detail.fkClubId));
        }
        setRecipientType(String(detail.recipientType));
        if (detail.subgroupYear) setSelectedYearId(detail.subgroupYear);
        if (detail.subgroupIds) setSelectedSubGroupIds(detail.subgroupIds.split(",").map(Number).filter(Boolean));
        setIsHideCharges(detail.isHideCharges);
        setIsForm(detail.isForm);
        setIsTshirtSize(detail.isTshirtSize);
        setIsFood(detail.isFood);
        setFoodPreferenceIds(detail.foodPreferenceIds || "");
        setIsPartner(detail.isPartner);
        setIsPartnerName(detail.isPartnerName);
        setIsPartnerMobile(detail.isPartnerMobile);
        setIsPartnerEmail(detail.isPartnerEmail);
        setIsPartnerGender(detail.isPartnerGender);
        setIsRemark1(detail.isRemark1);
        setRemark1Title(detail.remark1Title || "");
        setIsRemark2(detail.isRemark2);
        setRemark2Title(detail.remark2Title || "");
        setIsRemark3(detail.isRemark3);
        setRemark3Title(detail.remark3Title || "");
        setIsDesignation(detail.isDesignation);
        setDesignationLabel(detail.designationLabel || "");
        setIsPersonal(detail.isPersonal);
        setIsPersonalName(detail.isPersonalName);
        setIsPersonalMobile(detail.isPersonalMobile);
        setIsPersonalEmail(detail.isPersonalEmail);
        setIsPersonalDistrict(detail.isPersonalDistrict);
        setIsPersonalClub(detail.isPersonalClub);
        setEmailCc(detail.emailCc || "");
        setEmailSubject(detail.emailSubject || "");
        setEmailBody(detail.emailBody || "");
        setEmailReminderSubject(detail.emailReminderSubject || "");
        setEmailReminderBody(detail.emailReminderBody || "");
        setGoogleSheetEmail(detail.googleSheetEmail || "support@example.org");

        // Load registrations with tempId = actual id for edit mode
        const regs: Registration[] = (detail.registrations || []).map((r: any) => ({
          tempId: r.id,
          id: r.id,
          registrationName: r.registrationName,
          amount: r.amount,
        }));
        setRegistrations(regs);
        const maxId = regs.reduce((max, r) => Math.max(max, r.tempId), 0);
        setNextTempId(maxId + 1);

        // Load vendor splits mapped to tempId
        const splits: VendorSplit[] = (detail.vendorSplits || []).map((s: any) => ({
          fkRegistrationTempId: s.fkRegistrationId,
          fkRegistrationId: s.fkRegistrationId,
          fkKycId: s.fkKycId,
          vendorId: s.vendorId,
          vendorName: s.vendorName,
          splitAmount: s.splitAmount,
        }));
        setVendorSplits(splits);

        setDesignations(detail.designations || []);
      } catch { setErrorMessage("Failed to load payment link details."); }
      finally { setLoading(false); }
    })();
  }, [isEdit, editId]);

  // Step validation
  const validateStep = (stepIdx: number): string | null => {
    switch (stepIdx) {
      case 0: // Basic Info
        if (!title.trim()) return "Title is required.";
        if (formType === "1") {
          if (isMultipleDistricts && selectedDistrictIds.length === 0) return "Please select at least one district.";
          if (!isMultipleDistricts && !selectedDistrictId) return "Please select a district.";
          if (recipientType === "2") {
            if (!selectedYearId) return "Please select a rotary year for subgroup.";
            if (selectedSubGroupIds.length === 0) return "Please select at least one subgroup.";
          }
        }
        return null;
      case 1: // Form Fields
        if (isForm) {
          const hasGeneral = isTshirtSize || isFood || isDesignation;
          const hasPartner = isPartner;
          const hasRemarks = isRemark1 || isRemark2 || isRemark3;
          const hasPersonal = isPersonal;
          if (!hasGeneral && !hasPartner && !hasRemarks && !hasPersonal) {
            return "Please enable at least one section (General Fields, Partner Fields, Custom Remark Fields, or Personal Detail Fields).";
          }
          // Food: if enabled, at least one food preference must be selected
          if (isFood && !foodPreferenceIds.trim()) return "Please select at least one food preference.";
          // Designation: if enabled, label and at least one designation required
          if (isDesignation) {
            if (!designationLabel.trim()) return "Designation Label is required.";
            if (designations.length === 0) return "Please add at least one designation.";
          }
          // Partner: if enabled, at least one sub-field must be checked
          if (isPartner && !isPartnerName && !isPartnerMobile && !isPartnerEmail && !isPartnerGender) {
            return "Please enable at least one partner field (Name, Mobile, Email, or Gender).";
          }
          // Remarks: if enabled, title is required
          if (isRemark1 && !remark1Title.trim()) return "Remark 1 title is required.";
          if (isRemark2 && !remark2Title.trim()) return "Remark 2 title is required.";
          if (isRemark3 && !remark3Title.trim()) return "Remark 3 title is required.";
          // Personal: if enabled, at least one sub-field must be checked
          if (isPersonal && !isPersonalName && !isPersonalMobile && !isPersonalEmail && !isPersonalDistrict && !isPersonalClub) {
            return "Please enable at least one personal detail field.";
          }
        }
        return null;
      case 2: // Registration Types
        if (registrations.length === 0) return "Please add at least one registration type.";
        return null;
      case 3: // Vendor Splits
        if (!SPLITS_ON) return null;
        for (const reg of registrations) {
          const regSplits = vendorSplits.filter(s => s.fkRegistrationTempId === reg.tempId);
          if (regSplits.length === 0) return `Please add at least one vendor split for "${reg.registrationName}".`;
          const total = regSplits.reduce((sum, s) => sum + s.splitAmount, 0);
          const target = amountType === "1" ? reg.amount : 100;
          if (Math.abs(total - target) > 0.01) {
            return `Splits for "${reg.registrationName}" must total ${amountType === "1" ? `${currencySymbol()}${reg.amount.toFixed(2)}` : "100%"}. Current: ${amountType === "1" ? `${currencySymbol()}${total.toFixed(2)}` : `${total.toFixed(1)}%`}`;
          }
          if (regSplits.some(s => !s.fkKycId)) {
            return `All vendor splits for "${reg.registrationName}" must have a vendor selected.`;
          }
        }
        return null;
      case 4: // Email Templates
        return null; // Optional
      default:
        return null;
    }
  };

  const handleNext = () => {
    const err = validateStep(currentStep);
    if (err) { setErrorMessage(err); return; }
    if (currentStep < totalSteps - 1) setCurrentStep(!SPLITS_ON && currentStep === SPLIT_STEP - 1 ? SPLIT_STEP + 1 : currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(!SPLITS_ON && currentStep === SPLIT_STEP + 1 ? SPLIT_STEP - 1 : currentStep - 1);
  };

  // Final submit — builds FormData and sends everything at once
  const handleSubmit = async () => {
    const err = validateStep(currentStep);
    if (err) { setErrorMessage(err); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      // Basic info
      fd.append("formType", formType);
      fd.append("amountType", amountType);
      fd.append("title", title);
      fd.append("description", description);
      fd.append("isForAllDistricts", String(isMultipleDistricts));
      fd.append("districtIdsList", isMultipleDistricts ? selectedDistrictIds.join(",") : "");
      fd.append("fkDistrictMasterId", !isMultipleDistricts && selectedDistrictId ? selectedDistrictId : "");
      fd.append("fkClubId", !isMultipleDistricts && selectedClubId ? selectedClubId : "");
      fd.append("recipientType", recipientType);
      fd.append("subgroupIds", recipientType === "2" ? selectedSubGroupIds.join(",") : "");
      fd.append("subgroupYear", recipientType === "2" ? selectedYearId : "");
      fd.append("isHideCharges", String(isHideCharges));

      // Form fields
      fd.append("isForm", String(isForm));
      fd.append("isTshirtSize", String(isTshirtSize));
      fd.append("isFood", String(isFood));
      fd.append("foodPreferenceIds", foodPreferenceIds);
      fd.append("isPartner", String(isPartner));
      fd.append("isPartnerName", String(isPartnerName));
      fd.append("isPartnerMobile", String(isPartnerMobile));
      fd.append("isPartnerEmail", String(isPartnerEmail));
      fd.append("isPartnerGender", String(isPartnerGender));
      fd.append("isRemark1", String(isRemark1));
      fd.append("remark1Title", remark1Title);
      fd.append("isRemark2", String(isRemark2));
      fd.append("remark2Title", remark2Title);
      fd.append("isRemark3", String(isRemark3));
      fd.append("remark3Title", remark3Title);
      fd.append("isDesignation", String(isDesignation));
      fd.append("designationLabel", designationLabel);
      fd.append("isPersonal", String(isPersonal));
      fd.append("isPersonalName", String(isPersonalName));
      fd.append("isPersonalMobile", String(isPersonalMobile));
      fd.append("isPersonalEmail", String(isPersonalEmail));
      fd.append("isPersonalDistrict", String(isPersonalDistrict));
      fd.append("isPersonalClub", String(isPersonalClub));

      // Email
      fd.append("emailCc", emailCc);
      fd.append("emailSubject", emailSubject);
      fd.append("emailBody", emailBody);
      fd.append("emailReminderSubject", emailReminderSubject);
      fd.append("emailReminderBody", emailReminderBody);
      fd.append("googleSheetEmail", googleSheetEmail);

      // Files
      if (logoFile) fd.append("logo", logoFile);
      if (bgImageFile) fd.append("bgImage", bgImageFile);
      if (emailLogoFile) fd.append("emailLogo", emailLogoFile);

      // Registrations with index notation
      registrations.forEach((reg, i) => {
        fd.append(`registrations[${i}].registrationName`, reg.registrationName);
        fd.append(`registrations[${i}].amount`, String(reg.amount));
      });

      // Vendor splits with index notation — map tempId to registration index
      vendorSplits.forEach((split, i) => {
        const regIndex = registrations.findIndex(r => r.tempId === split.fkRegistrationTempId);
        fd.append(`vendorSplits[${i}].fkRegistrationId`, String(regIndex));
        fd.append(`vendorSplits[${i}].fkKycId`, String(split.fkKycId));
        fd.append(`vendorSplits[${i}].splitAmount`, String(split.splitAmount));
      });

      // Designations with index notation
      designations.forEach((d, i) => {
        fd.append(`designations[${i}].designationName`, d.designationName);
      });

      if (isEdit && editId) {
        await updateFullEventPaymentLink(Number(editId), fd);
        setSuccessMessage("Payment link updated successfully!");
      } else {
        await createFullEventPaymentLink(fd);
        setSuccessMessage("Payment link created successfully!");
      }
      setTimeout(() => router.push("/settings/event-payment-links"), 1500);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save payment link.");
    } finally { setSaving(false); }
  };

  // Registration handlers (local only)
  const handleAddReg = () => {
    if (!regName.trim()) return;
    if (editingRegTempId !== null) {
      setRegistrations(prev => prev.map(r =>
        r.tempId === editingRegTempId
          ? { ...r, registrationName: regName, amount: Number(regAmount) || 0 }
          : r
      ));
      setEditingRegTempId(null);
    } else {
      setRegistrations(prev => [...prev, { tempId: nextTempId, registrationName: regName, amount: Number(regAmount) || 0 }]);
      setNextTempId(prev => prev + 1);
    }
    setRegName("");
    setRegAmount("");
  };

  const handleEditReg = (reg: Registration) => {
    setEditingRegTempId(reg.tempId);
    setRegName(reg.registrationName);
    setRegAmount(String(reg.amount));
  };

  const handleDeleteReg = (tempId: number) => {
    setRegistrations(prev => prev.filter(r => r.tempId !== tempId));
    setVendorSplits(prev => prev.filter(s => s.fkRegistrationTempId !== tempId));
    if (editingRegTempId === tempId) {
      setEditingRegTempId(null);
      setRegName("");
      setRegAmount("");
    }
  };

  // Designation handlers (local only)
  const handleAddDesig = () => {
    if (!desigName.trim()) return;
    if (editingDesigIdx !== null) {
      setDesignations(prev => prev.map((d, i) => i === editingDesigIdx ? { ...d, designationName: desigName } : d));
      setEditingDesigIdx(null);
    } else {
      setDesignations(prev => [...prev, { designationName: desigName }]);
    }
    setDesigName("");
  };

  const handleDeleteDesig = (idx: number) => {
    setDesignations(prev => prev.filter((_, i) => i !== idx));
  };
  return { isSuperAdmin, isAdmin, isEdit, currentStep, loading, saving, successMessage, setSuccessMessage, errorMessage, setErrorMessage, formType, setFormType, amountType, setAmountType, title, setTitle, description, setDescription, recipientType, setRecipientType, isHideCharges, setIsHideCharges, allDistricts, districtClubs, isMultipleDistricts, setIsMultipleDistricts, selectedDistrictIds, setSelectedDistrictIds, selectedDistrictId, setSelectedDistrictId, selectedClubId, setSelectedClubId, rotaryYears, selectedYearId, setSelectedYearId, subGroups, setSubGroups, selectedSubGroupIds, setSelectedSubGroupIds, kycVendors, allFoodPreferences, isForm, setIsForm, isTshirtSize, setIsTshirtSize, isFood, setIsFood, foodPreferenceIds, setFoodPreferenceIds, isPartner, setIsPartner, isPartnerName, setIsPartnerName, isPartnerMobile, setIsPartnerMobile, isPartnerEmail, setIsPartnerEmail, isPartnerGender, setIsPartnerGender, isRemark1, setIsRemark1, remark1Title, setRemark1Title, isRemark2, setIsRemark2, remark2Title, setRemark2Title, isRemark3, setIsRemark3, remark3Title, setRemark3Title, isDesignation, setIsDesignation, designationLabel, setDesignationLabel, isPersonal, setIsPersonal, isPersonalName, setIsPersonalName, isPersonalMobile, setIsPersonalMobile, isPersonalEmail, setIsPersonalEmail, isPersonalDistrict, setIsPersonalDistrict, isPersonalClub, setIsPersonalClub, emailCc, setEmailCc, emailSubject, setEmailSubject, emailBody, setEmailBody, emailReminderSubject, setEmailReminderSubject, emailReminderBody, setEmailReminderBody, previewReceipt, setPreviewReceipt, previewReminder, setPreviewReminder, googleSheetEmail, setGoogleSheetEmail, setLogoFile, setBgImageFile, setEmailLogoFile, registrations, regName, setRegName, regAmount, setRegAmount, editingRegTempId, setEditingRegTempId, vendorSplits, setVendorSplits, splitVendorId, setSplitVendorId, splitAmounts, setSplitAmounts, splitVendorOpen, setSplitVendorOpen, designations, desigName, setDesigName, editingDesigIdx, setEditingDesigIdx, totalSteps, handleNext, handleBack, handleSubmit, handleAddReg, handleEditReg, handleDeleteReg, handleAddDesig, handleDeleteDesig };
}

// Values the page computed after its early returns; same statements, same order.
export function derivePaymentLinkForm(h: ReturnType<typeof usePaymentLinkForm>) {
  const { currentStep, totalSteps, splitVendorId, kycVendors, registrations, splitAmounts, setErrorMessage, amountType, setVendorSplits, setSplitVendorId, setSplitAmounts, vendorSplits, emailBody, emailReminderBody } = h;

  const isLastStep = currentStep === totalSteps - 1;

  const handleAddVendorSplit = () => {
    if (!splitVendorId) return;
    const vendor = kycVendors.find(k => k.id === splitVendorId);
    if (!vendor) return;
    // Check all registrations have an amount entered
    for (const reg of registrations) {
      const amt = splitAmounts[reg.tempId] || 0;
      if (amt <= 0) { setErrorMessage(`Please enter ${amountType === "1" ? "amount" : "percentage"} for "${reg.registrationName}".`); return; }
    }
    // Add splits for all registrations
    const newSplits = registrations.map(reg => ({
      fkRegistrationTempId: reg.tempId,
      fkKycId: vendor.id,
      vendorId: vendor.vendorId,
      vendorName: vendor.name,
      splitAmount: splitAmounts[reg.tempId] || 0,
    }));
    setVendorSplits(prev => [...prev, ...newSplits]);
    setSplitVendorId(0);
    setSplitAmounts({});
  };

  const handleDeleteVendorGroup = (kycId: number) => {
    setVendorSplits(prev => prev.filter(s => s.fkKycId !== kycId));
  };

  // Get unique vendors already added
  const addedVendorIds = Array.from(new Set(vendorSplits.map(s => s.fkKycId)));


  const defaultReceiptHtml = `<p>Dear {name},</p>
<p><strong>District Number</strong> : {districtNumber}</p>
<p><strong>Club Name</strong> : {clubName}</p>
<p><strong>Purpose of the payment</strong> : {purpose}</p>
<p><strong>Amount received</strong> : {amount}/-</p>
<p><strong>Date and time</strong> : {dateTime}</p>
<p><strong>Method of payment</strong> : {paymentMethod}</p>
<p><strong>Transaction ID</strong> : {transactionId}</p>`;

  const defaultReminderHtml = `<p>Dear {name},</p>
<p><strong>District Number</strong> : {districtNumber}</p>
<p><strong>Club Name</strong> : {clubName}</p>
<p><strong>Purpose of the payment</strong> : {purpose}</p>
<p><strong>Outstanding amount</strong> : {amount}/-</p>
<p><strong>Status</strong> : {status}</p>
<p><strong>Click on the link</strong> : <a href="{paymentLink}">{paymentLink}</a></p>`;

  const replaceSampleData = (html: string) => html
    .replace(/{name}/g, "****")
    .replace(/{districtNumber}/g, "****")
    .replace(/{clubName}/g, "****")
    .replace(/{purpose}/g, "****")
    .replace(/{amount}/g, "****")
    .replace(/{dateTime}/g, "****")
    .replace(/{paymentMethod}/g, "****")
    .replace(/{transactionId}/g, "****")
    .replace(/{status}/g, "****")
    .replace(/{paymentLink}/g, "****");

  const getReceiptPreviewHtml = () => {
    const combined = defaultReceiptHtml + (emailBody ? `<br/>${emailBody}` : "");
    return replaceSampleData(combined);
  };

  const getReminderPreviewHtml = () => {
    const combined = defaultReminderHtml + (emailReminderBody ? `<br/>${emailReminderBody}` : "");
    return replaceSampleData(combined);
  };
  return { isLastStep, handleAddVendorSplit, handleDeleteVendorGroup, addedVendorIds, defaultReceiptHtml, defaultReminderHtml, replaceSampleData, getReceiptPreviewHtml, getReminderPreviewHtml };
}

export type PaymentLinkFormCtx = ReturnType<typeof usePaymentLinkForm> & ReturnType<typeof derivePaymentLinkForm>;
