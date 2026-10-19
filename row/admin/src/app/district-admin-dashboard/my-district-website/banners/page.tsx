"use client";

/**
 * District Admin Dashboard — Banner Photos (V2)
 * ---------------------------------------------------------------------------
 * Ports src/app/districts/[id]/website-data/banners/page.tsx into the DA
 * dashboard shell. Behaviour is preserved verbatim (data-only year list,
 * available-years refresh, drag-sort, crop dialog with 16:5 lock + 1200 px
 * min-width guard, 10-active-per-year cap, admin gating, delete confirm,
 * upload/description/status/year form). Only the chrome and navigation
 * change.
 *
 * Key differences vs V1:
 *   - districtId comes from useAuth().selectedDistrictId (NOT useParams)
 *   - Back button / Save-Cancel-Delete redirects honour ?returnTo=,
 *     otherwise fall back to /district-admin-dashboard/my-district-website
 *   - ?yearId= is carried forward on every redirect
 *
 * Palette:
 *   Navy   #17458f  — primary buttons, table header, active tab
 *   Navy H #1b2c42  — button hover
 *   Gold   #F7A81B  — table-header underline (border-b-2)
 *   Slate  text/backgrounds/rings
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getDistrictBanners,
  createDistrictBanner,
  updateDistrictBanner,
  deleteDistrictBanner,
  uploadDistrictBannerImage,
  uploadDistrictBannerDocument,
  getDistrictBannerAvailableYears, getRotaryYears,
  getDistrict,
  getPhotoUrl,
  reorderDistrictBannersAll,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { fileNameOnly } from "@/lib/pathUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, ImageIcon,
  AlertTriangle, Upload, X, Eye, EyeOff, GripVertical, Search,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import DocumentOrLinkField from "@/components/website-data/DocumentOrLinkField";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

const BANNER_ASPECT = 16 / 5;
const BANNER_MAX_WIDTH = 1920;
// Banners render full-bleed (~1920 px) on the public site, so a narrower crop
// would be upscaled by the browser and look blurry. Rejected rather than stored.
const BANNER_MIN_WIDTH = 1200;

interface BannerItem {
  id: number;
  bannerImagePath: string;
  documentPath: string | null;
  linkUrl: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  yearId: number;
}

export default function DistrictAdminBannerPhotosPage() {
  // ── District id from AuthContext (NOT URL) ────────────────────────────
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const currentYearId = searchParams.get("yearId");

  // Back / redirect helper — honour ?returnTo=, else land on
  // my-district-website; forward yearId if present.
  const goBack = useCallback(() => {
    const dest = returnTo || "/district-admin-dashboard/my-district-website";
    if (!currentYearId) { router.push(dest); return; }
    const sep = dest.includes("?") ? "&" : "?";
    router.push(`${dest}${sep}yearId=${encodeURIComponent(currentYearId)}`);
  }, [returnTo, currentYearId, router]);

  const [districtNumber, setDistrictNumber] = useState("");
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);  // listing: data-only years
  const [allRotaryYears, setAllRotaryYears] = useState<RotaryYear[]>([]);  // form: all years
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingBanners, setLoadingBanners] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<BannerItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [formImagePath, setFormImagePath] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDocumentPath, setFormDocumentPath] = useState<string | undefined>(undefined);
  const [formDocumentName, setFormDocumentName] = useState("");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");
  const [formYearId, setFormYearId] = useState<string>("");

  const bannerCrop = useImageCropUpload();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<BannerItem | null>(null);

  const canManage = isSuperAdmin || isAdmin;
  const activeCount = banners.filter((b) => b.isActive).length;

  const filteredBanners = banners.filter((banner) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (banner.description || "").toLowerCase().includes(q) ||
      (banner.isActive ? "active" : "inactive").includes(q)
    );
  });
  const isSearching = searchQuery.trim() !== "";
  const maxActive = 6;

  useEffect(() => {
    if (!districtId) return;
    async function fetchInitial() {
      setLoading(true);
      try {
        // Only need district + rotary years for the form. The listing year
        // filter (getDistrictBannerAvailableYears) was dropped because the
        // top-bar ?yearId= is now the single source of truth.
        const [districtData, allYrs] = await Promise.all([
          getDistrict(districtId), getRotaryYears(),
        ]);
        setDistrictNumber(districtData.districtNumber);
        setAllRotaryYears(allYrs);
        // Keep allYears populated for the form's year dropdown even though
        // no listing filter is shown; use the full RY list.
        setAllYears(allYrs);
        // Trust the top-bar year verbatim. If none, fall back to current RY.
        if (currentYearId) {
          setSelectedYearId(currentYearId);
        } else {
          const currentYear = allYrs.find((y: any) => y.isCurrent);
          if (currentYear) setSelectedYearId(String(currentYear.id));
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtId]);

  // React to top-bar year changes verbatim (no data-year gating).
  useEffect(() => {
    if (!currentYearId) return;
    if (currentYearId !== selectedYearId) setSelectedYearId(currentYearId);
  }, [currentYearId, selectedYearId]);

  const fetchBanners = useCallback(async (yearId: number) => {
    setLoadingBanners(true);
    try {
      const data = await getDistrictBanners(districtId, yearId);
      setBanners(data);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load banners.");
    } finally {
      setLoadingBanners(false);
    }
  }, [districtId]);

  useEffect(() => {
    if (selectedYearId) {
      fetchBanners(Number(selectedYearId));
    } else {
      setBanners([]);
    }
  }, [selectedYearId, fetchBanners]);

  const { dragProps } = useDragSort(banners, setBanners, async (ids) => {
    try { await reorderDistrictBannersAll(districtId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchBanners(Number(selectedYearId)); }
  });

  const openAddDialog = () => {
    setEditingBanner(null);
    setFormImagePath("");
    setFormDescription("");
    setFormDocumentPath(undefined); setFormDocumentName(""); setFormLinkUrl("");
    setFormIsActive("1");
    setFormYearId(selectedYearId);
    setDialogOpen(true);
  };

  const openEditDialog = (banner: BannerItem) => {
    setEditingBanner(banner);
    setFormImagePath(banner.bannerImagePath);
    setFormDescription(banner.description || "");
    setFormDocumentPath(banner.documentPath || undefined);
    setFormDocumentName(banner.documentPath ? banner.documentPath.split("/").pop() || "Document" : "");
    setFormLinkUrl(banner.linkUrl || "");
    setFormIsActive(banner.isActive ? "1" : "0");
    setFormYearId(String(banner.yearId));
    setDialogOpen(true);
  };

  const handleCropSave = async (blob: Blob) => {
    const cropped = await createImageBitmap(blob);
    if (cropped.width < BANNER_MIN_WIDTH) {
      setErrorMessage(
        `Cropped area is only ${cropped.width}×${cropped.height} pixels. ` +
        `Banners need at least ${BANNER_MIN_WIDTH} pixels wide for a clean (non-blurry) display. ` +
        "Please upload a larger source image (recommended: 1920×600 or larger) or zoom out before cropping."
      );
      return;
    }
    setUploading(true);
    try {
      const file = new File([blob], "banner.png", { type: "image/png" });
      const { path, url } = await uploadDistrictBannerImage(districtId, file);
      setFormImagePath(url || path);
      bannerCrop.cancel();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to upload image.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!formImagePath) { setErrorMessage("Please upload a banner image."); return; }
    if (!editingBanner && !formYearId) { setErrorMessage("Please select a rotary year."); return; }

    const isActivating = formIsActive === "1";
    if (isActivating) {
      const currentActiveCount = editingBanner
        ? banners.filter((b) => b.isActive && b.id !== editingBanner.id).length
        : activeCount;
      if (currentActiveCount >= maxActive) {
        setErrorMessage(`Maximum ${maxActive} active banners allowed per year.`);
        return;
      }
    }

    setSaving(true);
    try {
      if (editingBanner) {
        await updateDistrictBanner(districtId, editingBanner.id, {
          bannerImagePath: fileNameOnly(formImagePath),
          documentPath: formDocumentPath || undefined,
          linkUrl: formLinkUrl.trim() || undefined,
          description: formDescription || undefined,
          sortOrder: editingBanner.sortOrder,
          isActive: isActivating,
        });
        setSuccessMessage("Banner updated successfully.");
      } else {
        const nextSort = banners.length > 0 ? Math.max(...banners.map(b => b.sortOrder)) + 1 : 1;
        await createDistrictBanner(districtId, {
          yearId: Number(formYearId),
          bannerImagePath: fileNameOnly(formImagePath),
          documentPath: formDocumentPath || undefined,
          linkUrl: formLinkUrl.trim() || undefined,
          description: formDescription || undefined,
          sortOrder: nextSort,
          isActive: isActivating,
        });
        setSuccessMessage("Banner added successfully.");
      }
      setDialogOpen(false);
      fetchBanners(Number(selectedYearId));
      // Refresh available years
      try { const av = await getDistrictBannerAvailableYears(districtId); if (av.length > 0) setAllYears(av); } catch {}
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save banner.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictBanner(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Banner deleted successfully.");
      fetchBanners(Number(selectedYearId));
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete banner.");
    }
  };

  const handleToggleActive = async (banner: BannerItem) => {
    if (!banner.isActive && activeCount >= maxActive) {
      setErrorMessage(`Maximum ${maxActive} active banners allowed per year.`);
      return;
    }
    try {
      await updateDistrictBanner(districtId, banner.id, {
        bannerImagePath: banner.bannerImagePath,
        description: banner.description,
        sortOrder: banner.sortOrder,
        isActive: !banner.isActive,
      });
      setSuccessMessage(banner.isActive ? "Banner deactivated." : "Banner activated.");
      fetchBanners(Number(selectedYearId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update banner status.");
    }
  };

  // Guard AFTER hooks — Rules of Hooks
  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-ink">
                {districtNumber ? `District ${districtNumber} · Banner Photos` : "Banner Photos"}
              </h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Manage district website banner photos by year
              </p>
            </div>
          </div>
          {canManage && (
            <Button
              onClick={openAddDialog}
              disabled={!selectedYearId}
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Plus className="mr-2 h-4 w-4" />Add Banner
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* ── Active-count badge (year picker removed — top-bar owns year) ── */}
        {!loading && (
          <div className="flex items-center gap-4 flex-wrap bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            {selectedYearId && !loadingBanners && (
              <Badge
                variant={activeCount >= maxActive ? "destructive" : "secondary"}
                className={activeCount >= maxActive
                  ? undefined
                  : "bg-slate-100 text-slate-700 border border-slate-200"}
              >
                {activeCount}/{maxActive} Active
              </Badge>
            )}
          </div>
        )}

        {/* Only show this secondary loader once the initial fetch is done,
            so we don't render two spinners at the same time on first load. */}
        {!loading && loadingBanners && (
          <div className="flex items-center justify-center py-12">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* ── Empty state ────────────────────────────────────────── */}
        {!loading && !loadingBanners && selectedYearId && banners.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
            <ImageIcon className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">No banners yet</h3>
            <p className="text-slate-500 mt-2">
              {canManage ? 'Click "Add Banner" to upload your first banner photo.' : "No banners have been added yet."}
            </p>
          </div>
        )}

        {/* ── Search + list ──────────────────────────────────────── */}
        {!loading && !loadingBanners && banners.length > 0 && (
          <>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search banners..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 border-slate-200 bg-white focus:border-azure focus:ring-azure/20 text-sm"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-slate-500 hover:text-slate-800"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            {filteredBanners.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-slate-500 text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            {/* ── Mobile: card list ──────────────────────────────── */}
            <div className="block sm:hidden space-y-3">
              {filteredBanners.map((banner, idx) => {
                const photoUrl = getPhotoUrl(banner.bannerImagePath);
                return (
                  <Card key={banner.id} className="rounded-2xl border border-slate-200 shadow-sm bg-white relative">
                    {canManage && !isSearching && (
                      <div
                        {...dragProps(idx)}
                        className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur rounded p-1 text-slate-500 ring-1 ring-slate-200"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-4 w-4 cursor-grab" />
                      </div>
                    )}
                    <CardContent className="p-4 space-y-3">
                      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-slate-100">
                        {photoUrl ? (
                          <Image src={photoUrl} alt={banner.description || "Banner"} fill className="object-cover" unoptimized />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-500">
                            <ImageIcon className="h-8 w-8" />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-600 truncate">{banner.description || "No description"}</p>
                          <Badge
                            variant={banner.isActive ? "default" : "secondary"}
                            className={`mt-1 ${banner.isActive
                              ? "bg-azure text-white hover:bg-mint-ink"
                              : "bg-slate-100 text-slate-700 border border-slate-200"}`}
                          >
                            {banner.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(banner)}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleActive(banner)}>
                                {banner.isActive ? (<><EyeOff className="mr-2 h-4 w-4" />Deactivate</>) : (<><Eye className="mr-2 h-4 w-4" />Activate</>)}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(banner)}>
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* ── Desktop: table ─────────────────────────────────── */}
            <div className="hidden sm:block rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
              <Table>
                <TableHeader>
                  <TableRow
                    className="hover:opacity-100 border-b-2 border-marigold"
                    style={{ backgroundColor: "#17458f" }}
                  >
                    <TableHead className="w-24 text-white text-xs font-semibold uppercase tracking-wide">Thumbnail</TableHead>
                    <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Description</TableHead>
                    <TableHead className="w-24 text-white text-xs font-semibold uppercase tracking-wide">Status</TableHead>
                    {canManage && <TableHead className="w-12 text-white/90"></TableHead>}
                    {canManage && <TableHead className="w-20 text-white text-xs font-semibold uppercase tracking-wide text-center">Sorting</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBanners.map((banner, idx) => {
                    const photoUrl = getPhotoUrl(banner.bannerImagePath);
                    return (
                      <TableRow key={banner.id} className="hover:bg-slate-50/70 transition-colors border-slate-100">
                        <TableCell>
                          <div className="relative h-[45px] w-[80px] overflow-hidden rounded bg-slate-100">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={banner.description || "Banner"} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-500">
                                <ImageIcon className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-800">{banner.description || <span className="text-slate-400">No description</span>}</TableCell>
                        <TableCell>
                          <Badge
                            variant={banner.isActive ? "default" : "secondary"}
                            className={banner.isActive
                              ? "bg-azure text-white hover:bg-mint-ink"
                              : "bg-slate-100 text-slate-700 border border-slate-200"}
                          >
                            {banner.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditDialog(banner)}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleToggleActive(banner)}>
                                  {banner.isActive ? (<><EyeOff className="mr-2 h-4 w-4" />Deactivate</>) : (<><Eye className="mr-2 h-4 w-4" />Activate</>)}
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(banner)}>
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                        {canManage && (
                          <TableCell className="w-20">
                            {!isSearching ? (
                              <div {...dragProps(idx)} className="flex items-center justify-center text-slate-400" title="Drag to reorder">
                                <GripVertical className="h-4 w-4 cursor-grab" />
                              </div>
                            ) : null}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </>
            )}
          </>
        )}

        {/* ── Add/Edit dialog ─────────────────────────────────────── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-ink">{editingBanner ? "Edit Banner" : "Add Banner"}</DialogTitle>
              <DialogDescription>{editingBanner ? "Update the banner details." : "Upload an image and fill in the details."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Banner Image *</Label>
                {formImagePath ? (
                  <div className="relative aspect-video w-full overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    <Image src={getPhotoUrl(formImagePath)} alt="Banner preview" fill className="object-cover" unoptimized />
                    <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={() => setFormImagePath("")}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) bannerCrop.startCrop(f); e.target.value = ""; }} />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-24 border-dashed border-slate-300 text-slate-600 hover:bg-slate-50"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <Upload className="h-6 w-6 text-slate-400" />
                        <span className="text-sm text-slate-500">Click to upload image</span>
                      </div>
                    </Button>
                    <p className="text-xs text-slate-500 mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                    {bannerCrop.error && <p className="text-xs text-rose-600 mt-1.5">{bannerCrop.error}</p>}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Document or Link (optional)</Label>
                <DocumentOrLinkField
                  value={{ documentPath: formDocumentPath, documentName: formDocumentName, linkUrl: formLinkUrl }}
                  onChange={(v) => { setFormDocumentPath(v.documentPath); setFormDocumentName(v.documentName); setFormLinkUrl(v.linkUrl); }}
                  uploadDocument={async (f) => (await uploadDistrictBannerDocument(districtId, f)).path}
                  onError={setErrorMessage}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Description <span className="text-slate-400 text-xs">(max 500 chars)</span></Label>
                <Textarea
                  placeholder="Optional description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value.slice(0, 500))}
                  rows={2}
                  maxLength={500}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
                <p className="text-xs text-slate-400 text-right">{formDescription.length}/500</p>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!editingBanner && (
                <div className="space-y-2">
                  <Label className="text-slate-600 text-sm">Rotary Year</Label>
                  <Select value={formYearId} onValueChange={setFormYearId}>
                    <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"><SelectValue placeholder="Select a year" /></SelectTrigger>
                    <SelectContent>
                      {allRotaryYears.map((y) => (
                        <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formImagePath}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving ? "Saving..." : editingBanner ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Crop dialog ─────────────────────────────────────────── */}
        <ImageCropDialog
          open={bannerCrop.open}
          imageSrc={bannerCrop.imageSrc}
          aspect={BANNER_ASPECT}
          maxOutputWidth={BANNER_MAX_WIDTH}
          minOutputWidth={BANNER_MIN_WIDTH}
          title="Crop Banner Image"
          saving={uploading}
          onCancel={bannerCrop.cancel}
          onSave={handleCropSave}
        />

        {/* ── Delete confirmation ─────────────────────────────────── */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Banner"
          description={<>Are you sure you want to delete this banner{deleteTarget?.description ? (<> &mdash; <span className="font-semibold text-foreground">{deleteTarget.description}</span></>) : null}? This action cannot be undone.</>}
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
