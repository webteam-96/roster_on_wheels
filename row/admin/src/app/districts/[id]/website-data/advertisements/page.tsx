"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getDistrictAdvertisements,
  createDistrictAdvertisement,
  updateDistrictAdvertisement,
  deleteDistrictAdvertisement,
  uploadDistrictAdvertisementImage,
  uploadDistrictAdvertisementDocument,
  reorderDistrictAdvertisementsAll,
  getDistrictAdAvailableYears, getRotaryYears,
  getDistrict,
  getPhotoUrl,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { fileNameOnly } from "@/lib/pathUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
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
  AlertTriangle, Upload, X, Eye, EyeOff, FileText, ExternalLink, GripVertical,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import ImageCropDialog from "@/components/ImageCropDialog";
import DocumentOrLinkField from "@/components/website-data/DocumentOrLinkField";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

// Ads are sponsor posters/flyers in many shapes, so the crop stays FREE-FORM
// (no locked aspect). Matches the upload validator's own 2560 px compression
// ceiling, so this never shrinks a realistic source.
const AD_MAX_WIDTH = 2560;

interface AdvertisementItem {
  id: number;
  advertisementImagePath: string;
  documentPath: string | null;
  linkUrl: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  yearId: number;
}

export default function DistrictAdvertisementsPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtNumber, setDistrictNumber] = useState("");
  const [advertisements, setAdvertisements] = useState<AdvertisementItem[]>([]);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [allRotaryYears, setAllRotaryYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingAds, setLoadingAds] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<AdvertisementItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [formImagePath, setFormImagePath] = useState("");
  const [formDocumentPath, setFormDocumentPath] = useState<string | undefined>(undefined);
  const [formDocumentName, setFormDocumentName] = useState("");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");
  const [formYearId, setFormYearId] = useState<string>("");

  const adCrop = useImageCropUpload();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdvertisementItem | null>(null);

  const canManage = isSuperAdmin || isAdmin;
  const activeCount = advertisements.filter((a) => a.isActive).length;
  const filteredAdvertisements = advertisements.filter((ad) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (ad.description || "").toLowerCase().includes(q) || (ad.isActive ? "active" : "inactive").includes(q);
  });
  const isSearching = searchQuery.trim() !== "";
  const maxActive = 10;

  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const [districtData, allYrs, available] = await Promise.all([getDistrict(districtId), getRotaryYears(), getDistrictAdAvailableYears(districtId)]);
        setDistrictNumber(districtData.districtNumber);
        setAllRotaryYears(allYrs);
        const years = available.length > 0 ? available : (allYrs.find((y: any) => y.isCurrent) ? [allYrs.find((y: any) => y.isCurrent)] : []);
        setAllYears(years);
        const currentYear = years.find((y: any) => y.isCurrent);
        const defaultYear = currentYear || years[0];
        if (defaultYear) setSelectedYearId(String(defaultYear.id));
      } catch { setErrorMessage("Failed to load data."); } finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  const fetchAdvertisements = useCallback(async (yearId: number) => {
    setLoadingAds(true);
    try { const data = await getDistrictAdvertisements(districtId, yearId); setAdvertisements(data); }
    catch { setErrorMessage("Failed to load advertisements."); }
    finally { setLoadingAds(false); }
  }, [districtId]);

  useEffect(() => {
    if (selectedYearId) fetchAdvertisements(Number(selectedYearId));
    else setAdvertisements([]);
  }, [selectedYearId, fetchAdvertisements]);

  const { dragProps } = useDragSort(advertisements, setAdvertisements, async (ids) => {
    try { await reorderDistrictAdvertisementsAll(districtId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchAdvertisements(Number(selectedYearId)); }
  });

  const openAddDialog = () => {
    setEditingAd(null); setFormImagePath(""); setFormDocumentPath(undefined); setFormDocumentName(""); setFormLinkUrl("");
    setFormDescription(""); setFormIsActive("1"); setFormYearId(selectedYearId); setDialogOpen(true);
  };

  const openEditDialog = (ad: AdvertisementItem) => {
    setEditingAd(ad); setFormImagePath(ad.advertisementImagePath);
    setFormDocumentPath(ad.documentPath || undefined); setFormDocumentName(ad.documentPath ? ad.documentPath.split("/").pop() || "Document" : ""); setFormLinkUrl(ad.linkUrl || "");
    setFormDescription(ad.description || ""); setFormIsActive(ad.isActive ? "1" : "0"); setFormYearId(String(ad.yearId)); setDialogOpen(true);
  };

  const handleCropSave = async (blob: Blob) => {
    setUploading(true);
    try {
      const file = new File([blob], "advertisement.png", { type: "image/png" });
      const { path, url } = await uploadDistrictAdvertisementImage(districtId, file);
      setFormImagePath(url || path); adCrop.cancel();
    } catch { setErrorMessage("Failed to upload image."); } finally { setUploading(false); }
  };

  const handleDocumentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    setUploadingDoc(true);
    try {
      const { path } = await uploadDistrictAdvertisementImage(districtId, file);
      setFormDocumentPath(path); setFormDocumentName(file.name);
    } catch { setErrorMessage("Failed to upload document."); } finally { setUploadingDoc(false); }
  };

  const handleSave = async () => {
    if (!formImagePath) { setErrorMessage("Please upload an advertisement image."); return; }
    if (!editingAd && !formYearId) { setErrorMessage("Please select a rotary year."); return; }
    const isActivating = formIsActive === "1";
    if (isActivating) {
      const currentActiveCount = editingAd ? advertisements.filter((a) => a.isActive && a.id !== editingAd.id).length : activeCount;
      if (currentActiveCount >= maxActive) { setErrorMessage(`Maximum ${maxActive} active advertisements allowed per year.`); return; }
    }
    setSaving(true);
    try {
      if (editingAd) {
        await updateDistrictAdvertisement(districtId, editingAd.id, { advertisementImagePath: fileNameOnly(formImagePath), documentPath: formDocumentPath || undefined, linkUrl: formLinkUrl.trim() || undefined, description: formDescription || undefined, sortOrder: editingAd.sortOrder, isActive: isActivating });
        setSuccessMessage("Advertisement updated successfully.");
      } else {
        const nextSort = advertisements.length > 0 ? Math.max(...advertisements.map((a) => a.sortOrder)) + 1 : 1;
        await createDistrictAdvertisement(districtId, { yearId: Number(formYearId), advertisementImagePath: fileNameOnly(formImagePath), documentPath: formDocumentPath || undefined, linkUrl: formLinkUrl.trim() || undefined, description: formDescription || undefined, sortOrder: nextSort, isActive: isActivating });
        setSuccessMessage("Advertisement added successfully.");
      }
      setDialogOpen(false); fetchAdvertisements(Number(selectedYearId));
      try { const av = await getDistrictAdAvailableYears(districtId); if (av.length > 0) setAllYears(av); } catch {}
    } catch { setErrorMessage("Failed to save advertisement."); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteDistrictAdvertisement(districtId, deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Advertisement deleted successfully."); fetchAdvertisements(Number(selectedYearId)); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete advertisement."); }
  };

  const handleToggleActive = async (ad: AdvertisementItem) => {
    if (!ad.isActive && activeCount >= maxActive) { setErrorMessage(`Maximum ${maxActive} active advertisements allowed per year.`); return; }
    try {
      await updateDistrictAdvertisement(districtId, ad.id, { advertisementImagePath: ad.advertisementImagePath, documentPath: ad.documentPath || undefined, description: ad.description, sortOrder: ad.sortOrder, isActive: !ad.isActive });
      setSuccessMessage(ad.isActive ? "Advertisement deactivated." : "Advertisement activated."); fetchAdvertisements(Number(selectedYearId));
    } catch { setErrorMessage("Failed to update advertisement status."); }
  };

  const handleViewDocument = (docPath: string) => { const url = getPhotoUrl(docPath); if (url) window.open(url, "_blank"); };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{districtNumber ? `District ${districtNumber} - Advertisements` : "Advertisements"}</h2>
              <p className="text-muted-foreground text-base">Manage district website advertisements by year</p>
            </div>
          </div>
          {canManage && (<Button onClick={openAddDialog} disabled={!selectedYearId}><Plus className="mr-2 h-4 w-4" />Add Advertisement</Button>)}
        </div>

        {loading && (<div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>)}

        {!loading && allYears.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-48">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>{allYears.map((y) => (<SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            {selectedYearId && !loadingAds && (<Badge variant={activeCount >= maxActive ? "destructive" : "secondary"}>{activeCount}/{maxActive} Active</Badge>)}
          </div>
        )}

        {loadingAds && (<div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>)}

        {!loading && !loadingAds && selectedYearId && advertisements.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No advertisements yet</h3>
            <p className="text-muted-foreground mt-2">{canManage ? 'Click "Add Advertisement" to upload your first advertisement.' : "No advertisements have been added yet."}</p>
          </div>
        )}

        {!loading && !loadingAds && advertisements.length > 0 && (
          <>
            <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search advertisements..." />
            {filteredAdvertisements.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            <div className="block sm:hidden space-y-3">
              {filteredAdvertisements.map((ad, idx) => {
                const photoUrl = getPhotoUrl(ad.advertisementImagePath);
                return (
                  <Card key={ad.id} className="border-primary/20 relative">
                    {canManage && !isSearching && (
                      <div
                        {...dragProps(idx)}
                        className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur rounded p-1 text-muted-foreground"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-4 w-4 cursor-grab" />
                      </div>
                    )}
                    <CardContent className="p-4 space-y-3">
                      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
                        {photoUrl ? (<Image src={photoUrl} alt={ad.description || "Advertisement"} fill className="object-cover" unoptimized />) : (<div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary"><ImageIcon className="h-8 w-8" /></div>)}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-muted-foreground truncate">{ad.description || "No description"}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={ad.isActive ? "default" : "secondary"}>{ad.isActive ? "Active" : "Inactive"}</Badge>
                            {ad.documentPath && (<Badge variant="outline" className="gap-1 cursor-pointer" onClick={() => handleViewDocument(ad.documentPath!)}><FileText className="h-3 w-3" />Doc</Badge>)}
                          </div>
                        </div>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(ad)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleActive(ad)}>{ad.isActive ? (<><EyeOff className="mr-2 h-4 w-4" />Deactivate</>) : (<><Eye className="mr-2 h-4 w-4" />Activate</>)}</DropdownMenuItem>
                              {ad.documentPath && (<DropdownMenuItem onClick={() => handleViewDocument(ad.documentPath!)}><ExternalLink className="mr-2 h-4 w-4" />View Document</DropdownMenuItem>)}
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(ad)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
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
                    <TableHead className="w-24 text-primary-foreground">Thumbnail</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Description</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold">Document</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold">Status</TableHead>
                    {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
                    {canManage && <TableHead className="w-20 text-primary-foreground text-base font-semibold text-center">Sorting</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAdvertisements.map((ad, idx) => {
                    const photoUrl = getPhotoUrl(ad.advertisementImagePath);
                    return (
                      <TableRow key={ad.id} className="hover:bg-primary/5 transition-colors">
                        <TableCell>
                          <div className="relative h-[45px] w-[80px] overflow-hidden rounded bg-muted">
                            {photoUrl ? (<Image src={photoUrl} alt={ad.description || "Advertisement"} fill className="object-cover" unoptimized />) : (<div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary"><ImageIcon className="h-4 w-4" /></div>)}
                          </div>
                        </TableCell>
                        <TableCell>{ad.description || "No description"}</TableCell>
                        <TableCell>{ad.documentPath ? (<Button variant="ghost" size="sm" className="h-7 gap-1 text-primary" onClick={() => handleViewDocument(ad.documentPath!)}><FileText className="h-3.5 w-3.5" /><span className="text-xs">View</span></Button>) : (<span className="text-muted-foreground text-sm">None</span>)}</TableCell>
                        <TableCell><Badge variant={ad.isActive ? "default" : "secondary"}>{ad.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        {canManage && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditDialog(ad)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleToggleActive(ad)}>{ad.isActive ? (<><EyeOff className="mr-2 h-4 w-4" />Deactivate</>) : (<><Eye className="mr-2 h-4 w-4" />Activate</>)}</DropdownMenuItem>
                                {ad.documentPath && (<DropdownMenuItem onClick={() => handleViewDocument(ad.documentPath!)}><ExternalLink className="mr-2 h-4 w-4" />View Document</DropdownMenuItem>)}
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(ad)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
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
              <DialogTitle>{editingAd ? "Edit Advertisement" : "Add Advertisement"}</DialogTitle>
              <DialogDescription>{editingAd ? "Update the advertisement details." : "Upload an image and fill in the details."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Advertisement Image *</Label>
                {formImagePath ? (
                  <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted">
                    <Image src={getPhotoUrl(formImagePath)} alt="Advertisement preview" fill className="object-cover" unoptimized />
                    <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={() => setFormImagePath("")}><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <div>
                    <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) adCrop.startCrop(f); e.target.value = ""; }} />
                    <Button type="button" variant="outline" className="w-full h-24 border-dashed" onClick={() => fileInputRef.current?.click()}>
                      <div className="flex flex-col items-center gap-1"><Upload className="h-6 w-6 text-muted-foreground" /><span className="text-sm text-muted-foreground">Click to upload image</span></div>
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                    {adCrop.error && <p className="text-xs text-destructive mt-1.5">{adCrop.error}</p>}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Document or Link (optional)</Label>
                <DocumentOrLinkField
                  value={{ documentPath: formDocumentPath, documentName: formDocumentName, linkUrl: formLinkUrl }}
                  onChange={(v) => { setFormDocumentPath(v.documentPath); setFormDocumentName(v.documentName); setFormLinkUrl(v.linkUrl); }}
                  uploadDocument={async (f) => (await uploadDistrictAdvertisementDocument(districtId, f)).path}
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
                <Select value={formIsActive} onValueChange={setFormIsActive}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent></Select>
              </div>
              {!editingAd && (
                <div className="space-y-2"><Label>Rotary Year</Label>
                  <Select value={formYearId} onValueChange={setFormYearId}><SelectTrigger><SelectValue placeholder="Select a year" /></SelectTrigger><SelectContent>{allRotaryYears.map((y) => (<SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>))}</SelectContent></Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !formImagePath}>{saving ? "Saving..." : editingAd ? "Update" : "Add"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ImageCropDialog
          open={adCrop.open}
          imageSrc={adCrop.imageSrc}
          maxOutputWidth={AD_MAX_WIDTH}
          allowOrientation
          title="Crop Advertisement Image"
          saving={uploading}
          onCancel={adCrop.cancel}
          onSave={handleCropSave}
        />

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Advertisement" description={<>Are you sure you want to delete this advertisement{deleteTarget?.description ? (<> &mdash; <span className="font-semibold text-foreground">{deleteTarget.description}</span></>) : null}? This action cannot be undone.</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
