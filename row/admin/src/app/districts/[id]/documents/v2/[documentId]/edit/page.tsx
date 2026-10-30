"use client";

/**
 * District Documents v2 — Edit Document.
 *
 * District-scoped mirror of the club v2 edit page. Same data semantics, every
 * field, every API call, every validation rule preserved verbatim — including
 * the "only validate past dates if changed" exemption so existing past
 * publish/expiry timestamps stay editable. Only the chrome differs
 * (DistrictAdminShell wrapper, district-scoped API calls, districtId source).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, Info, FileText, FileUp, Calendar, Eye, Download,
} from "@/components/icons";
import {
  getDistrict,
  getDistrictDocument,
  updateDistrictDocument,
  uploadDistrictDocumentFile,
} from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, DOC_EXTENSIONS } from "@/lib/uploadValidate";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictCommunicationTabBar from "@/components/dashboard/DistrictCommunicationTabBar";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
import { ListPageSkeleton } from "@/components/row/AppKit";

const TOP_MESSAGE = "Update district document details. Changing access type instantly switches whether members can download the file.";

function FieldLabel({ children, hint, dot }: { children: React.ReactNode; hint?: string; dot: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}<span className="text-rose-600 ml-0.5">*</span>
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
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function RadioPill({
  checked, onChange, label, icon: Icon,
}: { checked: boolean; onChange: () => void; label: string; icon: React.ElementType }) {
  return (
    <label
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium
        ${checked
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-slate-800"
        }`}
    >
      <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${checked ? "border-blue-500" : "border-slate-400"}`}>
        {checked && <div className="h-2 w-2 rounded-full bg-blue-500" />}
      </div>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </label>
  );
}

// Inline mirror of useSyncClubIdFromUrl for district scope. Kept here (not a
// shared hook) to match the district upcoming-events v2 pattern.
function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();

  useEffect(() => {
    if (
      Number.isFinite(urlDistrictId) &&
      urlDistrictId > 0 &&
      urlDistrictId !== selectedDistrictId
    ) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}

export default function DistrictDocumentsV2EditPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const districtId = Number(params.id);
  const documentId = Number(params.documentId);
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/documents`);

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [accessType, setAccessType] = useState<string>("downloadable");
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);

  // Track original dates to allow existing past dates (matches v1 behavior)
  const [originalPublishDateTime, setOriginalPublishDateTime] = useState("");
  const [originalExpiryDateTime, setOriginalExpiryDateTime] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [district, doc] = await Promise.all([
          getDistrict(districtId),
          getDistrictDocument(districtId, documentId),
        ]);
        setDistrictName(`District ${district.districtNumber}`);

        setTitle(doc.title || "");
        setAccessType(doc.accessType || "downloadable");
        setFilePath(doc.filePath || null);
        setOriginalFileName(doc.originalFileName || null);
        if (doc.filePath) {
          setFileName(doc.originalFileName || doc.filePath.split("/").pop() || null);
        }

        if (doc.publishDateTime) {
          const pdt = new Date(doc.publishDateTime);
          const pd = pdt.toISOString().split("T")[0];
          const pt = pdt.toTimeString().slice(0, 5);
          setPublishDate(pd);
          setPublishTime(pt);
          setOriginalPublishDateTime(`${pd}T${pt}:00`);
        }

        if (doc.expiryDateTime) {
          const edt = new Date(doc.expiryDateTime);
          const ed = edt.toISOString().split("T")[0];
          const et = edt.toTimeString().slice(0, 5);
          setExpiryDate(ed);
          setExpiryTime(et);
          setOriginalExpiryDateTime(`${ed}T${et}:00`);
        }
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } | string } };
        if (e?.response?.status === 403) {
          setErrorMessage("You don't have permission to edit documents for this district.");
        } else {
          const msg = typeof e?.response?.data === "string"
            ? e.response.data
            : e?.response?.data?.message;
          setErrorMessage(msg || "Failed to load document.");
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [districtId, documentId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) {
      setTitle(val);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input first so re-picking the SAME file after an error still fires onChange.
    e.target.value = "";
    if (!file) return;

    // Pre-check before the request goes out: an oversized or wrong-type file
    // fails instantly with a specific message instead of after a long upload.
    try {
      validateDocumentFile(file, DOC_EXTENSIONS);
    } catch (err: unknown) {
      setErrorMessage(describeUploadError(err));
      return;
    }

    setFileName(file.name);
    setFileUploading(true);
    try {
      const result = await uploadDistrictDocumentFile(districtId, file);
      setFilePath(result.path);
      setOriginalFileName(result.originalName || file.name);
    } catch (err: unknown) {
      setFileName(null);
      setFilePath(null);
      setOriginalFileName(null);
      setErrorMessage(describeUploadError(err));
    } finally {
      setFileUploading(false);
    }
  };

  const removeFile = () => {
    setFilePath(null);
    setFileName(null);
    setOriginalFileName(null);
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!filePath) { setErrorMessage("Please upload a file."); return; }
    if (fileUploading) { setErrorMessage("Please wait for file to finish uploading."); return; }
    if (!publishDate || !publishTime) { setErrorMessage("Publish Date & Time is required."); return; }
    const publishDTStr = `${publishDate}T${publishTime}:00`;
    const publishDT = new Date(publishDTStr);
    if (publishDTStr !== originalPublishDateTime && publishDT < new Date()) {
      setErrorMessage("Publish Date & Time cannot be in the past."); return;
    }
    if (!expiryDate || !expiryTime) { setErrorMessage("Expiry Date & Time is required."); return; }
    const expiryDTStr = `${expiryDate}T${expiryTime}:00`;
    const expiryDT = new Date(expiryDTStr);
    if (expiryDTStr !== originalExpiryDateTime && expiryDT < new Date()) {
      setErrorMessage("Expiry Date & Time cannot be in the past."); return;
    }
    if (expiryDT < publishDT) { setErrorMessage("Expiry Date & Time must be on or after Publish Date & Time."); return; }

    setSaving(true);
    try {
      await updateDistrictDocument(districtId, documentId, {
        title: title.trim(),
        accessType,
        filePath: filePath!,
        originalFileName: originalFileName,
        publishDateTime: publishDTStr,
        expiryDateTime: expiryDTStr,
      });
      setSuccessMessage("Document updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string } | string } };
      if (e?.response?.status === 403) {
        setErrorMessage("You don't have permission to edit documents for this district.");
      } else {
        const msg = typeof e?.response?.data === "string"
          ? e.response.data
          : e?.response?.data?.message;
        setErrorMessage(msg || "Failed to update document.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Edit District Document"
          activeNavHref="/district-admin-dashboard/communication"
        >
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Edit District Document"
        activeNavHref="/district-admin-dashboard/communication"
      >
        <div className="mb-4">
          <DistrictCommunicationTabBar />
        </div>
        <V2FormShell
          title="Edit District Document"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/documents`}
          saving={saving}
          saveLabel="Update Document"
          onSave={handleSave}
          banner={
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{TOP_MESSAGE}</span>
            </div>
          }
        >
          {/* 1. Document Details */}
          <SectionCard number={1} icon={FileText} title="Document Details" dot="bg-[#17458F]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 50 chars)" dot="bg-[#17458F]">Title</FieldLabel>
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="Document title"
                  maxLength={50}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-[#17458F]">Access Type</FieldLabel>
                <div className="flex flex-wrap gap-2 mt-1">
                  <RadioPill
                    checked={accessType === "view_only"}
                    onChange={() => setAccessType("view_only")}
                    label="View Only"
                    icon={Eye}
                  />
                  <RadioPill
                    checked={accessType === "downloadable"}
                    onChange={() => setAccessType("downloadable")}
                    label="Downloadable"
                    icon={Download}
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 2. Attachment */}
          <SectionCard number={2} icon={FileUp} title="Attachment" dot="bg-[#17458F]">
            <div className="space-y-2">
              <FieldLabel dot="bg-[#17458F]">File</FieldLabel>
              {fileName ? (
                <div className="flex items-center gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50">
                  <FileUp className="h-5 w-5 text-emerald-600 shrink-0" />
                  <span className="text-sm font-medium text-emerald-700 flex-1 truncate">{fileName}</span>
                  {fileUploading && <RotaryLoader size="sm" />}
                  <button
                    type="button"
                    onClick={removeFile}
                    className="p-1 rounded-full hover:bg-rose-100 text-rose-600"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg hover:border-blue-300 transition-colors text-slate-500"
                  >
                    <Upload className="h-4 w-4" />
                    <span className="text-sm">Upload file</span>
                  </button>
                  <p className="text-xs text-slate-400 mt-1.5">{documentUploadHint(DOC_EXTENSIONS)}</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                onChange={handleFileSelect}
              />
            </div>
          </SectionCard>

          {/* 3. Schedule */}
          <SectionCard number={3} icon={Calendar} title="Schedule" dot="bg-[#17458F]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel dot="bg-[#17458F]">Publish Date</FieldLabel>
                <DateField value={publishDate} onChange={setPublishDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]">Publish Time</FieldLabel>
                <input
                  type="time"
                  value={publishTime}
                  onChange={(e) => setPublishTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]">Expiry Date</FieldLabel>
                <DateField value={expiryDate} onChange={setExpiryDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
              </div>
              <div>
                <FieldLabel dot="bg-[#17458F]">Expiry Time</FieldLabel>
                <input
                  type="time"
                  value={expiryTime}
                  onChange={(e) => setExpiryTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
            </div>
          </SectionCard>

          <SuccessAlert
            open={showSuccessDialog}
            title="Saved"
            description={successMessage || "Document updated successfully."}
            onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
          />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </V2FormShell>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
