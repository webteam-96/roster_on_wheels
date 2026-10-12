"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRiDirectorWeblink, createRiDirectorWeblink, updateRiDirectorWeblink } from "@/services/api";
import { isValidWebUrl, INVALID_URL_MESSAGE } from "@/lib/urlValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Save } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function RiWeblinkForm({ weblinkId }: { weblinkId?: number }) {
  const router = useRouter();
  const isEdit = !!weblinkId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [writeup, setWriteup] = useState("");
  const [linkType, setLinkType] = useState<"url" | "youtube">("url");
  const [linkUrl, setLinkUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isEdit) return;
    try {
      const d = await getRiDirectorWeblink(weblinkId!);
      setTitle(d.title); setWriteup(d.writeup || "");
      setLinkType((d.linkType as any) || "url");
      setLinkUrl(d.linkUrl || ""); setYoutubeUrl(d.youtubeUrl || "");
      setButtonText(d.buttonText || "");
      setSortOrder(d.sortOrder || 0);
      setIsActive(!!d.isActive);
    } catch { setErrorMessage("Failed to load."); }
    finally { setLoading(false); }
  }, [isEdit, weblinkId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (linkType === "url") {
      if (!linkUrl.trim()) { setErrorMessage("Link URL is required."); return; }
      if (!isValidWebUrl(linkUrl)) { setErrorMessage(INVALID_URL_MESSAGE); return; }
    }
    if (linkType === "youtube") {
      if (!youtubeUrl.trim()) { setErrorMessage("YouTube URL is required."); return; }
      if (!isValidWebUrl(youtubeUrl)) { setErrorMessage(INVALID_URL_MESSAGE); return; }
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        writeup: writeup.trim() || null,
        linkType,
        linkUrl: linkType === "url" ? linkUrl.trim() : null,
        youtubeUrl: linkType === "youtube" ? youtubeUrl.trim() : null,
        buttonText: buttonText.trim() || null,
        sortOrder,
        isActive,
      };
      if (isEdit) { await updateRiDirectorWeblink(weblinkId!, payload); setSuccessMessage("Updated."); }
      else { await createRiDirectorWeblink(payload); setSuccessMessage("Created."); }
      setTimeout(() => router.push("/ri-director/weblinks"), 1500);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href="/ri-director/weblinks"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">{isEdit ? "Edit" : "Add"} Web Link</h2>
            <p className="text-muted-foreground">RI Director</p>
          </div>
        </div>

        <Card><CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="font-semibold text-sm">Title <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="font-semibold text-sm">Writeup</Label>
              <Textarea value={writeup} onChange={(e) => setWriteup(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label className="font-semibold text-sm">Link Type <span className="text-destructive">*</span></Label>
              <Select value={linkType} onValueChange={(v) => setLinkType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="url">URL</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-semibold text-sm">Button Text</Label>
              <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} maxLength={100} placeholder="e.g., Learn More" />
            </div>
            {linkType === "url" && (
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="font-semibold text-sm">URL <span className="text-destructive">*</span></Label>
                <Input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" />
              </div>
            )}
            {linkType === "youtube" && (
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="font-semibold text-sm">YouTube URL <span className="text-destructive">*</span></Label>
                <Input type="url" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="font-semibold text-sm">Sort Order</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
                <span className="text-sm font-medium">Active</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button onClick={handleSave} disabled={saving} size="lg">
              {saving ? <RotaryLoader size="sm" /> : <><Save className="mr-2 h-4 w-4" />{isEdit ? "Update" : "Save"}</>}
            </Button>
          </div>
        </CardContent></Card>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push("/ri-director/weblinks")} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
