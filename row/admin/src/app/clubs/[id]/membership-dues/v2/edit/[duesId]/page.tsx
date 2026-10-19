"use client";

/**
 * Club Dues v2 — Edit page (Club Admin).
 *
 * Same data semantics as v1: identical fields, identical FormData keys,
 * identical updateMembershipDuesBasic call. Only the visual presentation
 * differs (ClubAdminShell + V2FormShell wrapper, dot-accented section
 * headers, sticky save bar).
 *
 * Form fields preserved 1:1 with v1:
 *   - purpose          (Title — required)
 *   - purposeDescription (Description)
 *   - emailCC
 *   - emailSubject
 *   - emailBody
 *   - emailReminderSubject
 *   - emailReminderBody
 *   - logo, bgImage, emailLogo (file uploads)
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { FileText, ImageIcon, Mail, Upload } from "@/components/icons";
import {
  getMembershipDuesDetail, updateMembershipDuesBasic,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import "react-quill-new/dist/quill.snow.css";

// ReactQuill must be client-only — SSR would crash on `document`.
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function FieldLabel({
  children, hint, dot, required,
}: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>
          {number}
        </div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ImageUploadField({
  label, preview, onChange, dot,
}: {
  label: string;
  preview: string | null;
  onChange: (file: File | null) => void;
  dot: string;
}) {
  return (
    <div>
      <FieldLabel dot={dot}>{label}</FieldLabel>
      {preview && (
        <div className="relative w-40 h-28 mb-2 border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={label} className="w-full h-full object-contain" />
        </div>
      )}
      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
        <Upload className="h-4 w-4" />
        {preview ? "Change image" : "Upload image"}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.gif,.webp"
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
      </label>
      <p className="text-xs text-slate-400 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
    </div>
  );
}

export default function ClubMembershipDuesV2EditPage() {
  useSyncClubIdFromUrl();
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const clubId = Number(params.id);
  const duesId = Number(params.duesId);

  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/membership-dues/v2`);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  // Editable fields — identical to v1
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReminderSubject, setEmailReminderSubject] = useState("");
  const [emailReminderBody, setEmailReminderBody] = useState("");
  const [emailCc, setEmailCc] = useState("");

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

  // Images — identical to v1
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bgImagePreview, setBgImagePreview] = useState<string | null>(null);
  const [emailLogoPreview, setEmailLogoPreview] = useState<string | null>(null);

  // Header context
  const [rotaryYear, setRotaryYear] = useState<string>("");
  const [clubLabel, setClubLabel] = useState<string>("");

  // Original data marker (mirrors v1 "originalData" sentinel)
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const detail = await getMembershipDuesDetail(duesId);
        if (!detail) {
          setErrorMessage("Club dues not found.");
          setLoading(false);
          return;
        }
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
        setRotaryYear(detail.rotaryYear || "");
        setClubLabel(detail.clubName || "");
        setLoaded(true);
      } catch {
        setErrorMessage("Failed to load details.");
      } finally {
        setLoading(false);
      }
    })();
  }, [duesId]);

  const handleImageChange = (
    file: File | null,
    setFile: (f: File | null) => void,
    setPreview: (s: string | null) => void
  ) => {
    setFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!purpose.trim()) {
      setErrorMessage("Purpose / Title is required.");
      return;
    }
    if (!loaded) return;
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
      setSuccessMessage("Club dues updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update.");
    } finally {
      setSaving(false);
    }
  };

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Club Dues"
          pageSubtitle="Update title, description, images, and email templates"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="text-lg font-semibold text-slate-700">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Club Dues"
          pageSubtitle="Update title, description, images, and email templates"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  const subtitle = [rotaryYear, clubLabel].filter(Boolean).join(" · ");

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit Club Dues"
        pageSubtitle="Update title, description, images, and email templates"
        activeNavHref="/club-admin-dashboard/membership-dues"
      >
        <V2FormShell
          title="Edit Club Dues"
          subtitle={subtitle || "Club dues record"}
          defaultBack={`/clubs/${clubId}/membership-dues/v2`}
          saving={saving}
          saveLabel="Save Changes"
          onSave={handleSave}
        >
          {/* 1. Basic Information */}
          <SectionCard number={1} icon={FileText} title="Basic Information" dot="bg-blue-600">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <FieldLabel dot="bg-blue-500" required>Purpose / Title</FieldLabel>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Title / Purpose"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-blue-500">Description</FieldLabel>
                <ReactQuill
                  theme="snow"
                  value={description}
                  onChange={setDescription}
                  modules={quillModules}
                  placeholder="Description (optional): supports bold/italic/sizes/colors/etc."
                />
              </div>
            </div>
          </SectionCard>

          {/* 2. Images */}
          <SectionCard number={2} icon={ImageIcon} title="Images" dot="bg-amber-600">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <ImageUploadField
                label="Logo"
                preview={logoPreview}
                onChange={(f) => handleImageChange(f, setLogoFile, setLogoPreview)}
                dot="bg-amber-500"
              />
              <ImageUploadField
                label="Background Image"
                preview={bgImagePreview}
                onChange={(f) => handleImageChange(f, setBgImageFile, setBgImagePreview)}
                dot="bg-amber-500"
              />
              <ImageUploadField
                label="Email Logo"
                preview={emailLogoPreview}
                onChange={(f) => handleImageChange(f, setEmailLogoFile, setEmailLogoPreview)}
                dot="bg-amber-500"
              />
            </div>
          </SectionCard>

          {/* 3. Email Settings */}
          <SectionCard number={3} icon={Mail} title="Email Settings" dot="bg-emerald-600">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <FieldLabel dot="bg-emerald-500">Email CC</FieldLabel>
                <input
                  type="text"
                  value={emailCc}
                  onChange={(e) => setEmailCc(e.target.value)}
                  placeholder="CC email address"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-emerald-500">Email Subject</FieldLabel>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                {/* Display-only hint of the receipt-email template the system
                    fills in around the admin-authored body. */}
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
                <FieldLabel dot="bg-emerald-500">Email Body</FieldLabel>
                <ReactQuill
                  theme="snow"
                  value={emailBody}
                  onChange={setEmailBody}
                  modules={quillModules}
                  placeholder="Email body: supports bold/italic/sizes/colors/etc."
                />
              </div>
              <div>
                <FieldLabel dot="bg-emerald-500">Reminder Email Subject</FieldLabel>
                <input
                  type="text"
                  value={emailReminderSubject}
                  onChange={(e) => setEmailReminderSubject(e.target.value)}
                  placeholder="Reminder subject"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
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
                <FieldLabel dot="bg-emerald-500">Reminder Email Body</FieldLabel>
                <ReactQuill
                  theme="snow"
                  value={emailReminderBody}
                  onChange={setEmailReminderBody}
                  modules={quillModules}
                  placeholder="Reminder body: supports bold/italic/sizes/colors/etc."
                />
              </div>
            </div>
          </SectionCard>

          <SuccessAlert
            open={showSuccessDialog}
            title="Saved"
            description={successMessage || "Club dues updated successfully."}
            onOk={() => {
              setShowSuccessDialog(false);
              setSuccessMessage(null);
              navigateAfterSave();
            }}
          />
          <ErrorAlert
            open={!!errorMessage}
            title="Error"
            description={errorMessage || ""}
            onOk={() => setErrorMessage(null)}
          />
        </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
