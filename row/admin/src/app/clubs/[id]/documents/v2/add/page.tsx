"use client";
import { Button } from "@/components/ui/button";

/**
 * Documents v2 — Add Document.
 *
 * Same data semantics as the v1 add page: every field, every API call, every
 * validation rule is preserved verbatim. Only the visual presentation differs
 * (V2FormShell wrapper, dot-accented section headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import RadioPill from "@/components/form/RadioPill";
import FieldLabel from "@/components/form/FieldLabel";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, Info, FileText, FileUp, Calendar, Eye, Download,
} from "@/components/icons";
import {
  getClub,
  createDocument,
  uploadDocumentFile,
} from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, DOC_EXTENSIONS } from "@/lib/uploadValidate";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
import { ListPageSkeleton } from "@/components/row/AppKit";

const TOP_MESSAGE = "Upload club documents (constitution, bylaws, forms, attachments). Choose 'View Only' to restrict downloads or 'Downloadable' to let members save the file locally.";

export default function DocumentsV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/documents/v2`);

  const [clubName, setClubName] = useState("");
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
  // The picked file is uploaded on Save, after every check passes, so a rejected save leaves no orphan file.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    async function init() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

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
    setPendingFile(file);
  };

  const removeFile = () => {
    setPendingFile(null); setFilePath(null);
    setFileName(null);
    setOriginalFileName(null);
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!filePath && !pendingFile) { setErrorMessage("Please upload a file."); return; }
    if (fileUploading) { setErrorMessage("Please wait for file to finish uploading."); return; }
    if (!publishDate || !publishTime) { setErrorMessage("Publish Date & Time is required."); return; }
    const publishDT = new Date(`${publishDate}T${publishTime}:00`);
    if (publishDT < new Date()) { setErrorMessage("Publish Date & Time cannot be in the past."); return; }
    if (!expiryDate || !expiryTime) { setErrorMessage("Expiry Date & Time is required."); return; }
    const expiryDT = new Date(`${expiryDate}T${expiryTime}:00`);
    if (expiryDT < new Date()) { setErrorMessage("Expiry Date & Time cannot be in the past."); return; }
    if (expiryDT < publishDT) { setErrorMessage("Expiry Date & Time must be on or after Publish Date & Time."); return; }

    setSaving(true);
    try {
      let savedPath = filePath;
      let savedOriginalName = originalFileName;
      if (pendingFile) {
        setFileUploading(true);
        try {
          const result = await uploadDocumentFile(clubId, pendingFile);
          savedPath = result.path;
          savedOriginalName = result.originalName || pendingFile.name;
          // Keep the uploaded path so a retry after a failed save does not upload again.
          setFilePath(savedPath);
          setOriginalFileName(savedOriginalName);
          setPendingFile(null);
        } catch (err: unknown) {
          setErrorMessage(describeUploadError(err));
          return;
        } finally {
          setFileUploading(false);
        }
      }
      await createDocument(clubId, {
        title: title.trim(),
        accessType,
        filePath: savedPath!,
        originalFileName: savedOriginalName,
        publishDateTime: `${publishDate}T${publishTime}:00`,
        expiryDateTime: `${expiryDate}T${expiryTime}:00`,
      });
      setSuccessMessage("Document created successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to save document.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Add Document"
        activeNavHref="/club-admin-dashboard/communication"
      >
      <V2FormShell
        title="Add Document"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/documents/v2`}
        saving={saving}
        saveLabel="Save Document"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Document Details */}
        <SectionCard number={1} icon={FileText} title="Document Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel required hint="(max 50 chars)">Title</FieldLabel>
              <Input
                type="text"
                value={title}
                onChange={handleTitleChange}
                placeholder="Document title"
                maxLength={50}
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel required>Access Type</FieldLabel>
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
        <SectionCard number={2} icon={FileUp} title="Attachment">
          <div className="space-y-2">
            <FieldLabel required>File</FieldLabel>
            {fileName ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50">
                <FileUp className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="text-sm font-medium text-emerald-700 flex-1 truncate">{fileName}</span>
                {fileUploading && <RotaryLoader size="sm" />}
                <IconButton
                  type="button"
                  onClick={removeFile}
                  className="hover:text-red-700"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
            ) : (
              <div>
                <Button variant="outline"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  <span className="text-sm">Upload file</span>
                </Button>
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
        <SectionCard number={3} icon={Calendar} title="Schedule">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Publish Date</FieldLabel>
              <DateField value={publishDate} onChange={setPublishDate} min={today} className="row-field w-full" />
            </div>
            <div>
              <FieldLabel required>Publish Time</FieldLabel>
              <Input
                type="time"
                value={publishTime}
                onChange={(e) => setPublishTime(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel required>Expiry Date</FieldLabel>
              <DateField value={expiryDate} onChange={setExpiryDate} min={today} className="row-field w-full" />
            </div>
            <div>
              <FieldLabel required>Expiry Time</FieldLabel>
              <Input
                type="time"
                value={expiryTime}
                onChange={(e) => setExpiryTime(e.target.value)}
              />
            </div>
          </div>
        </SectionCard>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Document saved successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
