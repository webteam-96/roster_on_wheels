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

import { Card } from "@/components/ui/card";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { WeblinkTree } from "@/types/weblink";
import { createDistrictWeblink, getDistrictWeblinkTree } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYearless } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
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
import { Loader2 } from "@/components/icons";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

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
  const { selectedDistrictId, isSuperAdmin, isAdmin, user } = useAuth();
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

  // Web links carry NO Rotary year — one live set — so adding one needs
  // CURRENT-year rights, the same rule as the listing. Nothing here is worth
  // reading, so someone without those rights goes straight back rather than
  // filling in a form the server would refuse.
  //
  // ⚠️ Waits for dCurrentYearId. Until the years arrive it is undefined, which
  // reads as "cannot edit" — bouncing on that would throw out an admin who is
  // entitled to be here, on nothing more than a slow request.
  const { currentYearId: dCurrentYearId } = useRotaryYears();
  const rights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYearless(rights, dCurrentYearId, isSuperAdmin);
  const backTo = returnTo || listingFallback;
  useEffect(() => {
    if (dCurrentYearId !== undefined && !canManage) router.replace(backTo);
  }, [canManage, dCurrentYearId, backTo, router]);

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
  // The effect above is already sending them back; don't flash the form first.
  if (dCurrentYearId !== undefined && !canManage) return null;

  const showLinkTypeSelect = level <= 2;
  const showUrl = linkType === "URL" || level === 3;
  const showPdf = linkType === "PDF" && level <= 2;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl">
        {/* ── Header ────────────────────────────────────────────────── */}
        <PageHeader title="Add Web Link" description={<>Level {level}</>} back={() => goBack()} />

        {loading ? (
          <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>
        ) : (
          <Card className="p-5 space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-700 text-sm font-medium">Title *</Label>
              <Input
               
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
                className="border-slate-200 bg-card"
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
                  className="border-slate-200 bg-card"
                />
                <p className="text-xs text-slate-500">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
              </div>
            )}

            {showLinkTypeSelect && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Link Type</Label>
                <Select value={linkType} onValueChange={setLinkType}>
                  <SelectTrigger>
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
                  className="border-slate-200 bg-card"
                />
                <p className="text-xs text-slate-500">Allowed: PDF only</p>
              </div>
            )}

            {level === 1 && (
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">YouTube Video Link</Label>
                <Input
                 
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
                className="max-w-[160px]"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Switch id="webLinkActive" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="webLinkActive" className="text-slate-700 text-sm font-medium">Active</Label>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={goBack}
                disabled={saving}
               
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
               
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </Card>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
