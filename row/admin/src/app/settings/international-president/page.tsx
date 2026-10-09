"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { ArrowLeft, Camera, Save, UserCircle2 } from "lucide-react";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getRotaryYears,
  getInternationalPresidentByYear,
  saveInternationalPresident,
  uploadInternationalPresidentPhoto,
  getPhotoUrl,
} from "@/services/api";
import "react-quill-new/dist/quill.snow.css";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

// The photo value can be EITHER a bare filename (just uploaded) or a full
// /Documents/WebsiteData/International_President/<file> URL (loaded from an existing record).
// Build a servable URL for both. IP_PREFIX is also used to normalise the value back to a bare
// filename before saving, so a re-save of a loaded record never double-prefixes the stored path.
const IP_PREFIX = "/Documents/WebsiteData/International_President/";
const ipPhotoSrc = (v: string | null): string => {
  if (!v) return "";
  if (v.startsWith("http") || v.startsWith("/")) return getPhotoUrl(v);
  return getPhotoUrl(`${IP_PREFIX}${v}`); // bare filename → add our upload folder
};
const ipPhotoFilename = (v: string | null): string | null => {
  if (!v) return v;
  const i = v.lastIndexOf(IP_PREFIX);
  return i >= 0 ? v.substring(i + IP_PREFIX.length) : v;
};

// Square (1:1) — the photo is displayed in a circular frame on both the admin
// form and the club/district websites.
const PHOTO_ASPECT = 1;
const PHOTO_MAX_WIDTH = 1200;

export default function InternationalPresidentPage() {
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  // Crop dialog state
  const photoCrop = useImageCropUpload();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rich text editor — image upload uses our backend upload endpoint
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const handlerAttachedRef = useRef(false);

  const quillModules = useRef({
    toolbar: {
      container: [
        ["bold", "italic", "underline"],
        [{ header: [1, 2, 3, false] }],
        [{ size: [] }],
        [{ color: [] }, { background: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ align: [] }],
        ["link", "image"],
        ["clean"],
      ],
    },
  }).current;

  const getQuillInstance = useCallback(() => {
    const container = editorContainerRef.current;
    if (!container) return null;
    const qlContainer = container.querySelector(".ql-container");
    if (!qlContainer) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const QuillClass = require("quill").default || require("quill");
      return QuillClass.find(qlContainer);
    } catch { return null; }
  }, []);

  // Attach custom image handler to Quill so uploads go to our backend
  useEffect(() => {
    const timer = setTimeout(() => {
      if (handlerAttachedRef.current) return;
      const quill = getQuillInstance();
      if (!quill) return;
      handlerAttachedRef.current = true;
      const toolbar = quill.getModule("toolbar");
      if (toolbar) {
        toolbar.addHandler("image", () => {
          const input = document.createElement("input");
          input.setAttribute("type", "file");
          input.setAttribute("accept", "image/*");
          input.click();
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const result = await uploadInternationalPresidentPhoto(file);
              const range = quill.getSelection(true);
              const fullUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${result.path}`;
              quill.insertEmbed(range.index, "image", fullUrl);
              quill.setSelection(range.index + 1);
            } catch {
              setErrorMessage("Failed to upload image.");
            }
          };
        });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [getQuillInstance]);

  // Initial load — fetch years and default to current year
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const yrs = await getRotaryYears();
        setYears(yrs);
        const current = yrs.find((y: RotaryYear) => y.isCurrent) || yrs[0];
        if (current) setSelectedYearId(String(current.id));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load rotary years.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // When year changes → fetch existing record
  useEffect(() => {
    if (!selectedYearId) return;
    (async () => {
      try {
        const record = await getInternationalPresidentByYear(Number(selectedYearId));
        if (record) {
          setName(record.name || "");
          setDesignation(record.designation || "");
          setProfilePhoto(record.profilePhoto || null);
          setDescription(record.description || "");
        } else {
          // Clear form if no existing record for this year
          setName("");
          setDesignation("");
          setProfilePhoto(null);
          setDescription("");
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load record for year.");
      }
    })();
  }, [selectedYearId]);

  const handleCropSave = async (blob: Blob) => {
    setUploading(true);
    try {
      const file = new File([blob], "ip-profile.png", { type: "image/png" });
      const { path } = await uploadInternationalPresidentPhoto(file);
      setProfilePhoto(path);
      photoCrop.cancel();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to upload image.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedYearId) { setErrorMessage("Please select a rotary year."); return; }
    if (!name.trim()) { setErrorMessage("Name is required."); return; }
    setSaving(true);
    try {
      await saveInternationalPresident({
        yearId: Number(selectedYearId),
        name: name.trim(),
        designation: designation.trim() || null,
        // Always store filename-only — the record loads the photo as a full URL, so strip our
        // folder prefix here (backend does the same defensively) to avoid double-prefixing.
        profilePhotoPath: ipPhotoFilename(profilePhoto),
        description: description || null,
      });
      setSuccessMessage("Saved successfully.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">International President&apos;s Information</h2>
              <p className="text-muted-foreground text-base">Manage RI President profile per rotary year (shown on club & district websites)</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserCircle2 className="h-5 w-5" />Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Rotary Year <span className="text-red-500">*</span></Label>
                  <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                    <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y.id} value={String(y.id)}>
                          {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Pick a year to view/edit that year&apos;s International President.</p>
                </div>
              </div>

              <div className="flex flex-col items-start gap-4">
                <Label>Profile Photo</Label>
                <div className="flex items-start gap-4">
                  <div className="h-32 w-32 overflow-hidden rounded-full bg-primary/5 border-2 border-dashed border-primary/30 flex items-center justify-center">
                    {profilePhoto ? (
                      // Use plain img so this works for both absolute and relative paths without Next/Image config churn
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ipPhotoSrc(profilePhoto)} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      <Camera className="h-10 w-10 text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-2">
                    <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) photoCrop.startCrop(f); e.target.value = ""; }} />
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Camera className="mr-2 h-4 w-4" />{profilePhoto ? "Change Photo" : "Upload Photo"}
                    </Button>
                    {profilePhoto && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setProfilePhoto(null)}>
                        Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground max-w-xs">Allowed: JPG, JPEG, PNG, WEBP (max 5 MB). Upload a photo, then crop + zoom before saving.</p>
                    {photoCrop.error && <p className="text-xs text-destructive">{photoCrop.error}</p>}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name <span className="text-red-500">*</span></Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Rtn. Mario César Martins de Camargo" />
                </div>
                <div className="space-y-2">
                  <Label>Designation</Label>
                  <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g., RI President 2025-26" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <div ref={editorContainerRef} className="min-h-[200px]">
                  <ReactQuill
                    theme="snow"
                    value={description}
                    onChange={setDescription}
                    modules={quillModules}
                    placeholder="Write a biography, message, or any description…"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Supports bold, italic, headings, sizes, colors, alignment, lists, links, and inline images.</p>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving || !selectedYearId || !name.trim()}>
                  {saving ? <RotaryLoader size="sm" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Crop dialog */}
        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.imageSrc}
          aspect={PHOTO_ASPECT}
          maxOutputWidth={PHOTO_MAX_WIDTH}
          title="Crop Profile Photo"
          saving={uploading}
          onCancel={photoCrop.cancel}
          onSave={handleCropSave}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
