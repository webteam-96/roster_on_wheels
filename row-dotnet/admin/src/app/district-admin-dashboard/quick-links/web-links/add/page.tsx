"use client";

/**
 * V2 — Add Web Link (District Admin dashboard shell).
 * ---------------------------------------------------------------------------
 * Page form (V1 used an inline dialog). Field set mirrors the V1 dialog and is
 * level-driven exactly like V1:
 *   - level = parent.level + 1 (root add = level 1), resolved from the tree via
 *     ?parentId=.
 *   - Link Type options: L1 None/Page/URL/PDF, L2 URL/PDF, L3 URL-only.
 *   - Banner + YouTube only at L1; Button Text at L2+; PDF upload when type=PDF
 *     and level<=2; URL input when type=URL or level 3.
 * Save/Cancel/Back honour ?returnTo=, else fall back to the listing (preserving
 * parentId + yearId). Web Links are NOT year-wise — yearId is only forwarded.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { WeblinkTree } from "@/types/weblink";
import { createDistrictWeblink, getDistrictWeblinkTree } from "@/services/api";
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
import { ArrowLeft, Loader2, Link2 } from "lucide-react";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";

const WEB_LINKS_BASE = "/district-admin-dashboard/quick-links/web-links";
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

export default function AddWebLinkPage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");
  const parentIdParam = searchParams.get("parentId");
  const parentId = parentIdParam ? Number(parentIdParam) : null;

  const listingFallback = withSearch(WEB_LINKS_BASE, { parentId: parentIdParam, yearId });

  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState(1);
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

  const resolveLevel = useCallback(async () => {
    if (!districtId) { setLoading(false); return; }
    if (!parentId) { setLevel(1); setLinkType("None"); setLoading(false); return; }
    try {
      const tree = await getDistrictWeblinkTree(districtId);
      const parent = findNode(tree, parentId);
      const lvl = parent ? parent.level + 1 : 1;
      setLevel(lvl);
      setLinkType(lvl >= 2 ? "URL" : "None");
    } catch {
      setLevel(1);
      setLinkType("None");
    } finally { setLoading(false); }
  }, [districtId, parentId]);

  useEffect(() => { resolveLevel(); }, [resolveLevel]);

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
      if (parentId !== null) fd.append("parentId", String(parentId));
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
      await createDistrictWeblink(districtId, fd);
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f]">
              <Link2 size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-800 leading-tight">Add Web Link</h1>
              <p className="text-xs text-slate-500 mt-0.5">Level {level}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : (
          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Title *</Label>
              <Input
                className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
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
              {logoPreviewUrl && (
                <img
                  src={logoPreviewUrl}
                  alt="Logo preview"
                  className="h-20 w-20 rounded object-cover border border-slate-200"
                />
              )}
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
                {bannerPreviewUrl && (
                  <img
                    src={bannerPreviewUrl}
                    alt="Banner preview"
                    className="h-24 w-full max-w-md rounded object-cover border border-slate-200"
                  />
                )}
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
                  <SelectTrigger className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20">
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
                  className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
            )}

            {showPdf && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">PDF File</Label>
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
                  className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
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
                  className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
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
                className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20 max-w-[160px]"
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
                className="bg-[#1e3a5f] hover:bg-[#152a44] text-white"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
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
