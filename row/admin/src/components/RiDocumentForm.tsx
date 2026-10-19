"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import DateField from "@/components/DateField";
import { useRouter } from "next/navigation";
import { getRiDirectorDocument, createRiDirectorDocument, updateRiDirectorDocument, uploadRiDirectorDocumentFile } from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, DOC_EXTENSIONS } from "@/lib/uploadValidate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, Upload, X } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function RiDocumentForm({ documentId }: { documentId?: number }) {
  const router = useRouter();
  const isEdit = !!documentId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [accessType, setAccessType] = useState("downloadable");
  const [filePath, setFilePath] = useState("");
  const [originalFileName, setOriginalFileName] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];

  const load = useCallback(async () => {
    if (!isEdit) return;
    try {
      const d = await getRiDirectorDocument(documentId!);
      setTitle(d.title);
      setAccessType(d.accessType || "downloadable");
      setFilePath(d.filePath || "");
      setOriginalFileName(d.originalFileName || "");
      const setDT = (s: string, setD: (v: string) => void, setT: (v: string) => void) => {
        const dt = new Date(s);
        setD(dt.toISOString().split("T")[0]); setT(dt.toTimeString().slice(0, 5));
      };
      if (d.publishDateTime) setDT(d.publishDateTime, setPublishDate, setPublishTime);
      if (d.expiryDateTime) setDT(d.expiryDateTime, setExpiryDate, setExpiryTime);
    } catch { setErrorMessage("Failed to load."); }
    finally { setLoading(false); }
  }, [isEdit, documentId]);

  useEffect(() => { load(); }, [load]);

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

    setUploading(true);
    try {
      const r = await uploadRiDirectorDocumentFile(file);
      setFilePath(r.path); setOriginalFileName(r.originalFileName);
    } catch (err: unknown) { setErrorMessage(describeUploadError(err)); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (!filePath) { setErrorMessage("File is required."); return; }
    if (!publishDate || !publishTime || !expiryDate || !expiryTime) { setErrorMessage("Dates are required."); return; }
    if (uploading) { setErrorMessage("Please wait for upload."); return; }

    const publishDT = new Date(`${publishDate}T${publishTime}:00`);
    const expiryDT = new Date(`${expiryDate}T${expiryTime}:00`);
    if (expiryDT < publishDT) { setErrorMessage("Expiry must be after publish."); return; }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(), accessType, filePath, originalFileName,
        publishDateTime: publishDT.toISOString(), expiryDateTime: expiryDT.toISOString(),
      };
      if (isEdit) { await updateRiDirectorDocument(documentId!, payload); setSuccessMessage("Updated."); }
      else { await createRiDirectorDocument(payload); setSuccessMessage("Created."); }
      setTimeout(() => router.push("/ri-director/documents"), 1500);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href="/ri-director/documents"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">{isEdit ? "Edit" : "Add"} Document</h2>
            <p className="text-muted-foreground">RI Director</p>
          </div>
        </div>

        <Card><CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="font-semibold text-sm">Title <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={50} />
            </div>
            <div className="space-y-1.5">
              <Label className="font-semibold text-sm">Access Type</Label>
              <Select value={accessType} onValueChange={setAccessType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="downloadable">Downloadable</SelectItem>
                  <SelectItem value="viewonly">View Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"></div>
            <div className="sm:col-span-2 space-y-2">
              <Label className="font-semibold text-sm">File <span className="text-destructive">*</span></Label>
              {filePath ? (
                <div className="flex items-center gap-2 p-3 border rounded-lg">
                  <span className="text-sm flex-1 truncate">{originalFileName || "Uploaded file"}</span>
                  <button onClick={() => { setFilePath(""); setOriginalFileName(""); }} className="text-destructive"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg text-muted-foreground">
                    {uploading ? <RotaryLoader size="sm" /> : <Upload className="h-4 w-4" />}
                    <span className="text-sm">{uploading ? "Uploading..." : "Upload file"}</span>
                  </button>
                  <p className="text-xs text-muted-foreground mt-1.5">{documentUploadHint(DOC_EXTENSIONS)}</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" className="hidden" onChange={handleFileSelect} />
            </div>
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Publish Date <span className="text-destructive">*</span></Label><DateField value={publishDate} onChange={setPublishDate} min={today} /></div>
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Publish Time <span className="text-destructive">*</span></Label><Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Expiry Date <span className="text-destructive">*</span></Label><DateField value={expiryDate} onChange={setExpiryDate} min={today} /></div>
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Expiry Time <span className="text-destructive">*</span></Label><Input type="time" value={expiryTime} onChange={(e) => setExpiryTime(e.target.value)} /></div>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={handleSave} disabled={saving} size="lg"><Save className="mr-2 h-4 w-4" />{saving ? <RotaryLoader size="sm" /> : (isEdit ? "Update" : "Save")}</Button>
          </div>
        </CardContent></Card>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push("/ri-director/documents")} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
