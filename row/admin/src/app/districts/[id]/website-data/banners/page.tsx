"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
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
  AlertTriangle, Upload, X, Eye, EyeOff, GripVertical,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import ImageCropDialog from "@/components/ImageCropDialog";
import DocumentOrLinkField from "@/components/website-data/DocumentOrLinkField";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";
import { ListPageSkeleton } from "@/components/row/AppKit";

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

export default function DistrictBannerPhotosPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

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
    async function fetchInitial() {
      setLoading(true);
      try {
        const [districtData, allYrs, available] = await Promise.all([
          getDistrict(districtId), getRotaryYears(), getDistrictBannerAvailableYears(districtId),
        ]);
        setDistrictNumber(districtData.districtNumber);
        setAllRotaryYears(allYrs);
        const years = available.length > 0 ? available : (allYrs.find((y: any) => y.isCurrent) ? [allYrs.find((y: any) => y.isCurrent)] : []);
        setAllYears(years);
        const currentYear = years.find((y: any) => y.isCurrent);
        const defaultYear = currentYear || years[0];
        if (defaultYear) setSelectedYearId(String(defaultYear.id));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
  }, [districtId]);

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

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtNumber ? `District ${districtNumber} - Banner Photos` : "Banner Photos"}
              </h2>
              <p className="text-muted-foreground text-base">Manage district website banner photos by year</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddDialog} disabled={!selectedYearId}>
              <Plus className="mr-2 h-4 w-4" />Add Banner
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && allYears.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-48">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {allYears.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedYearId && !loadingBanners && (
              <Badge variant={activeCount >= maxActive ? "destructive" : "secondary"}>
                {activeCount}/{maxActive} Active
              </Badge>
            )}
          </div>
        )}

        {loadingBanners && (
          <div className="flex items-center justify-center py-12">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && !loadingBanners && selectedYearId && banners.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No banners yet</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? 'Click "Add Banner" to upload your first banner photo.' : "No banners have been added yet."}
            </p>
          </div>
        )}

        {!loading && !loadingBanners && banners.length > 0 && (
          <>
            <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search banners..." />
            {filteredBanners.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            <div className="block sm:hidden space-y-3">
              {filteredBanners.map((banner, idx) => {
                const photoUrl = getPhotoUrl(banner.bannerImagePath);
                return (
                  <Card key={banner.id} className="border-primary/20 relative">
                    {canManage && !isSearching && (
                      <div
                        {...dragProps(idx)}
                        className="absolute top-2 left-2 z-10 bg-background rounded p-1 text-muted-foreground"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-4 w-4 cursor-grab" />
                      </div>
                    )}
                    <CardContent className="p-4 space-y-3">
                      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
                        {photoUrl ? (
                          <Image src={photoUrl} alt={banner.description || "Banner"} fill className="object-cover" unoptimized />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                            <ImageIcon className="h-8 w-8" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-muted-foreground truncate">{banner.description || "No description"}</p>
                          <Badge variant={banner.isActive ? "default" : "secondary"} className="mt-1">
                            {banner.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
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

            <div className="hidden sm:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-24">Thumbnail</TableHead>
                    <TableHead className="text-base font-semibold">Description</TableHead>
                    <TableHead className="w-24 text-base font-semibold">Status</TableHead>
                    {canManage && <TableHead className="w-12"></TableHead>}
                    {canManage && <TableHead className="w-20 text-base font-semibold text-center">Sorting</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBanners.map((banner, idx) => {
                    const photoUrl = getPhotoUrl(banner.bannerImagePath);
                    return (
                      <TableRow key={banner.id} className="hover:bg-primary/5 transition-colors">
                        <TableCell>
                          <div className="relative h-[45px] w-[80px] overflow-hidden rounded bg-muted">
                            {photoUrl ? (
                              <Image src={photoUrl} alt={banner.description || "Banner"} fill className="object-cover" unoptimized />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                                <ImageIcon className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{banner.description || "No description"}</TableCell>
                        <TableCell>
                          <Badge variant={banner.isActive ? "default" : "secondary"}>
                            {banner.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
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
                              <div {...dragProps(idx)} className="flex items-center justify-center text-muted-foreground" title="Drag to reorder">
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

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingBanner ? "Edit Banner" : "Add Banner"}</DialogTitle>
              <DialogDescription>{editingBanner ? "Update the banner details." : "Upload an image and fill in the details."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Banner Image *</Label>
                {formImagePath ? (
                  <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted">
                    <Image src={getPhotoUrl(formImagePath)} alt="Banner preview" fill className="object-cover" unoptimized />
                    <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={() => setFormImagePath("")}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) bannerCrop.startCrop(f); e.target.value = ""; }} />
                    <Button type="button" variant="outline" className="w-full h-24 border-dashed" onClick={() => fileInputRef.current?.click()}>
                      <div className="flex flex-col items-center gap-1">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Click to upload image</span>
                      </div>
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                    {bannerCrop.error && <p className="text-xs text-destructive mt-1.5">{bannerCrop.error}</p>}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Document or Link (optional)</Label>
                <DocumentOrLinkField
                  value={{ documentPath: formDocumentPath, documentName: formDocumentName, linkUrl: formLinkUrl }}
                  onChange={(v) => { setFormDocumentPath(v.documentPath); setFormDocumentName(v.documentName); setFormLinkUrl(v.linkUrl); }}
                  uploadDocument={async (f) => (await uploadDistrictBannerDocument(districtId, f)).path}
                  onError={setErrorMessage}
                />
              </div>
              <div className="space-y-2">
                <Label>Description <span className="text-muted-foreground text-xs">(max 500 chars)</span></Label>
                <Textarea placeholder="Optional description" value={formDescription} onChange={(e) => setFormDescription(e.target.value.slice(0, 500))} rows={2} maxLength={500} />
                <p className="text-xs text-muted-foreground text-right">{formDescription.length}/500</p>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!editingBanner && (
                <div className="space-y-2">
                  <Label>Rotary Year</Label>
                  <Select value={formYearId} onValueChange={setFormYearId}>
                    <SelectTrigger><SelectValue placeholder="Select a year" /></SelectTrigger>
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
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !formImagePath}>{saving ? "Saving..." : editingBanner ? "Update" : "Add"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
