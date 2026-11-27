"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";

/**
 * Event Payment Links v2 — Edit Payment Link (5 tabs).
 *
 * Cloned from v1 src/app/clubs/[id]/event-payment-links/edit/page.tsx with the
 * same field set, validation rules and save logic. Visuals are restyled to the
 * dashboard look (ClubAdminShell + V2FormShell + shadcn Tabs + slate cards),
 * but every API call mirrors v1 byte-for-byte.
 *
 * Tabs:
 *   1. Basic Info        — title, description, form options, photo uploads
 *   2. Email Templates   — receipt + reminder subject/body, email CC, logo
 *   3. Registrations     — registration types (name + amount) inline CRUD
 *   4. Vendor Splits     — per-registration vendor split amounts
 *   5. Designations      — designation list (read by public form)
 *
 * v2 reads `?editId=` (from listing routing) and `?returnTo=` for navigation.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import SectionCard from "@/components/form/SectionCard";
import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Info, Mail, ListChecks, Wallet, BadgeCheck, Save, Plus, Edit3, Trash2, AlertTriangle, X } from "@/components/icons";
import {
  getEventPaymentLinkDetail, updateEventPaymentLink,
  getEventRegistrations, saveEventRegistration, updateEventRegistration, deleteEventRegistration,
  getEventVendorSplits, saveEventVendorSplits,
  getEventDesignations, saveEventDesignation, deleteEventDesignation,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import LoadingButton from "@/components/v2/LoadingButton";
import LoadingLink from "@/components/v2/LoadingLink";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
interface Registration { id: number; registrationName: string; amount: number; }
interface VendorSplit {
  id: number;
  fkRegistrationId: number;
  registrationName?: string;
  fkKycId: number;
  vendorId?: string;
  vendorName?: string;
  splitAmount: number;
}
interface Designation { id: number; designationName: string; }

// ─────────────────────────────────────────────────────────────────────────────
// Field primitives (visual only — match V2FormShell / TRF edit conventions).
// ─────────────────────────────────────────────────────────────────────────────

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-card hover:bg-slate-50 cursor-pointer">
      <span className="text-sm text-slate-700">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export default function EventPaymentLinkV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const editId = searchParams.get("editId");
  const returnTo = searchParams.get("returnTo") || "";

  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const listingHref = `/clubs/${clubId}/event-payment-links/v2`;
  const backHref = returnTo || listingHref;

  // Club admin (V2) can only edit, not create — redirect if no editId.
  useEffect(() => {
    if (!editId) router.replace(listingHref);
  }, [editId, listingHref, router]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("basic");
  const linkId = editId ? Number(editId) : null;

  // ── Basic info ────────────────────────────────────────────────────────────
  const [formType, setFormType] = useState("1");        // 1=Standard, 2=Dynamic
  const [amountType, setAmountType] = useState("1");    // 1=Fixed, 2=Variable
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isHideCharges, setIsHideCharges] = useState(false);

  // ── Form fields (toggles + dependent text inputs) ────────────────────────
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

  // ── Email tab ─────────────────────────────────────────────────────────────
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReminderSubject, setEmailReminderSubject] = useState("");
  const [emailReminderBody, setEmailReminderBody] = useState("");

  // ── File inputs ───────────────────────────────────────────────────────────
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);

  // ── Registrations tab ─────────────────────────────────────────────────────
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [editingReg, setEditingReg] = useState<Registration | null>(null);
  const [regName, setRegName] = useState("");
  const [regAmount, setRegAmount] = useState("");
  const [regSaving, setRegSaving] = useState(false);
  const [deleteReg, setDeleteReg] = useState<Registration | null>(null);

  // ── Vendor splits tab ─────────────────────────────────────────────────────
  const [vendorSplits, setVendorSplits] = useState<VendorSplit[]>([]);
  const [splitsSaving, setSplitsSaving] = useState(false);

  // ── Designations tab ──────────────────────────────────────────────────────
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [desigName, setDesigName] = useState("");
  const [desigSaving, setDesigSaving] = useState(false);
  const [deleteDesig, setDeleteDesig] = useState<Designation | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const detail = await getEventPaymentLinkDetail(Number(editId));
        setFormType(String(detail.formType));
        setAmountType(String(detail.amountType));
        setTitle(detail.title || "");
        setDescription(detail.description || "");
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
        setEmailCc(detail.emailCc || "");
        setEmailSubject(detail.emailSubject || "");
        setEmailBody(detail.emailBody || "");
        setEmailReminderSubject(detail.emailReminderSubject || "");
        setEmailReminderBody(detail.emailReminderBody || "");
        setRegistrations(detail.registrations || []);
        setVendorSplits(detail.vendorSplits || []);
        setDesignations(detail.designations || []);
      } catch {
        setErrorMessage("Failed to load details.");
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  // ── Save (Basic + Email tabs share this) ─────────────────────────────────
  const handleSaveLink = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("formType", formType);
      fd.append("amountType", amountType);
      fd.append("fkClubId", String(clubId));
      fd.append("title", title);
      fd.append("description", description);
      fd.append("isHideCharges", String(isHideCharges));
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
      fd.append("emailCc", emailCc);
      fd.append("emailSubject", emailSubject);
      fd.append("emailBody", emailBody);
      fd.append("emailReminderSubject", emailReminderSubject);
      fd.append("emailReminderBody", emailReminderBody);
      if (logoFile) fd.append("logo", logoFile);
      if (eventImageFile) fd.append("eventImage", eventImageFile);
      if (bgImageFile) fd.append("bgImage", bgImageFile);
      if (emailLogoFile) fd.append("emailLogo", emailLogoFile);

      if (linkId) {
        await updateEventPaymentLink(linkId, fd);
        setSuccessMessage("Payment link updated.");
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  // ── Registrations CRUD ────────────────────────────────────────────────────
  const fetchRegs = useCallback(async () => {
    if (!linkId) return;
    try { setRegistrations(await getEventRegistrations(linkId)); } catch {}
  }, [linkId]);

  const openRegDialog = (reg?: Registration) => {
    setEditingReg(reg || null);
    setRegName(reg?.registrationName || "");
    setRegAmount(reg ? String(reg.amount) : "");
    setRegDialogOpen(true);
  };

  const handleSaveReg = async () => {
    if (!linkId || !regName.trim()) { setErrorMessage("Registration name is required."); return; }
    setRegSaving(true);
    try {
      if (editingReg) {
        await updateEventRegistration(linkId, editingReg.id, { registrationName: regName, amount: Number(regAmount) || 0 });
      } else {
        await saveEventRegistration(linkId, { registrationName: regName, amount: Number(regAmount) || 0 });
      }
      setRegDialogOpen(false);
      fetchRegs();
      setSuccessMessage("Registration type saved.");
    } catch {
      setErrorMessage("Failed to save.");
    } finally {
      setRegSaving(false);
    }
  };

  const handleDeleteReg = async () => {
    if (!linkId || !deleteReg) return;
    try {
      await deleteEventRegistration(linkId, deleteReg.id);
      fetchRegs();
      setSuccessMessage("Registration deleted.");
    } catch {
      setErrorMessage("Failed to delete.");
    }
    setDeleteReg(null);
  };

  // ── Vendor Splits ─────────────────────────────────────────────────────────
  const fetchSplits = useCallback(async () => {
    if (!linkId) return;
    try { setVendorSplits(await getEventVendorSplits(linkId)); } catch {}
  }, [linkId]);

  const handleSaveSplits = async () => {
    if (!linkId) return;
    setSplitsSaving(true);
    try {
      await saveEventVendorSplits(linkId, {
        splits: vendorSplits.map((s) => ({
          fkRegistrationId: s.fkRegistrationId,
          fkKycId: s.fkKycId,
          splitAmount: s.splitAmount,
        })),
      });
      setSuccessMessage("Vendor splits saved.");
    } catch {
      setErrorMessage("Failed to save.");
    } finally {
      setSplitsSaving(false);
    }
  };

  // ── Designations ──────────────────────────────────────────────────────────
  const fetchDesigs = useCallback(async () => {
    if (!linkId) return;
    try { setDesignations(await getEventDesignations(linkId)); } catch {}
  }, [linkId]);

  const handleSaveDesig = async () => {
    if (!linkId || !desigName.trim()) { setErrorMessage("Designation name is required."); return; }
    setDesigSaving(true);
    try {
      await saveEventDesignation(linkId, { designationName: desigName });
      setDesigName("");
      fetchDesigs();
      setSuccessMessage("Designation added.");
    } catch {
      setErrorMessage("Failed to save.");
    } finally {
      setDesigSaving(false);
    }
  };

  const handleDeleteDesig = async () => {
    if (!linkId || !deleteDesig) return;
    try {
      await deleteEventDesignation(linkId, deleteDesig.id);
      fetchDesigs();
      setSuccessMessage("Designation deleted.");
    } catch {
      setErrorMessage("Failed to delete.");
    }
    setDeleteDesig(null);
  };

  // Lazy-load each tab's data on first activation.
  useEffect(() => {
    if (!linkId) return;
    if (activeTab === "registrations") fetchRegs();
    if (activeTab === "splits") fetchSplits();
    if (activeTab === "designations") fetchDesigs();
  }, [linkId, activeTab, fetchRegs, fetchSplits, fetchDesigs]);

  if (!canManage) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Event Payment Link"
          pageSubtitle="Update payment configuration"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="row-h2">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Event Payment Link"
          pageSubtitle="Update payment configuration"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex justify-center py-20"><ListPageSkeleton /></div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit Event Payment Link"
        pageSubtitle="Update payment configuration"
        activeNavHref="/club-admin-dashboard/membership-dues"
      >
        <div className="space-y-5">
          {/* Header */}
          <PageHeader title="Edit Payment Link" description={<>{title || "Untitled"} · Link #{linkId}</>} back={backHref} />

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <Card className="p-2">
              <TabsList>
                <TabsTrigger value="basic" className="gap-1.5">
                  <Info size={13} /> Basic Info
                </TabsTrigger>
                <TabsTrigger value="email" className="gap-1.5">
                  <Mail size={13} /> Email Templates
                </TabsTrigger>
                <TabsTrigger value="registrations" className="gap-1.5">
                  <ListChecks size={13} /> Registrations
                </TabsTrigger>
                <TabsTrigger value="splits" className="gap-1.5">
                  <Wallet size={13} /> Vendor Splits
                </TabsTrigger>
                <TabsTrigger value="designations" className="gap-1.5">
                  <BadgeCheck size={13} /> Designations
                </TabsTrigger>
              </TabsList>
            </Card>

            {/* ── 1. BASIC INFO ─────────────────────────────────────────── */}
            <TabsContent value="basic" className="mt-4 space-y-4">
              <SectionCard title="Link Configuration">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Form Type</FieldLabel>
                    <NativeSelect
                      value={formType}
                      onChange={(e) => setFormType(e.target.value)}
                    >
                      <option value="1">Standard</option>
                      <option value="2">Dynamic</option>
                    </NativeSelect>
                  </div>
                  <div>
                    <FieldLabel>Amount Type</FieldLabel>
                    <NativeSelect
                      value={amountType}
                      onChange={(e) => setAmountType(e.target.value)}
                    >
                      <option value="1">Fixed</option>
                      <option value="2">Variable</option>
                    </NativeSelect>
                  </div>
                </div>
                <div>
                  <FieldLabel required>Title</FieldLabel>
                  <Input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Event title"
                  />
                </div>
                <div>
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <ToggleRow label="Hide Convenience Charges" checked={isHideCharges} onChange={setIsHideCharges} />
              </SectionCard>

              <SectionCard title="Image Uploads">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <FieldLabel>Logo</FieldLabel>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp"
                      onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                      className="w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                  </div>
                  <div>
                    <FieldLabel>Event Image</FieldLabel>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp"
                      onChange={(e) => setEventImageFile(e.target.files?.[0] || null)}
                      className="w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                  </div>
                  <div>
                    <FieldLabel>Background</FieldLabel>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp"
                      onChange={(e) => setBgImageFile(e.target.files?.[0] || null)}
                      className="w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Form Options">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <ToggleRow label="Show Form" checked={isForm} onChange={setIsForm} />
                  <ToggleRow label="T-Shirt Size" checked={isTshirtSize} onChange={setIsTshirtSize} />
                  <ToggleRow label="Food Preference" checked={isFood} onChange={setIsFood} />
                  <ToggleRow label="Partner Section" checked={isPartner} onChange={setIsPartner} />
                </div>
                {isFood && (
                  <div>
                    <FieldLabel hint="(comma-separated IDs)">Food Preference IDs</FieldLabel>
                    <Input
                      type="text"
                      value={foodPreferenceIds}
                      onChange={(e) => setFoodPreferenceIds(e.target.value)}
                      placeholder="e.g. 1,2,3"
                    />
                  </div>
                )}
                {isPartner && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <ToggleRow label="Partner Name" checked={isPartnerName} onChange={setIsPartnerName} />
                    <ToggleRow label="Partner Mobile" checked={isPartnerMobile} onChange={setIsPartnerMobile} />
                    <ToggleRow label="Partner Email" checked={isPartnerEmail} onChange={setIsPartnerEmail} />
                    <ToggleRow label="Partner Gender" checked={isPartnerGender} onChange={setIsPartnerGender} />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Custom Remarks">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3 items-center">
                    <ToggleRow label="Remark 1" checked={isRemark1} onChange={setIsRemark1} />
                    {isRemark1 && (
                      <Input
                        type="text"
                        value={remark1Title}
                        onChange={(e) => setRemark1Title(e.target.value)}
                        placeholder="Remark 1 label"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3 items-center">
                    <ToggleRow label="Remark 2" checked={isRemark2} onChange={setIsRemark2} />
                    {isRemark2 && (
                      <Input
                        type="text"
                        value={remark2Title}
                        onChange={(e) => setRemark2Title(e.target.value)}
                        placeholder="Remark 2 label"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3 items-center">
                    <ToggleRow label="Remark 3" checked={isRemark3} onChange={setIsRemark3} />
                    {isRemark3 && (
                      <Input
                        type="text"
                        value={remark3Title}
                        onChange={(e) => setRemark3Title(e.target.value)}
                        placeholder="Remark 3 label"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3 items-center">
                    <ToggleRow label="Designation" checked={isDesignation} onChange={setIsDesignation} />
                    {isDesignation && (
                      <Input
                        type="text"
                        value={designationLabel}
                        onChange={(e) => setDesignationLabel(e.target.value)}
                        placeholder="Designation field label"
                      />
                    )}
                  </div>
                </div>
              </SectionCard>

              <div className="flex flex-wrap justify-end gap-2">
                <LoadingLink
                  href={backHref}
                  className="row-btn row-btn-secondary row-btn-sm"
                >
                  <X size={14} /> Cancel
                </LoadingLink>
                <LoadingButton
                  onAction={handleSaveLink}
                  forcePending={saving}
                  loadingLabel="Saving…"
                  className="row-btn row-btn-primary row-btn-sm"
                >
                  {!saving && <Save size={14} />} Update
                </LoadingButton>
              </div>
            </TabsContent>

            {/* ── 2. EMAIL TEMPLATES ─────────────────────────────────────── */}
            <TabsContent value="email" className="mt-4 space-y-4">
              <SectionCard title="Email Header">
                <div>
                  <FieldLabel>Email Logo</FieldLabel>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.gif,.webp"
                    onChange={(e) => setEmailLogoFile(e.target.files?.[0] || null)}
                    className="w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                </div>
                <div>
                  <FieldLabel hint="(comma-separated addresses)">Email CC</FieldLabel>
                  <Input
                    type="text"
                    value={emailCc}
                    onChange={(e) => setEmailCc(e.target.value)}
                    placeholder="cc1@example.com, cc2@example.com"
                  />
                </div>
              </SectionCard>

              <SectionCard title="Receipt Email">
                <div>
                  <FieldLabel>Subject</FieldLabel>
                  <Input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel hint="(HTML supported)">Body</FieldLabel>
                  <Textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={6}
                    className="font-mono"
                  />
                </div>
              </SectionCard>

              <SectionCard title="Reminder Email">
                <div>
                  <FieldLabel>Subject</FieldLabel>
                  <Input
                    type="text"
                    value={emailReminderSubject}
                    onChange={(e) => setEmailReminderSubject(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel hint="(HTML supported)">Body</FieldLabel>
                  <Textarea
                    value={emailReminderBody}
                    onChange={(e) => setEmailReminderBody(e.target.value)}
                    rows={6}
                    className="font-mono"
                  />
                </div>
              </SectionCard>

              <div className="flex flex-wrap justify-end gap-2">
                <LoadingLink
                  href={backHref}
                  className="row-btn row-btn-secondary row-btn-sm"
                >
                  <X size={14} /> Cancel
                </LoadingLink>
                <LoadingButton
                  onAction={handleSaveLink}
                  forcePending={saving}
                  loadingLabel="Saving…"
                  className="row-btn row-btn-primary row-btn-sm"
                >
                  {!saving && <Save size={14} />} Save Email Settings
                </LoadingButton>
              </div>
            </TabsContent>

            {/* ── 3. REGISTRATIONS ───────────────────────────────────────── */}
            <TabsContent value="registrations" className="mt-4">
              <Card className="overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="row-h3">Registration Types</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Define ticket categories and their amounts
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => openRegDialog()}
                  >
                    <Plus size={13} /> Add Registration
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px] md:min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-left">Name</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right w-16">Edit</TableHead>
                        <TableHead className="text-right w-16">Delete</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registrations.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-400">
                            No registration types yet.
                          </TableCell>
                        </TableRow>
                      ) : registrations.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium text-slate-800">{r.registrationName}</TableCell>
                          <TableCell className="text-right tabular-nums text-slate-700">
                            {currencySymbol()}{(r.amount || 0).toLocaleString(appLocale())}
                          </TableCell>
                          <TableCell className="text-right">
                            <IconButton
                              type="button"
                              onClick={() => openRegDialog(r)}
                              
                              aria-label="Edit registration"
                            >
                              <Edit3 size={13} />
                            </IconButton>
                          </TableCell>
                          <TableCell className="text-right">
                            <IconButton
                              type="button"
                              onClick={() => setDeleteReg(r)}
                              className="hover:text-red-700"
                              aria-label="Delete registration"
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </TabsContent>

            {/* ── 4. VENDOR SPLITS ───────────────────────────────────────── */}
            <TabsContent value="splits" className="mt-4">
              <Card className="overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="row-h3">Vendor Splits</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Split each registration amount across vendors / KYCs
                    </p>
                  </div>
                  <LoadingButton
                    onAction={handleSaveSplits}
                    forcePending={splitsSaving}
                    loadingLabel="Saving…"
                    className="row-btn row-btn-primary"
                  >
                    {!splitsSaving && <Save size={13} />} Save Splits
                  </LoadingButton>
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px] md:min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-left">Registration</TableHead>
                        <TableHead className="text-left">Vendor</TableHead>
                        <TableHead className="text-right">Split Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendorSplits.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-slate-400">
                            No vendor splits configured.
                          </TableCell>
                        </TableRow>
                      ) : vendorSplits.map((s, idx) => (
                        <TableRow key={s.id || idx}>
                          <TableCell className="text-slate-800">{s.registrationName || `#${s.fkRegistrationId}`}</TableCell>
                          <TableCell className="text-slate-700">
                            {s.vendorName || s.vendorId || `KYC #${s.fkKycId}`}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={s.splitAmount}
                              min={0}
                              step="0.01"
                              onChange={(e) => {
                                const next = [...vendorSplits];
                                next[idx] = { ...next[idx], splitAmount: Number(e.target.value) || 0 };
                                setVendorSplits(next);
                              }}
                              className="row-field-sm w-28 text-right tabular-nums"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </TabsContent>

            {/* ── 5. DESIGNATIONS ────────────────────────────────────────── */}
            <TabsContent value="designations" className="mt-4">
              <Card className="overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="row-h3">Designations</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Add designation options shown on the registration form
                  </p>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="text"
                      value={desigName}
                      onChange={(e) => setDesigName(e.target.value)}
                      placeholder="Designation name"
                      className="flex-1"
                    />
                    <LoadingButton
                      onAction={handleSaveDesig}
                      forcePending={desigSaving}
                      loadingLabel="Adding…"
                      className="row-btn row-btn-primary row-btn-sm"
                    >
                      {!desigSaving && <Plus size={14} />} Add
                    </LoadingButton>
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[640px] md:min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-left">Designation</TableHead>
                          <TableHead className="text-right w-16">Delete</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {designations.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-center text-slate-400">
                              No designations yet.
                            </TableCell>
                          </TableRow>
                        ) : designations.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="text-slate-800">{d.designationName}</TableCell>
                            <TableCell className="text-right">
                              <IconButton
                                type="button"
                                onClick={() => setDeleteDesig(d)}
                                className="hover:text-red-700"
                                aria-label="Delete designation"
                              >
                                <Trash2 size={13} />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Registration add / edit dialog */}
        <Dialog open={regDialogOpen} onOpenChange={setRegDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingReg ? "Edit Registration" : "Add Registration"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <FieldLabel required>Registration Name</FieldLabel>
                <Input
                  type="text"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="e.g. Regular"
                />
              </div>
              <div>
                <FieldLabel hint={`(${currencySymbol()})`}>Amount</FieldLabel>
                <Input
                  type="number"
                  value={regAmount}
                  onChange={(e) => setRegAmount(e.target.value)}
                  placeholder="0"
                  min={0}
                  step="0.01"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => setRegDialogOpen(false)}
                variant="outline" size="sm"
              >
                Cancel
              </Button>
              <LoadingButton
                onAction={handleSaveReg}
                forcePending={regSaving}
                loadingLabel="Saving…"
                className="row-btn row-btn-primary row-btn-sm"
              >
                {!regSaving && <Save size={14} />} Save
              </LoadingButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete registration confirm */}
        <AlertModal
          open={!!deleteReg}
          onOpenChange={(o) => !o && setDeleteReg(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Registration"
          description={
            <>
              Delete registration type{" "}
              <span className="font-semibold text-foreground">{deleteReg?.registrationName}</span>?
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDeleteReg}
          cancelLabel="Cancel"
          onCancel={() => setDeleteReg(null)}
        />

        {/* Delete designation confirm */}
        <AlertModal
          open={!!deleteDesig}
          onOpenChange={(o) => !o && setDeleteDesig(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Designation"
          description={
            <>
              Delete designation{" "}
              <span className="font-semibold text-foreground">{deleteDesig?.designationName}</span>?
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDeleteDesig}
          cancelLabel="Cancel"
          onCancel={() => setDeleteDesig(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
