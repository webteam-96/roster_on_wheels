"use client";

import { UploadZone } from "@/components/ui/text-buttons";
import SectionCard from "@/components/form/SectionCard";
import FieldLabel from "@/components/form/FieldLabel";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import {
  getDistrict,
  getDistrictDocument,
  updateDistrictDocument,
  uploadDistrictDocumentFile,
} from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, DOC_EXTENSIONS } from "@/lib/uploadValidate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Upload, X, FileText, Send, FileUp } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function DistrictDocumentEditPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const documentId = Number(params.documentId);

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
  // The picked file is uploaded on Save, after every check passes, so a rejected save leaves no orphan file.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [originalPublishDateTime, setOriginalPublishDateTime] = useState("");
  const [originalExpiryDateTime, setOriginalExpiryDateTime] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load document.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [districtId, documentId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) setTitle(val);
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

  const removeFile = () => { setPendingFile(null); setFilePath(null); setFileName(null); setOriginalFileName(null); };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!filePath && !pendingFile) { setErrorMessage("Please upload a file."); return; }
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
      let savedPath = filePath;
      let savedOriginalName = originalFileName;
      if (pendingFile) {
        setFileUploading(true);
        try {
          const result = await uploadDistrictDocumentFile(districtId, pendingFile);
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
      await updateDistrictDocument(districtId, documentId, {
        title: title.trim(),
        accessType,
        filePath: savedPath!,
        originalFileName: savedOriginalName,
        publishDateTime: publishDTStr,
        expiryDateTime: expiryDTStr,
      });
      setSuccessMessage("Document updated successfully.");
      setTimeout(() => router.push(`/districts/${districtId}/documents`), 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update document.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl">
        <PageHeader title="Edit Document" description={districtName} back={`/districts/${districtId}/documents`} />

        <SectionCard icon={FileText} title="Document Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel required hint="(max 50 chars)">Title</FieldLabel>
              <Input value={title} onChange={handleTitleChange} placeholder="Document title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel required>Access Type</FieldLabel>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="accessType" checked={accessType === "view_only"} onChange={() => setAccessType("view_only")} className="h-4 w-4 text-primary focus:ring-primary" />
                  <span className="text-sm font-medium">View Only</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="accessType" checked={accessType === "downloadable"} onChange={() => setAccessType("downloadable")} className="h-4 w-4 text-primary focus:ring-primary" />
                  <span className="text-sm font-medium">Downloadable</span>
                </label>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard icon={FileUp} title="Attachment" number={2}>
          <div className="space-y-2">
            <FieldLabel required>File</FieldLabel>
            {fileName ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <FileUp className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">{fileName}</span>
                {fileUploading && <RotaryLoader size="sm" />}
                <IconButton aria-label="Remove file" onClick={removeFile} className="hover:text-red-700"><X className="h-4 w-4" /></IconButton>
              </div>
            ) : (
              <div>
                <UploadZone onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /><span className="text-sm">Upload file</span>
                </UploadZone>
                <p className="text-xs text-muted-foreground mt-1.5">{documentUploadHint(DOC_EXTENSIONS)}</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={handleFileSelect} />
          </div>
        </SectionCard>

        <SectionCard icon={FileText} title="Schedule" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <FieldLabel required>Publish Date</FieldLabel>
              <DateField value={publishDate} onChange={setPublishDate} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>Publish Time</FieldLabel>
              <Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>Expiry Date</FieldLabel>
              <DateField value={expiryDate} onChange={setExpiryDate} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>Expiry Time</FieldLabel>
              <Input type="time" value={expiryTime} onChange={(e) => setExpiryTime(e.target.value)} />
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Update Document</>}
          </Button>
        </div>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(`/districts/${districtId}/documents`)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
