"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import {
  updateMembershipDuesBasic, getMembershipDuesDetail,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, Upload, Eye } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import "react-quill-new/dist/quill.snow.css";
import { ListPageSkeleton } from "@/components/row/AppKit";

// ReactQuill must be client-only — SSR would crash on `document`.
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function ClubMembershipDuesEditPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const duesId = Number(params.duesId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Editable fields
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReminderSubject, setEmailReminderSubject] = useState("");
  const [emailReminderBody, setEmailReminderBody] = useState("");
  const [emailCc, setEmailCc] = useState("");

  // Images
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bgImagePreview, setBgImagePreview] = useState<string | null>(null);
  const [emailLogoPreview, setEmailLogoPreview] = useState<string | null>(null);

  // Original data (to send back unchanged fields)
  const [originalData, setOriginalData] = useState<any>(null);

  // ReactQuill toolbar — bold/italic/underline + heading + size + color + lists + align + link + image.
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

  useEffect(() => {
    (async () => {
      try {
        const detail = await getMembershipDuesDetail(duesId);
        if (!detail) { setErrorMessage("Club dues not found."); setLoading(false); return; }
        setOriginalData(detail);
        setPurpose(detail.purpose || "");
        setDescription(detail.purposeDescription || "");
        setEmailSubject(detail.emailSubject || "");
        setEmailBody(detail.emailBody || "");
        setEmailReminderSubject(detail.emailReminderSubject || "");
        setEmailReminderBody(detail.emailReminderBody || "");
        setEmailCc(detail.emailCC || detail.emailCc || "");
        if (detail.purposeLogo) setLogoPreview(`${API_BASE_URL}${detail.purposeLogo}`);
        if (detail.backgroundImage) setBgImagePreview(`${API_BASE_URL}${detail.backgroundImage}`);
        if (detail.emailHeaderLogo) setEmailLogoPreview(`${API_BASE_URL}${detail.emailHeaderLogo}`);
      } catch { setErrorMessage("Failed to load details."); }
      finally { setLoading(false); }
    })();
  }, [duesId]);

  const handleImageChange = (file: File | null, setFile: (f: File | null) => void, setPreview: (s: string | null) => void) => {
    setFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!purpose.trim()) { setErrorMessage("Purpose is required."); return; }
    if (!originalData) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("purpose", purpose);
      fd.append("purposeDescription", description);
      fd.append("emailCC", emailCc);
      fd.append("emailSubject", emailSubject);
      fd.append("emailBody", emailBody);
      fd.append("emailReminderSubject", emailReminderSubject);
      fd.append("emailReminderBody", emailReminderBody);
      if (logoFile) fd.append("logo", logoFile);
      if (bgImageFile) fd.append("bgImage", bgImageFile);
      if (emailLogoFile) fd.append("emailLogo", emailLogoFile);

      await updateMembershipDuesBasic(duesId, fd);
      setSuccessMessage("Updated successfully!");
      setTimeout(() => router.push(`/clubs/${clubId}/membership-dues`), 1500);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to update.");
    } finally { setSaving(false); }
  };

  if (!isSuperAdmin && !isAdmin) {
    return <ProtectedRoute><div className="flex justify-center py-20"><h3>Access Denied</h3></div></ProtectedRoute>;
  }

  if (loading) {
    return <ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>;
  }

  const renderImageUpload = (label: string, preview: string | null, onChange: (f: File | null) => void) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {preview && (
        <div className="relative w-40 h-28 border rounded-lg overflow-hidden bg-muted">
          <img src={preview} alt={label} className="w-full h-full object-contain" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 border rounded-full text-sm hover:bg-muted">
          <Upload className="h-4 w-4" />
          {preview ? "Change" : "Upload"}
          <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={e => onChange(e.target.files?.[0] || null)} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
    </div>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/membership-dues`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Edit Club Dues</h2>
            <p className="text-muted-foreground text-base">Update title, description, and images</p>
          </div>
        </div>

        {/* Basic Info */}
        <Card>
          <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Purpose / Title *</Label>
              <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Title / Purpose" />
            </div>
            <div>
              <Label>Description</Label>
              <ReactQuill
                theme="snow"
                value={description}
                onChange={setDescription}
                modules={quillModules}
                placeholder="Description (optional): supports bold/italic/sizes/colors/etc."
              />
            </div>
          </CardContent>
        </Card>

        {/* Images */}
        <Card>
          <CardHeader><CardTitle>Images</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {renderImageUpload("Logo", logoPreview, (f) => handleImageChange(f, setLogoFile, setLogoPreview))}
              {renderImageUpload("Background Image", bgImagePreview, (f) => handleImageChange(f, setBgImageFile, setBgImagePreview))}
              {renderImageUpload("Email Logo", emailLogoPreview, (f) => handleImageChange(f, setEmailLogoFile, setEmailLogoPreview))}
            </div>
          </CardContent>
        </Card>

        {/* Email Settings */}
        <Card>
          <CardHeader><CardTitle>Email Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Email CC</Label>
              <Input value={emailCc} onChange={e => setEmailCc(e.target.value)} placeholder="CC email address" />
            </div>
            <div>
              <Label>Email Subject</Label>
              <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Subject" />
            </div>
            <div>
              {/* Display-only hint of the receipt-email template */}
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-semibold mb-2 text-slate-800">Default template (auto-included):</p>
                <pre className="font-mono whitespace-pre-wrap text-[11px] leading-relaxed m-0">{`Dear *****,
District Number : ****
Club Name : **** **** **** ****
Purpose of the payment : ****
Amount received : ****/-
Date and time : ****
Method of payment : ****
Transaction ID : ****`}</pre>
              </div>
              <Label>Email Body</Label>
              <ReactQuill
                theme="snow"
                value={emailBody}
                onChange={setEmailBody}
                modules={quillModules}
                placeholder="Email body: supports bold/italic/sizes/colors/etc."
              />
            </div>
            <div>
              <Label>Reminder Email Subject</Label>
              <Input value={emailReminderSubject} onChange={e => setEmailReminderSubject(e.target.value)} placeholder="Reminder subject" />
            </div>
            <div>
              {/* Display-only hint of the auto-included template — sits ABOVE the editor */}
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-semibold mb-2 text-slate-800">Default template (auto-included):</p>
                <pre className="font-mono whitespace-pre-wrap text-[11px] leading-relaxed m-0">{`Dear *****,
District Number : ****
Club Name : **** **** **** ****
Purpose of the payment : ****
Outstanding amount : ****/-
Status : ****
Click on the link : ****`}</pre>
              </div>
              <Label>Reminder Email Body</Label>
              <ReactQuill
                theme="snow"
                value={emailReminderBody}
                onChange={setEmailReminderBody}
                modules={quillModules}
                placeholder="Reminder body: supports bold/italic/sizes/colors/etc."
              />
            </div>
          </CardContent>
        </Card>

        {/* Save */}
        <div className="flex justify-end pb-8">
          <Button onClick={handleSubmit} disabled={saving} className="bg-green-600 hover:bg-green-700">
            {saving ? <RotaryLoader size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </ProtectedRoute>
  );
}
