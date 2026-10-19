"use client";

/**
 * District PPH Camp V2 — Edit.
 *
 * Same data semantics as the v1 edit dialog: loads the camp, pre-fills the
 * FormData fields, keeps isActive, and calls updateDistrictPphCamp. There is no
 * single-camp getter, so we read the district list and find the camp by id
 * (mirrors how v1 held the camp in state). Chrome = DistrictAdminShell + V2FormShell.
 */

import { useEffect, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import { FileText } from "@/components/icons";
import { PphCamp } from "@/types/pphCamp";
import { getDistrict, getDistrictPphCamps, updateDistrictPphCamp } from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictEgovernanceTabBar from "@/components/dashboard/DistrictEgovernanceTabBar";
import DistrictEgovernanceKpis from "@/components/dashboard/DistrictEgovernanceKpis";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

// The camp logo fills a landscape header tile on the camp cards — locked to
// 16:9 at 1200×675.
const LOGO_ASPECT = 16 / 9;
const LOGO_MAX_WIDTH = 1200;

function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();
  useEffect(() => {
    if (Number.isFinite(urlDistrictId) && urlDistrictId > 0 && urlDistrictId !== selectedDistrictId) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}

export default function DistrictPphCampV2EditPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const districtId = Number(params.id);
  const campId = Number(params.campId);
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/pph-camps/v2`);

  const [districtName, setDistrictName] = useState("");
  const [camp, setCamp] = useState<PphCamp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [campDate, setCampDate] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const logoCrop = useImageCropUpload();

  const handleCroppedLogo = (blob: Blob) => {
    const file = new File([blob], `pph-camp-logo-${Date.now()}.png`, { type: "image/png" });
    setLogo(file);
    setLogoPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    logoCrop.cancel();
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [d, camps] = await Promise.all([getDistrict(districtId), getDistrictPphCamps(districtId)]);
        setDistrictName(`District ${d.districtNumber}`);
        const found = camps.find((c: PphCamp) => c.id === campId) || null;
        setCamp(found);
        if (found) {
          setTitle(found.title || "");
          setDescription(found.description || "");
          setAddress(found.address || "");
          setCampDate(found.campDate ? found.campDate.split("T")[0] : "");
        } else {
          setErrorMessage("Camp not found.");
        }
      } catch (err: unknown) {
        setErrorMessage((err as any)?.response?.data?.message || "Failed to load camp.");
      } finally {
        setLoading(false);
      }
    })();
  }, [districtId, campId]);

  const handleSave = async () => {
    if (!camp) return;
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (!campDate) { setErrorMessage("Camp date is required."); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("address", address.trim());
      fd.append("campDate", campDate);
      fd.append("isActive", camp.isActive ? "true" : "false");
      if (logo) fd.append("logo", logo);
      await updateDistrictPphCamp(districtId, camp.id, fd);
      setSuccessMessage("Camp updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const d = (err as any)?.response?.data;
      setErrorMessage(d?.message || d?.detail || d?.title || "Failed to save camp.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell pageTitle="Edit PPH Camp" activeNavHref="/district-admin-dashboard/egovernance">
          <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <DistrictAdminShell pageTitle="Edit PPH Camp" activeNavHref="/district-admin-dashboard/egovernance">
        <div className="space-y-4 mb-4">
          <DistrictEgovernanceKpis districtId={districtId} />
          <DistrictEgovernanceTabBar />
        </div>
        <V2FormShell
          title="Edit PPH Camp"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/pph-camps/v2`}
          saving={saving}
          saveLabel="Update Camp"
          onSave={handleSave}
        >
          <div className="flex items-center gap-2 mb-4 text-slate-500">
            <FileText size={16} />
            <h3 className="text-sm font-semibold text-slate-800">Camp Details</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Title <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter camp title"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter camp description"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter camp address"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Date <span className="text-rose-600">*</span>
              </label>
              <DateField value={campDate} onChange={setCampDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Camp Logo</label>
              {logoPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="Camp logo" className="h-28 w-full max-w-xs object-cover rounded-lg border border-slate-200 mb-2" />
              )}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) logoCrop.startCrop(f); e.target.value = ""; }}
                className="w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              />
              <p className="text-xs text-slate-400 mt-1">
                {camp?.campLogoPath ? "Current logo is kept if no new file is selected." : "Allowed: JPG, JPEG, PNG, GIF, WEBP"}
              </p>
              {logoCrop.error && <p className="text-xs text-rose-600 mt-1">{logoCrop.error}</p>}
            </div>
          </div>

          <ImageCropDialog
            open={logoCrop.open}
            imageSrc={logoCrop.imageSrc}
            aspect={LOGO_ASPECT}
            maxOutputWidth={LOGO_MAX_WIDTH}
            title="Crop Camp Logo"
            onCancel={logoCrop.cancel}
            onSave={handleCroppedLogo}
          />
          <SuccessAlert
            open={showSuccessDialog}
            title="Saved"
            description={successMessage || "Camp updated successfully."}
            onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
          />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </V2FormShell>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
