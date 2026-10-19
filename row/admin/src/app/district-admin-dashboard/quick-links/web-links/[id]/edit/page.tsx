"use client";

/**
 * V2 — Edit Web Link (District Admin dashboard shell).
 * ---------------------------------------------------------------------------
 * Page form (V1 used an inline dialog). The record is loaded from the tree
 * endpoint (no dedicated "get single weblink" API in V1) and preloaded into the
 * same level-driven field set as the Add page. `level` comes from the record.
 * Save/Cancel/Back honour ?returnTo=, else fall back to the listing (preserving
 * parentId — the record's own parentId when the URL didn't carry one — + yearId).
 * Web Links are NOT year-wise — yearId is only forwarded.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { WeblinkTree } from "@/types/weblink";
import { updateDistrictWeblink, getDistrictWeblinkTree } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { isValidWebUrl, INVALID_URL_MESSAGE } from "@/lib/urlValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Loader2, Link2 } from "@/components/icons";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

const WEB_LINKS_BASE = "/district-admin-dashboard/quick-links/web-links";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const quillModules = { toolbar: [["bold", "italic", "underline"], [{ list: "ordered" }, { list: "bullet" }], ["link"], ["clean"]] };

function withSearch(base: string, extra: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

function findNode(nodes: WeblinkTree[], id: number): WeblinkTree | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children || [], id);
    if (f) return f;
  }
  return null;
}

function linkTypeOptions(level: number): string[] {
  if (level === 1) return ["None", "Page", "URL", "PDF"];
  if (level === 2) return ["URL", "PDF"];
  return [];
}

// Migrated paths come back as "/Documents/..." — prepend the API host; already-
// absolute URLs are rendered as-is.
function mediaUrl(p?: string | null) {
  if (!p) return "";
  return /^https?:\/\//i.test(p) ? p : `${API_BASE_URL}${p}`;
}

export default function EditWebLinkPage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const weblinkId = Number(params.id);
  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");
  const parentIdParam = searchParams.get("parentId");

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [level, setLevel] = useState(1);
  const [recordParentId, setRecordParentId] = useState<number | null>(null);
  const [existingLogo, setExistingLogo] = useState<string | null>(null);
  const [existingBanner, setExistingBanner] = useState<string | null>(null);
  const [existingPdf, setExistingPdf] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [writeup, setWriteup] = useState("");
  const [linkType, setLinkType] = useState("None");
  const [linkUrl, setLinkUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [logo, setLogo] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);

  // parentId used to rebuild the listing fallback: prefer the URL param, else
  // the record's own parentId (so Back lands in the record's folder).
  const fallbackParentId = parentIdParam ?? (recordParentId !== null ? String(recordParentId) : null);
  const listingFallback = withSearch(WEB_LINKS_BASE, { parentId: fallbackParentId, yearId });

  const load = useCallback(async () => {
    if (!districtId || !weblinkId) { setLoading(false); return; }
    try {
      const tree = await getDistrictWeblinkTree(districtId);
      const rec = findNode(tree, weblinkId);
      if (!rec) { setNotFound(true); setLoading(false); return; }
      setLevel(rec.level);
      setRecordParentId(rec.parentId);
      setTitle(rec.title);
      setWriteup(rec.writeup || "");
      setLinkType(rec.linkType || "None");
      setLinkUrl(rec.linkUrl || "");
      setYoutubeUrl(rec.youtubeUrl || "");
      setButtonText(rec.buttonText || "");
      setSortOrder(rec.sortOrder);
      setIsActive(rec.isActive);
      setExistingLogo(rec.logoPath);
      setExistingBanner(rec.bannerPath);
      setExistingPdf(rec.pdfPath);
    } catch {
      setErrorMessage("Failed to load web link.");
    } finally { setLoading(false); }
  }, [districtId, weblinkId]);

  useEffect(() => { load(); }, [load]);

  // Object-URL previews for newly-picked files (revoked on unmount / re-pick).
  const logoPreviewUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);
  const bannerPreviewUrl = useMemo(() => (banner ? URL.createObjectURL(banner) : null), [banner]);
  useEffect(() => () => { if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl); }, [logoPreviewUrl]);
  useEffect(() => () => { if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl); }, [bannerPreviewUrl]);

  const goBack = () => router.push(returnTo || listingFallback);

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (linkType === "URL" && !linkUrl.trim()) { setErrorMessage("Link URL is required."); return; }
    if (linkUrl.trim() && !isValidWebUrl(linkUrl)) { setErrorMessage(INVALID_URL_MESSAGE); return; }
    if (youtubeUrl.trim() && !isValidWebUrl(youtubeUrl)) { setErrorMessage(INVALID_URL_MESSAGE); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("writeup", writeup);
      fd.append("linkType", linkType);
      fd.append("linkUrl", linkUrl);
      fd.append("youtubeUrl", youtubeUrl);
      fd.append("buttonText", buttonText);
      fd.append("sortOrder", String(sortOrder));
      fd.append("isActive", String(isActive));
      if (logo) fd.append("logo", logo);
      if (banner) fd.append("banner", banner);
      if (pdf) fd.append("pdf", pdf);
      await updateDistrictWeblink(districtId, weblinkId, fd);
      router.push(returnTo || listingFallback);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to save web link.";
      setErrorMessage(msg);
      setSaving(false);
    }
  };

  if (!districtId) return null;

  const showLinkTypeSelect = level <= 2;
  const showUrl = linkType === "URL" || level === 3;
  const showPdf = linkType === "PDF" && level <= 2;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-3xl">
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={goBack}
            className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800 shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-azure/10 text-ink">
              <Link2 size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-800 leading-tight">Edit Web Link</h1>
              <p className="text-xs text-slate-500 mt-0.5">Level {level}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : notFound ? (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <h3 className="text-lg font-semibold text-slate-800">Web link not found</h3>
            <Button variant="outline" onClick={goBack} className="mt-4 border-slate-200 text-slate-700 hover:bg-slate-50">
              Back
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Title *</Label>
              <Input
                className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Web link title"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">{level === 1 ? "Writeup / About" : "About"}</Label>
              <div className="min-h-[150px]">
                <ReactQuill theme="snow" value={writeup} onChange={setWriteup} modules={quillModules} placeholder="Enter content..." />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">{level === 1 ? "Module Logo" : "Logo"}</Label>
              {logoPreviewUrl ? (
                <div className="space-y-1">
                  <img src={logoPreviewUrl} alt="New logo preview" className="h-20 w-20 rounded object-cover border border-slate-200" />
                  <p className="text-[11px] text-emerald-600">New logo: will replace on save</p>
                </div>
              ) : existingLogo ? (
                <div className="space-y-1">
                  <img src={mediaUrl(existingLogo)} alt="Current logo" className="h-20 w-20 rounded object-cover border border-slate-200" />
                  <p className="text-[11px] text-slate-500">Current logo</p>
                </div>
              ) : null}
              <Input
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                onChange={(e) => setLogo(e.target.files?.[0] || null)}
                className="border-slate-200 bg-white"
              />
              <p className="text-xs text-slate-500">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
            </div>

            {level === 1 && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Banner</Label>
                {bannerPreviewUrl ? (
                  <div className="space-y-1">
                    <img src={bannerPreviewUrl} alt="New banner preview" className="h-24 w-full max-w-md rounded object-cover border border-slate-200" />
                    <p className="text-[11px] text-emerald-600">New banner: will replace on save</p>
                  </div>
                ) : existingBanner ? (
                  <div className="space-y-1">
                    <img src={mediaUrl(existingBanner)} alt="Current banner" className="h-24 w-full max-w-md rounded object-cover border border-slate-200" />
                    <p className="text-[11px] text-slate-500">Current banner</p>
                  </div>
                ) : null}
                <Input
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.webp"
                  onChange={(e) => setBanner(e.target.files?.[0] || null)}
                  className="border-slate-200 bg-white"
                />
                <p className="text-xs text-slate-500">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
              </div>
            )}

            {showLinkTypeSelect && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Link Type</Label>
                <Select value={linkType} onValueChange={setLinkType}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20">
                    <SelectValue placeholder="Select link type" />
                  </SelectTrigger>
                  <SelectContent>
                    {linkTypeOptions(level).map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showUrl && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">URL</Label>
                <Input
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
            )}

            {showPdf && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">PDF File</Label>
                {existingPdf && !pdf && (
                  <a href={mediaUrl(existingPdf)} target="_blank" rel="noopener noreferrer" className="text-xs text-ink hover:underline block">
                    {existingPdf.split("/").pop()}
                  </a>
                )}
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setPdf(e.target.files?.[0] || null)}
                  className="border-slate-200 bg-white"
                />
                <p className="text-xs text-slate-500">Allowed: PDF only</p>
              </div>
            )}

            {level === 1 && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">YouTube Video Link</Label>
                <Input
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
            )}

            {level >= 2 && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Button Text</Label>
                <Input
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  placeholder="e.g. Read More"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Sort Order</Label>
              <Input
                type="number"
                min={0}
                className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20 max-w-[160px]"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label className="text-slate-700 text-sm font-medium">Active</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={goBack}
                disabled={saving}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update
              </Button>
            </div>
          </div>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
