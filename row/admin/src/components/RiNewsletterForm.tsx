"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import DateField from "@/components/DateField";
import { useRouter } from "next/navigation";
import { getRiDirectorNewsletter, createRiDirectorNewsletter, updateRiDirectorNewsletter, uploadRiDirectorNewsletterFile } from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, PDF_ONLY_EXTENSIONS } from "@/lib/uploadValidate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save, Upload, X, Users2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import RiRecipientPicker, { RiRecipientValue } from "@/components/RiRecipientPicker";
import { toLocalDateParts } from "@/lib/dateUtils";

export default function RiNewsletterForm({ newsletterId }: { newsletterId?: number }) {
  const router = useRouter();
  const isEdit = !!newsletterId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("");
  const [attachmentType, setAttachmentType] = useState<"link" | "pdf">("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [filePath, setFilePath] = useState("");
  const [recipient, setRecipient] = useState<RiRecipientValue>({ target: "all", zoneIds: [], districtIds: [], subgroupIds: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];

  const load = useCallback(async () => {
    if (!isEdit) return;
    try {
      const d = await getRiDirectorNewsletter(newsletterId!);
      setTitle(d.title);
      setAttachmentType((d.attachmentType as any) || "link");
      setLinkUrl(d.linkUrl || "");
      setFilePath(d.filePath || "");
      const setDT = (s: string, setD: (v: string) => void, setT: (v: string) => void) => {
        const { date, time } = toLocalDateParts(s);
        setD(date); setT(time);
      };
      if (d.publishDateTime) setDT(d.publishDateTime, setPublishDate, setPublishTime);
      if (d.expiryDateTime) setDT(d.expiryDateTime, setExpiryDate, setExpiryTime);
      const parseIds = (s: string | null | undefined): number[] => !s ? [] : s.split(",").map((x: string) => parseInt(x.trim())).filter((x: number) => !isNaN(x));
      setRecipient({
        target: (d.recipientTarget as any) || "all",
        zoneIds: parseIds(d.recipientZoneIds),
        districtIds: parseIds(d.recipientDistrictIds),
        subgroupIds: parseIds(d.recipientSubgroupIds),
      });
    } catch { setErrorMessage("Failed to load."); }
    finally { setLoading(false); }
  }, [isEdit, newsletterId]);

  useEffect(() => { load(); }, [load]);

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

    setUploading(true);
    try { const r = await uploadRiDirectorNewsletterFile(file); setFilePath(r.path); }
    catch (err: unknown) { setErrorMessage(describeUploadError(err)); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (!publishDate || !publishTime || !expiryDate || !expiryTime) { setErrorMessage("Dates required."); return; }
    if (attachmentType === "link" && !linkUrl.trim()) { setErrorMessage("Link URL is required."); return; }
    if (attachmentType === "pdf" && !filePath) { setErrorMessage("PDF file is required."); return; }
    if (recipient.target === "zones" && recipient.zoneIds.length === 0) { setErrorMessage("Select at least one zone."); return; }
    if (recipient.target === "districts" && recipient.districtIds.length === 0) { setErrorMessage("Select at least one district."); return; }
    if (recipient.target === "subgroups" && recipient.subgroupIds.length === 0) { setErrorMessage("Select at least one sub group."); return; }

    const publishDT = new Date(`${publishDate}T${publishTime}:00`);
    const expiryDT = new Date(`${expiryDate}T${expiryTime}:00`);
    if (expiryDT < publishDT) { setErrorMessage("Expiry must be after publish."); return; }


    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        publishDateTime: publishDT.toISOString(),
        expiryDateTime: expiryDT.toISOString(),
        attachmentType,
        linkUrl: attachmentType === "link" ? linkUrl.trim() : null,
        filePath: attachmentType === "pdf" ? filePath : null,
        recipientTarget: recipient.target,
        recipientZoneIds: recipient.zoneIds,
        recipientDistrictIds: recipient.districtIds,
        recipientSubgroupIds: recipient.subgroupIds,
      };
      if (isEdit) { await updateRiDirectorNewsletter(newsletterId!, payload); setSuccessMessage("Updated."); }
      else { await createRiDirectorNewsletter(payload); setSuccessMessage("Created."); }
      setTimeout(() => router.push("/ri-director/newsletters"), 1500);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href="/ri-director/newsletters"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">{isEdit ? "Edit" : "Add"} Newsletter</h2>
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
              <Label className="font-semibold text-sm">Attachment Type <span className="text-destructive">*</span></Label>
              <Select value={attachmentType} onValueChange={(v) => setAttachmentType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="link">External Link</SelectItem>
                  <SelectItem value="pdf">PDF Upload</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div></div>
            {attachmentType === "link" && (
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="font-semibold text-sm">Link URL <span className="text-destructive">*</span></Label>
                <Input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
              </div>
            )}
            {attachmentType === "pdf" && (
              <div className="sm:col-span-2 space-y-2">
                <Label className="font-semibold text-sm">PDF File <span className="text-destructive">*</span></Label>
                {filePath ? (
                  <div className="flex items-center gap-2 p-3 border rounded-lg">
                    <span className="text-sm flex-1 truncate">{filePath.split("/").pop()}</span>
                    <button onClick={() => setFilePath("")} className="text-destructive"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <div>
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg text-muted-foreground">
                      {uploading ? <RotaryLoader size="sm" /> : <Upload className="h-4 w-4" />}
                      <span className="text-sm">{uploading ? "Uploading..." : "Upload PDF file"}</span>
                    </button>
                    <p className="text-xs text-muted-foreground mt-1.5">{documentUploadHint(PDF_ONLY_EXTENSIONS)}</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileSelect} />
              </div>
            )}
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Publish Date <span className="text-destructive">*</span></Label><DateField value={publishDate} onChange={setPublishDate} min={today} /></div>
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Publish Time <span className="text-destructive">*</span></Label><Input type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Expiry Date <span className="text-destructive">*</span></Label><DateField value={expiryDate} onChange={setExpiryDate} min={today} /></div>
            <div className="space-y-1.5"><Label className="font-semibold text-sm">Expiry Time <span className="text-destructive">*</span></Label><Input type="time" value={expiryTime} onChange={(e) => setExpiryTime(e.target.value)} /></div>
          </div>

          <div className="mt-6 pt-4 border-t">
            <div className="flex items-center gap-2 mb-3">
              <Users2 className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Recipients</h3>
            </div>
            <RiRecipientPicker value={recipient} onChange={setRecipient} />
          </div>


          <div className="flex justify-end pt-4">
            <Button onClick={handleSave} disabled={saving} size="lg"><Save className="mr-2 h-4 w-4" />{saving ? <RotaryLoader size="sm" /> : (isEdit ? "Update" : "Save")}</Button>
          </div>
        </CardContent></Card>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push("/ri-director/newsletters")} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
