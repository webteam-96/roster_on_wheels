"use client";

/**
 * Logos sub-module of Website Data.
 *
 * Two per-club horizontal logos stored on club_master:
 *   - ClubLogoPath    (same column the club add/edit page already reads/writes →
 *                      changing the logo here automatically reflects on edit)
 *   - RotaryLogoPath  (separate per-club "Rotary" logo — added 2026-06-25)
 *
 * Crop UI is the shared ImageCropDialog (react-easy-crop under the hood):
 *   - Drag to pan, mouse-wheel or slider to zoom (1×–3×)
 *   - Aspect locked to 3:1 for horizontal logos
 *   - Pixel-perfect crop emitted as a JPEG blob via canvas
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Image as ImageIcon, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getClubLogos, setClubLogos, uploadClubLogoFile, uploadRotaryLogoFile, getPhotoUrl } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

// Per-logo crop targets:
//   • Club Logo   → SQUARE (1:1) — typical circular/square club emblem.
//                   300×300 CSS display → 900×900 stored for retina.
//   • Rotary Logo → 3.75:1 horizontal banner — fits the website's 300×80 header slot.
//                   900×240 stored for retina.
// Locking the aspect per kind means "what you see in the cropper IS what the
// site shows" — no surprise letterboxing or distortion.
const CLUB_ASPECT   = 1;            // 1 : 1   — square club emblem
const ROTARY_ASPECT = 300 / 80;     // 3.75 : 1 — horizontal banner

const CLUB_MAX_OUTPUT   = 900;      // 900×900
const ROTARY_MAX_WIDTH  = 900;      // 900×240 (height derives from ROTARY_ASPECT)

// A short club name puts "Club of …" on a second line, so the Rotary logo is taller than 3.75:1 and
// the locked crop box (zoom can't go below 100%) cut its bottom off (user 2026-10-08). Before the
// crop window opens, the image is padded with transparent space to 3.75:1 at its own resolution -
// at 100% the WHOLE logo shows, and the admin can still crop/zoom as before. Wider images are padded
// top/bottom the same way.
function padToAspect(file: File, aspect: number): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const w = Math.max(iw, Math.round(ih * aspect));
      const h = Math.max(ih, Math.round(w / aspect));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx || (w === iw && h === ih)) { resolve(file); return; }   // already the right shape
      ctx.drawImage(img, Math.round((w - iw) / 2), Math.round((h - ih) / 2));
      canvas.toBlob((b) => resolve(b ? new File([b], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" }) : file), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };   // let the normal checks report it
    img.src = url;
  });
}

export default function ClubWebsiteLogosPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  // ?returnTo= honored so the Back arrow returns the user to wherever they came from
  // (e.g. /club-admin-dashboard/my-club-website). Falls back to the website-data hub.
  const returnTo = searchParams.get("returnTo") || `/clubs/${clubId}/website-data`;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"club" | "rotary" | null>(null);
  const [clubLogoUrl, setClubLogoUrl] = useState<string | null>(null);
  const [rotaryLogoUrl, setRotaryLogoUrl] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One crop-upload hook per logo target — each has its own aspect lock.
  const clubCrop = useImageCropUpload();
  const rotaryCrop = useImageCropUpload();
  const clubFileInputRef = useRef<HTMLInputElement | null>(null);
  const rotaryFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getClubLogos(clubId);
        setClubLogoUrl(data.clubLogoUrl);
        setRotaryLogoUrl(data.rotaryLogoUrl);
      } catch {
        setError("Failed to load logos.");
      } finally {
        setLoading(false);
      }
    })();
  }, [clubId]);

  const refreshLogos = async () => {
    const refreshed = await getClubLogos(clubId);
    setClubLogoUrl(refreshed.clubLogoUrl);
    setRotaryLogoUrl(refreshed.rotaryLogoUrl);
  };

  const handleSaveClubLogo = async (blob: Blob) => {
    setSaving("club");
    try {
      const fileForUpload = new File([blob], `club-logo-${Date.now()}.png`, { type: "image/png" });
      const { path } = await uploadClubLogoFile(clubId, fileForUpload);
      await setClubLogos(clubId, { clubLogoPath: path });
      await refreshLogos();
      setSuccess("Club logo updated.");
      clubCrop.cancel();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to save the logo.");
    } finally {
      setSaving(null);
    }
  };

  const handleSaveRotaryLogo = async (blob: Blob) => {
    setSaving("rotary");
    try {
      const fileForUpload = new File([blob], `rotary-logo-${Date.now()}.png`, { type: "image/png" });
      const { path } = await uploadRotaryLogoFile(clubId, fileForUpload);
      await setClubLogos(clubId, { rotaryLogoPath: path });
      await refreshLogos();
      setSuccess("Rotary logo updated.");
      rotaryCrop.cancel();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to save the logo.");
    } finally {
      setSaving(null);
    }
  };

  if (!canManage) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center py-20"><h3>Access Denied</h3></div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
        <ErrorAlert   open={!!error}   title="Error"   description={error   || ""} onOk={() => setError(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={returnTo}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-primary">Logos</h2>
            <p className="text-muted-foreground">
              <strong>Club Logo</strong>: square (1:1), saved at 900×900 for retina.{" "}
              <strong>Rotary Logo</strong>: horizontal (3.75:1), saved at 900×240 to fit the website's 300×80 header slot.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Club Logo (same column as the club add/edit page) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Club Logo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Same image as on the Club add/edit page. Update here and it reflects everywhere.
                </p>
                <div className="aspect-square w-48 mx-auto bg-slate-50 border border-dashed border-slate-300 rounded-md flex items-center justify-center overflow-hidden">
                  {clubLogoUrl ? (
                    <img src={getPhotoUrl(clubLogoUrl)} alt="Club logo" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="text-sm text-slate-400">No logo uploaded yet</span>
                  )}
                </div>
                <input
                  ref={clubFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) clubCrop.startCrop(f); e.target.value = ""; }}
                />
                <Button variant="outline" onClick={() => clubFileInputRef.current?.click()} disabled={saving !== null}>
                  <Upload className="h-4 w-4 mr-2" />{clubLogoUrl ? "Change" : "Upload"} Club Logo
                </Button>
                {clubCrop.error && <p className="text-xs text-destructive">{clubCrop.error}</p>}
              </CardContent>
            </Card>

            {/* Rotary Logo */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Rotary Logo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Club's branded Rotary mark (e.g., your district/zone variant). Displayed alongside Club Logo on the website header.
                </p>
                <div className="aspect-[300/80] w-full bg-slate-50 border border-dashed border-slate-300 rounded-md flex items-center justify-center overflow-hidden">
                  {rotaryLogoUrl ? (
                    <img src={getPhotoUrl(rotaryLogoUrl)} alt="Rotary logo" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="text-sm text-slate-400">No logo uploaded yet</span>
                  )}
                </div>
                <input
                  ref={rotaryFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) rotaryCrop.startCrop(f.type.startsWith("image/") ? await padToAspect(f, ROTARY_ASPECT) : f);
                  }}
                />
                <Button variant="outline" onClick={() => rotaryFileInputRef.current?.click()} disabled={saving !== null}>
                  <Upload className="h-4 w-4 mr-2" />{rotaryLogoUrl ? "Change" : "Upload"} Rotary Logo
                </Button>
                {rotaryCrop.error && <p className="text-xs text-destructive">{rotaryCrop.error}</p>}
              </CardContent>
            </Card>
          </div>
        )}

        <ImageCropDialog
          open={clubCrop.open}
          imageSrc={clubCrop.imageSrc}
          aspect={CLUB_ASPECT}
          maxOutputWidth={CLUB_MAX_OUTPUT}
          title="Crop Club Logo"
          saving={saving === "club"}
          onCancel={clubCrop.cancel}
          onSave={handleSaveClubLogo}
        />
        <ImageCropDialog
          open={rotaryCrop.open}
          imageSrc={rotaryCrop.imageSrc}
          aspect={ROTARY_ASPECT}
          maxOutputWidth={ROTARY_MAX_WIDTH}
          title="Crop Rotary Logo"
          saving={saving === "rotary"}
          onCancel={rotaryCrop.cancel}
          onSave={handleSaveRotaryLogo}
        />
      </div>
    </ProtectedRoute>
  );
}
