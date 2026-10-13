"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  createFullEventPaymentLink, updateFullEventPaymentLink,
  getEventPaymentLinkDetail,
  getDistricts, getClubs, getCashfreeKycList, getEventFoodPreferences,
  getSubGroups, getDistrictSubGroups, getSubGroupAvailableYears,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, ArrowRight, Plus, Trash2, Save, Loader2, Check, Pencil, ChevronsUpDown, Eye } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { currencySymbol } from "@/lib/appFormat";
interface Registration { tempId: number; id?: number; registrationName: string; amount: number; }
interface VendorSplit { fkRegistrationTempId: number; fkRegistrationId?: number; fkKycId: number; vendorId?: string; vendorName?: string; splitAmount: number; }
interface Designation { id?: number; designationName: string; }
interface KycItem { id: number; vendorId: string; name: string; status: string; isActive: boolean; }
interface DistrictItem { id: number; districtNumber: string; }
interface ClubItem { id: number; clubName: string; }

const STEP_LABELS = [
  "Basic Info",
  "Form Fields",
  "Registration Types",
  "Vendor Splits",
  "Email Templates",
];

export default function CreateEditPaymentLinkPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <CreateEditPaymentLinkPage />
    </Suspense>
  );
}

function CreateEditPaymentLinkPage() {
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
    if (currentStep < totalSteps - 1) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
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

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  if (loading) {
    return (<ProtectedRoute><div className="flex justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>);
  }

  const isLastStep = currentStep === totalSteps - 1;

  // ---- RENDER STEPS ----

  const renderStepBasicInfo = () => (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div>
          <Label>Form Type</Label>
          <Select value={formType} onValueChange={v => { setFormType(v); if (v === "2") { setIsForm(true); setIsPersonal(true); } }}>
            <SelectTrigger className="w-full md:w-1/2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Standard (Members Only)</SelectItem>
              <SelectItem value="2">Dynamic (Anyone)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Title *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Event description" />
        </div>

        {/* District/Club selection - only for Standard form */}
        {formType === "1" && (
          <div className="flex items-center gap-3">
            <Checkbox checked={isMultipleDistricts} onCheckedChange={(c) => { setIsMultipleDistricts(!!c); setSelectedDistrictIds([]); setSelectedDistrictId(""); setSelectedClubId(""); if (c) { setRecipientType("1"); setSelectedYearId(""); setSelectedSubGroupIds([]); setSubGroups([]); } }} id="multiDistrict" />
            <Label htmlFor="multiDistrict">Is For Multiple Districts</Label>
          </div>
        )}

        {formType === "1" && isMultipleDistricts ? (
          <div>
            <Label>Select Districts</Label>
            <div className="border rounded-lg p-3 max-h-48 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-2">
              {allDistricts.map(d => (
                <div key={d.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedDistrictIds.includes(d.id)}
                    onCheckedChange={(c) => {
                      if (c) setSelectedDistrictIds(prev => [...prev, d.id]);
                      else setSelectedDistrictIds(prev => prev.filter(id => id !== d.id));
                    }}
                    id={`dist-${d.id}`}
                  />
                  <Label htmlFor={`dist-${d.id}`} className="text-sm font-normal">{d.districtNumber}</Label>
                </div>
              ))}
            </div>
            {selectedDistrictIds.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">{selectedDistrictIds.length} district(s) selected</p>
            )}
          </div>
        ) : formType === "1" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Select District</Label>
              <Select value={selectedDistrictId} onValueChange={v => { setSelectedDistrictId(v); setSelectedClubId(""); }}>
                <SelectTrigger><SelectValue placeholder="Choose district" /></SelectTrigger>
                <SelectContent>
                  {allDistricts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedDistrictId && (
              <div>
                <Label>Select Club (optional)</Label>
                <Select value={selectedClubId} onValueChange={setSelectedClubId}>
                  <SelectTrigger><SelectValue placeholder="Choose club" /></SelectTrigger>
                  <SelectContent>
                    {districtClubs.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {formType === "1" && (
            <div>
              <Label>Recipient Type</Label>
              <Select value={recipientType} onValueChange={v => { setRecipientType(v); setSelectedYearId(""); setSelectedSubGroupIds([]); setSubGroups([]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">All Members</SelectItem>
                  {/* Subgroups only make sense for single-club/district scope, not All Districts. */}
                  {!isMultipleDistricts && <SelectItem value="2">Subgroup</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Switch checked={isHideCharges} onCheckedChange={setIsHideCharges} />
            <Label>Hide Gateway Charges</Label>
          </div>
        </div>

        {/* Subgroup selection - Year + Subgroup checkboxes */}
        {formType === "1" && recipientType === "2" && (
          <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
            <h4 className="font-medium">Select Subgroups</h4>
            <div>
              <Label>Rotary Year</Label>
              <Select value={selectedYearId} onValueChange={v => { setSelectedYearId(v); setSelectedSubGroupIds([]); }}>
                <SelectTrigger className="w-full md:w-1/2"><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {rotaryYears.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedYearId && subGroups.length > 0 && (
              <div>
                <Label>Subgroups</Label>
                <div className="border rounded-lg p-3 max-h-48 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 bg-white">
                  {subGroups.map(sg => (
                    <div key={sg.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedSubGroupIds.includes(sg.id)}
                        onCheckedChange={(c) => {
                          if (c) setSelectedSubGroupIds(prev => [...prev, sg.id]);
                          else setSelectedSubGroupIds(prev => prev.filter(id => id !== sg.id));
                        }}
                        id={`sg-${sg.id}`}
                      />
                      <Label htmlFor={`sg-${sg.id}`} className="text-sm font-normal">{sg.groupName}</Label>
                    </div>
                  ))}
                </div>
                {selectedSubGroupIds.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">{selectedSubGroupIds.length} subgroup(s) selected</p>
                )}
              </div>
            )}
            {selectedYearId && subGroups.length === 0 && (
              <p className="text-sm text-muted-foreground">No subgroups found for the selected year and scope.</p>
            )}
          </div>
        )}

        {/* Images */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Logo Image</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setLogoFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
          <div><Label>Background Image</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setBgImageFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
        </div>
      </CardContent>
    </Card>
  );

  const renderStepFormFields = () => (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="flex items-center gap-3">
          <Switch checked={isForm} onCheckedChange={setIsForm} disabled={formType === "2"} />
          <Label>Enable additional data collection form</Label>
          {formType === "2" && <span className="text-xs text-muted-foreground">(Auto-enabled for Dynamic form)</span>}
        </div>

        {isForm && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="font-semibold">General Fields</h3>
                <div className="flex items-center gap-3"><Switch checked={isTshirtSize} onCheckedChange={setIsTshirtSize} /><Label>T-shirt Size</Label></div>
                <div className="flex items-center gap-3"><Switch checked={isFood} onCheckedChange={setIsFood} /><Label>Food Preference</Label></div>
                {isFood && allFoodPreferences.length > 0 && (
                  <div className="ml-6 space-y-2">
                    {allFoodPreferences.map(f => {
                      const selectedIds = foodPreferenceIds.split(",").filter(Boolean).map(Number);
                      const isChecked = selectedIds.includes(f.id);
                      return (
                        <div key={f.id} className="flex items-center gap-2">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(c) => {
                              const ids = foodPreferenceIds.split(",").filter(Boolean).map(Number);
                              if (c) setFoodPreferenceIds([...ids, f.id].join(","));
                              else setFoodPreferenceIds(ids.filter(id => id !== f.id).join(","));
                            }}
                            id={`food-${f.id}`}
                          />
                          <Label htmlFor={`food-${f.id}`} className="text-sm font-normal">{f.foodType}</Label>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-3"><Switch checked={isDesignation} onCheckedChange={setIsDesignation} /><Label>Custom Designation</Label></div>
                {isDesignation && (
                  <div className="ml-6 space-y-3">
                    <div><Label>Designation Label</Label><Input value={designationLabel} onChange={e => setDesignationLabel(e.target.value)} placeholder="e.g. Select Designation" /></div>
                    <div>
                      <Label>Designation List</Label>
                      <div className="flex gap-2 mt-1">
                        <Input value={desigName} onChange={e => setDesigName(e.target.value)} placeholder="e.g. President" className="flex-1" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddDesig(); } }} />
                        <Button type="button" size="sm" onClick={handleAddDesig} disabled={!desigName.trim()}>
                          {editingDesigIdx !== null ? <><Pencil className="h-4 w-4 mr-1" />Update</> : <><Plus className="h-4 w-4 mr-1" />Add</>}
                        </Button>
                        {editingDesigIdx !== null && (
                          <Button type="button" size="sm" variant="outline" onClick={() => { setEditingDesigIdx(null); setDesigName(""); }}>Cancel</Button>
                        )}
                      </div>
                      {designations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {designations.map((d, i) => (
                            <div key={i} className={`flex items-center justify-between px-3 py-1.5 rounded text-sm ${editingDesigIdx === i ? "bg-primary/10 border border-primary" : "bg-muted"}`}>
                              <span>{d.designationName}</span>
                              <div className="flex gap-1">
                                <button type="button" onClick={() => { setEditingDesigIdx(i); setDesigName(d.designationName); }} className="text-blue-600 hover:text-blue-800"><Pencil className="h-3.5 w-3.5" /></button>
                                <button type="button" onClick={() => handleDeleteDesig(i)} className="text-destructive hover:text-destructive/80"><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <h3 className="font-semibold">Partner Fields</h3>
                <div className="flex items-center gap-3"><Switch checked={isPartner} onCheckedChange={setIsPartner} /><Label>Enable Partner Section</Label></div>
                {isPartner && (
                  <div className="ml-6 space-y-2">
                    <div className="flex items-center gap-3"><Switch checked={isPartnerName} onCheckedChange={setIsPartnerName} /><Label>Partner Name</Label></div>
                    <div className="flex items-center gap-3"><Switch checked={isPartnerMobile} onCheckedChange={setIsPartnerMobile} /><Label>Partner Mobile</Label></div>
                    <div className="flex items-center gap-3"><Switch checked={isPartnerEmail} onCheckedChange={setIsPartnerEmail} /><Label>Partner Email</Label></div>
                    <div className="flex items-center gap-3"><Switch checked={isPartnerGender} onCheckedChange={setIsPartnerGender} /><Label>Partner Gender</Label></div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="font-semibold">Custom Remark Fields</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3"><Switch checked={isRemark1} onCheckedChange={setIsRemark1} /><Label>Remark 1</Label></div>
                  {isRemark1 && <Input value={remark1Title} onChange={e => setRemark1Title(e.target.value)} placeholder="Remark 1 title" />}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3"><Switch checked={isRemark2} onCheckedChange={setIsRemark2} /><Label>Remark 2</Label></div>
                  {isRemark2 && <Input value={remark2Title} onChange={e => setRemark2Title(e.target.value)} placeholder="Remark 2 title" />}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3"><Switch checked={isRemark3} onCheckedChange={setIsRemark3} /><Label>Remark 3</Label></div>
                  {isRemark3 && <Input value={remark3Title} onChange={e => setRemark3Title(e.target.value)} placeholder="Remark 3 title" />}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="font-semibold">Personal Detail Fields</h3>
              <div className="flex items-center gap-3">
                <Switch checked={isPersonal} onCheckedChange={setIsPersonal} disabled={formType === "2"} />
                <Label>Enable Personal Details</Label>
                {formType === "2" && <span className="text-xs text-muted-foreground">(Auto-enabled for Dynamic form)</span>}
              </div>
              {isPersonal && (
                <div className="ml-6 grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div className="flex items-center gap-3"><Switch checked={isPersonalName} onCheckedChange={setIsPersonalName} /><Label>Name</Label></div>
                  <div className="flex items-center gap-3"><Switch checked={isPersonalMobile} onCheckedChange={setIsPersonalMobile} /><Label>Mobile</Label></div>
                  <div className="flex items-center gap-3"><Switch checked={isPersonalEmail} onCheckedChange={setIsPersonalEmail} /><Label>Email</Label></div>
                  <div className="flex items-center gap-3"><Switch checked={isPersonalDistrict} onCheckedChange={setIsPersonalDistrict} /><Label>District</Label></div>
                  <div className="flex items-center gap-3"><Switch checked={isPersonalClub} onCheckedChange={setIsPersonalClub} /><Label>Club</Label></div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  const renderStepRegistrations = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Registration Types</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Label>Registration Name</Label>
            <Input value={regName} onChange={e => setRegName(e.target.value)} placeholder="e.g. Individual" />
          </div>
          <div className="w-40">
            <Label>Amount</Label>
            <Input type="number" value={regAmount} onChange={e => setRegAmount(e.target.value)} placeholder="1000" />
          </div>
          <Button onClick={handleAddReg} disabled={!regName.trim()}>
            <Plus className="h-4 w-4 mr-1" />{editingRegTempId !== null ? "Update" : "Add"}
          </Button>
          {editingRegTempId !== null && (
            <Button variant="outline" onClick={() => { setEditingRegTempId(null); setRegName(""); setRegAmount(""); }}>Cancel</Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No registration types yet. Add at least one to proceed.</TableCell></TableRow>
            ) : registrations.map(reg => (
              <TableRow key={reg.tempId}>
                <TableCell>{reg.registrationName}</TableCell>
                <TableCell>{amountType === "1" ? `${currencySymbol()}${reg.amount.toFixed(2)}` : `${reg.amount}%`}</TableCell>
                <TableCell className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEditReg(reg)}><Pencil className="h-4 w-4 text-blue-600" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteReg(reg.tempId)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

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

  const renderStepVendorSplits = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle>Vendor Splits ({amountType === "1" ? "Amount ₹" : "Percentage %"})</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Amount Type:</Label>
            <Select value={amountType} onValueChange={setAmountType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Amount (Fixed ₹)</SelectItem>
                <SelectItem value="2">Percentage (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Registration totals summary */}
        <div className="border rounded-lg p-3 bg-muted/30">
          <h4 className="font-medium mb-2">Registration Split Summary</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Registration</TableHead>
                <TableHead>{amountType === "1" ? "Amount (₹)" : "Total %"}</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.map(reg => {
                const total = vendorSplits.filter(s => s.fkRegistrationTempId === reg.tempId).reduce((sum, s) => sum + s.splitAmount, 0);
                const target = amountType === "1" ? reg.amount : 100;
                const remaining = target - total;
                const isValid = Math.abs(remaining) < 0.01;
                return (
                  <TableRow key={reg.tempId}>
                    <TableCell className="font-medium">{reg.registrationName}</TableCell>
                    <TableCell>{amountType === "1" ? `${currencySymbol()}${reg.amount.toFixed(2)}` : "100%"}</TableCell>
                    <TableCell>{amountType === "1" ? `${currencySymbol()}${total.toFixed(2)}` : `${total.toFixed(1)}%`}</TableCell>
                    <TableCell className={remaining > 0.01 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                      {amountType === "1" ? `${currencySymbol()}${remaining.toFixed(2)}` : `${remaining.toFixed(1)}%`}
                    </TableCell>
                    <TableCell>{isValid ? <Check className="h-4 w-4 text-green-600" /> : <span className="text-red-600 text-xs">Incomplete</span>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

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
                        <CommandItem key={k.id} value={`${k.name} ${k.vendorId}`} onSelect={() => { setSplitVendorId(k.id); setSplitVendorOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${splitVendorId === k.id ? "opacity-100" : "opacity-0"}`} />
                          <div>
                            <div className="font-medium">{k.name}</div>
                            <div className="text-xs text-muted-foreground">{k.vendorId}</div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {splitVendorId > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registration Type</TableHead>
                    <TableHead>{amountType === "1" ? "Registration Amount" : "Total %"}</TableHead>
                    <TableHead>{amountType === "1" ? "Split Amount (₹)" : "Split Percentage (%)"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map(reg => (
                    <TableRow key={reg.tempId}>
                      <TableCell className="font-medium">{reg.registrationName}</TableCell>
                      <TableCell>{amountType === "1" ? `${currencySymbol()}${reg.amount.toFixed(2)}` : "100%"}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step={amountType === "1" ? "0.01" : "0.1"}
                          value={splitAmounts[reg.tempId] || ""}
                          onChange={e => setSplitAmounts(prev => ({ ...prev, [reg.tempId]: Number(e.target.value) }))}
                          placeholder={amountType === "1" ? "Enter amount" : "Enter %"}
                          className="w-40"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end">
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
              return (
                <div key={kycId} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-medium">{vendor?.name || vendorSplitsForKyc[0]?.vendorName}</span>
                      <span className="text-sm text-muted-foreground ml-2">({vendor?.vendorId || vendorSplitsForKyc[0]?.vendorId})</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteVendorGroup(kycId)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {vendorSplitsForKyc.map((split, idx) => {
                      const reg = registrations.find(r => r.tempId === split.fkRegistrationTempId);
                      return (
                        <div key={idx} className="text-sm bg-muted px-3 py-1.5 rounded">
                          <span className="text-muted-foreground">{reg?.registrationName}: </span>
                          <span className="font-medium">{amountType === "1" ? `${currencySymbol()}${split.splitAmount.toFixed(2)}` : `${split.splitAmount}%`}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );


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

  const renderStepEmail = () => (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div>
          <Label>Email Logo</Label>
          <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setEmailLogoFile(e.target.files?.[0] || null)} />
          <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
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
            <p>Dear &#123;name&#125;,</p>
            <p>District Number : &#123;districtNumber&#125;</p>
            <p>Club Name : &#123;clubName&#125;</p>
            <p>Purpose of the payment : &#123;purpose&#125;</p>
            <p>Amount received : &#123;amount&#125;/-</p>
            <p>Date and time : &#123;dateTime&#125;</p>
            <p>Method of payment : &#123;paymentMethod&#125;</p>
            <p>Transaction ID : &#123;transactionId&#125;</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={4} placeholder="Add any extra content after the default template..." />
          </div>
          <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => setPreviewReceipt(true)}><Eye className="h-4 w-4 mr-1" />Preview Receipt</Button></div>
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
            <p>Dear &#123;name&#125;,</p>
            <p>District Number : &#123;districtNumber&#125;</p>
            <p>Club Name : &#123;clubName&#125;</p>
            <p>Purpose of the payment : &#123;purpose&#125;</p>
            <p>Outstanding amount : &#123;amount&#125;/-</p>
            <p>Status : &#123;status&#125;</p>
            <p>Click on the link : &#123;paymentLink&#125;</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <Textarea value={emailReminderBody} onChange={e => setEmailReminderBody(e.target.value)} rows={4} placeholder="Add any extra content after the default template..." />
          </div>
          <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => setPreviewReminder(true)}><Eye className="h-4 w-4 mr-1" />Preview Reminder</Button></div>
        </div>

        {/* Google Sheet Email */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Google Sheet Integration</h3>
          <div>
            <Label>Google Sheet Email (optional)</Label>
            <Input value={googleSheetEmail} onChange={e => setGoogleSheetEmail(e.target.value)} placeholder="Enter email to share Google Sheet access" />
            <p className="text-xs text-muted-foreground mt-1">A Google Sheet will be auto-created for this event. Enter an email to share editor access.</p>
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
      </CardContent>
    </Card>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0: return renderStepBasicInfo();
      case 1: return renderStepFormFields();
      case 2: return renderStepRegistrations();
      case 3: return renderStepVendorSplits();
      case 4: return renderStepEmail();
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
            <Link href="/settings/event-payment-links"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {isEdit ? "Edit Payment Link" : "Create Payment Link"}
            </h2>
            <p className="text-muted-foreground text-base">Step {currentStep + 1} of {totalSteps}</p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {STEP_LABELS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i < currentStep ? "bg-green-600 text-white" :
                i === currentStep ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm hidden md:inline ${i === currentStep ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < STEP_LABELS.length - 1 && <div className="w-8 h-[2px] bg-muted" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        {renderCurrentStep()}

        {/* Navigation Buttons */}
        <div className="flex justify-between">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
          <div className="flex gap-2">
            {isLastStep ? (
              <Button onClick={handleSubmit} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving ? <RotaryLoader size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Link" : "Create Link")}
              </Button>
            ) : (
              <Button onClick={handleNext}>
                Next<ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
