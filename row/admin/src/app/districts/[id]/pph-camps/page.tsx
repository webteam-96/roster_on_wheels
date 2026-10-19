"use client";

import { useState, useEffect, useCallback } from "react";
import DateField from "@/components/DateField";
import { useParams, useRouter } from "next/navigation";
import { PphCamp } from "@/types/pphCamp";
import {
  getDistrict,
  getDistrictPphCamps,
  createDistrictPphCamp,
  updateDistrictPphCamp,
  deleteDistrictPphCamp,
  toggleDistrictPphCampActive,
  getPhotoUrl,
  getDistrictPphAttendeeReport,
} from "@/services/api";
import { exportPphAttendeeReport } from "@/utils/pphAttendeeReport";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Users,
  FolderOpen,
  AlertTriangle,
  Info,
  ImageIcon,
  Download,
  Loader2,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

import { appLocale } from "@/lib/appFormat";
// The camp logo fills a landscape header tile on the camp cards — locked to
// 16:9 at 1200×675.
const LOGO_ASPECT = 16 / 9;
const LOGO_MAX_WIDTH = 1200;

function PphCampIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="10" width="32" height="28" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M24 16v12M18 22h12" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="22" r="8" className="fill-primary/10 stroke-primary" strokeWidth="1.5" />
      <path d="M14 34h20" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 10l4-6h20l4 6" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function DistrictPphCampsPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtName, setDistrictName] = useState("");
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [camps, setCamps] = useState<PphCamp[]>([]);
  const [loading, setLoading] = useState(true);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PphCamp | null>(null);
  const [navigatingCampId, setNavigatingCampId] = useState<number | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCamp, setEditingCamp] = useState<PphCamp | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formLogo, setFormLogo] = useState<File | null>(null);
  const [formLogoPreview, setFormLogoPreview] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const logoCrop = useImageCropUpload();

  const handleCroppedLogo = (blob: Blob) => {
    const file = new File([blob], `pph-camp-logo-${Date.now()}.png`, { type: "image/png" });
    setFormLogo(file);
    setFormLogoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    logoCrop.cancel();
  };

  const clearFormLogo = () => {
    setFormLogo(null);
    setFormLogoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  };

  const [searchQuery, setSearchQuery] = useState("");

  const canManage = isSuperAdmin || isAdmin;

  const fetchCamps = useCallback(async () => {
    setLoading(true);
    try {
      const [d, campsData] = await Promise.all([
        getDistrict(districtId),
        getDistrictPphCamps(districtId),
      ]);
      setDistrictName(`District ${d.districtNumber}`);
      setCamps(campsData);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load PPH camps.");
    } finally {
      setLoading(false);
    }
  }, [districtId]);

  useEffect(() => {
    fetchCamps();
  }, [fetchCamps]);

  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormAddress("");
    setFormDate("");
    clearFormLogo();
    setEditingCamp(null);
  };

  const openAddDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (camp: PphCamp) => {
    setEditingCamp(camp);
    setFormTitle(camp.title);
    setFormDescription(camp.description || "");
    setFormAddress(camp.address || "");
    setFormDate(camp.campDate ? camp.campDate.split("T")[0] : "");
    clearFormLogo();
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formTitle.trim()) {
      setErrorMessage("Title is required.");
      return;
    }
    if (!formDate) {
      setErrorMessage("Camp date is required.");
      return;
    }

    setFormSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("title", formTitle.trim());
      fd.append("description", formDescription.trim());
      fd.append("address", formAddress.trim());
      fd.append("campDate", formDate);
      if (formLogo) {
        fd.append("logo", formLogo);
      }

      if (editingCamp) {
        fd.append("isActive", editingCamp.isActive ? "true" : "false");
        await updateDistrictPphCamp(districtId, editingCamp.id, fd);
        setSuccessMessage("Camp updated successfully.");
      } else {
        await createDistrictPphCamp(districtId, fd);
        setSuccessMessage("Camp created successfully.");
      }
      setDialogOpen(false);
      resetForm();
      fetchCamps();
    } catch (err: unknown) {
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || "Failed to save camp."
      );
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictPphCamp(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Camp deleted successfully.");
      fetchCamps();
    } catch (err: unknown) {
      setDeleteTarget(null);
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || "Failed to delete camp."
      );
    }
  };

  const handleToggleActive = async (camp: PphCamp) => {
    try {
      await toggleDistrictPphCampActive(districtId, camp.id);
      setCamps((prev) =>
        prev.map((c) =>
          c.id === camp.id ? { ...c, isActive: !c.isActive } : c
        )
      );
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to toggle active status.");
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString(appLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const filteredCamps = camps.filter((camp) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (camp.title || "").toLowerCase().includes(q) ||
      (camp.address || "").toLowerCase().includes(q) ||
      (camp.campDate ? formatDate(camp.campDate).toLowerCase().includes(q) : false)
    );
  });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/dashboard`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtName ? `${districtName} - PPH Camps` : "PPH Camps"}
              </h2>
              <p className="text-muted-foreground text-base">
                Preventive Public Health Camps
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                setDownloadingReport(true);
                try {
                  const rows = await getDistrictPphAttendeeReport(districtId);
                  if (!rows.length) { setErrorMessage("No attendee entries to export for this district."); return; }
                  exportPphAttendeeReport(rows, {
                    filename: "PPH_Camp_Attendees_District",
                    title: "PPH Camp Attendee Report",
                    subtitle: `${districtName || "District"}: all attendee entries across clubs (club-wise)`,
                  });
                } catch (err: any) {
                  setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to download attendee report.");
                } finally {
                  setDownloadingReport(false);
                }
              }}
              disabled={downloadingReport}
              title="Download the district's attendee report across all clubs (Excel)"
            >
              {downloadingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Attendee Report
            </Button>
            {canManage && (
              <Button onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add Camp
              </Button>
            )}
          </div>
        </div>

        <Card className="border-sky-200 bg-sky-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-sky-600 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-sky-900 mb-2">
                  Normal Parameters For Reference
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-sky-800">
                  <div>
                    <span className="font-medium">Fasting Blood Sugar:</span>{" "}
                    &lt; 100 mg/dl
                  </div>
                  <div>
                    <span className="font-medium">Random Blood Sugar:</span>{" "}
                    &lt; 140 mg/dl
                  </div>
                  <div>
                    <span className="font-medium">Blood Pressure:</span>{" "}
                    &lt; 130/90 mm Hg
                  </div>
                  <div>
                    <span className="font-medium">BMI:</span> &lt; 25
                  </div>
                </div>
                <p className="text-xs text-sky-600 mt-2">
                  Please note these are normal parameters for your reference only.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && camps.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by title, address, date..."
          />
        )}

        {!loading && camps.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No PPH camps found</h3>
            <p className="text-muted-foreground mt-2">
              {canManage
                ? 'Click "Add Camp" to create your first camp.'
                : "No camps have been created yet."}
            </p>
          </div>
        )}

        {!loading && filteredCamps.length === 0 && camps.length > 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground mt-2">No camps match your search &quot;{searchQuery}&quot;.</p>
          </div>
        )}

        {!loading && filteredCamps.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCamps.map((camp) => (
              <Card key={camp.id} className="relative overflow-hidden">
                {camp.campLogoPath ? (
                  <div className="h-40 w-full bg-muted">
                    <img
                      src={getPhotoUrl(camp.campLogoPath)}
                      alt={camp.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-40 w-full bg-muted/50 flex items-center justify-center">
                    <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
                  </div>
                )}

                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground line-clamp-1">
                      {camp.title}
                    </h3>
                    <Badge
                      variant={camp.isActive ? "default" : "secondary"}
                      className={
                        camp.isActive
                          ? "bg-green-100 text-green-800 hover:bg-green-100"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-100"
                      }
                    >
                      {camp.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {formatDate(camp.campDate)}
                  </p>

                  {camp.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {camp.description}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      <Users className="mr-1 h-3 w-3" />
                      {camp.attendanceCount} Attendees
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={navigatingCampId === camp.id}
                      onClick={() => {
                        setNavigatingCampId(camp.id);
                        router.push(
                          `/districts/${districtId}/pph-camps/${camp.id}/attendance`
                        );
                      }}
                    >
                      {navigatingCampId === camp.id ? (
                        <><RotaryLoader size="sm" /><span className="ml-1">Loading...</span></>
                      ) : (
                        <><Users className="mr-1 h-3.5 w-3.5" />Attendance</>
                      )}
                    </Button>

                    {canManage && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(camp)}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(camp)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Delete
                        </Button>
                        <div className="ml-auto flex items-center gap-2">
                          <Switch
                            checked={camp.isActive}
                            onCheckedChange={() => handleToggleActive(camp)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setDialogOpen(false);
              resetForm();
            }
          }}
        >
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingCamp ? "Edit Camp" : "Add New Camp"}
              </DialogTitle>
              <DialogDescription>
                {editingCamp
                  ? "Update the camp details below."
                  : "Fill in the details to create a new PPH camp."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="camp-title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="camp-title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Enter camp title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="camp-description">Description</Label>
                <Textarea
                  id="camp-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Enter camp description"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="camp-address">Address</Label>
                <Textarea
                  id="camp-address"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="Enter camp address"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="camp-date">
                  Date <span className="text-destructive">*</span>
                </Label>
                <DateField id="camp-date" value={formDate} onChange={setFormDate} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="camp-logo">Camp Logo</Label>
                {formLogoPreview && (
                  <img src={formLogoPreview} alt="Camp logo" className="h-28 w-full max-w-xs object-cover rounded-lg border" />
                )}
                <Input
                  id="camp-logo"
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.webp"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) logoCrop.startCrop(f); e.target.value = ""; }}
                />
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                {logoCrop.error && <p className="text-xs text-destructive">{logoCrop.error}</p>}
                {editingCamp?.campLogoPath && !formLogo && (
                  <p className="text-xs text-muted-foreground">
                    Current logo will be kept if no new file is selected.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={formSubmitting}>
                {formSubmitting
                  ? "Saving..."
                  : editingCamp
                  ? "Update"
                  : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ImageCropDialog
          open={logoCrop.open}
          imageSrc={logoCrop.imageSrc}
          aspect={LOGO_ASPECT}
          maxOutputWidth={LOGO_MAX_WIDTH}
          title="Crop Camp Logo"
          onCancel={logoCrop.cancel}
          onSave={handleCroppedLogo}
        />

        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Camp"
          description={
            deleteTarget && deleteTarget.attendanceCount > 0 ? (
              <>
                The camp{" "}
                <span className="font-semibold text-foreground">
                  {deleteTarget.title}
                </span>{" "}
                has {deleteTarget.attendanceCount} attendance record(s). Please
                delete all attendance records first before deleting the camp.
              </>
            ) : (
              <>
                Are you sure you want to delete{" "}
                <span className="font-semibold text-foreground">
                  {deleteTarget?.title}
                </span>
                ? This action cannot be undone.
              </>
            )
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={
            deleteTarget && deleteTarget.attendanceCount > 0
              ? () => setDeleteTarget(null)
              : handleDelete
          }
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert
          open={!!successMessage}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
