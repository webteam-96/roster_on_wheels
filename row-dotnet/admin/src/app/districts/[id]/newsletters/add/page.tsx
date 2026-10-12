"use client";

import { useState, useEffect, useRef } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import {
  getDistrict,
  createDistrictNewsletter,
  uploadDistrictNewsletterFile,
} from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, PDF_ONLY_EXTENSIONS } from "@/lib/uploadValidate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ArrowLeft, Upload, X,
  FileText, Send, Bell, Link2, FileUp,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import WhatsAppRecipientBadge from "@/components/WhatsAppRecipientBadge";

const ENGLISH_ONLY_REGEX = /^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$/;

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

export default function DistrictNewslettersAddPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const listUrl = `/districts/${districtId}/newsletters`;

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("");
  const [attachmentType, setAttachmentType] = useState<"link" | "file">("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [isSendWhatsapp, setIsSendWhatsapp] = useState(false);
  const [isSendEmail, setIsSendEmail] = useState(false);

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
    if (ENGLISH_ONLY_REGEX.test(val)) setTitle(val);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input first so re-picking the SAME file after an error still fires onChange.
    e.target.value = "";
    if (!file) return;

    // Pre-check before the request goes out: an oversized or wrong-type file
    // fails instantly with a specific message instead of after a long upload.
    try {
      validateDocumentFile(file, PDF_ONLY_EXTENSIONS);
    } catch (err: unknown) {
      setErrorMessage(describeUploadError(err));
      return;
    }

    setFileName(file.name);
    setFileUploading(true);
    try {
      const result = await uploadDistrictNewsletterFile(districtId, file);
      setFilePath(result.path);
    } catch (err: unknown) {
      setFileName(null);
      setFilePath(null);
      setErrorMessage(describeUploadError(err));
    } finally {
      setFileUploading(false);
    }
  };

  const removeFile = () => { setFilePath(null); setFileName(null); };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!publishDate || !publishTime) { setErrorMessage("Publish Date & Time is required."); return; }
    if (attachmentType === "link" && !linkUrl.trim()) { setErrorMessage("Link URL is required when attachment type is Link."); return; }
    if (attachmentType === "file" && !filePath) { setErrorMessage("Please upload a PDF file."); return; }
    if (fileUploading) { setErrorMessage("Please wait for file to finish uploading."); return; }

    setSaving(true);
    try {
      await createDistrictNewsletter(districtId, {
        title: title.trim(),
        publishDateTime: `${publishDate}T${publishTime}:00`,
        // Expiry kept for backend compatibility — UI no longer captures it
        expiryDateTime: "2099-12-31T23:59:00", // no expiry — UI doesn't capture one; matches mobile's never-expires sentinel
        attachmentType,
        linkUrl: attachmentType === "link" ? linkUrl.trim() : null,
        filePath: attachmentType === "file" ? filePath : null,
        isSendWhatsapp,
        isSendEmail,
      });
      setSuccessMessage("Newsletter created successfully.");
      setTimeout(() => router.push(listUrl), 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save newsletter.");
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
            <Link href={listUrl}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Add Newsletter</h2>
            <p className="text-muted-foreground text-base">{districtName}</p>
          </div>
        </div>

        <Section icon={FileText} title="Newsletter Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Req hint="(max 50 chars, English only)">Title</Req>
              <Input value={title} onChange={handleTitleChange} placeholder="Newsletter title" maxLength={50} />
              <p className="text-xs text-muted-foreground text-right">{title.length}/50</p>
            </div>
            <div className="space-y-1.5">
              <Req>Publish Date</Req>
              <DateField value={publishDate} onChange={setPublishDate} />
            </div>
            <div className="space-y-1.5">
              <Req>Publish Time</Req>
              <Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} />
            </div>
          </div>
        </Section>

        <Section icon={Link2} title="Attachment" number={2}>
          <div className="space-y-4">
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="attachmentType" checked={attachmentType === "link"} onChange={() => { setAttachmentType("link"); setFilePath(null); setFileName(null); }} className="h-4 w-4 text-primary focus:ring-primary" />
                <span className="text-sm font-medium">Save Link</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="attachmentType" checked={attachmentType === "file"} onChange={() => { setAttachmentType("file"); setLinkUrl(""); }} className="h-4 w-4 text-primary focus:ring-primary" />
                <span className="text-sm font-medium">Attach File (PDF)</span>
              </label>
            </div>

            {attachmentType === "link" && (
              <div className="space-y-1.5">
                <Req>Link URL</Req>
                <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" type="url" />
              </div>
            )}

            {attachmentType === "file" && (
              <div className="space-y-2">
                <Req>PDF File</Req>
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
                      <Upload className="h-4 w-4" /><span className="text-sm">Upload PDF file</span>
                    </button>
                    <p className="text-xs text-muted-foreground mt-1.5">{documentUploadHint(PDF_ONLY_EXTENSIONS)}</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf" onChange={handleFileSelect} />
              </div>
            )}
          </div>
        </Section>

        <Section icon={Bell} title="Notification Settings" number={3}>
          <div className="space-y-4">
            {/* WhatsApp notify checkbox hidden 2026-09-07 per request — re-enable later. Value still submits (default off). */}
            {false && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isSendWhatsapp} onChange={(e) => setIsSendWhatsapp(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <span className="text-sm font-medium">Notify members via WhatsApp</span>
              {isSendWhatsapp && <WhatsAppRecipientBadge scope="district" districtId={districtId} />}
            </label>
            )}
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isSendEmail} onChange={(e) => setIsSendEmail(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <span className="text-sm font-medium">Notify members via Email</span>
              {isSendEmail && <WhatsAppRecipientBadge scope="district" districtId={districtId} channel="email" />}
            </label>
          </div>
        </Section>

        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Save Newsletter</>}
          </Button>
        </div>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(listUrl)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
