"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  getEventPaymentLinkDetail, updateEventPaymentLink,
  getEventRegistrations, saveEventRegistration, updateEventRegistration, deleteEventRegistration,
  getEventVendorSplits, saveEventVendorSplits,
  getEventDesignations, saveEventDesignation, deleteEventDesignation,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Save, Loader2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ListPageSkeleton } from "@/components/row/AppKit";

interface Registration { id: number; registrationName: string; amount: number; }
interface VendorSplit { id: number; fkRegistrationId: number; registrationName?: string; fkKycId: number; vendorId?: string; vendorName?: string; splitAmount: number; }
interface Designation { id: number; designationName: string; }

export default function ClubEditPaymentLinkPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const editId = searchParams.get("editId");

  // Club admin can only edit, not create — redirect if no editId
  useEffect(() => {
    if (!editId) router.replace(`/clubs/${clubId}/event-payment-links`);
  }, [editId, clubId, router]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("basic");
  const [linkId, setLinkId] = useState<number | null>(editId ? Number(editId) : null);

  // Basic info
  const [formType, setFormType] = useState("1");
  const [amountType, setAmountType] = useState("1");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isHideCharges, setIsHideCharges] = useState(false);

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

  // Email
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReminderSubject, setEmailReminderSubject] = useState("");
  const [emailReminderBody, setEmailReminderBody] = useState("");

  // Files
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);

  // Registrations
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [editingReg, setEditingReg] = useState<Registration | null>(null);
  const [regName, setRegName] = useState("");
  const [regAmount, setRegAmount] = useState("");
  const [regSaving, setRegSaving] = useState(false);
  const [deleteReg, setDeleteReg] = useState<Registration | null>(null);

  // Vendor Splits
  const [vendorSplits, setVendorSplits] = useState<VendorSplit[]>([]);
  const [splitsSaving, setSplitsSaving] = useState(false);

  // Designations
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [desigName, setDesigName] = useState("");
  const [desigSaving, setDesigSaving] = useState(false);
  const [deleteDesig, setDeleteDesig] = useState<Designation | null>(null);

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
      } catch { setErrorMessage("Failed to load details."); }
      finally { setLoading(false); }
    })();
  }, [editId]);

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
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save.");
    } finally { setSaving(false); }
  };

  const fetchRegs = useCallback(async () => {
    if (!linkId) return;
    try { setRegistrations(await getEventRegistrations(linkId)); } catch {}
  }, [linkId]);

  const handleSaveReg = async () => {
    if (!linkId || !regName.trim()) return;
    setRegSaving(true);
    try {
      if (editingReg) await updateEventRegistration(linkId, editingReg.id, { registrationName: regName, amount: Number(regAmount) });
      else await saveEventRegistration(linkId, { registrationName: regName, amount: Number(regAmount) });
      setRegDialogOpen(false);
      fetchRegs();
      setSuccessMessage("Registration type saved.");
    } catch { setErrorMessage("Failed to save."); }
    finally { setRegSaving(false); }
  };

  const handleDeleteReg = async () => {
    if (!linkId || !deleteReg) return;
    try { await deleteEventRegistration(linkId, deleteReg.id); fetchRegs(); setSuccessMessage("Deleted."); } catch { setErrorMessage("Failed."); }
    setDeleteReg(null);
  };

  const fetchSplits = useCallback(async () => {
    if (!linkId) return;
    try { setVendorSplits(await getEventVendorSplits(linkId)); } catch {}
  }, [linkId]);

  const handleSaveSplits = async () => {
    if (!linkId) return;
    setSplitsSaving(true);
    try {
      await saveEventVendorSplits(linkId, { splits: vendorSplits.map(s => ({ fkRegistrationId: s.fkRegistrationId, fkKycId: s.fkKycId, splitAmount: s.splitAmount })) });
      setSuccessMessage("Splits saved.");
    } catch { setErrorMessage("Failed."); }
    finally { setSplitsSaving(false); }
  };

  const fetchDesigs = useCallback(async () => {
    if (!linkId) return;
    try { setDesignations(await getEventDesignations(linkId)); } catch {}
  }, [linkId]);

  const handleSaveDesig = async () => {
    if (!linkId || !desigName.trim()) return;
    setDesigSaving(true);
    try { await saveEventDesignation(linkId, { designationName: desigName }); setDesigName(""); fetchDesigs(); setSuccessMessage("Added."); } catch { setErrorMessage("Failed."); }
    finally { setDesigSaving(false); }
  };

  const handleDeleteDesig = async () => {
    if (!linkId || !deleteDesig) return;
    try { await deleteEventDesignation(linkId, deleteDesig.id); fetchDesigs(); setSuccessMessage("Deleted."); } catch { setErrorMessage("Failed."); }
    setDeleteDesig(null);
  };

  useEffect(() => {
    if (linkId && activeTab === "registrations") fetchRegs();
    if (linkId && activeTab === "splits") fetchSplits();
    if (linkId && activeTab === "designations") fetchDesigs();
  }, [linkId, activeTab, fetchRegs, fetchSplits, fetchDesigs]);

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }
  if (loading) return (<ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/event-payment-links`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Edit Payment Link</h2>
            <p className="text-muted-foreground text-base">Club #{clubId}</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="email">Email Templates</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <Card><CardContent className="pt-6 space-y-4">
              <div><Label>Title *</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
              <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>Logo</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setLogoFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
                <div><Label>Event Image</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setEventImageFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
                <div><Label>Background</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setBgImageFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
              </div>
              <div className="flex justify-end"><Button onClick={handleSaveLink} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}{saving ? "Saving..." : "Update"}</Button></div>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="email">
            <Card><CardContent className="pt-6 space-y-4">
              <div><Label>Email Logo</Label><Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setEmailLogoFile(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
              <div><Label>Email CC</Label><Input value={emailCc} onChange={e => setEmailCc(e.target.value)} /></div>
              <h3 className="font-semibold pt-4">Receipt Email</h3>
              <div><Label>Subject</Label><Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} /></div>
              <div><Label>Body (HTML)</Label><Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={6} /></div>
              <h3 className="font-semibold pt-4">Reminder Email</h3>
              <div><Label>Subject</Label><Input value={emailReminderSubject} onChange={e => setEmailReminderSubject(e.target.value)} /></div>
              <div><Label>Body (HTML)</Label><Textarea value={emailReminderBody} onChange={e => setEmailReminderBody(e.target.value)} rows={6} /></div>
              <div className="flex justify-end"><Button onClick={handleSaveLink} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}{saving ? "Saving..." : "Save Email Settings"}</Button></div>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </ProtectedRoute>
  );
}
