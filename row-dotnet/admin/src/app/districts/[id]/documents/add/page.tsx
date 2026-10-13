"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import {
  getDistrict,
  createDistrictDocument,
  uploadDistrictDocumentFile,
} from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, DOC_EXTENSIONS } from "@/lib/uploadValidate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ArrowLeft, Upload, X,
  FileText, Send, FileUp,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { TEXT_INPUT_REGEX } from "@/lib/textInput";

function Req({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <Label className="text-sm font-semibold text-foreground">
      {children}<span className="text-destructive ml-0.5">*</span>
      {hint && <span className="text-muted-foreground font-normal ml-1">{hint}</span>}
    </Label>
  );
}

function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/40 border-b">
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</div>
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-base">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function DistrictDocumentsAddPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    async function init() {
      try {
        const district = await getDistrict(districtId);
        setDistrictName(`District ${district.districtNumber}`);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [districtId]);

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

  const removeFile = () => { setFilePath(null); setFileName(null); setOriginalFileName(null); };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!filePath) { setErrorMessage("Please upload a file."); return; }
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
      await createDistrictDocument(districtId, {
        title: title.trim(),
        accessType,
        filePath: filePath!,
        originalFileName: originalFileName,
        publishDateTime: `${publishDate}T${publishTime}:00`,
        expiryDateTime: `${expiryDate}T${expiryTime}:00`,
      });
      setSuccessMessage("Document created successfully.");
      setTimeout(() => router.push(`/districts/${districtId}/documents`), 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save document.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/districts/${districtId}/documents`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Add Document</h2>
            <p className="text-muted-foreground text-base">{districtName}</p>
          </div>
        </div>

        <Section icon={FileText} title="Document Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 50 chars)">Title</Req>
              <Input value={title} onChange={handleTitleChange} placeholder="Document title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Req>Access Type</Req>
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
        </Section>

        <Section icon={FileUp} title="Attachment" number={2}>
          <div className="space-y-2">
            <Req>File</Req>
            {fileName ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <FileUp className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm font-medium flex-1 truncate">{fileName}</span>
                {fileUploading && <RotaryLoader size="sm" />}
                <button onClick={removeFile} className="p-1 rounded-full hover:bg-destructive/10 text-destructive"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div>
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg hover:border-primary/40 transition-colors text-muted-foreground">
                  <Upload className="h-4 w-4" /><span className="text-sm">Upload file</span>
                </button>
                <p className="text-xs text-muted-foreground mt-1.5">{documentUploadHint(DOC_EXTENSIONS)}</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={handleFileSelect} />
          </div>
        </Section>

        <Section icon={FileText} title="Schedule" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Req>Publish Date</Req>
              <DateField value={publishDate} onChange={setPublishDate} min={today} />
            </div>
            <div className="space-y-1.5">
              <Req>Publish Time</Req>
              <Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Req>Expiry Date</Req>
              <DateField value={expiryDate} onChange={setExpiryDate} min={today} />
            </div>
            <div className="space-y-1.5">
              <Req>Expiry Time</Req>
              <Input type="time" value={expiryTime} onChange={(e) => setExpiryTime(e.target.value)} />
            </div>
          </div>
        </Section>

        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Save Document</>}
          </Button>
        </div>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(`/districts/${districtId}/documents`)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
