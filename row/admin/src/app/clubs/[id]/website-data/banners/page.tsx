"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { ClubBanner } from "@/types/banner";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getClubBanners,
  createClubBanner,
  updateClubBanner,
  deleteClubBanner,
  uploadBannerImage,
  uploadBannerDocument,
  reorderClubBannersAll,
  getRotaryYears,
  getClubBannerAvailableYears,
  getClub,
  getPhotoUrl,
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

export default function BannerPhotosPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [banners, setBanners] = useState<ClubBanner[]>([]);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  // Listing year filter is data-only (years that actually have banners); popup uses allYears.
  const [dataYears, setDataYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingBanners, setLoadingBanners] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<ClubBanner | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formImagePath, setFormImagePath] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDocumentPath, setFormDocumentPath] = useState<string | undefined>(undefined);
  const [formDocumentName, setFormDocumentName] = useState("");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");
  const [formYearId, setFormYearId] = useState<string>("");

  // Image crop state
  const bannerCrop = useImageCropUpload();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<ClubBanner | null>(null);

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

  // Initial load
  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const [clubData, years, dyears] = await Promise.all([
          getClub(clubId),
          getRotaryYears(),
          getClubBannerAvailableYears(clubId),
        ]);
        setClubName(clubData.clubName);
        setAllYears(years);
        setDataYears(dyears);
        // Default to the current year if it has data, else the newest year that has data.
        const cy = dyears.find((y) => y.isCurrent) || dyears[0];
        if (cy) setSelectedYearId(String(cy.id));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
  }, [clubId]);

  // Fetch banners when year changes
  const fetchBanners = useCallback(async (yearId: number) => {
    setLoadingBanners(true);
    try {
      const data = await getClubBanners(clubId, yearId);
      setBanners(data);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load banners.");
    } finally {
      setLoadingBanners(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (selectedYearId) {
      fetchBanners(Number(selectedYearId));
    } else {
      setBanners([]);
    }
  }, [selectedYearId, fetchBanners]);

  // After add/delete, refresh the data-only year list and keep a sensible selection.
  const reconcileDataYears = useCallback(async (preferYearId?: number) => {
    let dy: { id: number; yearLabel: string; isCurrent: boolean }[] = [];
    try { dy = await getClubBannerAvailableYears(clubId); } catch { return; }
    setDataYears(dy);
    if (preferYearId && dy.find((y) => y.id === preferYearId)) { setSelectedYearId(String(preferYearId)); fetchBanners(preferYearId); return; }
    if (dy.find((y) => String(y.id) === selectedYearId)) { fetchBanners(Number(selectedYearId)); return; }
    const cy = dy.find((y) => y.isCurrent) || dy[0];
    if (cy) setSelectedYearId(String(cy.id)); else { setSelectedYearId(""); setBanners([]); }
  }, [clubId, selectedYearId, fetchBanners]);

  const { dragProps } = useDragSort(banners, setBanners, async (ids) => {
    try { await reorderClubBannersAll(clubId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchBanners(Number(selectedYearId)); }
  });

  const currentYearId = allYears.find((y) => y.isCurrent)?.id;

  const openAddDialog = () => {
    setEditingBanner(null);
    setFormImagePath("");
    setFormDescription("");
    setFormDocumentPath(undefined);
    setFormDocumentName("");
    setFormLinkUrl("");
    setFormIsActive("1");
    // Default the popup year to the selected (data) year, else the current rotary year.
    setFormYearId(selectedYearId || (currentYearId ? String(currentYearId) : (allYears[0] ? String(allYears[0].id) : "")));
    setDialogOpen(true);
  };

  const openEditDialog = (banner: ClubBanner) => {
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
      const { path, url } = await uploadBannerImage(clubId, file);
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

    // Check active limit when creating or activating
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
        await updateClubBanner(clubId, editingBanner.id, {
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
        await createClubBanner(clubId, {
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
      if (editingBanner) {
        fetchBanners(Number(selectedYearId));
      } else {
        // A new banner may have created the first data for its year — refresh + jump to it.
        await reconcileDataYears(Number(formYearId));
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save banner.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteClubBanner(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Banner deleted successfully.");
      // Deleting the last banner of a year removes it from the data-only filter.
      await reconcileDataYears();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete banner.");
    }
  };

  const handleToggleActive = async (banner: ClubBanner) => {
    if (!banner.isActive && activeCount >= maxActive) {
      setErrorMessage(`Maximum ${maxActive} active banners allowed per year.`);
      return;
    }
    try {
      await updateClubBanner(clubId, banner.id, {
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
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Banner Photos` : "Banner Photos"}
              </h2>
              <p className="text-muted-foreground text-base">Manage club website banner photos by year</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddDialog} disabled={allYears.length === 0}>
              <Plus className="mr-2 h-4 w-4" />Add Banner
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Year filter (data-only: years that have banners) + active count */}
        {!loading && dataYears.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-48">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {dataYears.map((y) => (
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

        {/* Empty state */}
        {!loading && !loadingBanners && selectedYearId && banners.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No banners yet</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? 'Click "Add Banner" to upload your first banner photo.' : "No banners have been added yet."}
            </p>
          </div>
        )}

        {/* Banner list */}
        {!loading && !loadingBanners && banners.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search banners..."
            />
            {filteredBanners.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            {/* Mobile card view */}
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
                                {banner.isActive ? (
                                  <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                                ) : (
                                  <><Eye className="mr-2 h-4 w-4" />Activate</>
                                )}
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

            {/* Desktop table view */}
            <div className="hidden sm:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-24 text-primary-foreground">Thumbnail</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Description</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold">Status</TableHead>
                    {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
                    {canManage && <TableHead className="w-20 text-primary-foreground text-base font-semibold text-center">Sorting</TableHead>}
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
                                  {banner.isActive ? (
                                    <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                                  ) : (
                                    <><Eye className="mr-2 h-4 w-4" />Activate</>
                                  )}
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

        {/* Add/Edit Banner Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingBanner ? "Edit Banner" : "Add Banner"}</DialogTitle>
              <DialogDescription>
                {editingBanner ? "Update the banner details." : "Upload an image and fill in the details."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Banner Image */}
              <div className="space-y-2">
                <Label>Banner Image *</Label>
                {formImagePath ? (
                  <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted">
                    <Image src={getPhotoUrl(formImagePath)} alt="Banner preview" fill className="object-cover" unoptimized />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7"
                      onClick={() => setFormImagePath("")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) bannerCrop.startCrop(f); e.target.value = ""; }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-24 border-dashed"
                      onClick={() => fileInputRef.current?.click()}
                    >
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

              {/* Document or Link (optional) */}
              <div className="space-y-2">
                <Label>Document or Link (optional)</Label>
                <DocumentOrLinkField
                  value={{ documentPath: formDocumentPath, documentName: formDocumentName, linkUrl: formLinkUrl }}
                  onChange={(v) => { setFormDocumentPath(v.documentPath); setFormDocumentName(v.documentName); setFormLinkUrl(v.linkUrl); }}
                  uploadDocument={async (f) => (await uploadBannerDocument(clubId, f)).path}
                  onError={setErrorMessage}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Description <span className="text-muted-foreground text-xs">(max 500 chars)</span></Label>
                <Textarea
                  placeholder="Optional description for this banner"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value.slice(0, 500))}
                  rows={2}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">{formDescription.length}/500</p>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Rotary Year — only in Add mode */}
              {!editingBanner && (
                <div className="space-y-2">
                  <Label>Rotary Year</Label>
                  <Select value={formYearId} onValueChange={setFormYearId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a year" />
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
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !formImagePath}>
                {saving ? "Saving..." : editingBanner ? "Update" : "Add"}
              </Button>
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

        {/* Delete confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Banner"
          description={
            <>
              Are you sure you want to delete this banner
              {deleteTarget?.description ? (
                <> &mdash; <span className="font-semibold text-foreground">{deleteTarget.description}</span></>
              ) : null}
              ? This action cannot be undone.
            </>
          }
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
